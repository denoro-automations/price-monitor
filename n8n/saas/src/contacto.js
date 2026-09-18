// Solicitud de presupuesto enviada desde la web de Denoro
const raw = $('Solicitud de la web').first().json;
const body = typeof raw.body === 'string' ? JSON.parse(raw.body || '{}') : (raw.body || {});
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (s, n = 500) => String(s ?? '').trim().slice(0, n);
const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(body.email || ''));

if (body.empresa_web) return [{ json: { status: 200, respuesta: { ok: true } } }];   // bot
if (!clean(body.nombre) || !emailOk || !clean(body.competidores)) {
  return [{ json: { status: 400, enviar: false, respuesta: { ok: false, error: 'Faltan datos obligatorios' } } }];
}
const d = {
  nombre: clean(body.nombre, 100), email: clean(body.email, 120), tienda: clean(body.tienda, 200),
  competidores: clean(body.competidores, 2000), productos: clean(body.productos, 40),
  paquete: clean(body.paquete, 40), mensaje: clean(body.mensaje, 2000),
  idioma: clean(body.idioma, 5), origen: clean(body.origen, 200),
};
const enlaces = d.competidores.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
const telegram = `💰 <b>Nueva solicitud de presupuesto</b>\n` +
  `<b>${esc(d.nombre)}</b> · ${esc(d.email)}\n` +
  (d.tienda ? `Tienda: ${esc(d.tienda)}\n` : '') +
  `Paquete: ${esc(d.paquete || '—')} · Productos: ${esc(d.productos || '—')} · Idioma: ${esc(d.idioma || 'es')}\n` +
  `\n<b>Webs a vigilar (${enlaces.length})</b>\n` + enlaces.slice(0, 10).map((x) => '• ' + esc(x)).join('\n') +
  (d.mensaje ? `\n\n<b>Mensaje</b>\n${esc(d.mensaje.slice(0, 600))}` : '');
const html = `<div style="font-family:Arial,sans-serif;max-width:620px;color:#35322c">
<h2 style="color:#191713;margin:0 0 12px">Nueva solicitud de presupuesto</h2>
<p><b>${esc(d.nombre)}</b> · <a href="mailto:${esc(d.email)}">${esc(d.email)}</a>${d.tienda ? ` · <a href="${esc(d.tienda)}">${esc(d.tienda)}</a>` : ''}</p>
<p>Paquete: <b>${esc(d.paquete || '—')}</b> · Productos: ${esc(d.productos || '—')} · Idioma: ${esc(d.idioma || 'es')}</p>
<h3 style="font-size:15px;margin:18px 0 6px">Webs a vigilar</h3>
<ul>${enlaces.map((x) => `<li><a href="${esc(x)}">${esc(x)}</a></li>`).join('')}</ul>
${d.mensaje ? `<h3 style="font-size:15px;margin:18px 0 6px">Mensaje</h3><p style="white-space:pre-wrap">${esc(d.mensaje)}</p>` : ''}
<p style="margin-top:18px;font-size:12px;color:#8a857a">Enviado desde ${esc(d.origen || 'la web')} el ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p></div>`;
return [{ json: {
  status: 200, enviar: true, ...d,
  telegram, email_html: html, asunto: `💰 Presupuesto · ${d.nombre}${d.tienda ? ' (' + d.tienda + ')' : ''}`,
  respuesta: { ok: true },
} }];
