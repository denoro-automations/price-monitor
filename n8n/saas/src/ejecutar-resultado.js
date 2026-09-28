// Tras ejecutar una automatización desde el panel. Si ha ido bien, el propio workflow
// ya ha guardado su resultado; si ha fallado, lo guardamos aquí para enseñarlo en el panel.
const req = $('Procesar petición').first().json;
const out = $input.all().map((i) => i.json || {});
const fallo = out.find((x) => x && x.error);
const texto = (e) => String(e?.message || e?.description || e || '').replace(/\s+/g, ' ').trim();
const amable = (m) => {
  if (/credential/i.test(m)) return 'Falta conectar la cuenta de tu tienda en el servidor. Escríbeme y lo dejo hecho.';
  if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|timeout|ETIMEDOUT/i.test(m)) return 'No se pudo conectar con la dirección que has puesto. Comprueba que el enlace abre en el navegador.';
  if (/404|Not Found/i.test(m)) return 'La dirección que has puesto no existe (error 404). Revisa el enlace.';
  if (/401|403|Forbidden|Unauthorized/i.test(m)) return 'La web ha rechazado la consulta (sin permiso). Revisa el enlace o las claves de acceso.';
  return m.slice(0, 240) || 'Error desconocido';
};
if (fallo) {
  const m = amable(texto(fallo.error));
  return [{ json: { fallo: true, status: 200,
    fila: { clave: req.clave, token: req.token, snapshot: '', resumen: JSON.stringify({ ultima: new Date().toISOString(), ok: false, error: m, modo: req.modo || null, origen: 'panel' }) },
    respuesta: { ok: false, error: `No ha podido terminar: ${m}` } } }];
}
return [{ json: { fallo: false, status: 200, respuesta: { ok: true, mensaje: 'Hecho. Tienes el resultado abajo y en tu email o Telegram.' } } }];
