# Mapa de datos WooCommerce → Shopify (myminileo)

Fecha: 2026-09-11. Fuente: inspección de solo lectura de la base de datos de
`www.myminileo.com` (WooCommerce 11.1.0, WordPress con prefijo `ojn1h_`, PHP 8.4,
MySQL 5.7). Destino: `miminileodev.myshopify.com`.

Estado de cada fila: ✅ ya lo hace el sincronizador · ⚠️ lo hace mal o a medias · ❌ no existe.

## 1. Qué hay en WooCommerce

| Entidad | Cantidad | Notas |
|---|---|---|
| Productos publicados | 482 | 317 simples + 165 variables |
| Productos en borrador | 690 | 374 variables + 316 simples. 152 con stock en el padre, 1.302 variaciones con stock > 0, 669 con ventas históricas. Hoy no se migran (solo `publish`). |
| Variaciones publicadas | 2.692 | Media 5 por producto, máximo 13 |
| Atributos de variación | 1 | Todos los productos variables usan **solo `pa_talla` ("Talla")**. `pa_color` y `pa_patucos` existen pero no se usan en variaciones. |
| Valores de Talla | 80 términos | Con duplicados y textos inconsistentes ("8- 10 años" y "8-10 años", "6/12 meses" y "6-12 meses", slug `2-3-anos` con nombre "3-4 años"). |
| SKU | **0** | Ningún producto ni variación tiene SKU. Solo 4 filas en la tabla lookup. |
| Precios | regular + rebajado | 237 variaciones y 20 simples con rebaja real (`sale < regular`). Sin ofertas programadas. Precios sin impuestos, sin cálculo de impuestos. |
| Stock | por variación | 3.047 artículos gestionan stock; 784 agotados; sin reservas (backorders). |
| Imágenes | galería en 488 productos | 168 variaciones (de 49 productos publicados) tienen imagen propia. |
| Categorías | 76 (11 raíces, 3 niveles) | Con imagen (`thumbnail_id`) y orden. Productos en 1 a 4 categorías (251 / 120 / 61 / 50). Sin categoría principal (Yoast no activo). |
| Etiquetas | 315 términos | Uso masivo: "bebé" 448, "baby" 370, "niña" 274... |
| Descripción larga | 456 productos | 325 con HTML, media 723 caracteres |
| Descripción corta | 283 productos | Shopify no tiene campo equivalente |
| Upsells | 129 publicados | `_upsell_ids`. Crosssell solo en 4. |
| Variación por defecto | 39 productos | `_default_attributes` |
| Visibilidad | 90 ocultos de búsqueda, 1 de catálogo, 4 destacados | Taxonomía `product_visibility` |
| Guías de tallas | 10 tablas | Plugin *Product Size Chart for WooCommerce*. Solo 9 productos con guía asignada explícitamente; el resto usa el conjunto por defecto del plugin. Tablas en JSON (`chart-table`). |
| Atributo no-variación "Tallaje" | 3 productos | Texto visible en la ficha |
| Peso y dimensiones | 0 | No hay datos |
| Marcas, clases de envío, reseñas, GTIN | 0 | No existen (1 GTIN) |
| Pedidos | 16.956 | 16.435 completados, 282 cancelados, 130 reembolsados, 109 pendientes |
| Clientes registrados | 564 | |
| Cupones | 30 | |
| TPV | en uso | Plugin *WooCommerce Point of Sale*, 2.491 sesiones de caja. Visibilidad por producto `_pos_visibility`. |
| Otros plugins con datos de producto | Waitlist (avísame), Facebook catálogo, MailerLite, Klaviyo | Datos operativos de terceros, no de catálogo |
| SEO | solo puntuación de contenido Yoast | No hay títulos ni descripciones SEO. La opción "Metadatos SEO" del sincronizador no aporta nada real. |

## 2. Encaje producto a producto

### Nivel producto

| WooCommerce | Shopify | Estado | Detalle |
|---|---|---|---|
| `name` | `title` | ✅ | |
| `description` (HTML) | `body_html` | ✅ | |
| `short_description` | metacampo `custom.descripcion_corta` (texto multilínea con HTML) | ✅ | Implementado 2026-09-11 en el paso "Metacampos". |
| `status = publish` | `status = active` | ✅ | |
| `status = draft` | no migrar | ✅ | Decisión 2026-09-11: los borradores no se sincronizan. |
| `categories` (árbol) | metaobjetos `categoria` + metacampo `custom.categorias` | ✅ | Implementado hoy, 241 productos asignados. Incluye imagen de categoría. |
| `categories[0].name` | `product_type` | ✅ | Decisión 2026-09-11: se deja vacío. |
| `categories` + `tags` | `tags` | ⚠️ | Se vuelcan las categorías también como tags. Con los metaobjetos ya no hace falta; propuesta: solo tags de Woo. |
| `images` | `images` con `alt` | ✅ | |
| `featured` | metacampo booleano `custom.destacado` | ✅ | Implementado 2026-09-11. |
| `exclude-from-search` / `exclude-from-catalog` | no migrar | ✅ | Decisión 2026-09-11: todo producto con `catalog_visibility` distinto de `visible` se omite (91 productos). Si ya existía en Shopify, cuenta como huérfano para la opción de borrado. |
| `upsell_ids` | metacampo `custom.upsells` (`list.product_reference`) | ✅ | Implementado 2026-09-11; se resuelve por título tras la migración de productos. Los upsells que apunten a productos no migrados se omiten. |
| `default_attributes` | orden de variantes (la variante por defecto primero) | ❌ | 39 productos. Shopify muestra la primera variante. |
| guía de tallas (`prod-chart` + defecto) | metaobjeto `guia_tallas` (nombre, tabla JSON, etiqueta) + metacampo `custom.guia_tallas` | ❌ | 10 tablas. Hay que decidir si se migran las 10 y la regla de asignación por defecto. |
| atributo "Tallaje" | metacampo `custom.tallaje` (texto) | ❌ | 3 productos, prioridad baja |
| `tax_status = taxable` | `taxable = true` en variantes | ✅ | Por defecto |
| SEO título/descr. | `metafields_global_title_tag` | ✅ | Sin datos reales en Woo, iguala al título. |
| `_pos_visibility` | publicación en canal Shopify POS | ❌ | Fuera del alcance del sincronizador; configurar en Shopify. |

