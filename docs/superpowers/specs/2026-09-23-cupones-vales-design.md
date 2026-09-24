# Sincronización de vales (cupones) WooCommerce → Shopify

Fecha: 2026-09-23. Estado: **análisis, sin implementar**.
Origen: 30 cupones (`shop_coupon`) en `www.myminileo.com`. Destino: códigos de descuento
de `miminileodev.myshopify.com`.

> "Vales" aquí = **cupones** de WooCommerce (`shop_coupon`, 30 filas en la inspección del
> 2026-09-11). Si lo que se quiere migrar son **tarjetas regalo** con saldo, es otra cosa
> distinta y no hay plugin de gift cards en la lista de plugins activos de Woo — ver §6.

## 1. De dónde salen los datos

`GET /wp-json/wc/v3/coupons?per_page=100` — una sola página, ya autenticado con las mismas
credenciales que usa el resto del sincronizador (`wooRequest`). No hace falta la sonda de
base de datos.

Campos que devuelve cada cupón y que importan:

`code`, `discount_type`, `amount`, `description`, `date_expires`, `usage_limit`,
`usage_limit_per_user`, `limit_usage_to_x_items`, `usage_count`, `individual_use`,
`free_shipping`, `minimum_amount`, `maximum_amount`, `product_ids`, `excluded_product_ids`,
`product_categories`, `excluded_product_categories`, `exclude_sale_items`,
`email_restrictions`, `used_by`, `status`.

## 2. Qué API de Shopify se usa

**GraphQL, no REST.** `price_rules.json` + `discount_codes.json` son la API antigua y
está en desuso. Lo vigente:

| Caso | Mutación |
|---|---|
| % o importe fijo | `discountCodeBasicCreate` / `discountCodeBasicUpdate` |
| Envío gratis | `discountCodeFreeShippingCreate` |
| Buscar si ya existe | `codeDiscountNodeByCode(code:)` → GID, para no duplicar al reejecutar |

El helper `shopifyGraphQL()` ya existe en `woo-shopify-sync.html:1209` y sirve tal cual.

### Bloqueante: faltan permisos

La app **no pide `read_discounts` ni `write_discounts`**. Hay que añadirlos en dos sitios
y volver a autorizar la app desde "Conectar con Shopify":

- `shopify.app.toml:11` (`access_scopes.scopes`)
- `server.js:19` (la cadena `scopes` del endpoint `/auth/shopify`)

Nota aparte: esas dos listas **ya están desincronizadas hoy** — el `.toml` incluye
`read_orders,write_orders` y `server.js` no. Como el token real sale de `server.js`, el paso
de pedidos está autorizando de menos. Conviene arreglarlo en el mismo cambio.

## 3. Mapa campo a campo

| WooCommerce | Shopify | Viabilidad |
|---|---|---|
| `code` | `code` + `title` | ✅ directo (Shopify no distingue mayúsculas) |
| `discount_type = percent` | `customerGets.value.percentage` (0–1: `amount/100`) | ✅ |
| `discount_type = fixed_cart` | `customerGets.value.discountAmount { amount, appliesOnEachItem: false }` | ✅ |
| `discount_type = fixed_product` | `discountAmount { amount, appliesOnEachItem: true }` | ✅ |
| `date_expires` | `endsAt` | ✅ (Woo lo da sin zona horaria; enviar como ISO en la del negocio) |
| — | `startsAt` | Obligatorio en Shopify. Usar la fecha de creación del cupón o "ahora". |
| `usage_limit` | `usageLimit` | ⚠️ ver §4 (el consumo previo se pierde) |
| `usage_limit_per_user = 1` | `appliesOncePerCustomer: true` | ✅ |
| `usage_limit_per_user > 1` | — | ❌ sin equivalente (Shopify solo tiene 1 vez sí/no) |
| `individual_use = true` | `combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }` | ✅ |
| `minimum_amount` | `minimumRequirement.subtotal.greaterThanOrEqualToSubtotal` | ✅ |
| `free_shipping = true` | `discountCodeFreeShippingCreate` | ⚠️ ver §4 |
| `product_ids` | `customerGets.items.products.productsToAdd` | ✅ vía `custom.woo_id` (`fetchShopifyWooIds`, línea 842) |
| sin restricción de producto | `customerGets.items.all: true` | ✅ |
| `product_categories` | `customerGets.items.collections` | ❌ **no hay colecciones** (decisión 2026-09-11: categorías van como metaobjetos). Ver §4. |
| `excluded_product_ids` / `excluded_product_categories` | — | ❌ Shopify solo permite incluir, nunca excluir |
| `exclude_sale_items` | — | ❌ sin equivalente |
| `maximum_amount` | — | ❌ sin equivalente |
| `limit_usage_to_x_items` | — | ❌ sin equivalente |
| `email_restrictions` | `customerSelection.customers` | ❌ en la práctica: exige tener los clientes creados en Shopify, y los clientes **no se migran** |
| `usage_count` / `used_by` | — | ❌ histórico, no se puede escribir |
| `description` | — | No hay campo. Va en el `title` o se pierde. |
| `status = draft/trash` | no migrar | Solo migrar los `publish` |

