#!/usr/bin/env bash
# Inspección de SOLO LECTURA de la instalación WooCommerce en el hosting (Strato).
# Ejecutar desde tu terminal:  WOO_SSH_USER=... WOO_SSH_HOST=... bash scripts/inspect-woo.sh > woo-inspeccion.txt
# Pedirá la contraseña SFTP/SSH del hosting (la del fichero ftp.rtf). No se guarda en ningún sitio.
# Solo lanza consultas SELECT/SHOW contra la base de datos de WordPress. No modifica nada.
set -euo pipefail

SSH_USER="${WOO_SSH_USER:?Define WOO_SSH_USER (usuario SSH del hosting)}"
SSH_HOST="${WOO_SSH_HOST:?Define WOO_SSH_HOST (host SSH del hosting)}"

ssh -o StrictHostKeyChecking=accept-new "${SSH_USER}@${SSH_HOST}" 'bash -s' <<'REMOTE'
set -uo pipefail
echo "### HOST"; hostname; pwd; echo

# Localizar wp-config.php (máximo 4 niveles)
CFG=$(find . -maxdepth 4 -name wp-config.php 2>/dev/null | head -1)
if [ -z "$CFG" ]; then echo "No se encontró wp-config.php. Contenido de la carpeta inicial:"; ls -la; exit 1; fi
WPROOT=$(dirname "$CFG")
echo "### WP ROOT: $WPROOT"

val() { grep -E "define\(\s*['\"]$1['\"]" "$CFG" | head -1 | sed -E "s/.*define\(\s*['\"]$1['\"]\s*,\s*['\"]([^'\"]*)['\"].*/\1/"; }
DB_NAME=$(val DB_NAME); DB_USER=$(val DB_USER); DB_PASS=$(val DB_PASSWORD); DB_HOST=$(val DB_HOST)
PFX=$(grep -E '^\s*\$table_prefix' "$CFG" | sed -E "s/.*=\s*['\"]([^'\"]+)['\"].*/\1/")
PFX=${PFX:-wp_}
echo "### DB: $DB_NAME @ $DB_HOST  prefijo: $PFX"
echo

if ! command -v mysql >/dev/null 2>&1; then echo "No hay cliente mysql en el hosting. Alternativa: usar la REST API de WooCommerce."; exit 1; fi

Q() { # Q "titulo" "sql" [max_lineas]
  echo "### $1"
  MYSQL_PWD="$DB_PASS" mysql -h "$DB_HOST" -u "$DB_USER" "$DB_NAME" --default-character-set=utf8mb4 -t -e "$2" 2>&1 | head -${3:-60}
  echo
}

Q "Versiones y URL" "SELECT option_name, LEFT(option_value,80) valor FROM ${PFX}options WHERE option_name IN ('siteurl','woocommerce_version','woocommerce_currency','woocommerce_weight_unit','woocommerce_dimension_unit','woocommerce_prices_include_tax','woocommerce_calc_taxes','WPLANG');"
Q "Plugins activos" "SELECT option_value FROM ${PFX}options WHERE option_name='active_plugins';" 5
Q "Tablas (para detectar plugins con datos propios)" "SHOW TABLES;" 120

Q "Productos por tipo" "SELECT t.name tipo, p.post_status estado, COUNT(*) n FROM ${PFX}posts p JOIN ${PFX}term_relationships tr ON tr.object_id=p.ID JOIN ${PFX}term_taxonomy tt ON tt.term_taxonomy_id=tr.term_taxonomy_id AND tt.taxonomy='product_type' JOIN ${PFX}terms t ON t.term_id=tt.term_id WHERE p.post_type='product' GROUP BY t.name, p.post_status ORDER BY n DESC;"
Q "Variaciones" "SELECT post_status, COUNT(*) n FROM ${PFX}posts WHERE post_type='product_variation' GROUP BY post_status;"
Q "Variaciones por producto variable (max/media)" "SELECT MAX(n) maximo, ROUND(AVG(n),1) media FROM (SELECT post_parent, COUNT(*) n FROM ${PFX}posts WHERE post_type='product_variation' AND post_status='publish' GROUP BY post_parent) x;"

