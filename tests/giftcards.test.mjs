// Prueba de la lógica pura de vales vendidos → tarjetas regalo.
// Ejecutar: node tests/giftcards.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../woo-shopify-sync.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ GIFTCARDS-PURE-BEGIN([\s\S]*?)\/\/ GIFTCARDS-PURE-END/);
assert.ok(m, 'No se encontró el bloque GIFTCARDS-PURE en el HTML');
// CUPON_ES_VALE vive en el bloque de cupones, que en la página se evalúa antes que este.
const cup = html.match(/\/\/ COUPONS-PURE-BEGIN([\s\S]*?)\/\/ COUPONS-PURE-END/);
assert.ok(cup, 'No se encontró el bloque COUPONS-PURE en el HTML');
const exporta = 'giftCardCode, notaDelPedido, importeDeNota, refsDeNota, importeDelVale, cadenasDeVales, parseConfirmados, giftCardNote, planGiftCard, notasEscritasAMano, estadoSegunNotasPedido, cuponesDeVales, estadoSegunCupon, estadoCombinado, valesSoloEnCupon, planCoupon, valeIndexHandle, valeIndexTitulo, valeIndexFields, adminGiftCardUrl, eurosEs';
const { giftCardCode, notaDelPedido, importeDeNota, refsDeNota, importeDelVale, cadenasDeVales, parseConfirmados, giftCardNote, planGiftCard, notasEscritasAMano, estadoSegunNotasPedido, cuponesDeVales, estadoSegunCupon, estadoCombinado, valesSoloEnCupon, planCoupon, valeIndexHandle, valeIndexTitulo, valeIndexFields, adminGiftCardUrl, eurosEs } =
  new Function(`${cup[1]}\n${m[1]}; return { ${exporta} };`)();

// ── Código: Shopify exige 8-20 caracteres, solo a-z y 0-9 ──
assert.equal(giftCardCode(23661), 'vale23661');
assert.match(giftCardCode(23661), /^[a-z0-9]{8,20}$/);
assert.equal(giftCardCode(99), 'vale0099', 'se rellena hasta el mínimo de 8 caracteres');
assert.match(giftCardCode(99), /^[a-z0-9]{8,20}$/);

// ── La nota puede estar en cualquier línea del pedido, no solo en la del vale ──
const pedido23229 = { line_items: [
  { name: 'Otro articulo', product_id: 16516, total: '0.00', meta_data: [{ key: 'note', value: 'Vale 16euros, cambio 23071' }, { key: '_reduced_stock', value: '1' }] },
  { name: 'VALE', product_id: 27100, total: '0.00', meta_data: [{ key: '_reduced_stock', value: '1' }] },
] };
assert.equal(notaDelPedido(pedido23229), 'Vale 16euros, cambio 23071', 'lee la nota de la línea que la tenga');
assert.equal(notaDelPedido({ line_items: [{ product_id: 27100, meta_data: [] }] }), '', 'sin nota devuelve cadena vacía');
assert.equal(notaDelPedido({}), '', 'pedido sin líneas');

// ── Importe escrito a mano, sin formato fijo ──
assert.equal(importeDeNota('VALE POR 23,50EUROS DEL PEDIDO 22122'), 23.5);
assert.equal(importeDeNota('VALE DE 1EURO, CAMBIO 23582'), 1);
assert.equal(importeDeNota('VALE POR 17´50EUROS, RESTO DEL TICKET 15109'), 17.5, 'el apóstrofo es separador decimal');
assert.equal(importeDeNota('VALE POR 0,50CENTIMOS DEL TICKET 18238'), 0.5, '"céntimos" aquí significa euros');
assert.equal(importeDeNota('VALE DE 1,5 SIN CADUCIDAD DEL TICKET ANTERIOR 19897'), 1.5, 'sin unidad, vale la cifra con decimales');
assert.equal(importeDeNota('vale por 38.50 de una devolucion del ticket 13180'), 38.5, 'punto decimal y minúsculas');
assert.equal(importeDeNota('VALE `POR VALOR DE 3.05 DEL TICKET ANTERIOR 16193 '), 3.05);
assert.equal(importeDeNota('VALE SIN CADUCIDAD DE 41.50 DEL TICKET ANTERIOR 20954'), 41.5);
assert.equal(importeDeNota('13885'), null, 'un número de pedido no es un importe');
assert.equal(importeDeNota('TARJETA REGALO MATEO'), null, 'sin cifra no hay importe');
assert.equal(importeDeNota(''), null);
assert.equal(importeDeNota(null), null);