### Nivel variante

| WooCommerce | Shopify | Estado | Detalle |
|---|---|---|---|
| atributo `pa_talla` | `options: [{ name: "Talla" }]` en el producto | ✅ | Implementado 2026-09-11: en alta va en el POST; en productos existentes se renombra la opción. |
| valor de talla de la variación | `variant.option1` con el nombre del término | ✅ | Implementado 2026-09-11, también en actualización. |
| variaciones en productos ya existentes | crear / actualizar / borrar variantes | ✅ | Implementado 2026-09-11 (`syncProductVariants`). Nunca borra si Woo no aporta variaciones. |
| variante de relleno del padre | no crearla; borrar la existente | ✅ | Implementado 2026-09-11. |
| emparejar variación con variante | por valor de Talla (`option1`) | ✅ | Implementado 2026-09-11. |
| `regular_price` | `compare_at_price` cuando hay rebaja | ✅ | Implementado 2026-09-11 en simples y variantes. |
| `sale_price` / `price` | `price` | ✅ | Woo ya expone `price` como precio vigente. |
| `stock_quantity` de la variación | `inventory_levels/set` por variante | ✅ | Implementado 2026-09-11; solo se envía si difiere. |
| `manage_stock = no` + `stock_status` | cantidad 0 si agotado; si no, no se toca | ✅ | Implementado 2026-09-11. |
| imagen de la variación | imagen del producto enlazada a la variante | ✅ | Implementado 2026-09-11; no se vuelve a subir si la variante ya tiene imagen. |
| SKU / GTIN | `sku` / `barcode` | ✅ | Vacíos en origen; no hay nada que migrar. |
| `variation_description` | metacampo de variante | ✅ | Vacía en las 2.692; no migrar. |
| orden de tallas | `position` de la variante según el orden de variaciones de Woo | ✅ | Implementado 2026-09-11. |

### Comparación de precio y stock en productos existentes

Resuelto 2026-09-11: los productos variables ya no pasan por la comparación padre contra
primera variante; van variante a variante con `planVariants`. Los simples mantienen
`stockUpdatePlan` y añaden el precio tachado.

## 3. Otras entidades

| Entidad | Shopify | Estado | Comentario |
|---|---|---|---|
| Pedidos (16.956) | Orders (importación) | ⚠️ | Existe la opción "Pedidos" en el sincronizador; no revisada en este análisis. |
| Clientes (564) | Customers | ❌ | Fuera del alcance actual. |
| Cupones (30) | Discount codes | ❌ | Recrear a mano o migración aparte. |
| Lista de espera (waitlist) | app de "avísame" en Shopify | ❌ | Datos de terceros. |
| Catálogo Facebook, MailerLite, Klaviyo | canales / apps de Shopify | ❌ | Se reconectan en Shopify, no se migran. |
| Redsys | pasarela de pago | ❌ | Configuración, no datos. |

## 4. Prioridades de implementación

1. **Variantes (bloqueante).** Opción "Talla"; descargar variaciones también en productos
   existentes; emparejar por valor de talla; crear, actualizar y borrar; quitar la variante
   de relleno; `compare_at_price`; stock por variante; imagen de variante; orden de tallas.
   Dejar de comparar padre contra primera variante. El checkbox "Variantes" controla el paso.
2. **Metacampos de producto.** `custom.descripcion_corta`, `custom.upsells`,
   `custom.destacado`, guías de tallas como metaobjeto + referencia.
3. **Ajustes.** `product_type` por categoría raíz o vacío; no duplicar categorías en tags;
   ocultos de búsqueda como tag o sin publicar.
4. **Decisiones del negocio.** Qué hacer con los 690 borradores; si se migran las guías de
   tallas por defecto; canal POS.

## 5. Decisiones

Tomadas el 2026-09-11: borradores no se migran; `product_type` vacío; productos ocultos
(de catálogo o de búsqueda) no se sincronizan.

Pendientes:
- Tags: ¿solo etiquetas de Woo, o seguir añadiendo también las categorías? (hoy se añaden las dos)
- Guías de tallas: ¿migrar las 10 como metaobjetos y asignar la de cada producto (9 explícitas + regla por defecto), o solo las 9 explícitas?