Q "Taxonomías usadas en productos" "SELECT tt.taxonomy, COUNT(DISTINCT tr.object_id) productos, COUNT(DISTINCT tt.term_id) terminos FROM ${PFX}term_relationships tr JOIN ${PFX}term_taxonomy tt ON tt.term_taxonomy_id=tr.term_taxonomy_id JOIN ${PFX}posts p ON p.ID=tr.object_id AND p.post_type='product' GROUP BY tt.taxonomy ORDER BY productos DESC;"
Q "Atributos globales (pa_*)" "SELECT attribute_name, attribute_label, attribute_type, attribute_orderby FROM ${PFX}woocommerce_attribute_taxonomies;"
Q "Atributos usados para variaciones (meta attribute_* en variaciones)" "SELECT meta_key, COUNT(DISTINCT post_id) variaciones, COUNT(DISTINCT meta_value) valores FROM ${PFX}postmeta pm JOIN ${PFX}posts p ON p.ID=pm.post_id WHERE p.post_type='product_variation' AND meta_key LIKE 'attribute_%' GROUP BY meta_key ORDER BY variaciones DESC;"
Q "Categorías: total y raíces" "SELECT COUNT(*) total, SUM(parent=0) raices FROM ${PFX}term_taxonomy WHERE taxonomy='product_cat';"
Q "Árbol de categorías (id, nombre, slug, padre, nº productos)" "SELECT t.term_id id, t.name, t.slug, tt.parent, tt.count FROM ${PFX}terms t JOIN ${PFX}term_taxonomy tt ON tt.term_id=t.term_id WHERE tt.taxonomy='product_cat' ORDER BY tt.parent, t.name;" 200
Q "Marcas (si existe taxonomía de marca)" "SELECT tt.taxonomy, t.name, tt.count FROM ${PFX}terms t JOIN ${PFX}term_taxonomy tt ON tt.term_id=t.term_id WHERE tt.taxonomy IN ('product_brand','pwb-brand','yith_product_brand','pa_marca','pa_brand') ORDER BY tt.count DESC;" 40

Q "Meta keys de PRODUCTOS (frecuencia)" "SELECT meta_key, COUNT(DISTINCT post_id) productos, SUM(meta_value<>'' AND meta_value IS NOT NULL) con_valor FROM ${PFX}postmeta pm JOIN ${PFX}posts p ON p.ID=pm.post_id WHERE p.post_type='product' AND p.post_status='publish' GROUP BY meta_key ORDER BY productos DESC;" 150
Q "Meta keys de VARIACIONES (frecuencia)" "SELECT meta_key, COUNT(DISTINCT post_id) variaciones, SUM(meta_value<>'' AND meta_value IS NOT NULL) con_valor FROM ${PFX}postmeta pm JOIN ${PFX}posts p ON p.ID=pm.post_id WHERE p.post_type='product_variation' AND p.post_status='publish' GROUP BY meta_key ORDER BY variaciones DESC;" 80

Q "Campos ACF definidos (si hay ACF)" "SELECT g.post_title grupo, f.post_excerpt clave, f.post_title etiqueta, LEFT(f.post_content,60) config FROM ${PFX}posts f JOIN ${PFX}posts g ON g.ID=f.post_parent WHERE f.post_type='acf-field' ORDER BY g.post_title, f.menu_order;" 80

Q "Ejemplo: un producto VARIABLE con todo su meta" "SELECT p.ID, p.post_title, pm.meta_key, LEFT(pm.meta_value,120) valor FROM ${PFX}posts p JOIN ${PFX}postmeta pm ON pm.post_id=p.ID WHERE p.ID=(SELECT p2.ID FROM ${PFX}posts p2 JOIN ${PFX}term_relationships tr ON tr.object_id=p2.ID JOIN ${PFX}term_taxonomy tt ON tt.term_taxonomy_id=tr.term_taxonomy_id JOIN ${PFX}terms t ON t.term_id=tt.term_id WHERE t.slug='variable' AND tt.taxonomy='product_type' AND p2.post_status='publish' ORDER BY p2.ID DESC LIMIT 1) ORDER BY pm.meta_key;" 80
Q "Ejemplo: variaciones de ese producto" "SELECT v.ID, v.post_title, pm.meta_key, LEFT(pm.meta_value,60) valor FROM ${PFX}posts v JOIN ${PFX}postmeta pm ON pm.post_id=v.ID WHERE v.post_type='product_variation' AND v.post_parent=(SELECT p2.ID FROM ${PFX}posts p2 JOIN ${PFX}term_relationships tr ON tr.object_id=p2.ID JOIN ${PFX}term_taxonomy tt ON tt.term_taxonomy_id=tr.term_taxonomy_id JOIN ${PFX}terms t ON t.term_id=tt.term_id WHERE t.slug='variable' AND tt.taxonomy='product_type' AND p2.post_status='publish' ORDER BY p2.ID DESC LIMIT 1) AND (pm.meta_key IN ('_sku','_price','_regular_price','_sale_price','_stock','_stock_status','_manage_stock','_weight','_thumbnail_id','_variation_description') OR pm.meta_key LIKE 'attribute_%') ORDER BY v.ID, pm.meta_key;" 120

