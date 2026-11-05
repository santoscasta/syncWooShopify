// Prueba de la lógica pura de comparación de pedidos. Ejecutar: node tests/orders-compare.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../woo-shopify-sync.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ ORDERS-PURE-BEGIN([\s\S]*?)\/\/ ORDERS-PURE-END/);
assert.ok(m, 'No se encontró el bloque ORDERS-PURE en el HTML');
const { wooNumberFromTags, compareOrders, planOrderImport, orderTransactions, orderCustomer, wooOrderCustomerEmail, ordersSummary, ordersHeadline, shopifyOrdersCreatedMin, shopifyReadableFrom, WOO_ORDER_SKIP_STATUSES } =
  new Function(`${m[1]}; return { wooNumberFromTags, compareOrders, planOrderImport, orderTransactions, orderCustomer, wooOrderCustomerEmail, ordersSummary, ordersHeadline, shopifyOrdersCreatedMin, shopifyReadableFrom, WOO_ORDER_SKIP_STATUSES };`)();

const wooOrder = (number, date, extra = {}) => ({ number: String(number), date_created: date, status: 'completed', total: '10.00', ...extra });
const shopifyOrder = (number, date, extra = {}) => ({ name: `#S${number}`, tags: `woo-import, woo-${number}`, created_at: date, total_price: '10.00', ...extra });
const statusOf = (rows, number) => rows.find(r => r.number === String(number))?.status;

// ── Número de Woo a partir de las etiquetas que escribe syncOrders ──
assert.equal(wooNumberFromTags('woo-import, woo-123'), '123');
assert.equal(wooNumberFromTags('woo-123, woo-import'), '123', 'el orden de las etiquetas da igual');
assert.equal(wooNumberFromTags('vip, Woo-77'), '77', 'Shopify puede devolver otra capitalización');
assert.equal(wooNumberFromTags('woo-import'), null, 'la etiqueta genérica no es un número de pedido');
assert.equal(wooNumberFromTags('vip'), null);
assert.equal(wooNumberFromTags(''), null);
assert.equal(wooNumberFromTags(undefined), null);

// ── Estados ──
const rows = compareOrders(
  [
    wooOrder(1, '2026-10-01T10:00:00'),
    wooOrder(2, '2026-10-02T10:00:00'),
    wooOrder(3, '2026-10-03T10:00:00', { status: 'cancelled' }),
    wooOrder(4, '2026-10-04T10:00:00', { status: 'refunded' }),
    wooOrder(5, '2026-10-05T10:00:00'),
  ],
  [
    shopifyOrder(1, '2026-10-01T12:00:00+02:00'),
    shopifyOrder(4, '2026-10-04T12:00:00+02:00'),
    shopifyOrder(5, '2026-10-05T12:00:00+02:00'),
    shopifyOrder(5, '2026-10-05T13:00:00+02:00', { name: '#S5b' }),
    shopifyOrder(99, '2026-10-20T12:00:00+02:00'),
    { name: '#VENTA', tags: '', created_at: '2026-10-21T12:00:00+02:00', total_price: '5.00' },
  ],
  { since: '2026-10-01' },
);
assert.equal(statusOf(rows, 1), 'imported');
assert.equal(statusOf(rows, 2), 'missing');
assert.equal(statusOf(rows, 3), 'skipped', 'cancelado sin copia: no se importa por diseño');
assert.equal(statusOf(rows, 4), 'imported', 'reembolsado después de importarlo: está en Shopify');
assert.equal(statusOf(rows, 5), 'duplicate', 'reimportar crea un segundo pedido con la misma etiqueta');
assert.equal(rows.find(r => r.number === '5').shopify.count, 2);
assert.equal(statusOf(rows, 99), 'shopify_only');
assert.equal(rows.length, 6, 'los pedidos de Shopify sin etiqueta de Woo no entran: son ventas propias');

// Lo que hay que atender sale primero, y dentro de cada estado por fecha
assert.deepEqual(rows.map(r => r.status), ['duplicate', 'missing', 'shopify_only', 'imported', 'imported', 'skipped']);
const twoMissing = compareOrders([wooOrder(8, '2026-10-08T10:00:00'), wooOrder(7, '2026-10-07T10:00:00')], [], {});
assert.deepEqual(twoMissing.map(r => r.number), ['7', '8']);

// ── Importe: se avisa, no cambia el estado ──
const diffRows = compareOrders(
  [wooOrder(1, '2026-10-01T10:00:00', { total: '10.00' }), wooOrder(2, '2026-10-01T10:00:00', { total: '10.0' })],
  [shopifyOrder(1, '2026-10-01T10:00:00', { total_price: '12.00' }), shopifyOrder(2, '2026-10-01T10:00:00', { total_price: '10.00' })],
  {},
);
assert.equal(diffRows.find(r => r.number === '1').totalDiff, true);
assert.equal(diffRows.find(r => r.number === '1').status, 'imported');
assert.equal(diffRows.find(r => r.number === '2').totalDiff, false, '10.0 y 10.00 son el mismo importe');

