# Diseño: botón "Solo productos nuevos" y comparación de inventario

Fecha: 2026-09-08 · Archivo afectado: `woo-shopify-sync.html`

## 1. Botón "Solo productos nuevos"

- `startMigration(stockOnly)` pasa a `startMigration(mode)` con `mode ∈ {'full','stock','new'}`.
  Los botones existentes llaman con `'full'` y `'stock'`; el nuevo con `'new'`.
- Modo `new`: producto existente en Shopify (por SKU o título) → omitido y `stats.skip++`,
  ignorando `conflictMode`. No existente → se crea igual que en modo `full`, variantes incluidas.
- Colecciones y pedidos no se sincronizan en modo `new`.
- Cabecera de log: "Inicio solo productos nuevos".

## 2. Comparación de inventario

- Botón "⇄ Comparar inventario" en el panel Resumen. Solo lectura.
- Descarga catálogo WooCommerce (`getAllWooProducts`) y Shopify (`getAllShopifyProducts`, nueva,
  extraída de la migración y reutilizada por ella).
- Emparejamiento: SKU de cualquier variante de Shopify; si no, título normalizado (minúsculas, trim).
- Estados: `synced` (ambos, precio y stock iguales), `diff` (ambos, precio o stock distinto),
  `woo_only`, `shopify_only`.
- Stock Shopify = suma de `inventory_quantity` de variantes. Precio Shopify = mínimo de variantes.
  Stock Woo `null` → "—" y no cuenta como diferencia. Precios comparados como números.
- `compareCatalogs(wooProducts, shopifyProducts)` es pura y devuelve filas
  `{ name, sku, woo:{price,stock}|null, shopify:{price,stock}|null, status, priceDiff, stockDiff }`.
- Panel "Comparación" (oculto hasta tener datos): 4 contadores-filtro por estado, buscador por
  nombre/SKU, tabla Producto · WooCommerce · Shopify · Estado. Orden: no sincronizados primero.
  Valores distintos resaltados. Render con `textContent`, sin `innerHTML` para datos de producto.
- Errores: fallo en cualquier descarga → log de error, sin tabla parcial. Botón Detener reutilizado.

## 3. Stock por InventoryLevel (corrección)

`inventory_quantity` es de solo lectura en la API REST de Shopify; el PUT de variante lo ignoraba en
silencio. Todo stock se fija ahora con `POST inventory_levels/set.json` en la ubicación principal
(`GET locations.json`, primera activa, cacheada por ejecución). Si WooCommerce no gestiona stock
(`stock_quantity` null) no se toca el stock de Shopify.

## 3b. Modo stock: omitir lo que no cambia

En la rama de actualización se compara el producto de WooCommerce con la primera variante del
catálogo de Shopify ya descargado (`stockUpdatePlan`). Solo se envía el precio si difiere y el stock
si difiere; sin diferencias, el producto se registra como "Sin cambios", cuenta como omitido y no
genera ninguna petición ni pausa. Desaparece la lectura de variantes por producto.

## 4. Borrado de huérfanos en Shopify

- Casilla "Eliminar en Shopify lo que no esté en WooCommerce", desactivada por defecto, no persistida.
- Solo al final de la migración completa, tras colecciones y pedidos, y si no se ha cancelado.
- WooCommerce es el dato maestro. Huérfano = producto de Shopify sin equivalente **publicado** en
  WooCommerce (`status=publish`, el mismo conjunto que usa la comparación). Un producto en borrador,
  privado o pendiente en WooCommerce se elimina de Shopify.
  Emparejamiento uno a uno (`pairCatalogs`, compartido con la comparación): cada producto de Shopify
  es pareja de un solo producto de WooCommerce, primero por SKU y luego por título normalizado,
  prefiriendo el de igual precio y si no el más antiguo. Lo que queda sin pareja en Shopify se borra.
- Salvaguardas: si WooCommerce devuelve 0 productos publicados no se borra nada; si falla la descarga de
  cualquiera de los catálogos, el error aborta el paso; cada borrado se registra en el log.

## 5. Botón "Eliminar los que solo están en Shopify"

Al pie del panel Comparación, activo solo si hay filas "Solo Shopify". Reutiliza `collectShopifyOrphans`
(WooCommerce publicados, criterio conservador) y `deleteShopifyProducts`, compartidas con el
paso automático. Muestra un `confirm` con hasta 15 nombres antes de borrar; al terminar retira las
filas borradas de la tabla.

## Limitaciones conocidas

- Con títulos duplicados sin SKU en ambos lados, la elección de qué producto de Shopify se conserva es
  por precio igual y, si no, por antigüedad. La lista de confirmación muestra siempre qué se borrará.
- El emparejamiento por título es insensible a mayúsculas y espacios, en migración y comparación.

## Fuera de alcance

Exportar CSV, acciones desde la tabla, cambio del criterio de emparejamiento.