Q "Imágenes: productos con galería, variaciones con imagen propia" "SELECT (SELECT COUNT(*) FROM ${PFX}postmeta pm JOIN ${PFX}posts p ON p.ID=pm.post_id WHERE p.post_type='product' AND meta_key='_product_image_gallery' AND meta_value<>'') productos_con_galeria, (SELECT COUNT(*) FROM ${PFX}postmeta pm JOIN ${PFX}posts p ON p.ID=pm.post_id WHERE p.post_type='product_variation' AND meta_key='_thumbnail_id' AND meta_value<>'' AND meta_value<>'0') variaciones_con_imagen;"
Q "Peso y dimensiones informados" "SELECT SUM(meta_key='_weight' AND meta_value<>'') con_peso, SUM(meta_key='_length' AND meta_value<>'') con_largo, SUM(meta_key='_width' AND meta_value<>'') con_ancho, SUM(meta_key='_height' AND meta_value<>'') con_alto FROM ${PFX}postmeta pm JOIN ${PFX}posts p ON p.ID=pm.post_id WHERE p.post_type IN ('product','product_variation');"
Q "Productos con precio rebajado / oferta programada" "SELECT SUM(meta_key='_sale_price' AND meta_value<>'') en_oferta, SUM(meta_key='_date_on_sale_from' AND meta_value<>'') oferta_programada FROM ${PFX}postmeta pm JOIN ${PFX}posts p ON p.ID=pm.post_id WHERE p.post_type IN ('product','product_variation');"
Q "Clases de envío" "SELECT tt.taxonomy, t.name, tt.count FROM ${PFX}terms t JOIN ${PFX}term_taxonomy tt ON tt.term_id=t.term_id WHERE tt.taxonomy='product_shipping_class';"
Q "Clases de impuesto" "SELECT meta_value clase_impuesto, COUNT(*) n FROM ${PFX}postmeta WHERE meta_key='_tax_class' GROUP BY meta_value;"
Q "Productos agrupados / venta cruzada / upsell" "SELECT SUM(meta_key='_children' AND meta_value<>'a:0:{}' AND meta_value<>'') agrupados_con_hijos, SUM(meta_key='_crosssell_ids' AND meta_value<>'a:0:{}' AND meta_value<>'') con_crosssell, SUM(meta_key='_upsell_ids' AND meta_value<>'a:0:{}' AND meta_value<>'') con_upsell FROM ${PFX}postmeta pm JOIN ${PFX}posts p ON p.ID=pm.post_id WHERE p.post_type='product';"
Q "Valoraciones (reviews)" "SELECT comment_approved, COUNT(*) n FROM ${PFX}comments WHERE comment_type='review' GROUP BY comment_approved;"
Q "Pedidos por estado (posts)" "SELECT post_status, COUNT(*) n FROM ${PFX}posts WHERE post_type='shop_order' GROUP BY post_status ORDER BY n DESC;"
Q "Pedidos HPOS (si la tabla existe)" "SELECT status, COUNT(*) n FROM ${PFX}wc_orders GROUP BY status ORDER BY n DESC;"
Q "Clientes registrados" "SELECT COUNT(*) clientes FROM ${PFX}usermeta WHERE meta_key='${PFX}capabilities' AND meta_value LIKE '%customer%';"
Q "Cupones" "SELECT post_status, COUNT(*) n FROM ${PFX}posts WHERE post_type='shop_coupon' GROUP BY post_status;"
Q "SEO: Yoast / RankMath presentes en meta de producto" "SELECT meta_key, COUNT(*) n FROM ${PFX}postmeta pm JOIN ${PFX}posts p ON p.ID=pm.post_id WHERE p.post_type='product' AND (meta_key LIKE '_yoast%' OR meta_key LIKE 'rank_math%') GROUP BY meta_key ORDER BY n DESC;" 30
echo "### FIN"
REMOTE
