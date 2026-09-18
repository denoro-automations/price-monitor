// ---------- mensajes (Telegram + email + CSV) ----------
const LABELS = {
  undercut: ['Te están ganando en precio', '🔻'], price_drop: ['Bajadas de precio', '📉'],
  out_of_stock: ['Se han quedado sin stock', '⛔'], back_in_stock: ['Vuelven a tener stock', '✅'],
  price_rise: ['Subidas de precio', '📈'], new_product: ['Productos nuevos', '🆕'],
  removed_product: ['Productos retirados', '🗑️'],
};
const ORDER = Object.keys(LABELS);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nf = (v, d = 2) => {
  const [int, dec] = Math.abs(Number(v || 0)).toFixed(d).split('.');
  return (Number(v) < 0 ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
};
const money = (v, cur) => (v === null || v === undefined ? '—' : nf(v) + ({ EUR: ' €', USD: ' $', GBP: ' £' }[cur] ?? (cur ? ' ' + cur : '')));
const pctFmt = (v) => (v > 0 ? '+' : '') + nf(v, 1) + ' %';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function buildMessages({ cliente, events, errors, stats, demo = false, bienvenida = null, fecha = new Date() }) {
  const count = (k) => events.filter((e) => e.kind === k).length;
  const line = (e) => {
    const p = e.p;
    const where = e.watch ? ` · ${e.watch}` : '';
    if (e.kind === 'undercut') return `${p.name}${where}: ${money(p.price, p.currency)} vs tu ${money(e.mine, p.currency)} (${pctFmt(e.pct)})`;
    if (e.old !== undefined) return `${p.name}${where}: ${money(e.old, p.currency)} → ${money(p.price, p.currency)} (${pctFmt(e.pct)})`;
    return `${p.name}${where} — ${money(p.price, p.currency)}`;
  };
  let tg = `<b>Denoro · ${esc(cliente.nombre)}</b>\n`;
  if (bienvenida) {
    tg += `✅ Vigilancia activada: ${plural(bienvenida.productos, 'producto', 'productos')} en ${plural(bienvenida.webs, 'enlace', 'enlaces')}.\nTe avisaré aquí cuando cambie algo importante.`;
  } else {
    tg += `${plural(stats.productos, 'producto revisado', 'productos revisados')} · ${plural(events.length, 'cambio', 'cambios')}`;
    for (const kind of ORDER) {
      const group = events.filter((e) => e.kind === kind);
      if (!group.length) continue;
      tg += `\n\n${LABELS[kind][1]} <b>${LABELS[kind][0]}</b> (${group.length})\n` + group.slice(0, 8).map((e) => '• ' + esc(line(e))).join('\n');
      if (group.length > 8) tg += `\n… y ${group.length - 8} más (ver email)`;
    }
  }
  if (errors.length) tg += '\n\n⚠️ <b>No he podido revisar</b>\n' + errors.map((x) => '• ' + esc(x)).join('\n');
  if (tg.length > 4000) tg = tg.slice(0, 3990) + '\n…';

  const td = 'padding:8px;border-bottom:1px solid #e6eaee;font-size:14px';
  const tiles = [[stats.productos, 'productos vigilados'], [count('price_drop') + count('undercut'), 'bajadas / te ganan'],
                 [count('out_of_stock'), 'sin stock'], [events.length, 'cambios']]
    .map(([v, l]) => `<td width="25%" style="padding:6px"><div style="background:#f4f6f8;border-radius:10px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:700;color:#0f2a3d">${v}</div><div style="font-size:12px;color:#5b6b7a">${l}</div></div></td>`).join('');
  let sections = '';
  for (const kind of ORDER) {
    const group = events.filter((e) => e.kind === kind);
    if (!group.length) continue;
    const rows = group.slice(0, 150).map((e) => {
      const before = e.mine ?? e.old;
      return `<tr><td style="${td}"><a href="${esc(e.p.url)}" style="color:#0f2a3d">${esc(e.p.name)}</a><div style="font-size:12px;color:#5b6b7a">${esc(e.watch || '')}</div></td>` +
        `<td style="${td};text-align:right;color:#5b6b7a">${before === undefined ? '' : money(before, e.p.currency)}</td>` +
        `<td style="${td};text-align:right;font-weight:600">${money(e.p.price, e.p.currency)}</td>` +
        `<td style="${td};text-align:right;color:${(e.pct || 0) < 0 ? '#b42318' : '#067647'}">${e.pct === undefined ? '' : pctFmt(e.pct)}</td></tr>`;
    }).join('');
    sections += `<h3 style="margin:24px 0 8px;font-size:16px;color:#0f2a3d">${LABELS[kind][1]} ${LABELS[kind][0]} (${group.length})</h3>` +
      `<table width="100%" cellspacing="0" style="border-collapse:collapse"><tr style="color:#5b6b7a;font-size:12px;text-align:left"><th style="padding:6px 8px">Producto</th><th style="padding:6px 8px;text-align:right">Antes / tu precio</th><th style="padding:6px 8px;text-align:right">Ahora</th><th style="padding:6px 8px;text-align:right">Cambio</th></tr>${rows}</table>`;
  }
  const errorBox = errors.length ? `<p style="margin-top:24px;padding:12px;background:#fef3f2;border-radius:8px;color:#b42318"><b>No he podido revisar:</b><br>${errors.map(esc).join('<br>')}</p>` : '';
  const fechaTxt = fecha.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'full', timeStyle: 'short' });
  const intro = bienvenida
    ? `<p style="font-size:15px">✅ Ya estamos vigilando <b>${plural(bienvenida.productos, 'producto', 'productos')}</b> en ${plural(bienvenida.webs, 'enlace', 'enlaces')}. A partir de ahora recibirás un aviso cuando cambie algo importante.</p>`
    : `<table width="100%" cellspacing="0" style="margin-top:12px"><tr>${tiles}</tr></table>${sections || '<p style="color:#5b6b7a">Sin cambios desde la última revisión.</p>'}`;
  const html = `<!doctype html><html><body style="margin:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif;color:#1d2939">
<table width="100%" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="640" cellspacing="0" style="background:#fff;border-radius:12px"><tr><td style="padding:28px">
<div style="font-size:12px;letter-spacing:.08em;color:#5b6b7a;text-transform:uppercase">Denoro · Monitor de precios</div>
<h2 style="margin:4px 0;font-size:22px;color:#0f2a3d">${esc(cliente.nombre)}</h2>
<div style="color:#5b6b7a;font-size:13px">${esc(fechaTxt)}${demo ? ' · <b>prueba</b>' : ''}</div>
${intro}${errorBox}
<p style="margin-top:28px;font-size:12px;color:#98a2b3">Puedes cambiar qué vigilas desde tu panel de Denoro.${stats.productos ? ' Adjunto: precios actuales (CSV).' : ''}</p>
</td></tr></table></td></tr></table></body></html>`;
  const asunto = bienvenida ? `✅ Denoro · Vigilancia activada (${plural(bienvenida.productos, 'producto', 'productos')})`
    : events.length ? `Denoro · ${plural(events.length, 'cambio', 'cambios')} en tu competencia`
    : `⚠️ Denoro · No he podido revisar ${plural(errors.length, 'enlace', 'enlaces')}`;
  return { telegram: tg, email_html: html, asunto };
}

function csvOf(products, fecha) {
  const cell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const num = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  return '﻿' + [['fecha', 'vigilancia', 'producto', 'precio', 'precio_sin_rebaja', 'moneda', 'en_stock', 'url'].join(';')]
    .concat(products.map((p) => [fecha.toISOString(), p.watch, p.name, num(p.price), num(p.regular), p.currency, p.stock === null || p.stock === undefined ? '' : p.stock ? 'sí' : 'no', p.url].map(cell).join(';')))
    .join('\n');
}
