// Prueba de la lógica pura de variantes y filtros de producto. Ejecutar: node tests/variants.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../woo-shopify-sync.html', import.meta.url), 'utf8');
const cmp = html.match(/\/\/ COMPARE-PURE-BEGIN([\s\S]*?)\/\/ COMPARE-PURE-END/);
const m = html.match(/\/\/ VARIANTS-PURE-BEGIN([\s\S]*?)\/\/ VARIANTS-PURE-END/);
assert.ok(cmp, 'No se encontró el bloque COMPARE-PURE');
assert.ok(m, 'No se encontró el bloque VARIANTS-PURE en el HTML');
const { isSyncableWooProduct, priceFields, productOptionNames, variationStock, planVariants } =
  new Function(`${cmp[1]}; ${m[1]}; return { isSyncableWooProduct, priceFields, productOptionNames, variationStock, planVariants };`)();

// ── Filtro de productos sincronizables: publicados y visibles ──
assert.equal(isSyncableWooProduct({ status: 'publish', catalog_visibility: 'visible' }), true);
assert.equal(isSyncableWooProduct({ status: 'publish' }), true, 'sin catalog_visibility se asume visible');
assert.equal(isSyncableWooProduct({ status: 'draft', catalog_visibility: 'visible' }), false);
assert.equal(isSyncableWooProduct({ status: 'publish', catalog_visibility: 'hidden' }), false);
assert.equal(isSyncableWooProduct({ status: 'publish', catalog_visibility: 'catalog' }), true, '"Solo tienda" es visible para el cliente: se sincroniza');
assert.equal(isSyncableWooProduct({ status: 'publish', catalog_visibility: 'search' }), true, '"Solo buscador" también se sincroniza');
assert.equal(isSyncableWooProduct(null), false);

// ── Precio y precio tachado ──
assert.deepEqual(priceFields({ price: '19.90', regular_price: '29.50', sale_price: '19.90' }), { price: '19.90', compare_at_price: '29.50' });
assert.deepEqual(priceFields({ price: '29.50', regular_price: '29.50', sale_price: '' }), { price: '29.50', compare_at_price: null });
assert.deepEqual(priceFields({ price: '', regular_price: '10', sale_price: '' }), { price: '10.00', compare_at_price: null });
assert.deepEqual(priceFields({}), { price: '0.00', compare_at_price: null });
// rebaja "al revés" (sale > regular) no produce tachado
assert.deepEqual(priceFields({ price: '30', regular_price: '20', sale_price: '30' }), { price: '30.00', compare_at_price: null });

// ── Nombres de opción a partir de los atributos de variación ──
const wooVariable = {
  id: 100, name: 'Pantalón corto pana', type: 'variable', status: 'publish',
  attributes: [
    { id: 1, name: 'Talla', variation: true, options: ['1 mes', '3 meses'] },
    { id: 0, name: 'Tallaje', variation: false, options: ['Normal'] },
  ],
};
assert.deepEqual(productOptionNames(wooVariable), ['Talla']);
assert.deepEqual(productOptionNames({ attributes: [] }), ['Título'], 'sin atributos de variación se usa un nombre por defecto');
assert.deepEqual(productOptionNames({ attributes: [{ name: 'A', variation: true }, { name: 'B', variation: true }, { name: 'C', variation: true }, { name: 'D', variation: true }] }), ['A', 'B', 'C'], 'máximo tres opciones');

// ── Stock de la variación ──
assert.equal(variationStock({ manage_stock: true, stock_quantity: 3 }, wooVariable), 3);
assert.equal(variationStock({ manage_stock: false, stock_status: 'outofstock' }, wooVariable), 0);
assert.equal(variationStock({ manage_stock: false, stock_status: 'instock' }, wooVariable), null, 'sin gestión de stock y en stock: no se toca');
assert.equal(variationStock({ manage_stock: 'parent', stock_status: 'instock' }, { ...wooVariable, manage_stock: true, stock_quantity: 7 }), 7, 'hereda del padre');
assert.equal(variationStock({ manage_stock: true, stock_quantity: null }, wooVariable), null);

// ── Aviso cuando alguna talla hereda el stock del padre (Shopify lo replica en cada una) ──
const inherit = planVariants({ name: 'Peto', manage_stock: true, stock_quantity: 4, attributes: [{ name: 'Talla', variation: true }] }, [
  { id: 1, status: 'publish', attributes: [{ name: 'Talla', option: 'S' }], price: '10', manage_stock: 'parent', stock_status: 'instock' },
  { id: 2, status: 'publish', attributes: [{ name: 'Talla', option: 'M' }], price: '10', manage_stock: true, stock_quantity: 2 },
], []);
assert.equal(inherit.create.map(v => v.stock).join(','), '4,2');
assert.equal(inherit.warnings.length, 1);
assert.match(inherit.warnings[0], /hereda/);
assert.match(inherit.warnings[0], /\bS\b/);

