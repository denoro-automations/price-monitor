const assert = require('assert');
const { runCode } = require('./harness');
const F = require('./fixtures.json');
// simula la salida del nodo HTML (text y attribute para cada campo)
const asNode = (h) => ({ nombres_attr: h.nombres, nombres_txt: h.nombres.map((n) => n.slice(0, 10)), enlaces_attr: h.enlaces, enlaces_txt: [],
  precios_txt: h.precios, precios_attr: [], stocks_txt: h.stocks, stocks_attr: [] });
F.books_page1.html = asNode(F.books_page1.html); F.books_page2.html = asNode(F.books_page2.html);

const ok = (data) => ({ json: { data, statusCode: 200, headers: {} } });
const notFound = { json: { data: '', statusCode: 404 } };
const empty = { json: {} };

async function scenario(cfgItems, responses, htmls, staticData) {
  const out = await runCode('compare.js', {
    input: htmls, staticData,
    nodes: { 'Configuración': cfgItems, 'Descargar páginas': responses },
  });
  return out[0];
}

(async () => {
  // 1. Configuración: genera las páginas a descargar
  const REAL = [["telegram_chat_id: 'TU_CHAT_ID'", "telegram_chat_id: '123456789'"],
    ["email_to: 'cliente@ejemplo.com'", "email_to: 'dueno@tienda.test'"],
    ["email_from: 'avisos@tu-dominio.com'", "email_from: 'avisos@denoro.test'"]];
  // valores de ejemplo → error claro
  await assert.rejects(runCode('config.js'), /valor de ejemplo/);
  await assert.rejects(runCode('config.js', { replace: [REAL[0], ["email_to: 'cliente@ejemplo.com'", "email_to: ''"]] }), /al menos|email_from|Configura/);
  await assert.rejects(runCode('config.js', { replace: [["telegram_chat_id: 'TU_CHAT_ID'", "telegram_chat_id: 'mi chat'"], ...REAL.slice(1)] }), /debe ser un número/);
  const soloEmail = await runCode('config.js', { replace: [["telegram_chat_id: 'TU_CHAT_ID'", "telegram_chat_id: ''"], ...REAL.slice(1)] });
  assert.strictEqual(soloEmail.length, 5);
  const cfgItems = await runCode('config.js', { replace: REAL });
  assert.strictEqual(cfgItems.length, 5);
  assert.strictEqual(cfgItems[1].json.url, 'https://books.toscrape.com/catalogue/page-2.html');
  assert.deepStrictEqual(cfgItems[0].json.sel.nombre, { css: 'article.product_pod h3 a', attr: 'title' });
  assert.deepStrictEqual(cfgItems[0].json.sel.precio, { css: 'article.product_pod .price_color', attr: '' });

  const responses = [ok(F.books_page1.body), ok(F.books_page2.body), notFound, notFound, notFound];
  const htmls = [{ json: F.books_page1.html }, { json: F.books_page2.html }, { json: {} }, { json: {} }, { json: {} }];

  // 2. Demo: primera ejecución sin datos → cambios simulados
  const store = {};
  const demo = await scenario(cfgItems, responses, htmls, store);
  const r = demo.json.resumen;
  assert.strictEqual(r.productos, 3);
  assert.strictEqual(r.demo, true);
  assert.deepStrictEqual(r.errores, []);
  assert.ok(r.por_tipo.undercut === 1, 'undercut demo');
  assert.ok(r.por_tipo.price_drop >= 1 && r.por_tipo.new_product === 1 && r.por_tipo.removed_product === 1, JSON.stringify(r.por_tipo));
  assert.strictEqual(demo.json.hay_cambios, true);
  assert.strictEqual(demo.json.email_from, 'avisos@denoro.test');
  assert.strictEqual(demo.json.enviar_email, true);
  assert.strictEqual(demo.json.enviar_telegram, true);
  assert.ok(demo.json.telegram.includes('A Light in the Attic'), 'usa el title completo, no el texto recortado');
  assert.ok(demo.json.telegram.includes('demo'));
  assert.ok(demo.json.email_html.includes('Te están ganando en precio'));
  const csv = Buffer.from(demo.binary.csv.data, 'base64').toString('utf8');
  assert.strictEqual(csv.trim().split('\n').length, 4);
  assert.ok(csv.includes('51,77'));
  assert.ok(store.snapshots['books-toscrape']);

  // 3. Real: sin cambios → no avisa
  cfgItems.forEach((i) => { i.json.config = { ...i.json.config, modo_demo: false, mis_productos: [] }; });
  const same = await scenario(cfgItems, responses, htmls, store);
  assert.strictEqual(same.json.resumen.cambios, 0);
  assert.strictEqual(same.json.hay_cambios, false);

  // 4. Bajada de precio + agotado
  const html1 = JSON.parse(JSON.stringify(F.books_page1.html));
  html1.precios_txt[0] = '£40.00';
  html1.stocks_txt[1] = 'Out of stock';
  const changed = await scenario(cfgItems, responses, [{ json: html1 }, ...htmls.slice(1)], store);
  const ev = changed.json.eventos;
  assert.deepStrictEqual(ev.map((e) => e.tipo), ['price_drop', 'out_of_stock']);
  assert.strictEqual(ev[0].cambio_pct, -22.74);
  assert.ok(changed.json.telegram.includes('51,77 £ → 40,00 £'));

  // 5. Web caída: error en página 1, sin falsos "retirados"
  const down = await scenario(cfgItems, [{ json: { error: { message: 'ECONNREFUSED' } } }, notFound, notFound, notFound, notFound],
    htmls.map(() => empty), store);
  assert.strictEqual(down.json.resumen.cambios, 0);
  assert.ok(down.json.resumen.errores[0].includes('ECONNREFUSED'), down.json.resumen.errores);
  assert.strictEqual(down.json.hay_cambios, true); // se avisa del error
  assert.ok(store.snapshots['books-toscrape'], 'la foto anterior se conserva');

  // 6. Shopify + WooCommerce
  const cfg2 = { ...cfgItems[0].json.config, fuentes: [], modo_demo: false, telegram_chat_id: '' };
  const mk = (fuente, tipo, url) => ({ json: { fuente, tipo, moneda: tipo === 'shopify' ? 'EUR' : '', pagina: 1, url, base: 'https://t.com', sel: {}, config: cfg2 } });
  const st2 = {};
  const items2 = [mk('shop', 'shopify', 'https://t.com/products.json'), mk('woo', 'woocommerce', 'https://w.es/wp-json')];
  const res2 = [ok(F.shopify), ok(F.woo)];
  const first = await scenario(items2, res2, [empty, empty], st2);
  assert.deepStrictEqual(first.json.resumen.por_web, { shop: 2, woo: 2 });
  const woo = JSON.parse(F.woo); woo[0].prices.price = '790'; woo[1].is_in_stock = true;
  const second = await scenario(items2, [ok(F.shopify), ok(JSON.stringify(woo))], [empty, empty], st2);
  assert.deepStrictEqual(second.json.eventos.map((e) => [e.tipo, e.producto, e.precio]),
    [['price_drop', 'Taza Cerámica', 7.9], ['back_in_stock', 'Gorra', 14.5]]);
  assert.ok(second.json.email_html.includes('9,90 €'));
  assert.strictEqual(second.json.enviar_telegram, false);

  // 7. Selectores descuadrados → error claro
  const bad = JSON.parse(JSON.stringify(F.books_page1.html)); bad.precios_txt.pop();
  const st3 = {};
  const mis = await scenario(cfgItems, responses, [{ json: bad }, ...htmls.slice(1)], st3);
  assert.ok(mis.json.resumen.errores.some((e) => e.includes('no cuadran')), mis.json.resumen.errores);

  // 7b. nodo HTML con error → error visible
  const hErr = await scenario(cfgItems, responses, [{ json: { error: { message: 'No property named "data"' } } }, ...htmls.slice(1)], {});
  assert.ok(hErr.json.resumen.errores.some((e) => e.includes('no se pudo leer el HTML')), hErr.json.resumen.errores);

  // 8. Error workflow
  const errOut = await runCode('error-handler.js', { input: [{ json: {
    execution: { id: '1', url: 'http://localhost:5678/execution/1', lastNodeExecuted: 'Gmail', error: { message: 'Invalid <credentials>' } },
    workflow: { id: '9', name: 'Monitor' } } }] });
  assert.ok(errOut[0].json.telegram.includes('Invalid &lt;credentials&gt;'));
  assert.ok(errOut[0].json.asunto.includes('Monitor'));

  // 9. robots.txt antes de descargar
  const it = (fuente, url) => ({ json: { fuente, url } });
  const fake = (mapa) => ({ httpRequest: async (o) => {
    const r = mapa[o.url]; if (r instanceof Error) throw r; if (!r) return { statusCode: 404, body: '' }; return r; } });
  const lista = [it('shop', 'https://shop.test/products.json?limit=250&page=1'), it('shop', 'https://shop.test/products.json?limit=250&page=2'),
    it('libros', 'https://libros.test/catalogue/page-1.html')];
  const pasa = await runCode('robots.js', { input: lista, helpers: fake({
    'https://shop.test/robots.txt': { statusCode: 200, body: 'User-agent: *\nDisallow: /admin\nDisallow: /cart' } }) });
  assert.deepStrictEqual(pasa.map((x) => x.json.url), lista.map((x) => x.json.url), 'deja pasar los mismos items, en orden');
  await assert.rejects(runCode('robots.js', { input: lista, helpers: fake({
    'https://libros.test/robots.txt': { statusCode: 200, body: 'User-agent: *\nDisallow: /catalogue/' } }) }), /no permiten.*libros/);
  await assert.rejects(runCode('robots.js', { input: lista, helpers: fake({
    'https://shop.test/robots.txt': { statusCode: 200, body: 'User-agent: *\nAllow: /\n\nUser-agent: DenoroPriceMonitor\nDisallow: /' } }) }), /no permiten.*shop/, 'respeta el grupo de su propio bot');
  await assert.rejects(runCode('robots.js', { input: lista, helpers: fake({ 'https://shop.test/robots.txt': { statusCode: 503, body: '' } }) }), /No se ha podido comprobar/);
  await assert.rejects(runCode('robots.js', { input: lista, helpers: fake({ 'https://shop.test/robots.txt': new Error('ETIMEDOUT') }) }), /No se ha podido comprobar/);
  const allow = await runCode('robots.js', { input: lista, helpers: fake({
    'https://libros.test/robots.txt': { statusCode: 200, body: 'User-agent: *\nDisallow: /catalogue/\nAllow: /catalogue/page-*.html$' } }) });
  assert.strictEqual(allow.length, 3, 'la regla más específica gana');

  console.log('price-monitor n8n: todos los escenarios OK');
  console.log(demo.json.telegram);
})().catch((e) => { console.error(e); process.exit(1); });
