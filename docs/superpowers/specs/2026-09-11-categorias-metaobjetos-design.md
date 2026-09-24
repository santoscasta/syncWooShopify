# Categorías de WooCommerce → Metaobjetos en Shopify (árbol)

Fecha: 2026-09-11

## Objetivo

Reproducir en Shopify el árbol de categorías de WooCommerce usando metaobjetos, y
asignar a cada producto sus categorías mediante un metacampo de referencias.
Sustituye la sincronización anterior "Categorías → Colecciones", que se elimina.

## Modelo en Shopify

Definición de metaobjeto `categoria` (nombre visible "Categoría"):

| Campo        | Tipo                       | Origen Woo            |
|--------------|----------------------------|-----------------------|
| nombre       | single_line_text_field     | `name`                |
| slug         | single_line_text_field     | `slug`                |
| descripcion  | multi_line_text_field      | `description`         |
| ruta         | single_line_text_field     | calculada: "A > B > C"|
| imagen       | url                        | `image.src`           |
| woo_id       | number_integer             | `id`                  |
| padre        | metaobject_reference (categoria) | `parent`        |

- Handle del metaobjeto = `slug` de Woo. El upsert por handle hace la operación idempotente.
- `displayNameKey` = `nombre`. Acceso storefront: `PUBLIC_READ`.
- `padre` se autorreferencia, así que la definición se crea en dos pasos: crear sin
  `padre`, luego `metaobjectDefinitionUpdate` añadiendo `padre` con validación
  `metaobject_definition_id` = id recién creado.

Definición de metacampo de producto `custom.categorias`, tipo
`list.metaobject_reference` con validación a la definición `categoria`.

## Flujo

Función `syncCategoryTree(cfg, signal, shopifyExisting)`, invocada en modo `full`
cuando `cfg.syncCategoryTree` está activo, tras la sincronización de productos.

1. `ensureCategoryDefinitions`: consulta `metaobjectDefinitionByType(type:"categoria")`
   y `metafieldDefinitions(ownerType: PRODUCT, namespace:"custom", key:"categorias")`.
   Crea lo que falte. Si falla, el paso aborta con mensaje claro (si es 403 o
   ACCESS_DENIED, indica que hay que reautorizar la app con los nuevos scopes).
2. Descargar todas las categorías de Woo (`products/categories`, paginado a 100).
3. `planCategoryTree(wooCats)` (lógica pura): descarta "Uncategorized" y
   "Sin categorizar", ordena padres antes que hijos, calcula `ruta`. Categorías con
   padre inexistente o en ciclo se tratan como raíz y se registran en `warnings`.
4. Por cada categoría, `metaobjectUpsert` por handle con todos los campos. Se guarda
   el mapa `wooId → GID`. Error por categoría: log y continuar. Pausa de 200 ms.
5. Descargar productos publicados de Woo. Para cada uno, resolver el id de Shopify con
   el índice `shopifyExisting` (SKU, luego título normalizado). Construir la lista de
   GIDs de sus categorías. Enviar `metafieldsSet` en lotes de 25 metacampos.
6. Log final: creadas/actualizadas, avisos, productos asignados, productos sin match.

## Helper GraphQL

`shopifyGraphQL(cfg, query, variables, signal)`: POST a `graphql.json` vía
`proxiedFetch`. Lanza error si hay `errors` de nivel superior; si el código es
`THROTTLED`, espera y reintenta. Devuelve `data`. Los `userErrors` de cada mutación
los comprueba el llamador.

## UI y configuración

- Checkbox `chk_collections` "Categorías → Colecciones" pasa a `chk_cattree`
  "Categorías → Metaobjetos (árbol)", activo por defecto. `cfg.syncCategoryTree`.
- Se elimina `syncCategories` (colecciones y collects).
- "Categorías / tags" (product_type y tags) no cambia.

## Scopes

Añadir en `server.js` y `shopify.app.toml`:
`read_metaobjects,write_metaobjects,read_metaobject_definitions,write_metaobject_definitions`.
El usuario debe volver a autorizar la app una vez.

## Tests

`tests/category-tree.test.mjs` extrae el bloque `CATTREE-PURE` del HTML igual que el
test existente y cubre: orden padres→hijos, cálculo de rutas, exclusión de
"Sin categorizar", padre inexistente → raíz con aviso, ciclo → raíz con aviso.

## Fuera de alcance

Categoría principal, taxonomía estándar de Shopify, borrado de metaobjetos que ya no
existan en Woo, migración de colecciones ya creadas.
