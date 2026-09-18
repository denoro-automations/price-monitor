// Decide qué clientes toca revisar ahora (según su frecuencia) y devuelve uno por item.
const clientes = $('Leer clientes').all().map((i) => i.json).filter((r) => r && r.token);
const resumenes = Object.fromEntries($('Leer resúmenes').all().map((i) => i.json)
  .filter((r) => r && r.clave && r.clave.endsWith(':__cliente')).map((r) => [r.token, r.resumen]));
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
const now = Date.now();
const due = [];
for (const c of clientes) {
  if (!c.activo) continue;
  const cfg = parse(c.config, {});
  if (!(cfg.vigilancias || []).length) continue;
  if (!c.email && !c.telegram_chat_id) continue;
  const horas = [1, 3, 6, 12, 24].includes(Number(cfg.frecuencia_horas)) ? Number(cfg.frecuencia_horas) : 6;
  const ultima = parse(resumenes[c.token], {}).ultima;
  // margen de 5 minutos para que "cada hora" no se salte ejecuciones
  if (!ultima || now - new Date(ultima).getTime() >= horas * 3600000 - 5 * 60000) due.push({ json: { token: c.token } });
}
return due;
