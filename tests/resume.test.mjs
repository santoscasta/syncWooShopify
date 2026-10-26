// Prueba del punto de reanudación de la migración. Ejecutar: node tests/resume.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../woo-shopify-sync.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ RESUME-PURE-BEGIN([\s\S]*?)\/\/ RESUME-PURE-END/);
assert.ok(m, 'No se encontró el bloque RESUME-PURE en el HTML');
const { resumeStartIndex, isUsableCheckpoint } =
  new Function(`${m[1]}; return { resumeStartIndex, isUsableCheckpoint };`)();

const products = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }];

// ── Reanuda en el producto guardado, buscándolo por woo_id ──
assert.equal(resumeStartIndex(products, { wooId: 30, index: 2 }), 2);
// el catálogo cambió de orden: manda el woo_id, no la posición
assert.equal(resumeStartIndex([{ id: 30 }, { id: 10 }], { wooId: 30, index: 2 }), 0);
// el producto guardado ya no está: se usa la posición, acotada al catálogo
assert.equal(resumeStartIndex(products, { wooId: 99, index: 3 }), 3);
assert.equal(resumeStartIndex(products, { wooId: 99, index: 50 }), 4);
// sin punto guardado se empieza desde el principio
assert.equal(resumeStartIndex(products, null), 0);
assert.equal(resumeStartIndex(products, { index: -5 }), 0);

// ── Solo vale un punto de la misma tienda y de un modo con bucle de productos ──
const cp = { mode: 'full', wooId: 30, index: 2, shopifyUrl: 'a.myshopify.com' };
assert.equal(isUsableCheckpoint(cp, 'a.myshopify.com'), true);
assert.equal(isUsableCheckpoint(cp, 'b.myshopify.com'), false);
assert.equal(isUsableCheckpoint({ ...cp, mode: 'categories' }, 'a.myshopify.com'), false);
assert.equal(isUsableCheckpoint({ ...cp, mode: 'x' }, 'a.myshopify.com'), false);
assert.equal(isUsableCheckpoint(null, 'a.myshopify.com'), false);
assert.equal(isUsableCheckpoint({ ...cp, index: undefined }, 'a.myshopify.com'), false);

console.log('resume: OK');
