// API del panel: una sola ruta POST con { token | admin_key, accion, ... }
const http = (o) => this.helpers.httpRequest(o);
const ADMIN_KEY = '__ADMIN_KEY__';
const PANEL_URL = '__PANEL_URL__';          // p. ej. https://tu-dominio/webhook/denoro/panel
const body = $('API').first().json.body || {};
const clientes = $('Leer clientes').all().map((i) => i.json).filter((r) => r && r.token);
const estados = $('Leer estado').all().map((i) => i.json).filter((r) => r && r.clave);
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
const reply = (status, data, extra = {}) => [{ json: { siguiente: 'responder', status, respuesta: data, ...extra } }];
const fail = (status, error) => reply(status, { ok: false, error });
const accion = String(body.accion || '');
const emailOk = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const chatOk = (c) => !c || /^-?\d{5,15}$/.test(String(c));
const cleanText = (s, n = 80) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const DEFAULTS = { vigilancias: [], umbral_pct: 1, avisar_nuevos: true, avisar_retirados: true, avisar_stock: true, frecuencia_horas: 6, max_vigilancias: 10 };

function vistaCliente(c) {
  const cfg = { ...DEFAULTS, ...parse(c.config, {}) };
  const est = Object.fromEntries(estados.filter((e) => e.token === c.token).map((e) => [e.clave.split(':')[1], parse(e.resumen, {})]));
  return {
    ok: true,
    cliente: { nombre: c.nombre, email: c.email || '', telegram_chat_id: c.telegram_chat_id || '', activo: Boolean(c.activo) },
    ajustes: { umbral_pct: cfg.umbral_pct, avisar_nuevos: cfg.avisar_nuevos, avisar_retirados: cfg.avisar_retirados,
               avisar_stock: cfg.avisar_stock, frecuencia_horas: cfg.frecuencia_horas, max_vigilancias: cfg.max_vigilancias },
    vigilancias: cfg.vigilancias.map((w) => ({ ...w, estado: est[w.id] || null })),
    resumen: est.__cliente || null,
  };
}
const guardar = (c, cfg, respuesta) => [{ json: {
  siguiente: 'guardar', status: 200,
  fila: { token: c.token, nombre: c.nombre, email: c.email || '', telegram_chat_id: String(c.telegram_chat_id || ''), activo: Boolean(c.activo), config: JSON.stringify(cfg) },
  respuesta,
} }];

