// Prueba de la lógica pura de imágenes. Ejecutar: node tests/images.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../woo-shopify-sync.html', import.meta.url), 'utf8');
const cmp = html.match(/\/\/ COMPARE-PURE-BEGIN([\s\S]*?)\/\/ COMPARE-PURE-END/);
const m = html.match(/\/\/ IMAGES-PURE-BEGIN([\s\S]*?)\/\/ IMAGES-PURE-END/);
assert.ok(m, 'No se encontró el bloque IMAGES-PURE en el HTML');
const { imageKey, planProductImages, planVariantImageLinks } =
  new Function(`${cmp[1]}; ${m[1]}; return { imageKey, planProductImages, planVariantImageLinks };`)();

// ── Clave de imagen: nombre de archivo sin ruta, extensión, query ni sufijo que añade Shopify ──
assert.equal(imageKey('https://myminileo.com/wp-content/uploads/2024/05/Vestido-Sendero-1.jpg'), 'vestidosendero1');
assert.equal(imageKey('https://cdn.shopify.com/s/files/1/09/files/vestido-sendero-1.jpg?v=1725'), 'vestidosendero1');
assert.equal(imageKey('https://cdn.shopify.com/s/files/1/09/files/vestido-sendero-1_3f2a9c1e-7b44-4d2a-9f1e-0c1d2e3f4a5b.jpg'), 'vestidosendero1');
assert.equal(imageKey('https://cdn.shopify.com/s/files/1/09/files/vestido-sendero-1_8f3a2b.png'), 'vestidosendero1');
// Caracteres que Shopify no conserva en el nombre ("@", "_" ↔ "-", mayúsculas) y query de Woo (?fit=...)
assert.equal(imageKey('https://myminileo.com/wp-content/uploads/2024/05/%40DOLORESTALBAC-15-scaled.jpg?fit=2560%2C2048&ssl=1'), 'dolorestalbac15scaled');
assert.equal(imageKey('https://cdn.shopify.com/s/files/1/09/files/_DOLORESTALBAC-15-scaled.jpg'), 'dolorestalbac15scaled');
assert.equal(imageKey('https://cdn.shopify.com/s/files/1/09/files/dolorestalbac_15_scaled_3f2a9c1e-7b44-4d2a-9f1e-0c1d2e3f4a5b.jpg'), 'dolorestalbac15scaled');
assert.equal(imageKey(''), '');
assert.equal(imageKey(null), '');

// ── Plan de imágenes del producto: reutiliza las que ya están en Shopify (por id), sube las nuevas
//    y deja fuera las que Woo ya no tiene. Las imágenes de variación entran una sola vez. ──
const woo = { name: 'Vestido', images: [{ src: 'https://w/a.jpg', alt: '' }, { src: 'https://w/b.jpg', alt: 'B' }] };
const variations = [{ image: { src: 'https://w/b.jpg' } }, { image: { src: 'https://w/c.jpg' } }, { image: null }];
const existing = [{ id: 1, src: 'https://cdn/a_3f2a9c1e-7b44-4d2a-9f1e-0c1d2e3f4a5b.jpg' }, { id: 2, src: 'https://cdn/old.jpg' }];
const plan = planProductImages(woo, variations, existing);
assert.deepEqual(plan.images, [{ id: 1 }, { src: 'https://w/b.jpg', alt: 'B' }, { src: 'https://w/c.jpg', alt: 'Vestido' }]);
assert.equal(plan.reused, 1);
assert.equal(plan.added, 2);
assert.equal(plan.removed, 1);
assert.deepEqual(plan.unmatched, ['b.jpg', 'c.jpg']);
assert.deepEqual(plan.retired, ['old.jpg']);
// Shopify antepone algo al nombre ("%40DOLORESTALBAC-283" → "40DOLORESTALBAC-283" o "_DOLORESTALBAC-283"): se reconoce por sufijo
const prefixed = planProductImages({ name: 'X', images: [{ src: 'https://w/%40DOLORESTALBAC-283-scaled.jpg?fit=1440%2C2560&ssl=1' }, { src: 'https://w/%40DOLORESTALBAC-284-scaled.jpg' }] }, null,
  [{ id: 1, src: 'https://cdn/40DOLORESTALBAC-283-scaled.jpg' }, { id: 2, src: 'https://cdn/_DOLORESTALBAC-284-scaled_3f2a9c1e-7b44-4d2a-9f1e-0c1d2e3f4a5b.jpg' }]);
