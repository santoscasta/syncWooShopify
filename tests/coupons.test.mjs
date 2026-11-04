// Prueba de la lógica pura de vales (cupones). Ejecutar: node tests/coupons.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../woo-shopify-sync.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ COUPONS-PURE-BEGIN([\s\S]*?)\/\/ COUPONS-PURE-END/);
assert.ok(m, 'No se encontró el bloque COUPONS-PURE en el HTML');
const { planCoupon, couponRemainingUses, couponSummary } =
  new Function(`${m[1]}; return { planCoupon, couponRemainingUses, couponSummary };`)();

const NOW = new Date('2026-11-04T00:00:00Z');
const base = { code: 'BIENVENIDA', status: 'publish', discount_type: 'percent', amount: '10', date_created: '2026-01-01T00:00:00' };

// ── Usos restantes: Shopify no sabe de consumo previo, se migra el restante ──
assert.equal(couponRemainingUses({ usage_limit: 100, usage_count: 37 }), 63);
assert.equal(couponRemainingUses({ usage_limit: null }), null, 'sin límite');
assert.equal(couponRemainingUses({ usage_limit: 0 }), null, '0 en Woo es "sin límite"');
assert.equal(couponRemainingUses({ usage_limit: 5 }), 5, 'sin usage_count cuenta como 0 usos');

// ── Porcentaje ──
const pct = planCoupon(base, new Map(), NOW);
assert.equal(pct.kind, 'basic');
assert.deepEqual(pct.input.customerGets.value, { percentage: 0.1 }, '10% → 0.1');
assert.deepEqual(pct.input.customerGets.items, { all: true }, 'sin product_ids aplica a todo');
assert.equal(pct.input.code, 'BIENVENIDA');
assert.equal(pct.input.usageLimit, undefined, 'sin límite no se envía usageLimit');
assert.equal(planCoupon({ ...base, amount: '12.5' }, new Map(), NOW).input.customerGets.value.percentage, 0.125, 'porcentaje decimal');

// ── Importe fijo: carrito vs por artículo ──
const cart = planCoupon({ ...base, discount_type: 'fixed_cart', amount: '5' }, new Map(), NOW);
assert.deepEqual(cart.input.customerGets.value, { discountAmount: { amount: '5.00', appliesOnEachItem: false } });
const perItem = planCoupon({ ...base, discount_type: 'fixed_product', amount: '3' }, new Map(), NOW);
assert.equal(perItem.input.customerGets.value.discountAmount.appliesOnEachItem, true);

// ── Fechas, mínimo, uso individual ──
const full = planCoupon({ ...base, date_expires: '2026-12-31T00:00:00', minimum_amount: '20', individual_use: true, usage_limit: 100, usage_count: 37, usage_limit_per_user: 1 }, new Map(), NOW);
assert.equal(full.input.endsAt, new Date('2026-12-31T00:00:00').toISOString());
assert.equal(full.input.minimumRequirement.subtotal.greaterThanOrEqualToSubtotal, '20.00');
assert.deepEqual(full.input.combinesWith, { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }, 'individual_use no combina');
assert.equal(full.input.usageLimit, 63, 'migra el restante, no el límite original');
assert.equal(full.input.appliesOncePerCustomer, true);
assert.deepEqual(planCoupon(base, new Map(), NOW).input.combinesWith, { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true });

// ── Envío gratis ──
const ship = planCoupon({ ...base, discount_type: 'fixed_cart', amount: '0', free_shipping: true }, new Map(), NOW);
assert.equal(ship.kind, 'freeShipping');
assert.deepEqual(ship.input.destination, { all: true });
assert.equal(ship.input.customerGets, undefined, 'el de envío no lleva customerGets');
const mixed = planCoupon({ ...base, free_shipping: true }, new Map(), NOW);
assert.equal(mixed.kind, 'basic');
assert.match(mixed.warn, /envío gratis/, 'mixto: migra el importe y avisa del envío');

// ── Productos concretos: todos deben existir en Shopify ──
const gids = new Map([[11, 'gid://shopify/Product/901'], [22, 'gid://shopify/Product/902']]);
const scoped = planCoupon({ ...base, product_ids: [11, 22] }, gids, NOW);
assert.deepEqual(scoped.input.customerGets.items, { products: { productsToAdd: ['gid://shopify/Product/901', 'gid://shopify/Product/902'] } });
assert.match(planCoupon({ ...base, product_ids: [11, 99] }, gids, NOW).skip, /no están en Shopify/, 'si falta un producto no se migra: aplicaría de más');

// ── Omisiones: todo lo que Shopify haría MÁS permisivo ──
const skips = [
  [{ date_expires: '2026-01-01T00:00:00' }, /caducado/],
  [{ usage_limit: 10, usage_count: 10 }, /agotado/],
  [{ usage_limit_per_user: 3 }, /por cliente/],
  [{ excluded_product_ids: [5] }, /excluye productos/],
  [{ excluded_product_categories: [7] }, /excluye categorías/],
  [{ exclude_sale_items: true }, /rebajados/],
  [{ maximum_amount: '50' }, /importe máximo/],
  [{ limit_usage_to_x_items: 2 }, /nº de artículos/],
  [{ email_restrictions: ['a@b.com'] }, /email/],
  [{ product_categories: [3] }, /categoría/],
  [{ status: 'draft' }, /estado draft/],
  [{ amount: '0' }, /importe 0/],
];
for (const [patch, re] of skips) {
  const r = planCoupon({ ...base, ...patch }, new Map(), NOW);
  assert.ok(r.skip, `debería omitirse: ${JSON.stringify(patch)}`);
  assert.match(r.skip, re);
}
assert.match(planCoupon({ status: 'publish' }, new Map(), NOW).skip, /sin código/);
assert.match(planCoupon(null, new Map(), NOW).skip, /sin código/);

// ── Resumen para el log ──
assert.equal(couponSummary(pct), '10% sobre todo');
assert.equal(couponSummary(cart), '5.00 € sobre todo');
assert.equal(couponSummary(perItem), '3.00 €/artículo sobre todo');
assert.equal(couponSummary(scoped), '10% sobre 2 productos');
assert.equal(couponSummary(full), '10% sobre todo, 63 usos');
assert.equal(couponSummary(ship), 'envío gratis');

console.log('✓ cupones: todas las pruebas pasan');