// ── Borde de la fecha: Woo filtra en hora local y Shopify guarda otra zona ──
const edge = compareOrders(
  [wooOrder(10, '2026-10-01T00:30:00')],
  [
    shopifyOrder(10, '2026-10-01T00:30:00+01:00'),
    shopifyOrder(9, '2026-09-30T23:30:00+00:00'),
    shopifyOrder(8, '2026-10-02T12:00:00+00:00'),
  ],
  { since: '2026-10-01' },
);
assert.equal(statusOf(edge, 9), undefined, 'la víspera en el margen no es "solo Shopify": Woo no la devolvió por la fecha');
assert.equal(statusOf(edge, 8), 'shopify_only', 'pasado el margen sí');
assert.equal(statusOf(compareOrders([], [shopifyOrder(9, '2026-09-30T23:30:00+00:00')], {}), 9), 'shopify_only', 'sin fecha no hay margen');
assert.equal(shopifyOrdersCreatedMin('2026-10-01'), '2026-09-30T00:00:00Z', 'Shopify se pide con un día de margen');
assert.equal(shopifyOrdersCreatedMin('2026-03-01'), '2026-02-28T00:00:00Z');
assert.equal(shopifyOrdersCreatedMin(''), null);

// ── Sin read_all_orders Shopify solo enseña 60 días: "no está" no significa "falta" ──
const NOW = new Date('2026-11-05T12:00:00Z');
const limit = shopifyReadableFrom(['read_orders', 'write_orders'], NOW);
assert.equal(limit, '2026-09-06T12:00:00.000Z');
assert.equal(shopifyReadableFrom(['read_orders', 'read_all_orders'], NOW), null);
assert.equal(shopifyReadableFrom(null, NOW), limit, 'si no se pudieron leer los permisos se asume el límite');

const limited = compareOrders(
  [
    wooOrder(20, '2026-08-01T10:00:00'),
    wooOrder(21, '2026-08-02T10:00:00'),
    wooOrder(22, '2026-08-03T10:00:00', { status: 'failed' }),
    wooOrder(23, '2026-10-01T10:00:00'),
  ],
  [shopifyOrder(21, '2026-08-02T10:00:00+02:00')],
  { readableFrom: limit },
);
assert.equal(statusOf(limited, 20), 'unverifiable');
assert.equal(statusOf(limited, 21), 'imported', 'si aparece, está: el límite solo afecta a los que no aparecen');
assert.equal(statusOf(limited, 22), 'skipped');
assert.equal(statusOf(limited, 23), 'missing', 'dentro de los 60 días la ausencia es real');

// ── Resumen y titular: la respuesta a "¿ha terminado?" ──
const summary = ordersSummary(rows);
assert.deepEqual(summary.counts, { imported: 2, missing: 1, duplicate: 1, unverifiable: 0, skipped: 1, shopify_only: 1 });
assert.equal(summary.complete, false);
assert.equal(summary.firstMissing.number, '2');
assert.equal(summary.lastImportedDate, '2026-10-05T10:00:00', 'cuenta también el duplicado');
assert.equal(summary.lastWooDate, '2026-10-05T10:00:00');
assert.equal(summary.wooTotal, 5);

