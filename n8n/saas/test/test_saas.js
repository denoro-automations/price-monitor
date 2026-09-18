const assert = require('assert');
const { runCode, fakeHttp } = require('./harness');

const FAST = { 'const POLITE_DELAY = 1200;': 'const POLITE_DELAY = 0;', 'const RETRY_WAIT = 1500;': 'const RETRY_WAIT = 1;',
  "'__ADMIN_KEY__'": "'clave-admin'", "'__PANEL_URL__'": "'http://localhost:5678/webhook/denoro/panel'", "'__EMAIL_FROM__'": "'avisos@denoro.test'" };

// ---------------- fixtures ----------------
const shopProducts = (n, price = '24.90') => ({ products: Array.from({ length: n }, (_, i) => ({
  id: i + 1, title: `Camiseta ${i + 1}`, handle: `camiseta-${i + 1}`, images: [{ src: 'https://cdn.test/img.jpg' }],
  variants: [{ price, compare_at_price: i === 0 ? '29.90' : null, available: i !== 1 }] })) });
const shopProductJs = (price = 2490, available = true) => ({ handle: 'zapatilla-runner', title: 'Zapatilla Runner', price, available,
  featured_image: '//cdn.test/z.jpg', variants: [{ price, compare_at_price: 2990, available }, { price: price + 500, available: false }] });
const wooItems = [
  { id: 10, name: 'Taza &amp; plato', sku: 'TAZ-01', permalink: 'https://woo.test/producto/taza', is_in_stock: true, images: [{ src: 'https://woo.test/t.jpg' }],
    prices: { price: '990', regular_price: '1290', currency_code: 'EUR', currency_minor_unit: 2 } },
  { id: 11, name: 'Gorra', sku: '', permalink: 'https://woo.test/producto/gorra', is_in_stock: false,
    prices: { price: '1450', regular_price: '1450', currency_code: 'EUR', currency_minor_unit: 2 } }];
const ldPage = (price = '149.00', avail = 'https://schema.org/InStock') => `<html><head><title>Cafetera X</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
{"@type":"Product","name":"Cafetera Express X &amp; Co","sku":"CAF-X","image":["https://pc.test/c.jpg"],
"offers":{"@type":"Offer","price":"${price}","priceCurrency":"EUR","availability":"${avail}"}}]}</script></head><body></body></html>`;
const aggPage = `<script type="application/ld+json">[{"@type":["Product"],"name":"Portátil","offers":{"@type":"AggregateOffer","lowPrice":"899,00","highPrice":"999","priceCurrency":"EUR","offers":[{"@type":"Offer","price":"949","availability":"OutOfStock"}]}}]</script>`;
const metaPage = `<html><head><meta property="og:title" content="Silla ergonómica"><meta property="product:price:amount" content="1.299,00">
<meta property="product:price:currency" content="EUR"><meta property="product:availability" content="out of stock"></head></html>`;

