// ============================================================================
// Denoro · motor de vigilancia (se inyecta al principio de varios nodos Code)
// Requiere: http(options) -> { statusCode, headers, body }  (this.helpers.httpRequest)
// ============================================================================
const DENORO_UA = 'Mozilla/5.0 (compatible; DenoroPriceMonitor/3.0; +https://github.com/denoro-automations/price-monitor)';
const MAX_STORE_PAGES = 20;          // Shopify: 250 productos/página; Woo: 100
const MAX_PRODUCTS = 3000;
const POLITE_DELAY = 1200;         // pausa entre peticiones al mismo dominio (ms)
const RETRY_WAIT = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parsePrice(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const m = String(v).match(/\d[\d.,\s  ]*/);
  if (!m) return null;
  let raw = m[0].replace(/[\s  ]/g, '').replace(/[.,]+$/, '');
  if (raw.includes(',') && raw.includes('.')) {
    raw = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (raw.includes(',')) {
    const tail = raw.split(',').pop();
    raw = tail.length <= 2 ? raw.replace(/,(?=[^,]*,)/g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if ((raw.match(/\./g) || []).length > 1 || (raw.includes('.') && raw.split('.').pop().length === 3)) {
    raw = raw.replace(/\./g, '');
  }
  const n = parseFloat(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// ---------- URLs (el sandbox de n8n no tiene URL()) ----------
function splitUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const m = s.match(/^(https?):\/\/([^/?#\s]+)([^?#\s]*)(\?[^#\s]*)?/i);
  if (!m) return null;
  const host = m[2].toLowerCase();
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(host) || !host.includes('.')) return null;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
  const path = (m[3] || '/').replace(/\/{2,}/g, '/');
  return { origin: `${m[1].toLowerCase()}://${host}`, host: host.replace(/^www\./, ''), path, query: m[4] || '', href: `${m[1].toLowerCase()}://${host}${path}${m[4] || ''}` };
}
function resolveUrl(href, base) {
  if (!href) return base;
  if (/^https?:\/\//i.test(href)) return href;
  const b = splitUrl(base);
  if (!b) return href;
  if (href.startsWith('//')) return b.origin.split(':')[0] + ':' + href;
  if (href.startsWith('/')) return b.origin + href;
  const dir = b.path.replace(/[^/]*$/, '');
  const clean = href.split(/[?#]/)[0];
  const out = [];
  for (const p of (dir + clean).split('/')) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
  return b.origin + out.join('/').replace(/^(?!\/)/, '/') + href.slice(clean.length);
}

// ---------- HTTP educado ----------
const lastHit = {};
const robotsCache = {};
async function politeGet(http, url, { json = false, delayMs = POLITE_DELAY } = {}) {
  delayMs = Math.min(delayMs, POLITE_DELAY);
  const u = splitUrl(url);
  if (!u) throw new Error(`URL no válida: ${url}`);
  const wait = (lastHit[u.host] || 0) + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit[u.host] = Date.now();
  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await http({ url: u.href, method: 'GET', json, returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 20000,
        headers: { 'User-Agent': DENORO_UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8', Accept: json ? 'application/json' : 'text/html,application/xhtml+xml' } });
    } catch (e) {
      const permanent = /redirect|ENOTFOUND|certificate|EAI_AGAIN|Invalid URL/i.test(e.message || '');
      if (attempt === 3 || permanent) throw new Error(`No se pudo conectar con ${u.host}: ${e.message}`);
      await sleep(RETRY_WAIT * attempt);
      continue;
    }
    if ([429, 500, 502, 503, 504].includes(res.statusCode) && attempt < 3) { await sleep(RETRY_WAIT * attempt); continue; }
    break;
  }
  let body = res.body;
  if (json && typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!json && body && typeof body !== 'string') body = typeof body === 'object' ? JSON.stringify(body) : String(body);
  return { status: res.statusCode, body, headers: res.headers || {} };
}
async function robotsAllows(http, url) {
  const u = splitUrl(url);
  if (!(u.origin in robotsCache)) {
    let rules = [];
    try {
      const r = await politeGet(http, u.origin + '/robots.txt', { delayMs: 0 });
      if (r.status === 200 && typeof r.body === 'string') {
        let applies = false;
        for (const line of r.body.split(/\r?\n/)) {
          const [k, ...rest] = line.split(':');
          const key = (k || '').trim().toLowerCase(); const val = rest.join(':').split('#')[0].trim();
          if (key === 'user-agent') applies = val === '*' || /denoro/i.test(val);
          else if (applies && key === 'disallow' && val) rules.push({ allow: false, path: val });
          else if (applies && key === 'allow' && val) rules.push({ allow: true, path: val });
        }
      }
    } catch (e) { rules = []; }
    robotsCache[u.origin] = rules;
  }
  const target = u.path + u.query;
  let best = null;
  for (const r of robotsCache[u.origin]) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(target) && (!best || r.path.length > best.path.length)) best = r;
  }
  return !best || best.allow;
}

// ---------- extracción ----------
const OUT_WORDS = /outofstock|soldout|discontinued|out of stock|agotado|sin stock|no disponible/i;
function jsonLdProducts(html) {
  const found = [];
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const types = [].concat(node['@type'] || []).map(String);
    if (types.some((t) => /^(Product|ProductGroup|IndividualProduct)$/i.test(t))) found.push(node);
    if (node['@graph']) visit(node['@graph']);
    if (node.mainEntity) visit(node.mainEntity);
  };
  while ((m = re.exec(html)) !== null) {
    const txt = m[1].trim().replace(/^<!--|-->$/g, '');
    try { visit(JSON.parse(txt)); } catch (e) { /* JSON-LD roto: se ignora */ }
  }
  return found;
}
function offerInfo(offers) {
  const list = [].concat(offers || []).flatMap((o) => (o && o['@type'] === 'AggregateOffer' && o.offers ? [o, ...[].concat(o.offers)] : [o])).filter(Boolean);
  let price = null, currency = '', stock = null, regular = null;
  for (const o of list) {
    const specs = [].concat(o.priceSpecification || []);
    const p = parsePrice(o.price ?? o.lowPrice ?? specs.find((s) => s && s.price !== undefined)?.price);
    if (p !== null && (price === null || p < price)) { price = p; currency = o.priceCurrency || specs[0]?.priceCurrency || currency; }
    const strike = specs.find((s) => /StrikethroughPrice|ListPrice/i.test(String(s?.priceType || '')));
    if (strike) regular = parsePrice(strike.price);
    if (o.availability) {
      const inS = !OUT_WORDS.test(String(o.availability));
      stock = stock === true ? true : inS;
    }
  }
  return { price, currency, stock, regular };
}
function metaContent(html, names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${n}["'][^>]*>`, 'i');
    const tag = html.match(re);
    if (tag) { const c = tag[0].match(/content\s*=\s*["']([^"']*)["']/i); if (c) return c[1]; }
  }
  return null;
}
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).trim();

function productFromHtml(html, url) {
  const lds = jsonLdProducts(html);
  for (const p of lds) {
    let info = offerInfo(p.offers);
    if (info.price === null && p.hasVariant) {
      const vs = [].concat(p.hasVariant).map((v) => offerInfo(v.offers)).filter((x) => x.price !== null);
      if (vs.length) info = { ...vs.reduce((a, b) => (b.price < a.price ? b : a)), stock: vs.some((x) => x.stock !== false) };
    }
    if (info.price !== null) {
      return { key: p.sku ? String(p.sku) : url, name: decode(p.name) || url, price: info.price, regular: info.regular && info.regular > info.price ? info.regular : null,
               currency: info.currency || '', stock: info.stock, url, image: [].concat(p.image || [])[0]?.url || [].concat(p.image || [])[0] || '', via: 'json-ld' };
    }
  }
  const price = parsePrice(metaContent(html, ['product:price:amount', 'og:price:amount', 'price']));
  if (price !== null) {
    const avail = metaContent(html, ['product:availability', 'og:availability', 'availability']);
    return { key: url, name: decode(metaContent(html, ['og:title', 'twitter:title']) || (html.match(/<title>([^<]*)/i) || [])[1] || url), price, regular: null,
             currency: metaContent(html, ['product:price:currency', 'og:price:currency', 'priceCurrency']) || '',
             stock: avail ? !OUT_WORDS.test(avail) : null, url, image: metaContent(html, ['og:image']) || '', via: 'meta' };
  }
  // microdatos: itemprop="price"
  const micro = html.match(/itemprop\s*=\s*["']price["'][^>]*?(?:content\s*=\s*["']([^"']+)["'])?[^>]*>([^<]{0,40})/i);
  if (micro && parsePrice(micro[1] || micro[2]) !== null) {
    const cur = (html.match(/itemprop\s*=\s*["']priceCurrency["'][^>]*content\s*=\s*["']([A-Z]{3})/i) || [])[1] || '';
    const av = (html.match(/itemprop\s*=\s*["']availability["'][^>]*(?:href|content)\s*=\s*["']([^"']+)/i) || [])[1];
    return { key: url, name: stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]) || decode(metaContent(html, ['og:title'])) || url,
             price: parsePrice(micro[1] || micro[2]), regular: null, currency: cur, stock: av ? !OUT_WORDS.test(av) : null, url,
             image: metaContent(html, ['og:image']) || '', via: 'microdata' };
  }
  // aproximación: un único precio visible en elementos con clase "price" y un único <h1>
  const h1s = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];
  if (h1s.length === 1) {
    const vals = [];
    const re = /<(?:p|span|div|strong|ins|bdi)[^>]*class\s*=\s*["'][^"']*\bprice[\w-]*\b[^"']*["'][^>]*>([\s\S]{0,120}?)<\/(?:p|span|div|strong|ins|bdi)>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const txt = stripTags(m[1]);
      if (/[€$£]|EUR|USD|GBP/.test(txt)) { const v = parsePrice(txt); if (v !== null) vals.push({ v, cur: /€|EUR/.test(txt) ? 'EUR' : /£|GBP/.test(txt) ? 'GBP' : 'USD' }); }
    }
    const distinct = [...new Set(vals.map((x) => x.v))];
    if (distinct.length === 1) {
      const stockTxt = stripTags((html.match(/<[^>]+class\s*=\s*["'][^"']*(?:availability|stock)[^"']*["'][^>]*>([\s\S]{0,300}?)<\/(?:p|span|div|td|li)>/i) || [])[1] || '');
      return { key: url, name: stripTags(h1s[0]), price: distinct[0], regular: null, currency: vals[0].cur,
               stock: stockTxt ? !OUT_WORDS.test(stockTxt) : null, url, image: metaContent(html, ['og:image']) || '', via: 'aproximado' };
    }
  }
  return null;
}
const stripTags = (s) => decode(String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));

function shopifyProducts(data, origin, currency) {
  return (data && data.products || []).map((p) => {
    const vs = p.variants && p.variants.length ? p.variants : [{}];
    const prices = vs.map((v) => parsePrice(v.price)).filter((x) => x !== null);
    const compare = vs.map((v) => parsePrice(v.compare_at_price)).filter((x) => x !== null);
    const price = prices.length ? Math.min(...prices) : null;
    const regular = compare.length ? Math.max(...compare) : null;
    return { key: p.handle || String(p.id), name: String(p.title || '').trim(), price, regular: regular && price && regular > price ? regular : null,
             currency, stock: vs.some((v) => v.available === true), url: `${origin}/products/${p.handle}`,
             image: (p.images && p.images[0] && p.images[0].src) || '' };
  }).filter((p) => p.name);
}
function shopifyProductJs(p, origin, currency) {
  // /products/<handle>.js : precios en céntimos
  const vs = p.variants || [];
  const cents = (x) => (x === null || x === undefined ? null : Math.round(Number(x)) / 100);
  const prices = vs.map((v) => cents(v.price)).filter((x) => x !== null);
  const price = prices.length ? Math.min(...prices) : cents(p.price);
  const compare = vs.map((v) => cents(v.compare_at_price)).filter((x) => x);
  const regular = compare.length ? Math.max(...compare) : null;
  return { key: p.handle, name: p.title, price, regular: regular && price && regular > price ? regular : null, currency,
           stock: p.available === true || vs.some((v) => v.available), url: `${origin}/products/${p.handle}`,
           image: (p.featured_image && String(p.featured_image).replace(/^\/\//, 'https://')) || '', via: 'shopify' };
}
function wooProducts(items) {
  return (Array.isArray(items) ? items : []).map((p) => {
    const pr = p.prices || {};
    const unit = Number(pr.currency_minor_unit ?? 2);
    const conv = (x) => (x === undefined || x === null || x === '' ? null : Math.round(Number(x)) / 10 ** unit);
    const price = conv(pr.price), regular = conv(pr.regular_price);
    return { key: p.sku || String(p.id), name: decode(p.name), price, regular: regular && price && regular > price ? regular : null,
             currency: pr.currency_code || '', stock: p.is_in_stock, url: p.permalink || '', image: (p.images && p.images[0] && p.images[0].src) || '' };
  }).filter((p) => p.name);
}

// ---------- detección ----------
// Devuelve { tipo, url, nombre, moneda, productos:[muestra], total, aviso? }
async function tryGet(http, url, opts) {
  try { return await politeGet(http, url, opts); } catch (e) { return { status: 0, body: null, headers: {}, error: e.message }; }
}
async function detectWatch(http, rawUrl) {
  const u = splitUrl(rawUrl);
  if (!u) return { ok: false, error: 'La dirección no es válida. Copia el enlace completo de la tienda o del producto.' };
  if (!(await robotsAllows(http, u.href))) return { ok: false, error: `${u.host} no permite la lectura automática de esa página (robots.txt).` };
  const unreachable = (r) => r.status === 0 && /redirect|ENOTFOUND|ECONNREFUSED|certificate|EAI_AGAIN/i.test(r.error || '');
  const cantOpen = (r) => ({ ok: false, error: `No he podido abrir ${u.host} (${String(r.error).replace(/^No se pudo conectar con [^:]+: /, '')}). Comprueba el enlace o prueba con otro producto.` });
  const shopHandle = (u.path.match(/\/products\/([^/?#.]+)/) || [])[1];
  const collection = (u.path.match(/\/collections\/([^/?#]+)/) || [])[1];

  // 1) Producto de Shopify (algunas tiendas usan prefijo de idioma: /es/products/...)
  if (shopHandle) {
    const prefix = u.path.slice(0, u.path.indexOf('/products/'));
    for (const pre of [...new Set([prefix, ''])]) {
      const r = await tryGet(http, `${u.origin}${pre}/products/${shopHandle}.js`, { json: true, delayMs: 300 });
      if (unreachable(r)) return cantOpen(r);
      if (r.status === 200 && r.body && r.body.handle) {
        const cur = await shopifyCurrency(http, u.origin);
        const p = shopifyProductJs(r.body, u.origin + pre, cur);
        return { ok: true, tipo: 'shopify_producto', url: p.url, nombre: p.name, moneda: cur, total: 1, productos: [p] };
      }
    }
  }
  // 2) Tienda o colección de Shopify
  // se considera "toda la tienda" la home, con o sin prefijo de idioma (/es, /es-es), y las colecciones
  const isHome = /^(\/[a-z]{2}(-[a-z]{2})?)?(\/(collections(\/[^/]+)?|shop|tienda|store))?\/?$/i.test(u.path);
  if (isHome || collection) {
    let locale = (u.path.match(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i) || [''])[0];
    let base = collection && collection !== 'all' ? `${u.origin}${locale}/collections/${collection}` : u.origin + locale;
    let r = await tryGet(http, `${base}/products.json?limit=250&page=1`, { json: true, delayMs: 300 });
    if (unreachable(r)) return cantOpen(r);
    if (r.status !== 200 && locale) {           // la tienda no usa ese prefijo de idioma
      const alt = await tryGet(http, `${u.origin}/products.json?limit=250&page=1`, { json: true, delayMs: 300 });
      if (alt.status === 200) { r = alt; locale = ''; base = u.origin; }
    }
    if (r.status === 200 && r.body && Array.isArray(r.body.products)) {
      const cur = await shopifyCurrency(http, u.origin);
      const list = shopifyProducts(r.body, u.origin + locale, cur);
      return { ok: true, tipo: 'shopify_tienda', url: collection ? `${u.origin}${locale}/collections/${collection}` : u.origin + locale,
               nombre: collection ? `${u.host} · ${collection}` : u.host, moneda: cur,
               total: list.length >= 250 ? '250+' : list.length, productos: list.slice(0, 6) };
    }
    // 3) Tienda WooCommerce
    const w = await tryGet(http, `${u.origin}/wp-json/wc/store/v1/products?per_page=100&page=1`, { json: true, delayMs: 300 });
    if (w.status === 200 && Array.isArray(w.body)) {
      const list = wooProducts(w.body);
      const total = Number(w.headers['x-wp-total'] || list.length);
      return { ok: true, tipo: 'woo_tienda', url: u.origin, nombre: u.host, moneda: list[0]?.currency || '',
               total, productos: list.slice(0, 6) };
    }
    if (isHome) return { ok: false, error: `No he podido leer el catálogo completo de ${u.host} (no es Shopify ni WooCommerce, o lo tiene bloqueado). Pega enlaces de productos concretos: esos funcionan en casi cualquier tienda.` };
  }
  // 4) Página de producto de cualquier web (JSON-LD / metadatos estándar)
  const page = await tryGet(http, u.href, { delayMs: 300 });
  if (page.status === 0) return cantOpen(page);
  if (page.status === 401 || page.status === 403 || page.status === 429) return { ok: false, error: `${u.host} bloquea las consultas automáticas (error ${page.status}). Esta tienda no se puede vigilar de momento.` };
  if (page.status >= 400) return { ok: false, error: `${u.host} respondió con error ${page.status}. ¿El enlace es correcto y público?` };
  const p = productFromHtml(page.body || '', u.href);
  if (p) return { ok: true, tipo: 'producto', url: u.href, nombre: p.name, moneda: p.currency, total: 1, productos: [p],
                  ...(p.via === 'aproximado' ? { aviso: 'Hemos encontrado el precio por aproximación: comprueba que coincide con el de la web.' } : {}) };
  // ¿Es una página de producto WooCommerce sin datos estructurados?
  const slug = (u.path.match(/\/(?:product|producto)\/([^/]+)/) || [])[1];
  if (slug) {
    const w = await tryGet(http, `${u.origin}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`, { json: true, delayMs: 300 });
    const list = wooProducts(w.status === 200 ? w.body : []);
    if (list.length) return { ok: true, tipo: 'woo_producto', url: u.href, nombre: list[0].name, moneda: list[0].currency, total: 1, productos: [list[0]], slug };
  }
  return { ok: false, error: `No encuentro el precio en esa página de ${u.host}. Prueba con el enlace de un producto concreto (no de una categoría o búsqueda).` };
}

const currencyCache = {};
async function shopifyCurrency(http, origin) {
  if (origin in currencyCache) return currencyCache[origin];
  let cur = '';
  try {
    const r = await politeGet(http, `${origin}/cart.js`, { json: true, delayMs: 300 });
    if (r.status === 200 && r.body && r.body.currency) cur = r.body.currency;
  } catch (e) { cur = ''; }
  currencyCache[origin] = cur;
  return cur;
}

// ---------- lectura completa de una vigilancia ----------
async function fetchWatch(http, w) {
  const u = splitUrl(w.url);
  if (!u) throw new Error('URL no válida');
  if (!(await robotsAllows(http, u.href))) throw new Error('robots.txt no permite leer esta página');
  if (w.tipo === 'shopify_tienda') {
    const locale = (u.path.match(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i) || [''])[0];
    const base = locale + (u.path.match(/\/collections\/[^/]+/) || [''])[0];
    const cur = w.moneda || await shopifyCurrency(http, u.origin);
    const all = [];
    for (let page = 1; page <= MAX_STORE_PAGES && all.length < MAX_PRODUCTS; page++) {
      const r = await politeGet(http, `${u.origin}${base}/products.json?limit=250&page=${page}`, { json: true });
      if (r.status !== 200 || !r.body || !Array.isArray(r.body.products)) {
        if (page === 1) throw new Error(`la tienda respondió ${r.status}`);
        break;
      }
      const batch = shopifyProducts(r.body, u.origin, cur);
      all.push(...batch);
      if (batch.length < 250) break;
    }
    return { productos: all, completo: true };
  }
  if (w.tipo === 'woo_tienda') {
    const all = [];
    for (let page = 1; page <= MAX_STORE_PAGES * 3 && all.length < MAX_PRODUCTS; page++) {
      const r = await politeGet(http, `${u.origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { json: true });
      if (r.status !== 200 || !Array.isArray(r.body)) {
        if (page === 1) throw new Error(`la tienda respondió ${r.status}`);
        break;
      }
      const batch = wooProducts(r.body);
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return { productos: all, completo: true };
  }
  if (w.tipo === 'shopify_producto') {
    const handle = (u.path.match(/\/products\/([^/?#.]+)/) || [])[1];
    const pre = u.path.slice(0, u.path.indexOf('/products/'));
    const r = await politeGet(http, `${u.origin}${pre}/products/${handle}.js`, { json: true });
    if (r.status === 404) return { productos: [], completo: true, retirado: true };
    if (r.status !== 200 || !r.body || !r.body.handle) throw new Error(`la tienda respondió ${r.status}`);
    return { productos: [shopifyProductJs(r.body, u.origin + pre, w.moneda || await shopifyCurrency(http, u.origin))], completo: true };
  }
  if (w.tipo === 'woo_producto') {
    const r = await politeGet(http, `${u.origin}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(w.slug || '')}`, { json: true });
    if (r.status !== 200) throw new Error(`la tienda respondió ${r.status}`);
    const list = wooProducts(r.body);
    return { productos: list.slice(0, 1), completo: true, retirado: !list.length };
  }
  // producto genérico
  const r = await politeGet(http, u.href);
  if (r.status === 404 || r.status === 410) return { productos: [], completo: true, retirado: true };
  if (r.status >= 400) throw new Error(`la web respondió ${r.status}`);
  const p = productFromHtml(r.body || '', u.href);
  if (!p) throw new Error('no se encuentra el precio en la página (¿ha cambiado la web?)');
  p.key = u.href;                      // clave estable = URL vigilada
  return { productos: [p], completo: true };
}

// ---------- comparación ----------
function compareSnapshots(current, prev, opts) {
  const events = [];
  if (!prev) return events;
  const seen = new Set();
  for (const p of current) {
    seen.add(p.key);
    const o = prev[p.key];
    if (!o) { if (opts.avisar_nuevos) events.push({ kind: 'new_product', p }); continue; }
    if (p.price !== null && o.p) {
      const pct = Math.round(((p.price - o.p) / o.p) * 10000) / 100;
      if (Math.abs(p.price - o.p) >= 0.01 && Math.abs(pct) >= (opts.umbral_pct || 0)) {
        events.push({ kind: p.price < o.p ? 'price_drop' : 'price_rise', p, old: o.p, pct });
      }
    }
    if (opts.avisar_stock !== false) {
      if (o.s === true && p.stock === false) events.push({ kind: 'out_of_stock', p });
      if (o.s === false && p.stock === true) events.push({ kind: 'back_in_stock', p });
    }
  }
  if (opts.avisar_retirados && !opts.parcial) {
    for (const [key, o] of Object.entries(prev)) {
      if (!seen.has(key)) events.push({ kind: 'removed_product', p: { key, name: o.n, price: o.p, url: o.u, currency: opts.moneda || '' } });
    }
  }
  return events;
}
const snapshotOf = (list) => Object.fromEntries(list.map((p) => [p.key, { n: p.name, p: p.price, s: p.stock, u: p.url }]));

function newToken() {
  let t = '';
  for (let i = 0; i < 4; i++) t += Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return t;
}
function newId() { return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
// ============================ fin del motor ================================
