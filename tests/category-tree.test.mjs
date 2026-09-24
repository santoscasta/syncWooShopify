// Prueba de la lógica pura del árbol de categorías. Ejecutar: node tests/category-tree.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../woo-shopify-sync.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ CATTREE-PURE-BEGIN([\s\S]*?)\/\/ CATTREE-PURE-END/);
assert.ok(m, 'No se encontró el bloque CATTREE-PURE en el HTML');
const { planCategoryTree, chunk, toShopifyHandle, nextNetworkFailureCount } = new Function(`${m[1]}; return { planCategoryTree, chunk, toShopifyHandle, nextNetworkFailureCount };`)();

// Árbol: Ropa > Hombre > Camisetas; Ropa > Mujer; Accesorios (raíz). Orden de entrada desordenado.
const cats = [
  { id: 3, name: 'Camisetas', slug: 'camisetas', parent: 2, description: '', image: null },
  { id: 1, name: 'Ropa', slug: 'ropa', parent: 0, description: 'Toda la ropa', image: { src: 'https://x/ropa.jpg' } },
  { id: 4, name: 'Mujer', slug: 'mujer', parent: 1 },
  { id: 2, name: 'Hombre', slug: 'hombre', parent: 1 },
  { id: 5, name: 'Accesorios', slug: 'accesorios', parent: 0 },
  { id: 15, name: 'Sin categorizar', slug: 'sin-categorizar', parent: 0 },
  { id: 16, name: 'Uncategorized', slug: 'uncategorized', parent: 0 },
];

const plan = planCategoryTree(cats);
const ids = plan.ordered.map(c => c.id);

// Excluye las categorías por defecto
assert.ok(!ids.includes(15) && !ids.includes(16), 'Debe excluir Sin categorizar / Uncategorized');
assert.equal(plan.ordered.length, 5);
// Padres antes que hijos
assert.ok(ids.indexOf(1) < ids.indexOf(2));
assert.ok(ids.indexOf(2) < ids.indexOf(3));
assert.ok(ids.indexOf(1) < ids.indexOf(4));
// Rutas
const byId = Object.fromEntries(plan.ordered.map(c => [c.id, c]));
assert.equal(byId[3].ruta, 'Ropa > Hombre > Camisetas');
assert.equal(byId[4].ruta, 'Ropa > Mujer');
assert.equal(byId[5].ruta, 'Accesorios');
// parentId normalizado: null en raíz
assert.equal(byId[1].parentId, null);
assert.equal(byId[3].parentId, 2);
assert.equal(plan.warnings.length, 0);

// Padre inexistente → raíz con aviso
const orphan = planCategoryTree([{ id: 7, name: 'Huérfana', slug: 'huerfana', parent: 99 }]);
assert.equal(orphan.ordered.length, 1);
assert.equal(orphan.ordered[0].parentId, null);
assert.equal(orphan.ordered[0].ruta, 'Huérfana');
assert.equal(orphan.warnings.length, 1);
assert.match(orphan.warnings[0], /Huérfana/);

// Ciclo A→B→A → ambas quedan incluidas, una se convierte en raíz, con aviso
const cycle = planCategoryTree([
  { id: 10, name: 'A', slug: 'a', parent: 11 },
  { id: 11, name: 'B', slug: 'b', parent: 10 },
]);
assert.equal(cycle.ordered.length, 2);
assert.ok(cycle.ordered.some(c => c.parentId === null));
assert.ok(cycle.warnings.length >= 1);

// Padre "Sin categorizar" excluido → el hijo pasa a raíz
const underDefault = planCategoryTree([
  { id: 15, name: 'Sin categorizar', slug: 'sin-categorizar', parent: 0 },
  { id: 20, name: 'Hija', slug: 'hija', parent: 15 },
]);
assert.equal(underDefault.ordered.length, 1);
assert.equal(underDefault.ordered[0].parentId, null);

// Handles: slugs de Woo codificados en porcentaje y con tildes pasan a handle válido
assert.equal(toShopifyHandle('ropa-ni%c3%b1os'), 'ropa-ninos');
assert.equal(toShopifyHandle('Camisetas Básicas / Verano'), 'camisetas-basicas-verano');
assert.equal(planCategoryTree([{ id: 1, name: 'Niños', slug: 'ni%c3%b1os', parent: 0 }]).ordered[0].slug, 'ninos');
assert.equal(planCategoryTree([{ id: 2, name: 'Sin slug', parent: 0 }]).ordered[0].slug, 'sin-slug');

// chunk
assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.deepEqual(chunk([], 3), []);

// Fallos de red consecutivos: suman con isNetwork, se reinician con cualquier otro error
const net = Object.assign(new Error('proxy'), { isNetwork: true });
assert.equal(nextNetworkFailureCount(0, net), 1);
assert.equal(nextNetworkFailureCount(2, net), 3);
assert.equal(nextNetworkFailureCount(2, new Error('Shopify 422')), 0);
assert.equal(nextNetworkFailureCount(undefined, net), 1);

console.log('✓ category-tree: todas las pruebas pasan');