// ── Referencias a otros vales ──
assert.deepEqual(refsDeNota('VALE DE 42,50, UNION DEL CAMBIO 18111 Y VALE 18112'), [18111, 18112]);
assert.deepEqual(refsDeNota('VALE POR 45,50EUROS '), []);

// ── Importe del vale: la tarjeta regalo lo lleva en la línea; el vale, en la nota ──
assert.deepEqual(importeDelVale({ line_items: [{ product_id: 30722, total: '50.00', meta_data: [] }] }),
  { importe: 50, origen: 'línea del pedido' }, 'tarjeta regalo sin nota');
assert.deepEqual(importeDelVale(pedido23229), { importe: 16, origen: 'nota' });
assert.deepEqual(importeDelVale({ line_items: [{ product_id: 27100, total: '0.00', meta_data: [] }] }),
  { importe: null, origen: null }, 'vale sin nota: no se puede migrar');
assert.equal(importeDelVale({ line_items: [
  { product_id: 30722, total: '0.00', meta_data: [{ key: 'note', value: 'tarjeta regalo de 100EUROS' }] },
] }).importe, 100, 'tarjeta regalo a 0 en la línea cae a la nota');
// El 13931 es un VALE normal, no una tarjeta regalo, pero se cobró: lleva 15 € en su línea
// y una nota que solo cita otro ticket. Leer la línea solo en las tarjetas regalo lo perdía.
assert.deepEqual(importeDelVale({ line_items: [
  { product_id: 27100, total: '15.00', meta_data: [{ key: 'note', value: '13885' }] },
] }), { importe: 15, origen: 'línea del pedido' }, 'un VALE con importe en la línea');

// ── Cadenas: un vale muere cuando otro posterior lo cita ──
const vales = [
  { numero: 17620, nota: 'VALE POR 79,50EUROS' },
  { numero: 19005, nota: 'VALE POR 33,60EUROS DEL RESTO DEL VALE DEL TICKET 17620' },
  { numero: 23406, nota: 'VALE POR 1,70EUROS DEL VALE 19005 Y PEDIDO 23405' },
  { numero: 23661, nota: 'VALE DE 1EURO, CAMBIO 23582' },
];
const { gastadoPor, procedeDe } = cadenasDeVales(vales);
assert.deepEqual(gastadoPor.get(17620), [19005]);
assert.deepEqual(gastadoPor.get(19005), [23406]);
assert.equal(gastadoPor.get(23406), undefined, 'el último de la cadena sigue vivo');
assert.deepEqual(procedeDe.get(19005), [17620]);
assert.equal(gastadoPor.get(23582), undefined, 'un número que no es vale no cuenta');
assert.equal(gastadoPor.get(23405), undefined, 'citar un pedido normal no mata nada');
const dobles = cadenasDeVales([
  { numero: 18112, nota: 'VALE POR 42,50EUROS' },
  { numero: 18218, nota: 'VALE DE 42,50EUROS, UNION DEL VALE 18112' },
  { numero: 18219, nota: 'VALE DE 42,50, UNION DEL CAMBIO 18111 Y VALE 18112' },
]);
assert.deepEqual(dobles.gastadoPor.get(18112), [18218, 18219], 'puede citarlo más de uno');

// ── Lista confirmada por la tienda ──
const conf = parseConfirmados('23661\n23286=7,50\n\n# comentario\n17952 = 17.50\nbasura');
assert.equal(conf.size, 3);
assert.deepEqual(conf.get(23661), { importe: null, gastado: false }, 'sin importe se usa el detectado');
assert.deepEqual(conf.get(23286), { importe: 7.5, gastado: false });
assert.deepEqual(conf.get(17952), { importe: 17.5, gastado: false }, 'acepta espacios y punto decimal');
assert.equal(parseConfirmados('').size, 0);
assert.equal(parseConfirmados(null).size, 0);

