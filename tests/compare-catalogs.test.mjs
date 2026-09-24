// Prueba de la lógica pura de comparación. Ejecutar: node tests/compare-catalogs.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../woo-shopify-sync.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ COMPARE-PURE-BEGIN([\s\S]*?)\/\/ COMPARE-PURE-END/);
assert.ok(m, 'No se encontró el bloque COMPARE-PURE en el HTML');
const { compareCatalogs, findShopifyOrphans, stockUpdatePlan, pairCatalogs, findWooTitleCollisions } = new Function(`${m[1]}; return { compareCatalogs, findShopifyOrphans, stockUpdatePlan, pairCatalogs, findWooTitleCollisions };`)();

const woo = [
  { id: 1, name: 'Camiseta', sku: 'CAM-1', price: '19.90', stock_quantity: 5 },
  { id: 2, name: 'Gorra', sku: 'GOR-1', price: '12.00', stock_quantity: 3 },
  { id: 3, name: 'Bufanda', sku: '', price: '15.00', stock_quantity: null },
  { id: 4, name: 'Solo Woo', sku: 'SW-1', price: '1.00', stock_quantity: 1 },
];
const shopify = [
  { id: 101, title: 'Camiseta', variants: [{ sku: 'CAM-1', price: '19.90', inventory_quantity: 5 }] },
  { id: 102, title: 'Gorra',    variants: [{ sku: 'GOR-1', price: '12.00', inventory_quantity: 2 }, { sku: 'GOR-1B', price: '14.00', inventory_quantity: 2 }] },
  { id: 103, title: 'bufanda ', variants: [{ sku: '', price: '15.00', inventory_quantity: 9 }] },
  { id: 104, title: 'Solo Shopify', variants: [{ sku: 'SS-1', price: '2.00', inventory_quantity: 0 }] },
];

const rows = compareCatalogs(woo, shopify);
const byName = Object.fromEntries(rows.map(r => [r.name, r]));

// Sincronizado: mismo precio y stock
assert.equal(byName['Camiseta'].status, 'synced');
// Diferente: stock Shopify = suma variantes (4) ≠ 3; precio mínimo 12.00 = 12.00
assert.equal(byName['Gorra'].status, 'diff');
assert.equal(byName['Gorra'].shopify.stock, 4);
assert.equal(byName['Gorra'].stockDiff, true);
assert.equal(byName['Gorra'].priceDiff, false);
// Sin SKU: empareja por título normalizado; stock Woo null no cuenta como diferencia
assert.equal(byName['Bufanda'].status, 'synced');
assert.equal(byName['Bufanda'].woo.stock, null);
// Solo en un lado
assert.equal(byName['Solo Woo'].status, 'woo_only');
assert.equal(byName['Solo Woo'].shopify, null);
assert.equal(byName['Solo Shopify'].status, 'shopify_only');
assert.equal(byName['Solo Shopify'].woo, null);
// Orden: no sincronizados primero
assert.notEqual(rows[0].status, 'synced');
assert.equal(rows[rows.length - 1].status, 'synced');
assert.equal(rows.length, 5);

// Valores no numéricos en Woo no deben producir NaN ni forzar "diff"
const rowsNaN = compareCatalogs(
  [{ id: 9, name: 'Raro', sku: 'R-1', price: 'abc', stock_quantity: 'muchos' }],
  [{ id: 109, title: 'Raro', variants: [{ sku: 'R-1', price: '5.00', inventory_quantity: 2 }] }]
);
assert.equal(rowsNaN[0].woo.price, null);
assert.equal(rowsNaN[0].woo.stock, null);
assert.equal(rowsNaN[0].status, 'synced');

// Título con distinta capitalización y espacios empareja
const rowsTitle = compareCatalogs(
  [{ id: 10, name: '  Mochila URBANA ', sku: '', price: '30.00', stock_quantity: 1 }],
  [{ id: 110, title: 'mochila urbana', variants: [{ sku: '', price: '30.00', inventory_quantity: 1 }] }]
);
assert.equal(rowsTitle.length, 1);
assert.equal(rowsTitle[0].status, 'synced');

