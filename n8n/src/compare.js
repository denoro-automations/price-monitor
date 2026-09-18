// Normaliza los productos de todas las fuentes, los compara con la ejecución anterior
// y prepara los avisos (Telegram + email + CSV).
const cfgItems = $('Configuración').all();
const resItems = $('Descargar páginas').all();
const htmlItems = $input.all();
const CONFIG = cfgItems[0].json.config;
const now = new Date();

// ---------- utilidades ----------
function parsePrice(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
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
function currencyOf(txt) {
  if (!txt) return '';
  if (txt.includes('€')) return 'EUR';
  if (txt.includes('£')) return 'GBP';
  if (txt.includes('$')) return 'USD';
  return '';
}
// El sandbox de n8n no incluye URL(): resolución manual de enlaces relativos
function resolveUrl(href, base) {
  if (!href) return base;
  if (/^https?:\/\//i.test(href)) return href;
  const m = String(base).match(/^(https?:\/\/[^/]+)(\/[^?#]*)?/i);
  if (!m) return href;
  const origin = m[1];
  if (href.startsWith('//')) return base.split(':')[0] + ':' + href;
  if (href.startsWith('/')) return origin + href;
  const dir = (m[2] || '/').replace(/[^/]*$/, '');
  const parts = (dir + href.split(/[?#]/)[0]).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  const suffix = href.slice(href.split(/[?#]/)[0].length);
  return origin + out.join('/').replace(/^(?!\/)/, '/') + suffix;
}
const asArray = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const OUT_WORDS = ['out of stock', 'agotado', 'sin stock', 'sold out', 'no disponible'];
function money(v, cur) {
  if (v === null || v === undefined) return '—';
  const s = Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s + ({ EUR: ' €', USD: ' $', GBP: ' £' }[cur] ?? (cur ? ' ' + cur : ''));
}
const pctFmt = (v) => (v > 0 ? '+' : '') + Number(v).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' %';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- 1. normalizar ----------
const bySource = {};
const errors = [];
const pageErrors = {};
for (let i = 0; i < cfgItems.length; i++) {
  const c = cfgItems[i].json;
  bySource[c.fuente] = bySource[c.fuente] || { moneda: c.moneda, productos: {}, paginas_ok: 0 };
  const res = (resItems[i] || {}).json || {};
  // según la versión de n8n, el cuerpo llega en "data" o en "body"
  const body = res.data !== undefined ? res.data : res.body;
  const status = Number(res.statusCode || 0);
  if (res.error || !status || status >= 400) {
    // más allá de la última página algunas webs devuelven 404: solo es error si falla la primera
    if (c.pagina === 1 || (status && status !== 404)) {
      pageErrors[c.fuente] = pageErrors[c.fuente] || [];
      pageErrors[c.fuente].push(`página ${c.pagina}: ${res.error ? (res.error.message || res.error) : 'HTTP ' + status}`);
    }
    continue;
  }
  const target = bySource[c.fuente];
  const add = (p) => { if (p.key && p.name) target.productos[p.key] = p; };
  try {
    if (c.tipo === 'shopify') {
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      for (const p of data.products || []) {
        const vs = p.variants && p.variants.length ? p.variants : [{}];
        const prices = vs.map((v) => parsePrice(v.price)).filter((x) => x !== null);
        const compare = vs.map((v) => parsePrice(v.compare_at_price)).filter((x) => x !== null);
        const price = prices.length ? Math.min(...prices) : null;
        const regular = compare.length ? Math.max(...compare) : null;
        add({ key: p.handle || String(p.id), name: (p.title || '').trim(), price,
              regular: regular && price && regular > price ? regular : null,
              stock: vs.some((v) => v.available === true), url: `${c.base}/products/${p.handle}` });
      }
    } else if (c.tipo === 'woocommerce') {
      const data = typeof body === 'string' ? JSON.parse(body) : body;
      for (const p of Array.isArray(data) ? data : []) {
        const pr = p.prices || {};
        const unit = Number(pr.currency_minor_unit ?? 2);
        const conv = (x) => (x === undefined || x === null || x === '' ? null : Math.round(Number(x)) / 10 ** unit);
        const price = conv(pr.price), regular = conv(pr.regular_price);
        target.moneda = target.moneda || pr.currency_code || '';
        add({ key: p.sku || String(p.id), name: (p.name || '').trim(), price,
              regular: regular && price && regular > price ? regular : null,
              stock: p.is_in_stock, url: p.permalink || '' });
      }
    } else {
      const h = (htmlItems[i] || {}).json || {};
      if (h.error) throw new Error(`no se pudo leer el HTML (${h.error.message || h.error})`);
      const pickField = (key, field) => asArray(c.sel[field] && c.sel[field].attr ? h[`${key}_attr`] : h[`${key}_txt`]);
      const names = pickField('nombres', 'nombre'), links = pickField('enlaces', 'enlace');
      const prices = pickField('precios', 'precio'), stocks = pickField('stocks', 'stock');
      const hasStock = Boolean(c.sel.stock && c.sel.stock.css !== 'denoro-none');
      if (prices.length && names.length && prices.length !== names.length) {
        throw new Error(`los selectores no cuadran (${names.length} nombres y ${prices.length} precios)`);
      }
      prices.forEach((pt, k) => {
        const url = links[k] ? resolveUrl(links[k], c.url) : `${c.url}#${k}`;
        const st = stocks[k];
        target.moneda = target.moneda || currencyOf(pt);
        add({ key: url, name: String(names[k] || '').trim(), price: parsePrice(pt), regular: null,
              stock: !hasStock || st === undefined ? null : !OUT_WORDS.some((w) => String(st).toLowerCase().includes(w)), url });
      });
    }
    target.paginas_ok++;
  } catch (e) {
    pageErrors[c.fuente] = pageErrors[c.fuente] || [];
    pageErrors[c.fuente].push(`página ${c.pagina}: ${e.message}`);
  }
}
for (const [id, list] of Object.entries(pageErrors)) errors.push(`${id}: ${list.slice(0, 3).join('; ')}`);

// ---------- 2. comparar con la ejecución anterior ----------
const store = $getWorkflowStaticData('global');
store.snapshots = store.snapshots || {};
const events = [];
let demo = false;
const perSource = {};
const allProducts = [];
for (const [id, src] of Object.entries(bySource)) {
  const current = Object.values(src.productos);
  perSource[id] = current.length;
  if (!current.length) {
    if (!pageErrors[id]) errors.push(`${id}: 0 productos (¿ha cambiado la web o los selectores?)`);
    continue;
  }
  current.forEach((p) => { p.source = id; p.currency = src.moneda; allProducts.push(p); });
  let prev = store.snapshots[id];
  if (!prev && CONFIG.modo_demo) {
    // Simulación para enseñar el resultado: algunos precios "antes" eran distintos
    demo = true;
    prev = {};
    current.forEach((p, k) => {
      const factor = k < 3 ? 1.12 : k === 3 ? 0.9 : 1;
      prev[p.key] = { n: p.name, p: p.price === null ? null : Math.round(p.price * factor * 100) / 100,
                      s: k === 4 ? !p.stock : p.stock, u: p.url };
    });
    prev['demo-retirado'] = { n: 'Producto retirado (demo)', p: 9.99, s: true, u: '' };
    delete prev[current[current.length - 1].key]; // el último aparece como "nuevo"
  }
  if (prev) {
    const partial = current.length < 0.5 * Object.keys(prev).length;
    if (partial) errors.push(`${id}: solo ${current.length} de ${Object.keys(prev).length} productos; no se avisará de retirados`);
    const seen = new Set();
    for (const p of current) {
      seen.add(p.key);
      const o = prev[p.key];
      if (!o) { if (CONFIG.avisar_nuevos) events.push({ kind: 'new_product', p }); continue; }
      if (p.price !== null && o.p) {
        const pct = Math.round(((p.price - o.p) / o.p) * 10000) / 100;
        if (Math.abs(p.price - o.p) >= 0.01 && Math.abs(pct) >= (CONFIG.umbral_cambio_pct || 0)) {
          events.push({ kind: p.price < o.p ? 'price_drop' : 'price_rise', p, old: o.p, pct });
        }
      }
      if (o.s === true && p.stock === false) events.push({ kind: 'out_of_stock', p });
      if (o.s === false && p.stock === true) events.push({ kind: 'back_in_stock', p });
    }
    if (CONFIG.avisar_retirados && !partial) {
      for (const [key, o] of Object.entries(prev)) {
        if (!seen.has(key)) events.push({ kind: 'removed_product', p: { key, name: o.n, price: o.p, url: o.u, source: id, currency: src.moneda } });
      }
    }
  }
  const snap = {};
  current.forEach((p) => { snap[p.key] = { n: p.name, p: p.price, s: p.stock, u: p.url }; });
  store.snapshots[id] = snap;
}

// tus productos frente a la competencia
for (const item of CONFIG.mis_productos || []) {
  for (const [id, ref] of Object.entries(item.competidores || {})) {
    const p = allProducts.find((x) => x.source === id && (x.key === ref || x.url === ref));
    if (!p || p.price === null) continue;
    const limit = item.mi_precio * (1 - (item.tolerancia_pct || 0) / 100);
    if (p.price < limit) {
      events.push({ kind: 'undercut', p, mine: item.mi_precio, note: item.nombre,
                    pct: Math.round(((p.price - item.mi_precio) / item.mi_precio) * 10000) / 100 });
    }
  }
}
const ORDER = ['undercut', 'price_drop', 'out_of_stock', 'back_in_stock', 'price_rise', 'new_product', 'removed_product'];
events.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.pct || 0) - (b.pct || 0));

store.runs = (store.runs || []).concat([{ at: now.toISOString(), productos: allProducts.length, cambios: events.length, errores: errors.length }]).slice(-50);

// ---------- 3. mensajes ----------
const LABELS = {
  undercut: ['Te están ganando en precio', '🔻'], price_drop: ['Bajadas de precio', '📉'],
  out_of_stock: ['Se han quedado sin stock', '⛔'], back_in_stock: ['Vuelven a tener stock', '✅'],
  price_rise: ['Subidas de precio', '📈'], new_product: ['Productos nuevos', '🆕'],
  removed_product: ['Productos retirados', '🗑️'],
};
const count = (k) => events.filter((e) => e.kind === k).length;
const line = (e) => {
  const p = e.p;
  if (e.kind === 'undercut') return `${p.name} (${p.source}): ${money(p.price, p.currency)} vs tu ${money(e.mine, p.currency)} (${pctFmt(e.pct)})`;
  if (e.old !== undefined) return `${p.name} (${p.source}): ${money(e.old, p.currency)} → ${money(p.price, p.currency)} (${pctFmt(e.pct)})`;
  return `${p.name} (${p.source}) — ${money(p.price, p.currency)}`;
};
const nSources = Object.keys(bySource).length;

let tg = `<b>Denoro · Monitor de precios</b>${demo ? ' <i>(demo: cambios simulados)</i>' : ''}\n` +
         `${plural(allProducts.length, 'producto revisado', 'productos revisados')} en ${plural(nSources, 'web', 'webs')} · ${plural(events.length, 'cambio', 'cambios')}`;
for (const [kind, [label, icon]] of Object.entries(LABELS)) {
  const group = events.filter((e) => e.kind === kind);
  if (!group.length) continue;
  tg += `\n\n${icon} <b>${label}</b> (${group.length})\n` + group.slice(0, 8).map((e) => '• ' + esc(line(e))).join('\n');
  if (group.length > 8) tg += `\n… y ${group.length - 8} más (ver email)`;
}
if (errors.length) tg += '\n\n⚠️ <b>Fuentes con error</b>\n' + errors.map((x) => '• ' + esc(x)).join('\n');
if (tg.length > 4000) tg = tg.slice(0, 3990) + '\n…';

const td = 'padding:6px 8px;border-bottom:1px solid #e6eaee';
const tiles = [[allProducts.length, 'productos revisados'], [count('price_drop') + count('undercut'), 'bajadas / te ganan'],
               [count('out_of_stock'), 'sin stock'], [events.length, 'cambios totales']]
  .map(([v, l]) => `<td style="padding:12px;background:#f4f6f8;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700;color:#0f2a3d">${v}</div><div style="font-size:12px;color:#5b6b7a">${l}</div></td>`).join('');
let sections = '';
for (const [kind, [label, icon]] of Object.entries(LABELS)) {
  const group = events.filter((e) => e.kind === kind);
  if (!group.length) continue;
  const rows = group.slice(0, 100).map((e) => {
    const before = e.mine ?? e.old;
    const color = (e.pct || 0) < 0 ? '#b42318' : '#067647';
    return `<tr><td style="${td}"><a href="${esc(e.p.url)}" style="color:#0f2a3d">${esc(e.p.name)}</a></td>` +
      `<td style="${td};color:#5b6b7a">${esc(e.p.source)}</td>` +
      `<td style="${td};text-align:right">${before === undefined ? '' : money(before, e.p.currency)}</td>` +
      `<td style="${td};text-align:right;font-weight:600">${money(e.p.price, e.p.currency)}</td>` +
      `<td style="${td};text-align:right;color:${color}">${e.pct === undefined ? '' : pctFmt(e.pct)}</td></tr>`;
  }).join('');
  sections += `<h3 style="margin:24px 0 8px;font-size:16px">${icon} ${label} (${group.length})</h3>` +
    `<table width="100%" cellspacing="0" style="border-collapse:collapse;font-size:14px">` +
    `<tr style="color:#5b6b7a;font-size:12px;text-align:left"><th style="padding:6px 8px">Producto</th><th style="padding:6px 8px">Web</th>` +
    `<th style="padding:6px 8px;text-align:right">Antes / tu precio</th><th style="padding:6px 8px;text-align:right">Ahora</th><th style="padding:6px 8px;text-align:right">Cambio</th></tr>${rows}</table>`;
}
const errorBox = errors.length
  ? `<p style="margin-top:24px;padding:12px;background:#fef3f2;border-radius:8px;color:#b42318"><b>Fuentes con error:</b><br>${errors.map(esc).join('<br>')}</p>` : '';
const fecha = now.toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' });
const html = `<!doctype html><html><body style="margin:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif;color:#1d2939">
<table width="100%" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="640" cellspacing="0" style="background:#fff;border-radius:12px;padding:28px"><tr><td>
<div style="font-size:12px;letter-spacing:.08em;color:#5b6b7a;text-transform:uppercase">Denoro Automations</div>
<h2 style="margin:4px 0;font-size:22px;color:#0f2a3d">Monitor de precios de la competencia</h2>
<div style="color:#5b6b7a;font-size:13px">${esc(fecha)} · ${plural(nSources, 'web', 'webs')}${demo ? ' · <b>demo: cambios simulados</b>' : ''}</div>
<table width="100%" cellspacing="8" style="margin-top:16px"><tr>${tiles}</tr></table>
${sections || '<p style="color:#5b6b7a">Sin cambios desde la última revisión.</p>'}${errorBox}
<p style="margin-top:28px;font-size:12px;color:#98a2b3">Adjunto: precios actuales de todos los productos (CSV).</p>
</td></tr></table></td></tr></table></body></html>`;

// CSV con la foto actual (se abre directamente en Excel)
const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = '﻿' + [['fecha', 'web', 'producto', 'precio', 'precio_sin_rebaja', 'moneda', 'en_stock', 'url'].join(';')]
  .concat(allProducts.map((p) => [now.toISOString(), p.source, p.name, p.price === null ? '' : String(p.price).replace('.', ','),
    p.regular === null || p.regular === undefined ? '' : String(p.regular).replace('.', ','), p.currency, p.stock === null ? '' : p.stock ? 'sí' : 'no', p.url].map(csvCell).join(';')))
  .join('\n');

const hayCambios = events.length > 0 || errors.length > 0 || CONFIG.avisar_sin_cambios === true;
return [{
  json: {
    hay_cambios: hayCambios,
    asunto: events.length ? `Denoro · ${events.length} cambios en la competencia${demo ? ' (demo)' : ''}` : 'Denoro · Monitor de precios: sin cambios',
    telegram: tg,
    email_html: html,
    telegram_chat_id: CONFIG.telegram_chat_id,
    email_to: CONFIG.email_to,
    email_from: CONFIG.email_from,
    enviar_email: Boolean(CONFIG.email_to),
    enviar_telegram: Boolean(CONFIG.telegram_chat_id),
    resumen: { fecha: now.toISOString(), productos: allProducts.length, por_web: perSource, cambios: events.length,
               por_tipo: Object.fromEntries(ORDER.map((k) => [k, count(k)])), errores: errors, demo },
    eventos: events.slice(0, 200).map((e) => ({ tipo: e.kind, web: e.p.source, producto: e.p.name, precio: e.p.price,
                                               antes: e.old ?? null, tu_precio: e.mine ?? null, cambio_pct: e.pct ?? null, url: e.p.url })),
  },
  binary: {
    csv: { data: Buffer.from(csv, 'utf8').toString('base64'), mimeType: 'text/csv',
           fileName: `precios-${now.toISOString().slice(0, 10)}.csv`, fileExtension: 'csv' },
  },
}];