(async () => {
  // ================= detección =================
  const http = fakeHttp({
    'shop.test/robots.txt': { body: 'User-agent: *\nDisallow: /checkout\nDisallow: /*?q=' },
    'shop.test/es/products/zapatilla-runner.js': { body: shopProductJs() },
    'shop.test/products/zapatilla-runner.js': { body: shopProductJs() },
    'shop.test/es/products.json': { body: shopProducts(4) },
    'shop.test/cart.js': { body: { currency: 'EUR' } },
    'shop.test/collections/verano/products.json': { body: shopProducts(3) },
    'shop.test/products.json': { body: shopProducts(250) },
    'woo.test/wp-json/wc/store/v1/products?per_page': { body: wooItems, headers: { 'x-wp-total': '87' } },
    'woo.test/wp-json/wc/store/v1/products?slug=taza': { body: [wooItems[0]] },
    'woo.test/producto/taza': { body: '<html>sin datos</html>' },
    'pc.test/cafetera': { body: ldPage() },
    'pc.test/portatil': { body: aggPage },
    'pc.test/silla': { body: metaPage },
    'pc.test/categoria': { body: '<html><title>Categoría</title></html>' },
    'pc.test/caido': { status: 503, body: 'down' },
    'pc.test/bloqueado': { status: 403, body: 'no bots' },
    'pc.test/bucle': new Error('Maximum number of redirects exceeded'),
    'loop.test/': new Error('Maximum number of redirects exceeded'),
    'pc.test/libro': { body: `<html><h1>Un libro &amp; más</h1><p class="price_color">£51.77</p><p class="instock availability">\n <i class="icon-ok"></i>\n In stock (22 available)</p>
      <div class="related"><span class="old">precio</span></div></html>` },
    'pc.test/dosprecios': { body: '<h1>Pack</h1><span class="price">10,00 €</span><span class="price">12,00 €</span>' },
    'pc.test/micro': { body: '<html><head><meta property="og:title" content="Tienda Online | Lámparas"></head><div itemscope><h1>Lámpara Nórdica</h1><span itemprop="price" content="39.95">39,95 €</span><meta itemprop="priceCurrency" content="EUR"><link itemprop="availability" href="https://schema.org/OutOfStock"></div>' },
    'pc.test/products.json': { status: 404, body: 'no' },
    'pc.test/wp-json': { status: 404, body: 'no' },
    'pc.test/': { body: '<html>home</html>' },
  });
  const detect = async (url, token = 'tok1', extra = {}) => (await runCode('api.js', { http, consts: FAST, nodes: {
    API: [{ json: { body: { token, accion: 'detectar', url, ...extra } } }],
    'Leer clientes': [{ json: { token: 'tok1', nombre: 'Tienda Test', email: 'a@b.test', telegram_chat_id: '', activo: true, config: JSON.stringify({ vigilancias: [{ id: 'w0', url: 'https://pc.test/silla', tipo: 'producto' }] }) } }],
    'Leer estado': [] } }))[0].json;

  let d = await detect('shop.test/products/zapatilla-runner?variant=1');
  assert.strictEqual(d.status, 200);
  assert.strictEqual(d.respuesta.tipo, 'shopify_producto');
  assert.deepStrictEqual([d.respuesta.productos[0].price, d.respuesta.productos[0].regular, d.respuesta.moneda, d.respuesta.productos[0].stock], [24.9, 29.9, 'EUR', true]);

  d = (await detect('https://shop.test/es/products/zapatilla-runner')).respuesta;
  assert.strictEqual(d.productos[0].url, 'https://shop.test/es/products/zapatilla-runner', 'respeta el prefijo de idioma');
  d = (await detect('https://shop.test/es')).respuesta;
  assert.deepStrictEqual([d.tipo, d.total, d.url, d.productos[0].url], ['shopify_tienda', 4, 'https://shop.test/es', 'https://shop.test/es/products/camiseta-1']);
  d = (await detect('https://shop.test/fr')).respuesta;   // la tienda no tiene /fr: cae a la raíz
  assert.deepStrictEqual([d.tipo, d.url], ['shopify_tienda', 'https://shop.test']);
  d = (await detect('https://www.shop.test/')).respuesta;
  assert.strictEqual(d.tipo, 'shopify_tienda');
  assert.strictEqual(d.total, '250+');
  assert.strictEqual(d.productos.length, 6);

  d = (await detect('https://shop.test/collections/verano')).respuesta;
  assert.deepStrictEqual([d.tipo, d.total, d.url], ['shopify_tienda', 3, 'https://shop.test/collections/verano']);

  d = (await detect('https://woo.test')).respuesta;
  assert.deepStrictEqual([d.tipo, d.total, d.moneda, d.productos[0].name, d.productos[0].price], ['woo_tienda', 87, 'EUR', 'Taza & plato', 9.9]);

  d = (await detect('https://woo.test/producto/taza/')).respuesta;
  assert.deepStrictEqual([d.tipo, d.slug, d.productos[0].price], ['woo_producto', 'taza', 9.9]);

  d = (await detect('https://pc.test/cafetera-x')).respuesta;
  assert.deepStrictEqual([d.tipo, d.nombre, d.productos[0].price, d.moneda, d.productos[0].stock, d.productos[0].image], ['producto', 'Cafetera Express X & Co', 149, 'EUR', true, 'https://pc.test/c.jpg']);

  d = (await detect('https://pc.test/portatil')).respuesta;
  assert.deepStrictEqual([d.productos[0].price, d.productos[0].stock], [899, false]);

  d = (await detect('https://pc.test/silla-nueva')).respuesta;
  assert.deepStrictEqual([d.productos[0].price, d.productos[0].stock, d.nombre], [1299, false, 'Silla ergonómica']);

  d = await detect('https://pc.test/categoria/sillas');
  assert.strictEqual(d.status, 422);
  assert.match(d.respuesta.error, /No encuentro el precio/);

  d = await detect('https://pc.test/');
  assert.match(d.respuesta.error, /catálogo completo/);

  d = await detect('https://pc.test/caido');
  assert.match(d.respuesta.error, /error 503/);

  d = await detect('https://pc.test/bloqueado');
  assert.match(d.respuesta.error, /bloquea las consultas automáticas/);
  d = await detect('https://pc.test/bucle/x');
  assert.strictEqual(d.status, 422);
  assert.match(d.respuesta.error, /No he podido abrir pc\.test \(Maximum number of redirects exceeded\)/);
  const before = http.calls.length;
  d = await detect('https://loop.test/collections/x');
  assert.match(d.respuesta.error, /No he podido abrir loop\.test/);
  assert.ok(http.calls.length - before <= 2, 'no insiste tras un bucle de redirecciones');
  d = (await detect('https://pc.test/libro/1')).respuesta;
  assert.deepStrictEqual([d.productos[0].price, d.moneda, d.productos[0].stock, d.nombre, d.productos[0].via], [51.77, 'GBP', true, 'Un libro & más', 'aproximado']);
  assert.match(d.aviso, /aproximación/);
  d = await detect('https://pc.test/dosprecios');
  assert.strictEqual(d.status, 422, 'dos precios distintos: no se adivina');
  d = (await detect('https://pc.test/micro')).respuesta;
  assert.deepStrictEqual([d.productos[0].price, d.moneda, d.productos[0].stock, d.nombre], [39.95, 'EUR', false, 'Lámpara Nórdica']);
  d = await detect('https://shop.test/checkout/123');
  assert.match(d.respuesta.error, /robots\.txt/);

  for (const bad of ['', 'no es una url', 'http://localhost:5678/x', 'http://192.168.1.10/', 'ftp://x']) {
    d = await detect(bad);
    assert.strictEqual(d.status, 422, bad);
  }
  d = await detect('https://pc.test/silla');
  assert.strictEqual(d.status, 409, 'enlace repetido');
  d = await detect('https://pc.test/cafetera', 'token-malo');
  assert.strictEqual(d.status, 401);

  // ================= API: guardar, editar, borrar, ajustes =================
  const cliente = { token: 'tok1', nombre: 'Tienda Test', email: 'a@b.test', telegram_chat_id: '', activo: true, config: JSON.stringify({ max_vigilancias: 2, vigilancias: [] }) };
  const call = async (body, rows = [cliente], estados = []) => (await runCode('api.js', { http, consts: FAST, nodes: {
    API: [{ json: { body } }], 'Leer clientes': rows.map((json) => ({ json: structuredClone(json) })), 'Leer estado': estados.map((json) => ({ json })) } }))[0].json;

  let r = await call({ token: 'tok1', accion: 'guardar_vigilancia', url: 'pc.test/cafetera', mi_precio: '155,50', tolerancia_pct: 2, nombre: '<b>Cafetera rival</b>' });
  assert.strictEqual(r.siguiente, 'guardar');
  let cfg = JSON.parse(r.fila.config);
  assert.strictEqual(cfg.vigilancias.length, 1);
  assert.deepStrictEqual([cfg.vigilancias[0].mi_precio, cfg.vigilancias[0].tolerancia_pct, cfg.vigilancias[0].nombre], [155.5, 2, 'bCafetera rival/b']);
  assert.deepStrictEqual(Object.keys(r.fila).sort(), ['activo', 'config', 'email', 'nombre', 'telegram_chat_id', 'token']);

  const c2 = { ...cliente, config: r.fila.config };
  r = await call({ token: 'tok1', accion: 'guardar_vigilancia', url: 'https://shop.test/' }, [c2]);
  cfg = JSON.parse(r.fila.config);
  assert.strictEqual(cfg.vigilancias[1].mi_precio, null, 'las tiendas no llevan "tu precio"');
  const c3 = { ...cliente, config: r.fila.config };
  r = await call({ token: 'tok1', accion: 'guardar_vigilancia', url: 'https://woo.test' }, [c3]);
  assert.strictEqual(r.status, 403, 'límite del plan');

  const wid = cfg.vigilancias[0].id;
  r = await call({ token: 'tok1', accion: 'editar_vigilancia', id: wid, mi_precio: '' }, [c3]);
  assert.strictEqual(JSON.parse(r.fila.config).vigilancias[0].mi_precio, null);
  r = await call({ token: 'tok1', accion: 'borrar_vigilancia', id: wid }, [c3]);
  assert.strictEqual(JSON.parse(r.fila.config).vigilancias.length, 1);
  r = await call({ token: 'tok1', accion: 'borrar_vigilancia', id: 'nope' }, [c3]);
  assert.strictEqual(r.status, 404);

  r = await call({ token: 'tok1', accion: 'ajustes', email: '', telegram_chat_id: '' });
  assert.strictEqual(r.status, 400);
  r = await call({ token: 'tok1', accion: 'ajustes', email: 'mal', telegram_chat_id: '' });
  assert.match(r.respuesta.error, /email/);
  r = await call({ token: 'tok1', accion: 'ajustes', email: '', telegram_chat_id: '6137698577', frecuencia_horas: 3, umbral_pct: 5, avisar_nuevos: false });
  assert.deepStrictEqual([r.fila.email, r.fila.telegram_chat_id, JSON.parse(r.fila.config).frecuencia_horas, JSON.parse(r.fila.config).umbral_pct, JSON.parse(r.fila.config).avisar_nuevos], ['', '6137698577', 3, 5, false]);

  r = await call({ token: 'tok1', accion: 'estado' }, [c3], [{ clave: 'tok1:__cliente', token: 'tok1', resumen: JSON.stringify({ ultima: '2026-09-17T10:00:00Z', cambios: 2 }) },
    { clave: `tok1:${wid}`, token: 'tok1', resumen: JSON.stringify({ productos: 1, precio: 149 }) }, { clave: 'otro:x', token: 'otro', resumen: '{}' }]);
  assert.deepStrictEqual([r.respuesta.ok, r.respuesta.vigilancias.length, r.respuesta.vigilancias[0].estado.precio, r.respuesta.resumen.cambios], [true, 2, 149, 2]);
  assert.ok(!('token' in r.respuesta.cliente), 'no se expone el token');

  r = await call({ token: 'tok1', accion: 'probar_aviso' });
  assert.deepStrictEqual([r.siguiente, r.enviar_email, r.enviar_telegram, r.email_from], ['probar', true, false, 'avisos@denoro.test']);
  assert.ok(r.email_html.includes('Aviso de prueba'));

  r = await call({ token: 'tok1', accion: 'revisar_ahora' }, [c3]);
  assert.strictEqual(r.siguiente, 'revisar');
  r = await call({ token: 'tok1', accion: 'revisar_ahora' }, [c3], [{ clave: 'tok1:__cliente', token: 'tok1', resumen: JSON.stringify({ ultima: new Date().toISOString() }) }]);
  assert.strictEqual(r.status, 429);
  r = await call({ token: 'tok1', accion: 'estado' }, [{ ...cliente, activo: false }]);
  assert.strictEqual(r.status, 403);
  const boom = async () => { throw new Error('fallo raro'); };
  r = (await runCode('api.js', { http: boom, consts: FAST, nodes: { API: [{ json: { body: { token: 'tok1', accion: 'estado' } } }],
    'Leer clientes': [{ json: { ...cliente, config: '{roto' } }], 'Leer estado': [] } }))[0].json;
  assert.strictEqual(r.respuesta.ok, true, 'config corrupta no rompe el panel');
  r = await call({ admin_key: 'clave-admin', accion: 'admin_actualizar', token: 'tok1', nombre: 'Nuevo nombre' });
  assert.strictEqual(r.fila.nombre, 'Nuevo nombre');
  r = await call({ token: 'tok1', accion: 'hackear' });
  assert.strictEqual(r.status, 400);

  // ================= API admin =================
  r = await call({ admin_key: 'mala', accion: 'admin_listar' });
  assert.strictEqual(r.status, 401);
  r = await call({ accion: 'admin_listar' });
  assert.strictEqual(r.status, 401, 'sin clave');
  r = await call({ admin_key: 'clave-admin', accion: 'admin_crear', nombre: 'Moda Sol', email: 'sol@moda.test', max_vigilancias: 30, frecuencia_horas: 12 });
  assert.strictEqual(r.siguiente, 'guardar');
  assert.match(r.fila.token, /^[0-9a-f]{32}$/);
  assert.strictEqual(r.respuesta.panel, `http://localhost:5678/webhook/denoro/panel?t=${r.fila.token}`);
  assert.deepStrictEqual([JSON.parse(r.fila.config).max_vigilancias, JSON.parse(r.fila.config).frecuencia_horas, r.fila.activo], [30, 12, true]);
  r = await call({ admin_key: 'clave-admin', accion: 'admin_crear', nombre: 'tienda test' });
  assert.strictEqual(r.status, 409);
  r = await call({ admin_key: 'clave-admin', accion: 'admin_listar' }, [c3]);
  assert.deepStrictEqual([r.respuesta.clientes.length, r.respuesta.clientes[0].vigilancias], [1, 2]);
  r = await call({ admin_key: 'clave-admin', accion: 'admin_actualizar', token: 'tok1', activo: false, max_vigilancias: 5 });
  assert.deepStrictEqual([r.fila.activo, JSON.parse(r.fila.config).max_vigilancias], [false, 5]);

  // ================= revisión de un cliente =================
  let price = '149.00', stock = 'https://schema.org/InStock', zap = 2490, shopN = 3;
  const http2 = fakeHttp({
    'pc.test/robots.txt': { status: 404, body: '' },
    'pc.test/cafetera': () => ({ body: ldPage(price, stock) }),
    'shop.test/robots.txt': { body: '' },
    'shop.test/cart.js': { body: { currency: 'EUR' } },
    'shop.test/products/zapatilla-runner.js': () => ({ body: shopProductJs(zap) }),
    'shop.test/products.json': () => ({ body: shopProducts(shopN) }),
    'roto.test/': new Error('ECONNREFUSED'),
  });
  const watches = [
    { id: 'a', url: 'https://pc.test/cafetera', tipo: 'producto', nombre: 'Cafetera rival', moneda: 'EUR', mi_precio: 140 },
    { id: 'b', url: 'https://shop.test/products/zapatilla-runner', tipo: 'shopify_producto', nombre: 'Zapatilla', moneda: 'EUR', mi_precio: 30, tolerancia_pct: 5 },
    { id: 'c', url: 'https://shop.test', tipo: 'shopify_tienda', nombre: 'Tienda Shop', moneda: 'EUR' },
    { id: 'd', url: 'https://roto.test/p/1', tipo: 'producto', nombre: 'Web rota' },
  ];
  const cli = { token: 'tokR', nombre: 'Moda Sol', email: 'sol@moda.test', telegram_chat_id: '6137698577', activo: true, config: JSON.stringify({ vigilancias: watches, umbral_pct: 1 }) };
  let db = {};
  const revisar = async () => {
    const items = await runCode('revisar.js', { http: http2, consts: FAST, nodes: {
      'Al revisar un cliente': [{ json: { token: 'tokR' } }], 'Leer cliente': [{ json: cli }],
      'Leer estado': Object.values(db).map((json) => ({ json })) } });
    const estados = items.filter((i) => i.json.tipo === 'estado');
    const filas = await runCode('fila-estado.js', { input: estados });
    for (const f of filas) db[f.json.clave] = f.json;
    return { aviso: items.find((i) => i.json.tipo === 'aviso'), filas };
  };

  // 1ª revisión: referencia + bienvenida (la cafetera 149 > 140: sin aviso; zapatilla 24,90 < 30*0,95 → te ganan)
  let rv = await revisar();
  assert.strictEqual(rv.filas.length, 5);
  assert.deepStrictEqual(Object.keys(rv.filas[0].json).sort(), ['clave', 'resumen', 'snapshot', 'token']);
  assert.ok(rv.aviso, 'hay aviso');
  assert.deepStrictEqual(rv.aviso.json.telegram.match(/Te están ganando/) !== null, true);
  assert.ok(rv.aviso.json.telegram.includes('Zapatilla Runner · Zapatilla: 24,90 € vs tu 30,00 €'));
  assert.strictEqual(JSON.parse(db['tokR:d'].resumen).fallos, 1);
  assert.ok(!rv.aviso.json.telegram.includes('Web rota'), 'un solo fallo no avisa');
  assert.strictEqual(JSON.parse(db['tokR:c'].resumen).productos, 3);
  assert.strictEqual(rv.aviso.binary.csv.mimeType, 'text/csv');

  // 2ª revisión sin cambios: nada que avisar salvo el 2º fallo seguido de la web rota
  rv = await revisar();
  assert.ok(rv.aviso);
  assert.ok(rv.aviso.json.telegram.includes('No he podido revisar'));
  assert.ok(rv.aviso.json.telegram.includes('Web rota'));
  assert.ok(!rv.aviso.json.telegram.includes('Te están ganando'), 'no repite el aviso de precio');
  assert.strictEqual(rv.aviso.json.asunto, '⚠️ Denoro · No he podido revisar 1 enlace');

  // 3ª: bajadas, agotado, producto nuevo y retirado en la tienda
  price = '129.00'; stock = 'https://schema.org/OutOfStock'; zap = 2690; shopN = 2;
  rv = await revisar();
  const tg = rv.aviso.json.telegram;
  assert.ok(tg.includes('Cafetera Express X &amp; Co · Cafetera rival: 149,00 € → 129,00 € (-13,4 %)'), tg);
  assert.ok(tg.includes('Te están ganando'));                 // ahora 129 < 140
  assert.ok(tg.includes('Se han quedado sin stock'));
  assert.ok(tg.includes('📈'), 'subida de la zapatilla');
  assert.ok(tg.includes('Productos retirados'));
  assert.ok(!tg.includes('No he podido revisar'), 'el 3er fallo ya no se repite');
  assert.strictEqual(JSON.parse(db['tokR:d'].resumen).fallos, 3);
  const html = rv.aviso.json.email_html;
  assert.ok(html.includes('Moda Sol') && html.includes('129,00 €'));
  assert.deepStrictEqual([rv.aviso.json.enviar_email, rv.aviso.json.enviar_telegram, rv.aviso.json.email_from], [true, true, 'avisos@denoro.test']);
  const hist = JSON.parse(db['tokR:__cliente'].resumen).historial;
  assert.strictEqual(hist.length, 3);
  assert.strictEqual(JSON.parse(db['tokR:__cliente'].resumen).con_error, 1);

  // 4ª: tienda devuelve muy pocos productos (lectura parcial) → sin "retirados" falsos
  shopN = 250; await revisar(); shopN = 10;
  rv = await revisar();
  assert.ok(!rv.aviso || !rv.aviso.json.telegram.includes('Productos retirados'));
  assert.strictEqual(JSON.parse(db['tokR:c'].resumen).error, 'lectura parcial');

  // cliente inexistente
  const none = await runCode('revisar.js', { http: http2, consts: FAST, nodes: { 'Al revisar un cliente': [{ json: { token: 'x' } }], 'Leer cliente': [], 'Leer estado': [] } });
  assert.strictEqual(none[0].json.tipo, 'fin');

  // ================= planificador =================
  const now = Date.now();
  const sched = await runCode('scheduler.js', { nodes: {
    'Leer clientes': [
      { json: { token: 't1', activo: true, email: 'a@b.test', config: JSON.stringify({ vigilancias: [{}], frecuencia_horas: 6 }) } },
      { json: { token: 't2', activo: true, email: 'a@b.test', config: JSON.stringify({ vigilancias: [{}], frecuencia_horas: 6 }) } },
      { json: { token: 't3', activo: false, email: 'a@b.test', config: JSON.stringify({ vigilancias: [{}] }) } },
      { json: { token: 't4', activo: true, email: 'a@b.test', config: JSON.stringify({ vigilancias: [] }) } },
      { json: { token: 't5', activo: true, email: '', telegram_chat_id: '', config: JSON.stringify({ vigilancias: [{}] }) } },
      { json: { token: 't6', activo: true, telegram_chat_id: '1', config: JSON.stringify({ vigilancias: [{}], frecuencia_horas: 1 }) } },
    ],
    'Leer resúmenes': [
      { json: { clave: 't1:__cliente', token: 't1', resumen: JSON.stringify({ ultima: new Date(now - 2 * 3600000).toISOString() }) } },
      { json: { clave: 't2:__cliente', token: 't2', resumen: JSON.stringify({ ultima: new Date(now - 6 * 3600000 + 60000).toISOString() }) } },
      { json: { clave: 't6:__cliente', token: 't6', resumen: JSON.stringify({ ultima: new Date(now - 58 * 60000).toISOString() }) } },
      { json: { clave: 't6:x', token: 't6', resumen: '{}' } },
    ] } });
  assert.deepStrictEqual(sched.map((i) => i.json.token), ['t2', 't6']);

  // ================= resultado de la prueba =================
  const probar = { json: { enviar_telegram: true, enviar_email: true } };
  let pr = await runCode('resultado-prueba.js', { nodes: { 'Procesar petición': [probar], 'Prueba Telegram': [{ json: { ok: true } }], 'Prueba email': [{ json: { accepted: ['x'] } }] } });
  assert.strictEqual(pr[0].json.respuesta.mensaje, 'Prueba enviada por Telegram y email. Revisa que te haya llegado.');
  pr = await runCode('resultado-prueba.js', { nodes: { 'Procesar petición': [probar], 'Prueba Telegram': [{ json: { error: { message: 'Bad Request: chat not found' } } }], 'Prueba email': [{ json: {} }] } });
  assert.strictEqual(pr[0].json.status, 502);
  assert.match(pr[0].json.respuesta.error, /Abre el bot/);

  console.log('SaaS: todos los escenarios OK');
})().catch((e) => { console.error(e); process.exit(1); });
// (añadido) solicitudes de la web
(async () => {
  const { runCode } = require('./harness');
  const call = (body) => runCode('contacto.js', { nodes: { 'Solicitud de la web': [{ json: { body } }] } });
  const base = { nombre: 'Ana Ruiz', email: 'ana@tienda.test', tienda: 'https://mitienda.test',
                 competidores: 'https://rival1.test\nhttps://rival2.test/producto/x', productos: '200-1000', paquete: 'estandar', mensaje: 'Vendo ropa <b>infantil</b>', idioma: 'es' };
  let r = (await call(base))[0].json;
  assert.strictEqual(r.enviar, true);
  assert.ok(r.telegram.includes('Ana Ruiz') && r.telegram.includes('rival2.test'));
  assert.ok(r.email_html.includes('&lt;b&gt;infantil&lt;/b&gt;'), 'escapa el HTML del mensaje');
  assert.strictEqual(r.asunto, '💰 Presupuesto · Ana Ruiz (https://mitienda.test)');
  r = (await call({ ...base, email: 'mal' }))[0].json;
  assert.deepStrictEqual([r.status, r.enviar], [400, false]);
  r = (await call({ ...base, competidores: '   ' }))[0].json;
  assert.strictEqual(r.status, 400);
  r = (await call({ ...base, empresa_web: 'spam' }))[0].json;
  assert.deepStrictEqual([r.status, r.enviar], [200, undefined], 'los bots reciben 200 y no se envía nada');
  r = (await call(JSON.stringify(base)))[0].json;                      // body como texto (Content-Type text/plain)
  assert.strictEqual(r.enviar, true);
  console.log('Solicitudes de la web: OK');
})().catch((e) => { console.error(e); process.exit(1); });
