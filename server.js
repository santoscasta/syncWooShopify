const express = require('express');
const { request: httpsRequest, Agent: HttpsAgent } = require('https');
const { URL } = require('url');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// ─── Almacén temporal del access token obtenido por OAuth ────────────────────
let shopifyAccessToken = null;

// ─── Shopify OAuth: Paso 1 — Redirigir al usuario a Shopify ─────────────────
app.get('/auth/shopify', (req, res) => {
  const { shop, client_id } = req.query;
  if (!shop || !client_id) return res.status(400).send('Faltan shop o client_id');

  const redirectUri = `http://localhost:${PORT}/auth/shopify/callback`;
  const scopes = 'read_products,write_products,read_inventory,write_inventory,read_orders,write_orders,read_metaobjects,write_metaobjects,read_metaobject_definitions,write_metaobject_definitions,read_publications,write_publications,read_discounts,write_discounts,read_gift_cards,write_gift_cards,read_customers,write_customers';
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${client_id}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(authUrl);
});

// ─── Shopify OAuth: Paso 2 — Intercambiar code por access_token ─────────────
app.get('/auth/shopify/callback', (req, res) => {
  const { code, shop } = req.query;
  if (!code || !shop) return res.status(400).send('Faltan code o shop en el callback');

  // Leer client_id y client_secret de query params guardados o del .env
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).send('SHOPIFY_CLIENT_ID y SHOPIFY_CLIENT_SECRET deben estar definidos como variables de entorno');
  }

  const postData = JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
  });

  const options = {
    hostname: shop,
    path: '/admin/oauth/access_token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  const tokenReq = httpsRequest(options, (tokenRes) => {
    let body = '';
    tokenRes.on('data', (chunk) => body += chunk);
    tokenRes.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.access_token) {
          shopifyAccessToken = data.access_token;
          // Nunca el token: solo la tienda y los permisos concedidos, para ver si falta alguno.
          console.log(`Shopify autorizado para ${shop} · permisos: ${data.scope || '(sin dato)'}`);
          // Redirigir de vuelta a la app con el token
          res.send(`
            <html><body>
              <script>
                window.opener?.postMessage({ type: 'shopify-token', token: '${data.access_token}' }, '*');
                document.body.innerHTML = '<h2>Autenticado correctamente. Puedes cerrar esta ventana.</h2>';
                setTimeout(() => window.close(), 1500);
              </script>
            </body></html>
          `);
        } else {
          res.status(400).send(`Error de Shopify: ${body}`);
        }
      } catch (e) {
        res.status(500).send(`Error parseando respuesta: ${e.message} — ${body}`);
      }
    });
  });

  tokenReq.on('error', (e) => res.status(502).send(`Error de red: ${e.message}`));
  tokenReq.write(postData);
  tokenReq.end();
});

// ─── Endpoint para que el frontend consulte el token ────────────────────────
app.get('/auth/shopify/token', (req, res) => {
  res.json({ token: shopifyAccessToken });
});

// ─── Proxy genérico que reenvía requests evitando CORS ──────────────────────
// Reutiliza conexiones TLS en vez de abrir una por petición: el hosting de Woo corta
// (ECONNRESET) ráfagas de conexiones nuevas. Los sockets libres se cierran a los 3 s, antes
// que el keep-alive típico del servidor (5 s en Apache), para no escribir en uno ya cerrado.
const PROXY_SOCKET_IDLE_MS = 3000;
const PROXY_MAX_SOCKETS_PER_HOST = 4;
const proxyAgent = new HttpsAgent({
  keepAlive: true,
  maxSockets: PROXY_MAX_SOCKETS_PER_HOST,
  timeout: PROXY_SOCKET_IDLE_MS,
});

app.all('/proxy', (req, res) => {
  const targetUrl = req.query.url || req.headers['x-target-url'];
  if (!targetUrl) return res.status(400).json({ error: 'Falta x-target-url o ?url=' });

  let parsed;
  try { parsed = new URL(targetUrl); }
  catch { return res.status(400).json({ error: 'URL inválida' }); }

  // Reenviar solo headers seguros
  const fwdHeaders = {};
  for (const key of ['authorization', 'x-shopify-access-token', 'content-type']) {
    if (req.headers[key]) fwdHeaders[key] = req.headers[key];
  }

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || 443,
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: fwdHeaders,
    agent: proxyAgent,
  };

  const proxyReq = httpsRequest(options, (proxyRes) => {
    const expose = ['x-wp-total', 'x-wp-totalpages', 'link', 'content-type', 'retry-after'];
    for (const h of expose) {
      if (proxyRes.headers[h]) res.setHeader(h, proxyRes.headers[h]);
    }
    res.status(proxyRes.statusCode);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    res.status(502).json({ error: `Proxy error: ${e.message}` });
  });

  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    proxyReq.write(JSON.stringify(req.body));
  }

  proxyReq.end();
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Abre http://localhost:${PORT}/woo-shopify-sync.html`);
});