## 4. Los cuatro puntos que hay que decidir

1. **Cupones por categoría.** Si alguno de los 30 usa `product_categories`, no hay destino
   directo: en Shopify no estamos creando colecciones. Opciones: (a) expandir la categoría a
   la lista de productos concretos vía Woo y apuntarlos uno a uno — funciona pero queda
   congelado, los productos nuevos de esa categoría no entrarían; (b) crear una colección
   automática solo para ese descuento; (c) dejarlo para hacer a mano. **Recomendación: (c)**,
   son pocos y el descuento equivocado cuesta dinero real.
2. **Consumo previo.** Shopify no deja fijar "ya usado N veces". Si un cupón tenía límite 100
   y lleva 37 usos, hay que migrarlo con `usageLimit: 63` (restante) o con 100 (se regalan 37
   usos). **Recomendación: migrar el restante**, y si `usage_count >= usage_limit`, no migrarlo.
3. **Envío gratis + descuento a la vez.** Un cupón Woo con `free_shipping` y además importe
   son **dos descuentos** en Shopify, con dos códigos distintos — y Shopify no permite dos
   códigos en el mismo pedido salvo que `combinesWith` lo autorice. **Recomendación:** si el
   cupón solo es envío gratis → `discountCodeFreeShippingCreate`; si es mixto, migrar el
   importe y avisar en el log de que el envío gratis se configura a mano.
4. **Cupones caducados.** Los que tengan `date_expires` en el pasado probablemente no valga la
   pena migrarlos. **Recomendación: omitirlos** y contarlos en el log.

## 5. Cómo encaja en el sincronizador

Mismo patrón que `syncOrders` (línea 1538) y `syncCategoryTree` (1511):

1. Checkbox `chk_coupons` "Cupones" junto a `chk_orders` (línea 491) y su entrada en
   `getConfig()` (línea 703) como `syncCoupons`.
2. `async function syncCoupons(cfg, signal)`:
   - `wooRequest(cfg, 'coupons', { per_page: 100, status: 'publish' })`
   - índice `wooId → productId` reutilizando `fetchShopifyWooIds`, solo si hay cupones con
     `product_ids`
   - por cada cupón: `codeDiscountNodeByCode` → si existe, `discountCodeBasicUpdate`; si no,
     `discountCodeBasicCreate`. Esto lo hace reejecutable sin duplicar.
   - `throwUserErrors()` para los `userErrors` (ya existe, línea 1241)
   - log por cupón + resumen `=== Cupones: N creados, M actualizados, K omitidos ===`,
     nombrando cada omitido y su motivo (categoría, agotado, caducado).
3. Llamada en `startMigration` solo con `mode === 'full'`, junto a los pedidos (línea ~2450).

Son ~120 líneas. 30 cupones en una sola página: sin paginación ni problemas de rate limit.

## 6. Si "vales" son tarjetas regalo

Otra cosa completamente distinta: saldo prepago, no porcentaje. En Woo no hay plugin de gift
cards entre los activos, así que lo más probable es que no aplique. Si aplicara: Shopify tiene
`giftCardCreate` (scope `write_gift_cards`), permite fijar saldo inicial pero **no** el código
completo si ya existe otro igual, y requiere que la tienda tenga las tarjetas regalo activas.
Habría que confirmar antes de nada qué plugin las gestiona en Woo.