async function handle() {
// ------------------------------------------------------------------ admin
if (accion.startsWith('admin_')) {
  if (!body.admin_key || body.admin_key !== ADMIN_KEY) return fail(401, 'Clave de administrador incorrecta');
  if (accion === 'admin_listar') {
    return reply(200, { ok: true, panel_url: PANEL_URL, clientes: clientes.map((c) => {
      const v = vistaCliente(c);
      return { token: c.token, nombre: c.nombre, email: c.email, telegram_chat_id: c.telegram_chat_id, activo: Boolean(c.activo),
               vigilancias: v.vigilancias.length, max_vigilancias: v.ajustes.max_vigilancias, frecuencia_horas: v.ajustes.frecuencia_horas,
               ultima: v.resumen?.ultima || null, errores: v.resumen?.con_error ?? v.vigilancias.filter((w) => w.estado?.fallos > 0).length, creado: c.createdAt };
    }) });
  }
  if (accion === 'admin_crear') {
    const nombre = cleanText(body.nombre);
    if (!nombre) return fail(400, 'Pon el nombre del cliente o de su tienda');
    if (!emailOk(body.email)) return fail(400, 'El email no es válido');
    if (!chatOk(body.telegram_chat_id)) return fail(400, 'El chat ID de Telegram debe ser un número');
    if (clientes.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) return fail(409, 'Ya existe un cliente con ese nombre');
    const token = newToken();
    const max = Math.min(Math.max(Number(body.max_vigilancias) || 10, 1), 200);
    const c = { token, nombre, email: String(body.email || '').trim(), telegram_chat_id: String(body.telegram_chat_id || '').trim(), activo: true };
    return guardar(c, { ...DEFAULTS, max_vigilancias: max, frecuencia_horas: [1, 3, 6, 12, 24].includes(Number(body.frecuencia_horas)) ? Number(body.frecuencia_horas) : 6 },
      { ok: true, token, panel: `${PANEL_URL}?t=${token}` });
  }
  const c = clientes.find((x) => x.token === body.token);
  if (!c) return fail(404, 'Cliente no encontrado');
  if (accion === 'admin_actualizar') {
    const cfg = { ...DEFAULTS, ...parse(c.config, {}) };
    if (body.max_vigilancias !== undefined) cfg.max_vigilancias = Math.min(Math.max(Number(body.max_vigilancias) || 1, 1), 200);
    if (body.activo !== undefined) c.activo = Boolean(body.activo);
    if (body.nombre !== undefined && cleanText(body.nombre)) c.nombre = cleanText(body.nombre);
    return guardar(c, cfg, { ok: true });
  }
  return fail(400, 'Acción de administrador desconocida');
}

// ------------------------------------------------------------------ cliente
const c = clientes.find((x) => x.token && x.token === String(body.token || ''));
if (!c) return fail(401, 'Este enlace no es válido. Pide a Denoro tu enlace de acceso.');
if (!c.activo) return fail(403, 'Tu cuenta está pausada. Escríbeme para reactivarla.');
const cfg = { ...DEFAULTS, ...parse(c.config, {}) };

if (accion === 'estado') return reply(200, vistaCliente(c));

if (accion === 'detectar') {
  const url = String(body.url || '').slice(0, 500);
  if (cfg.vigilancias.some((w) => splitUrl(w.url)?.href === splitUrl(url)?.href)) return fail(409, 'Ya estás vigilando ese enlace');
  const d = await detectWatch(http, url);
  return reply(d.ok ? 200 : 422, d);
}

if (accion === 'guardar_vigilancia') {
  if (cfg.vigilancias.length >= cfg.max_vigilancias) return fail(403, `Tu plan permite ${cfg.max_vigilancias} enlaces. Escríbeme para ampliarlo.`);
  const d = await detectWatch(http, String(body.url || '').slice(0, 500));
  if (!d.ok) return reply(422, d);
  if (cfg.vigilancias.some((w) => w.url === d.url)) return fail(409, 'Ya estás vigilando ese enlace');
  const miPrecio = body.mi_precio === '' || body.mi_precio === undefined || body.mi_precio === null ? null : parsePrice(body.mi_precio);
  const w = { id: newId(), url: d.url, tipo: d.tipo, nombre: cleanText(body.nombre) || d.nombre, moneda: d.moneda || '',
              mi_precio: d.tipo.endsWith('tienda') ? null : miPrecio, tolerancia_pct: Math.min(Math.max(Number(body.tolerancia_pct) || 0, 0), 50),
              añadido: new Date().toISOString(), ...(d.slug ? { slug: d.slug } : {}) };
  cfg.vigilancias.push(w);
  return guardar(c, cfg, { ok: true, vigilancia: w, mensaje: 'Guardado. En la próxima revisión tomaremos los precios de referencia.' });
}

if (accion === 'editar_vigilancia') {
  const w = cfg.vigilancias.find((x) => x.id === body.id);
  if (!w) return fail(404, 'No encuentro esa vigilancia');
  if (body.nombre !== undefined) w.nombre = cleanText(body.nombre) || w.nombre;
  if (body.mi_precio !== undefined && !w.tipo.endsWith('tienda')) w.mi_precio = body.mi_precio === '' || body.mi_precio === null ? null : parsePrice(body.mi_precio);
  if (body.tolerancia_pct !== undefined) w.tolerancia_pct = Math.min(Math.max(Number(body.tolerancia_pct) || 0, 0), 50);
  return guardar(c, cfg, { ok: true, vigilancia: w });
}

if (accion === 'borrar_vigilancia') {
  const before = cfg.vigilancias.length;
  cfg.vigilancias = cfg.vigilancias.filter((x) => x.id !== body.id);
  if (cfg.vigilancias.length === before) return fail(404, 'No encuentro esa vigilancia');
  return guardar(c, cfg, { ok: true });
}

if (accion === 'ajustes') {
  const email = String(body.email ?? c.email ?? '').trim();
  const chat = String(body.telegram_chat_id ?? c.telegram_chat_id ?? '').trim();
  if (!emailOk(email)) return fail(400, 'El email no es válido');
  if (!chatOk(chat)) return fail(400, 'El chat ID de Telegram debe ser un número (te lo da @userinfobot)');
  if (!email && !chat) return fail(400, 'Necesitamos al menos un email o un chat de Telegram para avisarte');
  c.email = email; c.telegram_chat_id = chat;
  if (body.umbral_pct !== undefined) cfg.umbral_pct = Math.min(Math.max(Number(body.umbral_pct) || 0, 0), 50);
  for (const k of ['avisar_nuevos', 'avisar_retirados', 'avisar_stock']) if (body[k] !== undefined) cfg[k] = Boolean(body[k]);
  if (body.frecuencia_horas !== undefined && [1, 3, 6, 12, 24].includes(Number(body.frecuencia_horas))) cfg.frecuencia_horas = Number(body.frecuencia_horas);
  return guardar(c, cfg, { ok: true });
}

if (accion === 'probar_aviso') {
  const m = buildMessages({ cliente: c, events: [], errors: [], stats: { productos: 0 }, bienvenida: null });
  return [{ json: { siguiente: 'probar', status: 200, token: c.token,
    telegram_chat_id: c.telegram_chat_id || '', email_to: c.email || '', email_from: '__EMAIL_FROM__',
    enviar_telegram: Boolean(c.telegram_chat_id), enviar_email: Boolean(c.email),
    telegram: `<b>Denoro · ${esc(c.nombre)}</b>\n🔔 Aviso de prueba: así te llegarán los cambios de tu competencia.`,
    asunto: '🔔 Denoro · Aviso de prueba', email_html: m.email_html.replace('Sin cambios desde la última revisión.', '🔔 Aviso de prueba: así te llegarán los cambios de tu competencia.'),
  } }];
}

if (accion === 'revisar_ahora') {
  if (!cfg.vigilancias.length) return fail(400, 'Añade al menos un enlace antes de revisar');
  const last = parse(estados.find((e) => e.clave === `${c.token}:__cliente`)?.resumen, {}).ultima;
  if (last && Date.now() - new Date(last).getTime() < 2 * 60000) return fail(429, 'Acabamos de revisar. Espera un par de minutos.');
  return [{ json: { siguiente: 'revisar', status: 200, token: c.token } }];
}

return fail(400, 'Acción desconocida');
}

try {
  return await handle();
} catch (e) {
  return fail(502, `No hemos podido completar la operación: ${String(e.message || e).slice(0, 160)}`);
}
