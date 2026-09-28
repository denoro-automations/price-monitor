// (Se añade a cada automatización en su versión «para un cliente»)
// Guarda en denoro_estado lo que ha pasado en esta ejecución, para enseñarlo en el panel.
const d = $input.first()?.json || {};
const cfg = $('Configuración').first().json;
const txt = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const titulo = txt(d.asunto).replace(/^[^\p{L}\p{N}]*Denoro · /u, '').replace(/^[^\p{L}\p{N}]+/u, '');
return [{ json: {
  clave: cfg.__clave, token: cfg.__token, snapshot: '',
  resumen: JSON.stringify({
    ultima: new Date().toISOString(), ok: true, modo: cfg.modo || null,
    titulo: (titulo || __SIN_NOVEDAD__).slice(0, 200),
    texto: txt(d.telegram).slice(0, 1500),
    avisado: Boolean(d.asunto && (d.enviar_email || d.enviar_telegram)),
    demo: [cfg.fuente, cfg.destino].includes('demo'),
  }),
} }];
