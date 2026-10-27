// Prueba del traslado de visibilidad TPV de Woo a canales de Shopify. Ejecutar: node tests/channels.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../woo-shopify-sync.html', import.meta.url), 'utf8');
const cmp = html.match(/\/\/ COMPARE-PURE-BEGIN([\s\S]*?)\/\/ COMPARE-PURE-END/);
const m = html.match(/\/\/ CHANNELS-PURE-BEGIN([\s\S]*?)\/\/ CHANNELS-PURE-END/);
assert.ok(cmp, 'No se encontró el bloque COMPARE-PURE');
assert.ok(m, 'No se encontró el bloque CHANNELS-PURE en el HTML');
const { wooSalesChannels, findSalesPublications, channelMutation } =
  new Function(`${cmp[1]}; ${m[1]}; return { wooSalesChannels, findSalesPublications, channelMutation };`)();

const pos = (v) => ({ meta_data: v === undefined ? [] : [{ key: '_pos_visibility', value: v }] });

// ── _pos_visibility → canales ──
assert.deepEqual(wooSalesChannels(pos('pos_online')), { online: true, pos: true });
assert.deepEqual(wooSalesChannels(pos('pos')), { online: false, pos: true });
assert.deepEqual(wooSalesChannels(pos('online')), { online: true, pos: false });
// sin dato: el plugin trata el producto como visible en ambos
assert.deepEqual(wooSalesChannels(pos(undefined)), { online: true, pos: true });
// valor desconocido: no se toca
assert.equal(wooSalesChannels(pos('raro')), null);

// ── Publicaciones de Shopify por nombre ──
const pubs = findSalesPublications([
  { id: 'gid://shopify/Publication/1', name: 'Online Store' },
  { id: 'gid://shopify/Publication/2', name: 'Point of Sale' },
  { id: 'gid://shopify/Publication/3', name: 'Shop' },
]);
assert.deepEqual(pubs, { online: 'gid://shopify/Publication/1', pos: 'gid://shopify/Publication/2' });
assert.deepEqual(
  findSalesPublications([{ id: 'a', name: 'Tienda online' }, { id: 'b', name: 'Punto de venta' }]),
  { online: 'a', pos: 'b' }
);
assert.deepEqual(findSalesPublications([{ id: 'a', name: 'Online Store' }]), { online: 'a', pos: null });

// ── Mutación por lote: publica en los canales que tocan y despublica del resto ──
const { query, variables } = channelMutation([
  { shopifyId: 11, channels: { online: true, pos: true } },
  { shopifyId: 12, channels: { online: false, pos: true } },
], pubs);
assert.match(query, /p0: publishablePublish\(id: \$id0, input: \$pub0\)/);
assert.doesNotMatch(query, /u0:/, 'nada que despublicar en el primero');
assert.match(query, /p1: publishablePublish\(id: \$id1, input: \$pub1\)/);
assert.match(query, /u1: publishableUnpublish\(id: \$id1, input: \$unpub1\)/);
assert.equal(variables.id0, 'gid://shopify/Product/11');
assert.deepEqual(variables.pub0, [{ publicationId: pubs.online }, { publicationId: pubs.pos }]);
assert.deepEqual(variables.pub1, [{ publicationId: pubs.pos }]);
assert.deepEqual(variables.unpub1, [{ publicationId: pubs.online }]);
assert.match(query, /\$id0: ID!/);
assert.match(query, /\$unpub1: \[PublicationInput!\]!/);

console.log('channels: OK');
