// Prueba de la política de reintentos de WooCommerce. Ejecutar: node tests/woo-retry.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../woo-shopify-sync.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ WOO-RETRY-PURE-BEGIN([\s\S]*?)\/\/ WOO-RETRY-PURE-END/);
assert.ok(m, 'No se encontró el bloque WOO-RETRY-PURE en el HTML');
const { isRetryableWooStatus, wooRetryDelayMs, WOO_MAX_RETRIES } =
  new Function(`${m[1]}; return { isRetryableWooStatus, wooRetryDelayMs, WOO_MAX_RETRIES };`)();

// ── Solo se reintentan cortes y saturación, nunca errores de la petición ──
for (const s of [429, 502, 503, 504]) assert.equal(isRetryableWooStatus(s), true, `${s} se reintenta`);
for (const s of [200, 400, 401, 403, 404, 500]) assert.equal(isRetryableWooStatus(s), false, `${s} no se reintenta`);

// ── Espera creciente: 1s, 2s, 4s ──
assert.equal(wooRetryDelayMs(0), 1000);
assert.equal(wooRetryDelayMs(1), 2000);
assert.equal(wooRetryDelayMs(2), 4000);

// ── Retry-After manda si es válido, con tope de 30 s ──
assert.equal(wooRetryDelayMs(0, '5'), 5000);
assert.equal(wooRetryDelayMs(0, '600'), 30000);
assert.equal(wooRetryDelayMs(1, 'basura'), 2000);
assert.equal(wooRetryDelayMs(1, null), 2000);

assert.equal(WOO_MAX_RETRIES, 3);

console.log('woo-retry: OK');
