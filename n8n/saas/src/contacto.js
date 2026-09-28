// Solicitud de presupuesto enviada desde la web de Denoro
// Acepta el formulario nuevo (automatizacion + detalle + plan) y el antiguo (competidores + mensaje + paquete).
const raw = $('Solicitud de la web').first().json;
const body = typeof raw.body === 'string' ? JSON.parse(raw.body || '{}') : (raw.body || {});
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (s, n = 500) => String(s ?? '').trim().slice(0, n);
const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(body.email || ''));

const AUTOS = {
  monitor: 'Monitor de precios y stock', stock: 'Stock del proveedor', facturas: 'Facturas y albaranes',
  carritos: 'Carritos abandonados', resenas: 'Vigilancia de reseñas', fichas: 'Fichas de producto',
  informe: 'Informe semanal', varias: 'Varias', otra: 'Otra cosa / no lo sabe',
};
const PLANES = { basico: 'Básico · 149 €', estandar: 'Estándar · 349 €', premium: 'Premium · 599 €', ns: 'Que se lo recomiende' };

if (body.empresa_web) return [{ json: { status: 200, respuesta: { ok: true } } }];   // bot
const detalle = clean(body.detalle || body.competidores, 2000);
if (!clean(body.nombre) || !emailOk || !detalle) {
  return [{ json: { status: 400, enviar: false, respuesta: { ok: false, error: 'Faltan datos obligatorios' } } }];
}
const autoId = clean(body.automatizacion, 20);
const planId = clean(body.plan || body.paquete, 40);
const d = {
  nombre: clean(body.nombre, 100), email: clean(body.email, 120), tienda: clean(body.tienda, 200),
  automatizacion: AUTOS[autoId] || (autoId ? autoId : ''),
  detalle, productos: clean(body.productos, 40),
  paquete: PLANES[planId] || planId, mensaje: clean(body.mensaje, 2000),
  idioma: clean(body.idioma, 5), origen: clean(body.origen, 200),
};
// compatibilidad: el campo del que vivía el formulario antiguo
d.competidores = d.detalle;
const enlaces = [...new Set(d.detalle.match(/https?:\/\/[^\s,<>"]+/g) || [])];
const titulo = d.automatizacion ? `${d.automatizacion}` : 'Presupuesto';
const telegram = `💰 <b>Nueva solicitud · ${esc(titulo)}</b>\n` +
  `<b>${esc(d.nombre)}</b> · ${esc(d.email)}\n` +
  (d.tienda ? `Tienda: ${esc(d.tienda)}\n` : '') +
  `Paquete: ${esc(d.paquete || '—')} · Productos: ${esc(d.productos || '—')} · Idioma: ${esc(d.idioma || 'es')}\n` +
  `\n<b>Qué necesita</b>\n${esc(d.detalle.slice(0, 900))}` +
  (enlaces.length ? `\n\n<b>Enlaces (${enlaces.length})</b>\n` + enlaces.slice(0, 10).map((x) => '• ' + esc(x)).join('\n') : '') +
  (d.mensaje ? `\n\n<b>Mensaje</b>\n${esc(d.mensaje.slice(0, 600))}` : '');
const html = `<div style="font-family:Arial,sans-serif;max-width:620px;color:#35322c">
<h2 style="color:#191713;margin:0 0 12px">Nueva solicitud de presupuesto</h2>
<p><b>${esc(d.nombre)}</b> · <a href="mailto:${esc(d.email)}">${esc(d.email)}</a>${d.tienda ? ` · <a href="${esc(d.tienda)}">${esc(d.tienda)}</a>` : ''}</p>
<p>Le interesa: <b>${esc(d.automatizacion || '—')}</b><br>Paquete: <b>${esc(d.paquete || '—')}</b> · Productos: ${esc(d.productos || '—')} · Idioma: ${esc(d.idioma || 'es')}</p>
<h3 style="font-size:15px;margin:18px 0 6px">Qué necesita</h3><p style="white-space:pre-wrap">${esc(d.detalle)}</p>
${enlaces.length ? `<h3 style="font-size:15px;margin:18px 0 6px">Enlaces</h3><ul>${enlaces.map((x) => `<li><a href="${esc(x)}">${esc(x)}</a></li>`).join('')}</ul>` : ''}
${d.mensaje ? `<h3 style="font-size:15px;margin:18px 0 6px">Mensaje</h3><p style="white-space:pre-wrap">${esc(d.mensaje)}</p>` : ''}
<p style="margin-top:18px;font-size:12px;color:#8a857a">Enviado desde ${esc(d.origen || 'la web')} el ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p></div>`;
return [{ json: {
  status: 200, enviar: true, ...d,
  telegram, email_html: html,
  asunto: `💰 Presupuesto${d.automatizacion ? ' · ' + d.automatizacion : ''} · ${d.nombre}${d.tienda ? ' (' + d.tienda + ')' : ''}`,
  respuesta: { ok: true },
} }];
