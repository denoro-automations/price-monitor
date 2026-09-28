// Anota en denoro_estado las ejecuciones que han fallado o no se han podido lanzar
// (las que van bien las anota la propia automatización).
const pendientes = $('Automatizaciones pendientes').all().map((i) => i.json);
const texto = (e) => String(e?.message || e?.description || e || '').replace(/\s+/g, ' ').trim().slice(0, 240);
const fila = (p, error) => ({ json: { clave: p.clave, token: p.token, snapshot: '',
  resumen: JSON.stringify({ ultima: new Date().toISOString(), ok: false, error: error || 'Error desconocido', modo: p.modo || null, origen: 'planificador' }) } });
const filas = [];
$input.all().forEach((it, i) => {
  const j = it.json || {};
  if (j.saltar) { filas.push(fila(j, j.error)); return; }          // llegó por «no se puede ejecutar»
  if (!j.error) return;                                           // ejecución correcta
  const pi = Array.isArray(it.pairedItem) ? it.pairedItem[0] : it.pairedItem;
  const lanzables = pendientes.filter((x) => !x.saltar);
  const p = lanzables[typeof pi?.item === 'number' ? pi.item : i];
  if (p?.clave) filas.push(fila(p, texto(j.error)));
});
return filas;