// ── Nota de la tarjeta: de dónde sale el vale ──
const nota = giftCardNote({ numero: 23286, fecha: '2026-09-14', tipo: 'VALE', cliente: 'CARLA ROMERO',
  procedeDe: [21218], origen: 'nota', nota: 'VALE POR 7,50EUROS DEL RESTO DEL VALE 21218' });
assert.match(nota, /Vale de WooCommerce #23286/);
assert.match(nota, /2026-09-14/);
assert.match(nota, /CARLA ROMERO/);
assert.match(nota, /procede del vale 21218/);
assert.match(nota, /nota original: "VALE POR 7,50EUROS DEL RESTO DEL VALE 21218"/);
assert.doesNotMatch(nota, /confirmado/, 'sin importe confirmado no se menciona');
assert.match(giftCardNote({ numero: 1, fecha: '2026-01-01', tipo: 'VALE', origen: 'nota', importeConfirmado: 5 }),
  /importe confirmado por la tienda/);

// ── Plan: sin lista confirmada no se crea nada ──
const vale = { numero: 23286, fecha: '2026-09-14', tipo: 'VALE', cliente: '', nota: 'VALE POR 7,50EUROS', importe: 7.5, origen: 'nota', procedeDe: [] };
const sinLista = planGiftCard(vale, { gastadoPor: new Map() });
assert.equal(sinLista.input.code, 'vale23286');
assert.equal(sinLista.input.initialValue, '7.50', 'GiftCardCreateInput pide un Decimal suelto, no un MoneyInput');
assert.equal(sinLista.input.expiresOn, undefined, 'los vales de myminileo no caducan');

const lista = new Map([[23286, { importe: null }]]);
assert.equal(planGiftCard(vale, { confirmados: lista }).input.initialValue, '7.50');
assert.equal(planGiftCard({ ...vale, numero: 99999 }, { confirmados: lista }).skip, 'no está en la lista confirmada');
assert.equal(planGiftCard(vale, { confirmados: new Map([[23286, { importe: 3 }]]) }).input.initialValue, '3.00',
  'el importe confirmado manda sobre el de la nota');
assert.match(planGiftCard(vale, { confirmados: new Map([[23286, { importe: 3 }]]) }).input.note, /importe confirmado/);

// ── Plan: lo que no se migra ──
assert.equal(planGiftCard({ ...vale, importe: null }, {}).skip, 'sin importe legible');
assert.equal(planGiftCard({ ...vale, importe: 0 }, {}).skip, 'saldo 0', 'decisión de negocio: los de saldo 0 no se importan');
assert.equal(planGiftCard(vale, { gastadoPor: new Map([[23286, [23999]]]) }).skip,
  'gastado: su resto pasó al vale 23999', 'sin lista, la estimación descarta los gastados');
const forzado = planGiftCard(vale, { confirmados: lista, gastadoPor: new Map([[23286, [23999]]]) });
assert.ok(forzado.input, 'la tienda manda sobre la estimación');
assert.match(forzado.aviso, /lo daba por gastado/);
assert.equal(planGiftCard(vale, { confirmados: lista }).aviso, null);

// ── Notas del PEDIDO: la única prueba escrita de que un vale se gastó ──
const n = (...textos) => textos.map((note) => ({ note }));
assert.deepEqual(notasEscritasAMano(n(
  'El estado del pedido cambió de Pendiente de pago a Completado.',
  'Niveles de inventario reducidos: VALE (#27100) 75→74',
  'vale usado en el pedido 21698',
)), ['vale usado en el pedido 21698'], 'descarta las notas que escribe WooCommerce sola');
assert.deepEqual(notasEscritasAMano([]), []);
assert.deepEqual(notasEscritasAMano(null), []);

const est = (...textos) => estadoSegunNotasPedido(n(...textos));
assert.equal(est('vale usado en el pedido 21698').estado, 'USADO');
assert.equal(est('vale consumido el 11/10/23 13405').estado, 'USADO');
assert.equal(est('canjeado el 11 de noviembre ticket 13800').estado, 'USADO');
assert.equal(est('usa en pedido 17090').estado, 'USADO', '"usa" sin la palabra vale detrás');
assert.equal(est('SE GENERA NUEVO VALE CON EL RESTO 21611').estado, 'USADO', 'si se genera el resto, el viejo murió');
assert.equal(est('RESTO VALE DE 8,50EUROS TICKET 15965').estado, 'USADO');
assert.equal(est('AURORA MUÑOZ').estado, 'VIVO', 'una nota que no habla de consumo no mata el vale');
assert.equal(est().estado, 'VIVO', 'sin notas, vivo');
assert.equal(est('El estado del pedido cambió de Pendiente de pago a Completado.').estado, 'VIVO');

// Anulados: la tienda los canceló, no se migran aunque tengan importe
assert.equal(est('cancelado! unificado en un unico vale el 14491').estado, 'ANULADO');
assert.equal(est('este vale no sirve, CANCELADO, USAR EL VALE 16099').estado, 'ANULADO');
assert.equal(est('ERROR EN VALE, ES DE 1,95EUROS. ES EL 15612').estado, 'ANULADO');
assert.equal(est('nuevo vale 18219', 'se anula este vale').estado, 'ANULADO');

// Saldo parcial: el vale sigue vivo pero por menos dinero
const parcial = est('USA TARJETA REGALO EN EL PEDIDO 23649, LE QUEDA 1EURO PARA GASTAR');
assert.equal(parcial.estado, 'PARCIAL');
assert.equal(parcial.saldo, 1, 'migra 1 €, no los 100 € que costó');
assert.equal(est('le quedan 21euros', 'usa 19euros en pedido 18216').estado, 'PARCIAL');
assert.equal(est('le quedan 21euros', 'usa 19euros en pedido 18216').saldo, 21);
// Las notas llegan de más reciente a más antigua: manda la primera que hable de saldo
const dos = est('usado el pedido 22277, le queda 0euros', 'usado en el pedido 21631, le queda 1euro');
assert.equal(dos.estado, 'USADO', 'la nota más reciente dice que ya no queda nada');
assert.equal(dos.saldo, null);

// ── El plan respeta las notas del pedido por encima de todo ──
const conNotas = (estadoNotas) => ({ ...vale, estadoNotas });
assert.match(planGiftCard(conNotas(est('vale usado en el pedido 21698'))).skip, /^usado: vale usado/);
assert.match(planGiftCard(conNotas(est('se anula este vale'))).skip, /^anulado por la tienda/);
assert.equal(planGiftCard(conNotas(est('AURORA MUÑOZ'))).input.initialValue, '7.50');
const planParcial = planGiftCard(conNotas(est('LE QUEDA 1EURO PARA GASTAR')));
assert.equal(planParcial.input.initialValue, '1.00', 'se migra el saldo que queda');
assert.match(planParcial.input.note, /gastado en parte/);
// Ni siquiera la lista confirmada revive un vale que la nota da por gastado, salvo que
// corrija el importe a mano: ahí manda la tienda.
assert.match(planGiftCard(conNotas(est('vale usado')), { confirmados: lista }).skip, /^usado:/);
assert.equal(planGiftCard(conNotas(est('vale usado')), { confirmados: new Map([[23286, { importe: 4 }]]) }).input.initialValue, '4.00');



// ── Los cupones con código de número de pedido: la otra mitad de la historia ──
// Al principio la tienda daba el vale como un código de descuento de WooCommerce y le bajaba
// el saldo a mano en el campo «importe». Son los 10 cupones numéricos reales de la tienda.
const cuponesReales = [
  { code: '21159', amount: '1.00', usage_count: 2, date_created: '2026-03-05T00:00:00', date_expires: null, description: 'Mateo' },
  { code: '21041', amount: '0.00', usage_count: 0, date_created: '2025-12-26T00:00:00', date_expires: null, description: 'Tarjeta regalo 26.12.2025' },
  { code: '18954', amount: '50.00', usage_count: 1, date_created: '2025-07-11T00:00:00', date_expires: '2025-10-26T00:00:00', description: 'lUNA. REGALO DE ANUKA 10.4.2025 usado 26.10.2025' },
  { code: '18955', amount: '50.00', usage_count: 1, date_created: '2025-07-11T00:00:00', date_expires: '2025-10-26T00:00:00', description: 'nACHO, REGALO DE ANUKA. 10.4.2025 usado' },
  { code: '17873', amount: '0.00', usage_count: 1, date_created: '2025-01-15T00:00:00', date_expires: null, description: 'Código de Jacobo. Total de 40€ Usado parte el 15.1.2025 queda 21€ Gastado el 19.2.2025' },
  { code: '14503', amount: '100.00', usage_count: 0, date_created: '2024-01-12T00:00:00', date_expires: null, description: 'Tarjeta regalo para Leo de Pepa y Enrique Piñal' },
  { code: '14432', amount: '3.00', usage_count: 0, date_created: '2024-01-04T00:00:00', date_expires: null, description: 'Pepito Usado 22.3.2024 en pedido 15219 le quedan 19€ 19.9.2024 dos chupeteros usado en pedido 16957 quedan 3€' },
  { code: '14232', amount: '0.00', usage_count: 1, date_created: '2023-12-22T00:00:00', date_expires: null, description: 'Vale regalo de Victoria e Ignacio . 21.12.2023 Usado en pedido 15348 5.4.2024' },
  { code: 'cumplemyminileo', amount: '10.00', discount_type: 'percent', usage_count: 3, date_created: '2024-03-07T00:00:00', date_expires: '2025-04-10T00:00:00', description: '10% CUMPLE SANTI' },
  { code: 'minicumple', amount: '0.00', usage_count: 0, date_created: '2026-04-10T00:00:00', date_expires: null, description: '' },
];
const porCodigo = cuponesDeVales(cuponesReales);
assert.equal(porCodigo.size, 8, 'solo los códigos que son un número de pedido');
assert.ok(!porCodigo.has('cumplemyminileo'), 'un cupón de promoción no es un vale');
assert.equal(porCodigo.get(14432).amount, '3.00', 'la clave es el número, no el texto');

const ahora = new Date('2026-11-05T00:00:00Z');
// El importe del cupón es el saldo vivo, bajado a mano.
assert.deepEqual(estadoSegunCupon(porCodigo.get(14432), ahora).estado, 'VIVO');
assert.equal(estadoSegunCupon(porCodigo.get(14432), ahora).saldo, 3, 'le quedan 3 €, aunque la descripción diga "Usado" dos veces');
assert.equal(estadoSegunCupon(porCodigo.get(14503), ahora).saldo, 100, 'sin usar: los 100 € siguen enteros');
// Saldo a 0 = gastado.
assert.equal(estadoSegunCupon(porCodigo.get(17873), ahora).estado, 'USADO');
assert.equal(estadoSegunCupon(porCodigo.get(21041), ahora).estado, 'USADO');
assert.match(estadoSegunCupon(porCodigo.get(21041), ahora).motivo, /saldo 0/);
// Solo el importe decide. El 18954 y el 18955 están caducados el 26.10.2025 y su descripción
// dice "usado", y la tienda confirma que están sin usar y con sus 50 €: el importe es el saldo
// que ella baja a mano, el texto solo cuenta la historia.
assert.equal(estadoSegunCupon(porCodigo.get(18954), ahora).estado, 'VIVO', 'la tienda dice que está sin usar');
assert.equal(estadoSegunCupon(porCodigo.get(18954), ahora).saldo, 50);
assert.equal(estadoSegunCupon(porCodigo.get(18955), ahora).saldo, 50, 'caducado y "usado" en la descripción, pero con sus 50 € enteros');
assert.equal(estadoSegunCupon(null, ahora), null, 'sin cupón no hay opinión');
assert.equal(estadoSegunCupon({ code: '19999', amount: '10.00', description: 'CANCELADO, no sirve' }, ahora).estado, 'ANULADO');

// ── Dos fuentes para el mismo vale: gana la peor ──
const vivo = { estado: 'VIVO', saldo: null, motivo: null };
assert.equal(estadoCombinado(null, null).estado, 'VIVO', 'sin ninguna fuente, vivo');
assert.equal(estadoCombinado(vivo, null).estado, 'VIVO');
assert.equal(estadoCombinado(vivo, { estado: 'USADO', saldo: null, motivo: 'cupón 21041 — saldo 0' }).estado, 'USADO',
  'el pedido no dice nada pero el cupón está a 0: gastado');
assert.equal(estadoCombinado({ estado: 'PARCIAL', saldo: 21, motivo: 'le quedan 21euros' }, { estado: 'USADO', saldo: null, motivo: 'cupón 17873' }).estado, 'USADO',
  'la nota lo daba por parcial y el cupón por gastado: gastado');
assert.equal(estadoCombinado({ estado: 'USADO', saldo: null, motivo: 'le queda 0euros' }, { estado: 'VIVO', saldo: 1, motivo: 'cupón 21159' }).estado, 'USADO',
  'el 21159: el cupón aún marca 1 € pero la nota del pedido, posterior, lo deja a 0');
assert.equal(estadoCombinado({ estado: 'ANULADO', saldo: null, motivo: 'CANCELADO' }, { estado: 'VIVO', saldo: 50, motivo: 'c' }).estado, 'ANULADO');
assert.equal(estadoCombinado({ estado: 'PARCIAL', saldo: 40, motivo: 'a' }, { estado: 'VIVO', saldo: 12, motivo: 'b' }).saldo, 12,
  'con saldo en las dos, manda el más bajo');
assert.equal(estadoCombinado({ estado: 'PARCIAL', saldo: 9, motivo: 'a' }, { estado: 'VIVO', saldo: 30, motivo: 'b' }).saldo, 9);

// ── planGiftCard con cupón ──
const base = { numero: 21041, fecha: '2025-12-26', tipo: 'TARJETA REGALO', cliente: 'Anuca', nota: 'anuca', importe: 50, origen: 'línea del pedido' };
assert.match(planGiftCard({ ...base, estadoNotas: vivo, cupon: porCodigo.get(21041) }, { ahora }).skip, /usado/,
  'el 21041 ya no se crea: su cupón está a 0');
assert.ok(!planGiftCard({ ...base, estadoNotas: vivo, cupon: null }, { ahora }).skip,
  'sin cupón, el mismo vale seguiría pareciendo vivo (esto era el fallo)');
assert.equal(planGiftCard({ ...base, numero: 18954, estadoNotas: null, cupon: porCodigo.get(18954) }, { ahora }).input.initialValue, '50.00',
  'el 18954 sí se crea: la tienda lo da por sin usar y su cupón conserva los 50 €');
const conSaldoCupon = planGiftCard({ ...base, numero: 14432, importe: null, estadoNotas: null, cupon: porCodigo.get(14432) }, { ahora });
assert.equal(conSaldoCupon.input.initialValue, '3.00', 'migra el saldo que queda en el cupón, no el importe original');
assert.match(conSaldoCupon.input.note, /tenía código de descuento 14432 en WooCommerce/, 'la nota dice de dónde viene');

// ── Saldo que solo existe en un cupón, sin pedido de vale detrás ──
const huerfanos = valesSoloEnCupon(cuponesReales, [21159, 21041, 18954, 18955, 17873], ahora);
assert.deepEqual(huerfanos.map((v) => v.numero), [14432, 14503], 'solo los que tienen saldo vivo y no son un pedido de vale');
assert.equal(huerfanos.find((v) => v.numero === 14503).importe, 100);
assert.equal(huerfanos.find((v) => v.numero === 14503).tipo, 'VALE (solo cupón)');
assert.match(huerfanos.find((v) => v.numero === 14503).origen, /saldo del cupón 14503/);
assert.equal(valesSoloEnCupon(cuponesReales, [21159, 14432, 14503, 18954, 18955], ahora).length, 0,
  'si cada cupón con saldo ya tiene su pedido de vale, no se duplica nada');
assert.equal(valesSoloEnCupon([], [], ahora).length, 0);

// ── Correcciones de la tienda en la lista confirmada ──
// "13055=0" es la tienda diciendo «este está gastado». Sin tratarlo aparte, la línea se leería
// como «confirmado, sin importe» y el vale se migraría con el importe de su nota.
assert.equal(parseConfirmados('13055=0').get(13055).gastado, true);
assert.equal(parseConfirmados('13055=0').get(13055).importe, null);
assert.equal(parseConfirmados('13055').get(13055).gastado, false, 'sin importe no es una corrección, solo un visto bueno');
assert.equal(parseConfirmados('13055=29,00').get(13055).gastado, false);
assert.match(planGiftCard({ ...base, numero: 13055, importe: 29, estadoNotas: null, cupon: null },
  { confirmados: parseConfirmados('13055=0   # era una prueba'), ahora }).skip, /la tienda lo marca gastado/,
  'el 13055 era una prueba: no se migra aunque su nota diga 29 €');

// ── Un vale no se migra además como código de descuento ──
assert.match(planCoupon({ code: '14503', status: 'publish', amount: '100.00', discount_type: 'fixed_cart', date_created: '2024-01-12T00:00:00' }).skip,
  /vale vendido/, 'si no, el saldo existiría dos veces y el código sería reutilizable sin límite');
assert.match(planCoupon({ code: '17873', status: 'publish', amount: '40.00', discount_type: 'fixed_cart', date_created: '2025-01-15T00:00:00' }).skip, /vale vendido/);
assert.ok(!planCoupon({ code: 'cumplemyminileo', status: 'publish', amount: '10.00', discount_type: 'percent', date_created: '2024-03-07T00:00:00' }).skip,
  'los cupones de promoción de verdad siguen migrando');

console.log('giftcards: OK');

// ── La lista confirmada se entrega con el tipo y el cliente anotados detrás ──
const pegada = parseConfirmados(`# 101 vales
13055=29,00   # VALE · Celia Lledó
14503=100.00  # VALE (solo cupón)
23661         # sin importe: vale el de la nota

`);
assert.equal(pegada.size, 3, 'ignora la cabecera y las líneas vacías');
assert.equal(pegada.get(13055).importe, 29);
assert.equal(pegada.get(14503).importe, 100);
assert.equal(pegada.get(23661).importe, null, 'sin importe se queda con el de la nota');
console.log('giftcards: OK (lista pegada)');

// ── Índice de vales: lo único que busca la lista de metaobjetos es el nombre visible ──
assert.equal(valeIndexHandle(23360), 'vale-23360');
assert.equal(eurosEs(1), '1,00 €', 'importes en español, que es lo que ella lee');
assert.equal(eurosEs(23.5), '23,50 €');
assert.equal(valeIndexTitulo({ numero: 23360, cliente: 'Maria Barrau' }, 1),
  '23360 · Maria Barrau · 1,00 € · vale23360',
  'empieza por el número de pedido: buscar "23360" en tarjetas regalo no devuelve nada y aquí sí');
assert.equal(valeIndexTitulo({ numero: 14503, cliente: null }, 100), '14503 · 100,00 € · vale14503',
  'muchos vales se vendieron en el TPV sin cliente');

// El panel usa el nombre de la tienda, no el dominio, y el id numérico va dentro del GID.
assert.equal(adminGiftCardUrl('miminileodev.myshopify.com', 'gid://shopify/GiftCard/1324048712057'),
  'https://admin.shopify.com/store/miminileodev/gift_cards/1324048712057');
assert.equal(adminGiftCardUrl('', 'gid://shopify/GiftCard/1'), null);
assert.equal(adminGiftCardUrl('miminileodev.myshopify.com', null), null, 'sin tarjeta no se inventa enlace');

const campos = valeIndexFields(
  { numero: 23360, cliente: 'Maria Barrau', fecha: '2026-09-22' },
  { importe: 1, nota: 'Vale de WooCommerce #23360', giftCardGid: 'gid://shopify/GiftCard/1324048712057', shopifyUrl: 'miminileodev.myshopify.com' },
);
const porClave = new Map(campos.map((f) => [f.key, f.value]));
assert.equal(porClave.get('numero'), '23360');
assert.equal(porClave.get('codigo'), 'vale23360');
assert.equal(porClave.get('saldo'), '1.00', 'number_decimal quiere punto, no coma');
assert.equal(porClave.get('fecha'), '2026-09-22');
assert.equal(porClave.get('historia'), 'Vale de WooCommerce #23360');
assert.match(porClave.get('tarjeta'), /^https:\/\/admin\.shopify\.com\/store\/miminileodev\/gift_cards\/\d+$/);

// Una fecha a medias tira la entrada entera, así que no se manda.
const sinFecha = valeIndexFields({ numero: 99, cliente: null, fecha: '2024' }, { importe: 5 });
assert.ok(!sinFecha.some((f) => f.key === 'fecha'), 'fecha incompleta: mejor no mandarla');
assert.ok(!sinFecha.some((f) => f.key === 'cliente'), 'sin cliente no se manda el campo vacío');
assert.ok(!sinFecha.some((f) => f.key === 'tarjeta'), 'sin tarjeta no hay enlace');

console.log('✓ índice de vales (metaobjetos)');