// Huérfanos: solo los que no existen en WooCommerce, con id y nombre de Shopify
const orphans = findShopifyOrphans(woo, shopify);
assert.deepEqual(orphans, [{ id: 104, name: 'Solo Shopify' }]);
// Emparejamiento uno a uno: un Woo "Vela" y dos Shopify "Vela" → sobra uno (el más nuevo si no coincide precio)
const twins = findShopifyOrphans(
  [{ id: 1, name: 'Vela', sku: '', price: '5', stock_quantity: 1 }],
  [{ id: 201, title: 'Vela', variants: [{ sku: 'V-A', price: '7' }] }, { id: 202, title: 'vela ', variants: [{ sku: 'V-B', price: '9' }] }, { id: 203, title: 'Otro', variants: [{ sku: 'O-1' }] }]
);
assert.deepEqual(twins, [{ id: 202, name: 'vela ' }, { id: 203, name: 'Otro' }]);
// Si uno de los duplicados tiene el mismo precio que Woo, se conserva ese
const twinsPrice = findShopifyOrphans(
  [{ id: 1, name: 'Vela', sku: '', price: '9', stock_quantity: 1 }],
  [{ id: 201, title: 'Vela', variants: [{ price: '7' }] }, { id: 202, title: 'Vela', variants: [{ price: '9' }] }]
);
assert.deepEqual(twinsPrice, [{ id: 201, name: 'Vela' }]);
// El SKU manda: Woo con SKU A1 empareja con el Shopify que tiene A1 aunque otro comparta título
const twinsSku = findShopifyOrphans(
  [{ id: 1, name: 'Malva', sku: 'A1', price: '41.50', stock_quantity: null }],
  [{ id: 301, title: 'Malva', variants: [{ sku: '', price: '39.50' }] }, { id: 302, title: 'Malva', variants: [{ sku: 'A1', price: '30.50' }] }]
);
assert.deepEqual(twinsSku, [{ id: 301, name: 'Malva' }]);
// Dos Woo y dos Shopify con el mismo título: ninguno sobra
assert.deepEqual(findShopifyOrphans(
  [{ id: 1, name: 'Vela', sku: '', price: '5' }, { id: 2, name: 'Vela', sku: '', price: '5' }],
  [{ id: 201, title: 'Vela', variants: [{}] }, { id: 202, title: 'Vela', variants: [{}] }]
), []);
// La comparación usa el mismo emparejamiento: el duplicado aparece como "Solo Shopify"
const rowsDup = compareCatalogs(
  [{ id: 1, name: 'Malva', sku: 'A1', price: '41.50', stock_quantity: null }],
  [{ id: 301, title: 'Malva', variants: [{ sku: '', price: '39.50', inventory_quantity: 0 }] }, { id: 302, title: 'Malva', variants: [{ sku: 'A1', price: '30.50', inventory_quantity: 0 }] }]
);
assert.equal(rowsDup.filter(r => r.status === 'shopify_only').length, 1);
assert.equal(rowsDup.find(r => r.status === 'shopify_only').shopify.id, 301);
assert.equal(rowsDup.find(r => r.status === 'diff').shopify.id, 302);
// Con WooCommerce vacío no se considera huérfano nada (salvaguarda)
assert.deepEqual(findShopifyOrphans([], shopify), []);

// Plan de actualización de stock/precio: solo lo que difiere
assert.deepEqual(stockUpdatePlan({ price: '12.00', stock_quantity: 3 }, { price: '12.00', inventory_quantity: 3 }), { priceDiff: false, stockDiff: false });
assert.deepEqual(stockUpdatePlan({ price: '12.50', stock_quantity: 3 }, { price: '12.00', inventory_quantity: 3 }), { priceDiff: true, stockDiff: false });
assert.deepEqual(stockUpdatePlan({ price: '12.00', stock_quantity: 7 }, { price: '12.00', inventory_quantity: 3 }), { priceDiff: false, stockDiff: true });
// Stock no gestionado en Woo (null) nunca cuenta como diferencia; precio vacío en Woo equivale a 0
assert.deepEqual(stockUpdatePlan({ price: '', stock_quantity: null }, { price: '0.00', inventory_quantity: 9 }), { priceDiff: false, stockDiff: false });
// Sin variante en Shopify: hay que actualizar todo
assert.deepEqual(stockUpdatePlan({ price: '1', stock_quantity: 1 }, null), { priceDiff: true, stockDiff: true });


