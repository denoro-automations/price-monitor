// Resume cómo ha ido el envío de prueba para enseñarlo en el panel
const req = $('Procesar petición').first().json;
const tg = $('Prueba Telegram').first()?.json || {};
const em = $('Prueba email').first()?.json || {};
const partes = [];
const fallos = [];
if (req.enviar_telegram) {
  if (tg.error) fallos.push(`Telegram: ${/chat not found/i.test(JSON.stringify(tg.error)) ? 'no encontramos tu chat. Abre el bot y pulsa Iniciar, y revisa el chat ID.' : (tg.error.message || tg.error)}`);
  else partes.push('Telegram');
}
if (req.enviar_email) {
  if (em.error) fallos.push(`Email: ${em.error.message || em.error}`);
  else partes.push('email');
}
const ok = !fallos.length && partes.length > 0;
return [{ json: { status: ok ? 200 : 502, respuesta: ok
  ? { ok: true, mensaje: `Prueba enviada por ${partes.join(' y ')}. Revisa que te haya llegado.` }
  : { ok: false, error: fallos.join(' ') || 'No hay ningún canal configurado' } } }];
