// Formatea el error de cualquier workflow que tenga este como "Error workflow"
const e = $input.first().json;
const exec = e.execution || {};
const wf = e.workflow || {};
const err = exec.error || e.trigger?.error || {};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const when = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
const node = exec.lastNodeExecuted || err.node?.name || 'desconocido';
const msg = (err.message || 'Error sin mensaje').slice(0, 500);
const text = `🚨 <b>Fallo en un workflow</b>\n` +
  `<b>Workflow:</b> ${esc(wf.name || wf.id || '¿?')}\n` +
  `<b>Nodo:</b> ${esc(node)}\n` +
  `<b>Error:</b> ${esc(msg)}\n` +
  `<b>Cuándo:</b> ${when}` + (exec.url ? `\n<a href="${esc(exec.url)}">Ver ejecución</a>` : '');
const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
<h2 style="color:#8f2f24;margin:0 0 12px">Fallo en «${esc(wf.name || wf.id)}»</h2>
<p><b>Nodo:</b> ${esc(node)}<br><b>Error:</b> ${esc(msg)}<br><b>Cuándo:</b> ${when}</p>
${exec.url ? `<p><a href="${esc(exec.url)}">Abrir la ejecución en n8n</a></p>` : ''}
${err.stack ? `<pre style="background:#f4f3ef;padding:12px;font-size:11px;white-space:pre-wrap">${esc(String(err.stack).slice(0, 1500))}</pre>` : ''}
</div>`;
return [{ json: { telegram: text, asunto: `⚠️ Denoro · Error en ${wf.name || 'un workflow'}`, email_html: html } }];