// ── Emparejamiento por woo_id (metacampo en Shopify): manda sobre SKU y título ──
// Producto renombrado en Woo: el Shopify con wooId igual sigue siendo su pareja, no un huérfano
const renamed = pairCatalogs(
  [{ id: 7, name: 'Botella térmica robot 350ml', sku: '', price: '9' }],
  [{ id: 501, title: 'Botella térmica Robots 350ml', wooId: 7, variants: [{ price: '9' }] }, { id: 502, title: 'Botella térmica robot 350ml', wooId: null, variants: [{ price: '9' }] }]
);
assert.equal(renamed.pairs.get(7).id, 501, 'woo_id gana al título');
assert.deepEqual(renamed.unmatchedShopify.map(p => p.id), [502]);
assert.deepEqual(findShopifyOrphans(
  [{ id: 7, name: 'Nuevo nombre', sku: '', price: '9' }],
  [{ id: 501, title: 'Nombre viejo', wooId: 7, variants: [{ price: '9' }] }]
), []);
// Un Shopify con wooId de otro producto no se empareja por título con un tercero
const claimed = pairCatalogs(
  [{ id: 1, name: 'Vela', sku: '', price: '5' }, { id: 2, name: 'Otra', sku: '', price: '5' }],
  [{ id: 601, title: 'Vela', wooId: 2, variants: [{ price: '5' }] }]
);
assert.equal(claimed.pairs.get(2).id, 601);
assert.equal(claimed.pairs.has(1), false);

// ── Títulos repetidos en Woo: uno a uno, el resto queda "solo WooCommerce" (nunca se pisan) ──
const malvaWoo = [
  { id: 11, name: 'Conjunto 4 piezas punto MALVA', sku: '', price: '41.50', stock_quantity: null },
  { id: 12, name: 'Conjunto 4 piezas punto Malva', sku: '', price: '39.50', stock_quantity: null },
  { id: 13, name: 'Conjunto 4 piezas punto Malva', sku: '', price: '30.50', stock_quantity: null },
];
const malvaRows = compareCatalogs(malvaWoo, [{ id: 701, title: 'Conjunto 4 piezas punto Malva', variants: [{ price: '39.50', inventory_quantity: 0 }] }]);
assert.equal(malvaRows.filter(r => r.status === 'woo_only').length, 2);
assert.equal(malvaRows.find(r => r.status !== 'woo_only').woo.id, 12, 'prefiere el de igual precio');
assert.deepEqual(findWooTitleCollisions(malvaWoo), [{ title: 'conjunto 4 piezas punto malva', ids: [11, 12, 13] }]);
assert.deepEqual(findWooTitleCollisions(woo), []);

// ── Productos variables: el stock del padre no es comparable sin descargar las variaciones
//    (cada talla puede gestionar el suyo aunque el padre tenga manage_stock). Solo se compara el precio. ──
const variableRow = (qtys, price = '20') => compareCatalogs(
  [{ id: 20, name: 'Pelele', sku: '', type: 'variable', manage_stock: true, price: '20', stock_quantity: 1 }],
  [{ id: 801, title: 'Pelele', variants: qtys.map(q => ({ price, inventory_quantity: q })) }]
)[0];
assert.equal(variableRow([2, 1, 3, 1]).status, 'synced');
assert.equal(variableRow([2, 1, 3, 1]).woo.stock, null, 'el stock del padre no se muestra como comparable');
assert.equal(variableRow([2, 1, 3, 1]).stockDiff, false);
assert.equal(variableRow([0, 0], '25').status, 'diff', 'el precio sí se compara');
assert.equal(variableRow([0, 0], '25').priceDiff, true);

// Sin precio en Woo no hay preferencia por "igual precio": se lleva el candidato más antiguo
const noPrice = pairCatalogs(
  [{ id: 1, name: 'Vela', sku: '', price: '' }],
  [{ id: 201, title: 'Vela', variants: [{ price: '7' }] }, { id: 202, title: 'Vela', variants: [{ price: '' }] }]
);
assert.equal(noPrice.pairs.get(1).id, 201);

// "Solo WooCommerce" distingue lo que la sincronización nunca creará (oculto o borrador)
const hiddenRows = compareCatalogs(
  [{ id: 1, name: 'Visible', status: 'publish', catalog_visibility: 'catalog', price: '1' }, { id: 2, name: 'Oculto', status: 'publish', catalog_visibility: 'hidden', price: '1' }, { id: 3, name: 'Borrador', status: 'draft', price: '1' }],
  []
);
assert.deepEqual(hiddenRows.map(r => [r.name, r.status, r.hidden]), [['Borrador', 'woo_only', true], ['Oculto', 'woo_only', true], ['Visible', 'woo_only', false]]);

console.log('✓ compareCatalogs: todas las aserciones pasan');