assert.deepEqual(prefixed.images, [{ id: 1 }, { id: 2 }]);
// El sufijo no vale para nombres cortos (evita falsos positivos como "peto1" dentro de "otropeto1")
const short = planProductImages({ name: 'X', images: [{ src: 'https://w/peto-1.jpg' }] }, null, [{ id: 1, src: 'https://cdn/otro-peto-1.jpg' }]);
assert.equal(short.added, 1);
// Sin cambios: todo reutilizado, nada nuevo ni sobrante
const same = planProductImages(woo, null, [{ id: 1, src: 'https://cdn/a.jpg' }, { id: 2, src: 'https://cdn/b.jpg' }]);
assert.deepEqual(same.images, [{ id: 1 }, { id: 2 }]);
assert.equal(same.added + same.removed, 0);
// Woo sin imágenes: no se toca nada en Shopify (images null → no se envía el campo)
assert.equal(planProductImages({ name: 'X', images: [] }, [], existing).images, null);
// Una imagen de Shopify solo se reutiliza una vez aunque Woo repita el archivo
const twice = planProductImages({ name: 'X', images: [{ src: 'https://w/a.jpg' }, { src: 'https://w/a.jpg' }] }, null, [{ id: 1, src: 'https://cdn/a.jpg' }]);
assert.deepEqual(twice.images, [{ id: 1 }]);

// ── Enlace de variantes a imágenes ya subidas: enlazar si el archivo ya existe, subir si no ──
const touched = [
  { id: 11, option1: 'S', imageSrc: 'https://w/c.jpg', hasImage: false },
  { id: 12, option1: 'M', imageSrc: 'https://w/z.jpg', hasImage: false },
  { id: 13, option1: 'L', imageSrc: 'https://w/c.jpg', hasImage: true },
  { id: 14, option1: 'XL', imageSrc: null, hasImage: false },
];
const productImages = [{ id: 5, src: 'https://cdn/c_8f3a2b.jpg', variant_ids: [99] }];
const links = planVariantImageLinks(touched, productImages);
assert.deepEqual(links.link, [{ imageId: 5, variantId: 11, variantIds: [99, 11] }]);
assert.deepEqual(links.upload.map(v => v.id), [12]);
// Enlace de variante también por sufijo
const linksSuffix = planVariantImageLinks([{ id: 1, imageSrc: 'https://w/%40DOLORESTALBAC-283-scaled.jpg', hasImage: false }], [{ id: 9, src: 'https://cdn/40DOLORESTALBAC-283-scaled.jpg', variant_ids: [] }]);
assert.deepEqual(linksSuffix.link.map(l => l.imageId), [9]);
// Dos variantes al mismo archivo: el enlace acumula ids
const links2 = planVariantImageLinks([{ id: 1, imageSrc: 'https://w/c.jpg', hasImage: false }, { id: 2, imageSrc: 'https://w/c.jpg', hasImage: false }], [{ id: 5, src: 'https://cdn/c.jpg', variant_ids: [] }]);
assert.deepEqual(links2.link.map(l => l.variantIds), [[1], [1, 2]]);

// Una variante cuyo imageId ya no está entre las imágenes del producto (el PUT la retiró) se trata como sin imagen
const stale = planVariantImageLinks([{ id: 21, imageSrc: 'https://w/c.jpg', hasImage: true, imageId: 777 }, { id: 22, imageSrc: 'https://w/c.jpg', hasImage: true, imageId: 5 }], [{ id: 5, src: 'https://cdn/c.jpg', variant_ids: [22] }]);
assert.deepEqual(stale.link.map(l => l.variantId), [21]);
assert.deepEqual(stale.upload, []);

console.log('✓ images: todas las aserciones pasan');