// ── Plan de variantes: emparejar por valor de opción, no por SKU ──
const wooVariations = [
  { id: 201, status: 'publish', attributes: [{ id: 1, name: 'Talla', option: '1 mes' }], price: '29.50', regular_price: '29.50', sale_price: '', manage_stock: true, stock_quantity: 3, image: { id: 9, src: 'https://woo/1mes.jpg' } },
  { id: 202, status: 'publish', attributes: [{ id: 1, name: 'Talla', option: '3 meses' }], price: '19.90', regular_price: '29.50', sale_price: '19.90', manage_stock: true, stock_quantity: 0, image: null },
  { id: 203, status: 'publish', attributes: [{ id: 1, name: 'Talla', option: '6 meses' }], price: '29.50', regular_price: '29.50', sale_price: '', manage_stock: true, stock_quantity: 5, image: { id: 0, src: null } },
  { id: 204, status: 'private', attributes: [{ id: 1, name: 'Talla', option: '9 meses' }], price: '29.50' },
  { id: 205, status: 'publish', attributes: [{ id: 1, name: 'Talla', option: '1 MES ' }], price: '1' }, // duplicado por normalización
];
const shopifyVariants = [
  { id: 901, option1: 'Default Title', option2: null, option3: null, price: '29.50', compare_at_price: null, inventory_quantity: 0, image_id: null, position: 1 },
  { id: 902, option1: '3 meses', option2: null, option3: null, price: '29.50', compare_at_price: null, inventory_quantity: 4, image_id: null, position: 2 },
  { id: 903, option1: '6 meses', option2: null, option3: null, price: '29.50', compare_at_price: '29.50', inventory_quantity: 5, image_id: 55, position: 3 },
];
const plan = planVariants(wooVariable, wooVariations, shopifyVariants);
assert.deepEqual(plan.optionNames, ['Talla']);
// crear: "1 mes" (no existe en Shopify). La privada y la duplicada no entran.
assert.deepEqual(plan.create.map(v => v.option1), ['1 mes']);
assert.equal(plan.create[0].price, '29.50');
assert.equal(plan.create[0].compare_at_price, null);
assert.equal(plan.create[0].position, 1);
assert.equal(plan.create[0].stock, 3);
assert.equal(plan.create[0].imageSrc, 'https://woo/1mes.jpg');
assert.equal(plan.create[0].inventory_management, 'shopify');
// actualizar: "3 meses" cambia precio y tachado y stock; "6 meses" solo quita un tachado igual al precio
const upd = Object.fromEntries(plan.update.map(u => [u.option1, u]));
assert.equal(upd['3 meses'].id, 902);
assert.deepEqual(upd['3 meses'].patch, { price: '19.90', compare_at_price: '29.50' }, 'posición 2 ya coincide');
assert.equal(upd['3 meses'].stock, 0);
assert.equal(upd['3 meses'].stockDiff, true);
assert.equal(upd['6 meses'].id, 903);
assert.deepEqual(upd['6 meses'].patch, { compare_at_price: null }, 'tachado igual al precio se elimina; posición 3 ya coincide');
assert.equal(upd['6 meses'].stockDiff, false);
assert.equal(upd['6 meses'].imageSrc, null, 'imagen con src nulo no cuenta');
// borrar: la variante de relleno "Default Title"
assert.deepEqual(plan.delete.map(d => d.id), [901]);
// avisos: la duplicada
assert.equal(plan.warnings.length, 1);
assert.match(plan.warnings[0], /1 MES|1 mes/);

// Sin variaciones publicadas → plan vacío y aviso, y nunca se propone borrar todo
const empty = planVariants(wooVariable, [], shopifyVariants);
assert.equal(empty.create.length + empty.update.length, 0);
assert.deepEqual(empty.delete, [], 'sin variaciones en Woo no se borra nada en Shopify');
assert.ok(empty.warnings.length >= 1);

// Variación sin valor de opción ("cualquier talla") usa 'Única'
const anyPlan = planVariants(wooVariable, [{ id: 1, status: 'publish', attributes: [{ id: 1, name: 'Talla', option: '' }], price: '5' }], []);
assert.equal(anyPlan.create[0].option1, 'Única');

console.log('✓ variants: todas las pruebas pasan');