const unfinished = ordersHeadline(summary);
assert.equal(unfinished.level, 'warn');
assert.match(unfinished.text, /Sin terminar/);
assert.match(unfinished.text, /falta 1 pedido/);
assert.match(unfinished.text, /#2/);
assert.match(unfinished.text, /1 duplicado/);

const done = ordersHeadline(ordersSummary(compareOrders(
  [wooOrder(1, '2026-10-01T10:00:00'), wooOrder(2, '2026-10-02T10:00:00', { status: 'failed' })],
  [shopifyOrder(1, '2026-10-01T12:00:00+02:00')],
  {},
)));
assert.equal(done.level, 'ok');
assert.match(done.text, /terminada/);
assert.match(done.text, /2026-10-01 10:00/, 'la fecha del último importado se ve sin la T');

const dupOnly = ordersHeadline(ordersSummary(compareOrders(
  [wooOrder(1, '2026-10-01T10:00:00')],
  [shopifyOrder(1, '2026-10-01T10:00:00'), shopifyOrder(1, '2026-10-01T11:00:00')],
  {},
)));
assert.equal(dupOnly.level, 'warn', 'completa pero con duplicados no es un verde limpio');
assert.match(dupOnly.text, /terminada/);

const unknown = ordersHeadline(ordersSummary(limited.filter(r => r.status !== 'missing')));
assert.equal(unknown.level, 'warn');
assert.match(unknown.text, /No se puede confirmar/);
assert.match(unknown.text, /read_all_orders/);
assert.equal(ordersSummary(limited.filter(r => r.status !== 'missing')).complete, false, 'sin verificar no es terminado');

const empty = ordersHeadline(ordersSummary([]));
assert.equal(empty.level, 'info');
assert.doesNotMatch(empty.text, /terminada/, 'sin pedidos no se declara nada terminado');

// ── Importar solo lo que falta: reimportar no debe duplicar ──
const plan = planOrderImport(
  [
    wooOrder(30, '2026-10-01T10:00:00'),
    wooOrder(31, '2026-10-02T10:00:00'),
    wooOrder(32, '2026-10-03T10:00:00', { status: 'cancelled' }),
    wooOrder(33, '2026-10-04T10:00:00', { status: 'refunded' }),
    wooOrder(34, '2026-10-05T10:00:00'),
    wooOrder(35, '2026-08-01T10:00:00'),
    wooOrder(36, '2026-08-02T10:00:00'),
  ],
  [
    shopifyOrder(30, '2026-10-01T12:00:00+02:00'),
    shopifyOrder(33, '2026-10-04T12:00:00+02:00'),
    shopifyOrder(34, '2026-10-05T12:00:00+02:00'),
    shopifyOrder(34, '2026-10-05T13:00:00+02:00'),
    shopifyOrder(36, '2026-08-02T12:00:00+02:00'),
  ],
  { readableFrom: limit },
);
assert.deepEqual(plan.toCreate.map(o => o.number), ['31'], 'solo el que falta de verdad');
assert.equal(plan.alreadyImported, 4, 'importado, reembolsado ya copiado, duplicado y antiguo visible');
assert.equal(plan.skipped, 1, 'el cancelado sin copia no se crea');
assert.deepEqual(plan.unverifiable.map(o => o.number), ['35'], 'si no se puede comprobar, no se crea: podría duplicarlo');

const planAllOrders = planOrderImport([wooOrder(35, '2026-08-01T10:00:00')], [], {});
assert.deepEqual(planAllOrders.toCreate.map(o => o.number), ['35'], 'con read_all_orders la ausencia es real');
assert.deepEqual(planOrderImport([], [], {}), { toCreate: [], alreadyImported: 0, skipped: 0, unverifiable: [] });

// El plan y la comparación tienen que dar la misma respuesta sobre los mismos datos
const sameWoo = [wooOrder(40, '2026-10-01T10:00:00'), wooOrder(41, '2026-10-02T10:00:00')];
const sameShopify = [shopifyOrder(40, '2026-10-01T12:00:00+02:00')];
assert.deepEqual(
  planOrderImport(sameWoo, sameShopify, {}).toCreate.map(o => o.number),
  compareOrders(sameWoo, sameShopify, {}).filter(r => r.status === 'missing').map(r => r.number),
);

// ── syncOrders y la comparación deben omitir lo mismo ──
assert.deepEqual(WOO_ORDER_SKIP_STATUSES, ['cancelled', 'refunded', 'failed']);

console.log('orders-compare OK');

// ── Cobro adjunto al crear el pedido ──
assert.deepEqual(orderTransactions({ total: '25.50', payment_method_title: 'Tarjeta' }, 'paid'),
  [{ kind: 'sale', status: 'success', amount: '25.50', gateway: 'Tarjeta' }]);
assert.deepEqual(orderTransactions({ total: '25.50' }, 'pending'),
  [{ kind: 'sale', status: 'pending', amount: '25.50', gateway: 'manual' }]);
assert.deepEqual(orderTransactions({ total: '0.00', payment_method_title: 'Tarjeta' }, 'paid'), [],
  'un pedido de 0 € (venta de vale) no lleva cobro');
assert.deepEqual(orderTransactions({ total: '0' }, 'pending'), []);
assert.deepEqual(orderTransactions({ total: '' }, 'paid'), [], 'sin total no se inventa un cobro');

console.log('orders-compare: cobro de pedidos OK');

// ── Cliente asociado al pedido ──
const registered = { customer_id: 42, billing: { first_name: 'Ana', last_name: 'Ruiz', email: ' Ana@Ejemplo.es ' } };
assert.equal(wooOrderCustomerEmail(registered), 'ana@ejemplo.es', 'el email se normaliza para buscar y cachear');
assert.equal(wooOrderCustomerEmail({ customer_id: 0, billing: { email: 'x@y.es' } }), null, 'los invitados no tienen cliente asociado');
assert.equal(wooOrderCustomerEmail({ customer_id: 42, billing: { email: '' } }), null, 'sin email no se puede identificar');
assert.equal(wooOrderCustomerEmail({ customer_id: 42 }), null);

assert.deepEqual(orderCustomer(registered, { status: 'found', id: 'gid://shopify/Customer/7788' }), { id: 7788 },
  'si ya existe en Shopify se enlaza por id');
assert.deepEqual(orderCustomer(registered, { status: 'none' }), { first_name: 'Ana', last_name: 'Ruiz', email: 'ana@ejemplo.es' },
  'si no existe, Shopify lo crea con el pedido');
assert.equal(orderCustomer(registered, { status: 'unknown' }), null,
  'sin poder comprobar (permiso o varios clientes con ese email) no se crea otro: podría duplicarlo');
assert.equal(orderCustomer({ customer_id: 0, billing: { email: 'x@y.es' } }, { status: 'found', id: 'gid://shopify/Customer/1' }), null);
assert.equal(orderCustomer(registered, { status: 'found', id: 'gid://shopify/Customer/abc' }), null, 'un id raro no se manda');

console.log('orders-compare: cliente de pedidos OK');
