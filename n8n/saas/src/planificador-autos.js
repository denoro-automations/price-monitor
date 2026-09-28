// Cada 30 minutos: qué automatizaciones toca ejecutar, cliente a cliente. Devuelve un item por ejecución.
const EMAIL_FROM = '__EMAIL_FROM__';
const WORKFLOWS = { fichas: '__WF_FICHAS__', stock: '__WF_STOCK__', carritos: '__WF_CARRITOS__', resenas: '__WF_RESENAS__', facturas: '__WF_FACTURAS__', informe: '__WF_INFORME__' };
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
const clientes = $('Leer clientes').all().map((i) => i.json).filter((r) => r && r.token);
const estados = Object.fromEntries($('Leer estado').all().map((i) => i.json).filter((r) => r && r.clave).map((r) => [r.clave, parse(r.resumen, {})]));
const ahora = Date.now();
const out = [];
for (const c of clientes) {
  if (!c.activo || (!c.email && !c.telegram_chat_id)) continue;
  const cfg = parse(c.config, {});
  if (!cfg.servicios) continue;
  for (const p of ejecucionesPendientes(ahora, c.token, cfg.servicios, estados)) {
    const wf = WORKFLOWS[p.auto];
    if (!wf || wf.startsWith('__')) continue;
    const aj = cfg.servicios[p.auto].ajustes || {};
    const val = limpiarAjustes(p.auto, {}, aj, Array.isArray(cfg.conexiones) ? cfg.conexiones : []);
    if (!val.ok) {   // ajustes que ya no valen (p. ej. se quitó una conexión): se anota y no se ejecuta
      out.push({ json: { workflow_id: '', saltar: true, clave: p.clave, token: c.token, error: val.error, modo: p.modo } });
      continue;
    }
    out.push({ json: { workflow_id: wf, saltar: false, ...entradaAutomatizacion(c, p.auto, val.ajustes, p.modo, p.clave, EMAIL_FROM) } });
  }
}
return out;
