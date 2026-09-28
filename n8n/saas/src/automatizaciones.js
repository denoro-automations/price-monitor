// Catálogo de automatizaciones del panel único de Denoro.
// Lo usan la API (validar lo que guarda el cliente), el planificador (qué toca ejecutar)
// y los dos paneles (pintar los formularios). No usa nada de n8n: corre igual en el navegador.

const CONEXIONES = { shopify: 'Shopify', woocommerce: 'WooCommerce', openai: 'OpenAI' };
const MONEDAS = [['EUR', 'Euro (€)'], ['USD', 'Dólar ($)'], ['GBP', 'Libra (£)']];
const NECESITA = (x) => ({ conexion: x });

const AUTOS = [
  {
    id: 'fichas', corto: 'Fichas de producto', nombre: 'Fichas de producto en bloque', cat: 'Contenido',
    resumen: 'Le das el catálogo y devuelve títulos SEO, meta descripciones y fichas en HTML listas para importar. Sin inventarse nada: lo que no está en los datos se marca para que lo revises.',
    cada: { tipo: 'semanal', dia: 1, hora: 9, opcional: true, texto: 'Los lunes a las 9:00' },
    campos: [
      { g: 'Catálogo' },
      { k: 'fuente', t: 'select', label: 'De dónde saco los productos', def: 'demo',
        opts: [['demo', 'Catálogo de ejemplo (para probar)'], ['csv', 'Un CSV con mi catálogo'], ['shopify', 'Mi tienda Shopify', NECESITA('shopify')], ['woocommerce', 'Mi tienda WooCommerce', NECESITA('woocommerce')]] },
      { k: 'csv_url', t: 'url', label: 'Enlace directo al CSV', hint: 'Por ejemplo, el enlace de descarga de una hoja de Google publicada como CSV.', show: { fuente: ['csv'] }, req: true },
      { k: 'dominio_tienda', t: 'text', label: 'Dominio de Shopify', hint: 'tu-tienda.myshopify.com, para enlazar cada ficha.', show: { fuente: ['shopify'] }, max: 120 },
      { k: 'moneda', t: 'select', label: 'Moneda', def: 'EUR', opts: MONEDAS },
      { g: 'Cómo escribo' },
      { k: 'idioma', t: 'select', label: 'Idioma', def: 'es', opts: [['es', 'Español'], ['en', 'Inglés']] },
      { k: 'tono', t: 'select', label: 'Tono', def: 'cercano', opts: [['cercano', 'Cercano'], ['tecnico', 'Técnico'], ['premium', 'Premium']] },
      { k: 'motor', t: 'select', label: 'Quién escribe', def: 'plantilla', opts: [['plantilla', 'Plantilla (sin coste)'], ['openai', 'IA con tu clave de OpenAI', NECESITA('openai')]] },
      { k: 'palabras_clave_extra', t: 'lista', label: 'Palabras clave extra', hint: 'Separadas por comas. Ej.: envío 24h, hecho en España', max: 10 },
      { k: 'largo_titulo', t: 'number', label: 'Título SEO, máx. caracteres', def: 60, min: 30, max: 70 },
      { k: 'largo_meta', t: 'number', label: 'Meta descripción, máx. caracteres', def: 155, min: 70, max: 160 },
      { g: 'Qué productos' },
      { k: 'solo_sin_descripcion', t: 'bool', label: 'Solo los productos sin descripción (o con una muy corta)', def: true },
      { k: 'max_productos', t: 'number', label: 'Máximo de productos por pasada', def: 50, min: 1, max: 500 },
    ],
  },
  {
    id: 'stock', corto: 'Stock', nombre: 'Stock del proveedor', cat: 'Inventario',
    resumen: 'Lee el feed de tu proveedor y ajusta las existencias de la tienda. Si el feed llega roto, se para y te avisa en vez de vaciarte el catálogo.',
    cada: { tipo: 'horas', def: 4, opts: [1, 2, 4, 6, 12, 24] },
    campos: [
      { g: 'Proveedor' },
      { k: 'proveedor', t: 'text', label: 'Nombre del proveedor', def: '', max: 80 },
      { k: 'fuente', t: 'select', label: 'Feed del proveedor', def: 'demo', opts: [['demo', 'Feed de ejemplo (para probar)'], ['url', 'Enlace al CSV o XML del proveedor']] },
      { k: 'feed_url', t: 'url', label: 'Enlace al feed', show: { fuente: ['url'] }, req: true },
      { g: 'Tu tienda' },
      { k: 'destino', t: 'select', label: 'Tienda que actualizo', def: 'demo', opts: [['demo', 'Tienda de ejemplo (para probar)'], ['shopify', 'Mi tienda Shopify', NECESITA('shopify')], ['woocommerce', 'Mi tienda WooCommerce', NECESITA('woocommerce')]] },
      { k: 'dominio_shopify', t: 'text', label: 'Dominio de Shopify', hint: 'tu-tienda.myshopify.com', show: { destino: ['shopify'] }, max: 120 },
      { k: 'location_id', t: 'text', label: 'ID del almacén en Shopify', show: { destino: ['shopify'] }, max: 40 },
      { k: 'modo_prueba', t: 'bool', label: 'Modo prueba: calcula los cambios y te los manda, pero no toca la tienda', def: true },
      { k: 'avisar_cambio_precio_pct', t: 'number', label: 'Avisarme si el proveedor cambia un precio más de (%)', def: 3, min: 0, max: 100 },
      { g: 'Frenos de seguridad' },
      { k: 'min_referencias', t: 'number', label: 'Mínimo de referencias para fiarme del feed', def: 5, min: 1, max: 1000000 },
      { k: 'max_cambios_pct', t: 'number', label: 'Parar si cambiaría más de (% del catálogo)', def: 40, min: 1, max: 100 },
      { k: 'max_agotados_pct', t: 'number', label: 'Parar si agotaría más de (% del catálogo)', def: 25, min: 1, max: 100 },
      { k: 'margen_stock', t: 'number', label: 'Unidades de colchón que resto al stock', def: 0, min: 0, max: 1000 },
    ],
  },
  {
    id: 'carritos', corto: 'Carritos', nombre: 'Carritos abandonados', cat: 'Ventas',
    resumen: 'Una secuencia de avisos al comprador que se quedó a medias, con su carrito y un descuento si toca. Solo a quien dio su consentimiento.',
    cada: { tipo: 'horas', def: 0.5, opts: [0.5, 1, 2, 4] },
    campos: [
      { g: 'Tu tienda' },
      { k: 'web', t: 'url', label: 'Dirección de tu tienda', hint: 'Sale en el botón del email para volver al carrito.', def: '' },
      { k: 'fuente', t: 'select', label: 'De dónde saco los carritos', def: 'demo', opts: [['demo', 'Carritos de ejemplo (para probar)'], ['shopify', 'Mi tienda Shopify', NECESITA('shopify')], ['http', 'Un enlace que devuelve los carritos en JSON']] },
      { k: 'carritos_url', t: 'url', label: 'Enlace a los carritos (JSON)', show: { fuente: ['http'] }, req: true },
      { k: 'dominio_shopify', t: 'text', label: 'Dominio de Shopify', hint: 'tu-tienda.myshopify.com', show: { fuente: ['shopify'] }, max: 120 },
      { g: 'La secuencia de avisos' },
      { k: 'pasos', t: 'pasos', label: 'Avisos', def: [
        { horas: 1, asunto: '¿Te ayudamos a terminar tu pedido?', cupon: '' },
        { horas: 24, asunto: 'Tu carrito sigue esperándote', cupon: '' },
        { horas: 72, asunto: 'Última oportunidad: 10 % en tu carrito', cupon: 'VUELVE10' }] },
      { k: 'horas_limite', t: 'number', label: 'Dar el carrito por perdido a las (horas)', def: 168, min: 2, max: 2000 },
      { k: 'minimo_total', t: 'number', label: 'No escribir por carritos de menos de', def: 10, min: 0, max: 100000 },
      { k: 'max_envios_por_ejecucion', t: 'number', label: 'Máximo de emails por pasada', def: 50, min: 1, max: 500 },
      { g: 'Tu marca en el email' },
      { k: 'marca_color', t: 'color', label: 'Color del botón', def: '#235b54' },
      { k: 'marca_texto_boton', t: 'text', label: 'Texto del botón', def: 'Terminar mi pedido', max: 40 },
      { k: 'email_bajas', t: 'email', label: 'Email para darse de baja', hint: 'Sale en el pie de cada aviso. Si lo dejas vacío uso tu email de avisos.', def: '' },
      { k: 'moneda', t: 'select', label: 'Moneda', def: 'EUR', opts: MONEDAS },
    ],
  },
  {
    id: 'resenas', corto: 'Reseñas', nombre: 'Vigilancia de reseñas', cat: 'Reputación',
    resumen: 'Te avisa el mismo día de cada reseña negativa, que es cuando contestar todavía sirve. Los lunes, un resumen con la nota media y de qué se queja la gente.',
    cada: { tipo: 'horas', def: 2, opts: [1, 2, 4, 6, 12], semanal: { dia: 1, hora: 9, campo: 'resumen_semanal', texto: 'resumen los lunes a las 9:00' } },
    campos: [
      { g: 'De dónde leo las reseñas' },
      { k: 'fuente', t: 'select', label: 'Reseñas', def: 'demo', opts: [['demo', 'Reseñas de ejemplo (para probar)'], ['woocommerce', 'Las de mi tienda WooCommerce', NECESITA('woocommerce')], ['web', 'Una página pública de opiniones']] },
      { k: 'woo_url', t: 'url', label: 'Dirección de tu tienda', show: { fuente: ['woocommerce'] }, req: true },
      { k: 'sitios', t: 'sitios', label: 'Páginas de opiniones', show: { fuente: ['web'] },
        hint: 'Antes de leer cada página compruebo su robots.txt: si no lo permite, no la leo. Los selectores CSS te los preparo yo si me lo pides.' },
      { g: 'Cuándo aviso' },
      { k: 'umbral_negativa', t: 'number', label: 'Cuento como queja una nota de (sobre 5) o menos', def: 3, min: 1, max: 5 },
      { k: 'avisar_solo_nuevas', t: 'bool', label: 'Avisar solo de reseñas que no haya visto antes', def: true },
      { k: 'max_por_aviso', t: 'number', label: 'Máximo de reseñas por aviso', def: 10, min: 1, max: 100 },
      { k: 'resumen_semanal', t: 'bool', label: 'Resumen de la semana los lunes a las 9:00', def: true },
    ],
  },
  {
    id: 'facturas', corto: 'Facturas', nombre: 'Facturas y albaranes', cat: 'Administración',
    resumen: 'Numera, calcula el IVA, genera el PDF y se lo manda al cliente. Un pedido ya facturado no se vuelve a numerar nunca. No es un software certificado Verifactu.',
    cada: { tipo: 'horas', def: 1, opts: [1, 2, 4, 6, 12, 24] },
    campos: [
      { g: 'Quién emite la factura' },
      { k: 'emisor', t: 'obj', label: 'Datos fiscales', hint: 'Salen tal cual en el PDF. Con pedidos de ejemplo puedes dejarlos vacíos.', campos: [
        { k: 'nombre', t: 'text', label: 'Nombre fiscal', max: 100 },
        { k: 'nif', t: 'text', label: 'NIF', max: 12 },
        { k: 'direccion', t: 'text', label: 'Dirección', max: 120 },
        { k: 'cp_poblacion', t: 'text', label: 'Código postal y población', max: 80 },
        { k: 'pais', t: 'text', label: 'País', max: 40 },
        { k: 'email', t: 'email', label: 'Email de facturación' },
        { k: 'telefono', t: 'text', label: 'Teléfono', max: 20 }] },
      { g: 'Pedidos y documentos' },
      { k: 'fuente', t: 'select', label: 'De dónde saco los pedidos', def: 'demo', opts: [['demo', 'Pedidos de ejemplo (para probar)'], ['shopify', 'Mi tienda Shopify', NECESITA('shopify')], ['woocommerce', 'Mi tienda WooCommerce', NECESITA('woocommerce')]] },
      { k: 'documento', t: 'select', label: 'Qué genero', def: 'factura', opts: [['factura', 'Factura'], ['albaran', 'Albarán'], ['ambos', 'Factura y albarán']] },
      { k: 'enviar_al_cliente', t: 'bool', label: 'Enviar la factura al comprador por email', def: true },
      { k: 'max_por_ejecucion', t: 'number', label: 'Máximo de pedidos por pasada', def: 25, min: 1, max: 200 },
      { g: 'Numeración e impuestos' },
      { k: 'serie', t: 'text', label: 'Serie', hint: 'Prefijo del número: F2026-0001', def: 'F', max: 6 },
      { k: 'digitos', t: 'number', label: 'Dígitos del correlativo', def: 4, min: 1, max: 8 },
      { k: 'reiniciar_cada_anio', t: 'bool', label: 'Volver a empezar la numeración cada enero', def: true },
      { k: 'iva', t: 'number', label: 'IVA por defecto (%)', def: 21, min: 0, max: 100 },
      { k: 'precios_con_iva', t: 'bool', label: 'Los precios de mi tienda ya llevan el IVA incluido', def: true },
      { k: 'moneda', t: 'select', label: 'Moneda', def: 'EUR', opts: MONEDAS },
      { k: 'texto_pie', t: 'text', label: 'Texto al pie de la factura', def: 'Gracias por tu compra.', max: 160 },
    ],
  },
  {
    id: 'monitor', corto: 'Precios de la competencia', nombre: 'Monitor de precios y stock', cat: 'Competencia', propio: true,
    resumen: 'Vigila los precios y el stock de las tiendas que le digas y te manda un único resumen cuando cambia algo que te afecta.',
    cada: { tipo: 'monitor', texto: 'De 1 a 24 horas, tú eliges' },
    campos: [],
  },
  {
    id: 'informe', corto: 'Informe semanal', nombre: 'Informe semanal de tu tienda', cat: 'Dirección',
    resumen: 'Los lunes a las ocho, un PDF con las ventas de la semana, los productos que más se mueven y lo que se te va a agotar.',
    cada: { tipo: 'semanal', dia: 1, hora: 8, texto: 'Los lunes a las 8:00' },
    campos: [
      { g: 'Datos de la tienda' },
      { k: 'fuente', t: 'select', label: 'De dónde leo los pedidos', def: 'demo', opts: [['demo', 'Pedidos de ejemplo (para probar)'], ['shopify', 'Mi tienda Shopify', NECESITA('shopify')], ['woocommerce', 'Mi tienda WooCommerce', NECESITA('woocommerce')]] },
      { k: 'moneda', t: 'select', label: 'Moneda', def: 'EUR', opts: MONEDAS },
      { g: 'Qué destaco' },
      { k: 'stock_minimo', t: 'number', label: 'Aviso de poco stock a partir de (unidades)', def: 5, min: 0, max: 100000 },
      { k: 'semanas_cobertura_min', t: 'number', label: '…o si al ritmo actual se agota en menos de (semanas)', def: 2, min: 0, max: 12 },
      { k: 'objetivo_mensual', t: 'number', label: 'Objetivo de ventas del mes (0 para no mostrarlo)', def: 0, min: 0, max: 100000000 },
    ],
  },
];
const AUTO = Object.fromEntries(AUTOS.map((a) => [a.id, a]));

// Campos de un sitio de opiniones (fuente = web en reseñas)
const CAMPOS_SITIO = [['nombre', 'Nombre', 1], ['url', 'Página', 1], ['bloque', 'Selector de cada reseña', 1], ['texto', 'Selector del texto', 1],
  ['puntuacion', 'Selector de la nota'], ['puntuacion_attr', 'Atributo de la nota'], ['autor', 'Selector del autor'], ['fecha', 'Selector de la fecha'], ['fecha_attr', 'Atributo de la fecha']];

function valorPorDefecto(f) {
  if (f.t === 'obj') return Object.fromEntries(f.campos.map((s) => [s.k, s.def ?? '']));
  if (f.t === 'pasos' || f.t === 'sitios' || f.t === 'lista') return JSON.parse(JSON.stringify(f.def || []));
  return f.def ?? (f.t === 'bool' ? false : f.t === 'number' ? 0 : '');
}

function ajustesPorDefecto(id) {
  const a = AUTO[id];
  const r = {};
  for (const f of a.campos) if (f.k) r[f.k] = valorPorDefecto(f);
  if (a.cada.tipo === 'horas') r.cada_horas = a.cada.def;
  if (a.cada.opcional) r.programado = true;
  return r;
}

// ¿Se ve este campo con estos ajustes? (condiciones tipo { fuente: ['csv'] })
const visible = (f, v) => !f.show || Object.entries(f.show).every(([k, vals]) => vals.includes(v[k]));

// Direcciones que no se pueden pedir desde el servidor: evita que un ajuste apunte a la red interna.
function urlPublica(s) {
  let u;
  try { u = new URL(String(s)); } catch (e) { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes('.') || /(^|\.)(localhost|local|internal|lan|home|test)$/.test(h)) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
  if (h.includes(':')) return false; // IPv6 literal
  return true;
}

// Limpia y valida lo que manda el panel. Devuelve { ok, ajustes } o { ok: false, error }.
// conexion: lo que Denoro ha conectado para este cliente ('shopify', 'woocommerce', 'openai').
function limpiarAjustes(id, entrada, previos, conexiones) {
  const a = AUTO[id];
  if (!a || a.propio) return { ok: false, error: 'Automatización desconocida' };
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const r = { ...ajustesPorDefecto(id), ...(previos || {}) };
  const con = new Set(conexiones || []);
  const texto = (v, max = 200) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
  const num = (f, v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    if (!Number.isFinite(n)) return { error: `«${f.label}» tiene que ser un número` };
    if (f.min !== undefined && n < f.min) return { error: `«${f.label}» no puede ser menor que ${f.min}` };
    if (f.max !== undefined && n > f.max) return { error: `«${f.label}» no puede ser mayor que ${f.max}` };
    return { v: n };
  };
  const emailOk = (s) => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  for (const f of a.campos) {
    if (!f.k || !(f.k in e)) continue;
    const v = e[f.k];
    if (f.t === 'text') r[f.k] = texto(v, f.max || 200);
    else if (f.t === 'url') {
      const s = texto(v, 500);
      if (s && !urlPublica(s)) return { ok: false, error: `«${f.label}» tiene que ser una dirección pública que empiece por https://` };
      r[f.k] = s;
    } else if (f.t === 'email') {
      const s = texto(v, 120);
      if (!emailOk(s)) return { ok: false, error: `«${f.label}» no es un email válido` };
      r[f.k] = s;
    } else if (f.t === 'number') {
      const n = num(f, v); if (n.error) return { ok: false, error: n.error }; r[f.k] = n.v;
    } else if (f.t === 'bool') r[f.k] = v === true || v === 'true' || v === 'on';
    else if (f.t === 'color') {
      if (!/^#[0-9a-f]{6}$/i.test(String(v))) return { ok: false, error: `«${f.label}» tiene que ser un color como #235b54` };
      r[f.k] = String(v).toLowerCase();
    } else if (f.t === 'select') {
      const opt = f.opts.find((o) => o[0] === v);
      if (!opt) return { ok: false, error: `Elige una opción válida en «${f.label}»` };
      const need = opt[2]?.conexion;
      if (need && !con.has(need)) return { ok: false, error: `«${opt[1]}» necesita que conecte tu cuenta de ${CONEXIONES[need]}. Escríbeme y lo dejo hecho.` };
      r[f.k] = v;
    } else if (f.t === 'lista') {
      const arr = (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => texto(x, 60)).filter(Boolean);
      r[f.k] = arr.slice(0, f.max || 10);
    } else if (f.t === 'obj') {
      const o = v && typeof v === 'object' ? v : {};
      const out = {};
      for (const s of f.campos) {
        const val = texto(o[s.k], s.max || 120);
        if (s.t === 'email' && !emailOk(val)) return { ok: false, error: `«${s.label}» no es un email válido` };
        out[s.k] = val;
      }
      r[f.k] = out;
    } else if (f.t === 'pasos') {
      const arr = Array.isArray(v) ? v : [];
      const pasos = arr.map((p) => ({ horas: Number(p?.horas), asunto: texto(p?.asunto, 120), cupon: texto(p?.cupon, 30).replace(/\s+/g, '') }))
        .filter((p) => p.asunto || Number.isFinite(p.horas));
      if (!pasos.length) return { ok: false, error: 'Deja al menos un aviso en la secuencia' };
      if (pasos.length > 5) return { ok: false, error: 'Como mucho cinco avisos' };
      for (const [i, p] of pasos.entries()) {
        if (!Number.isFinite(p.horas) || p.horas < 0 || p.horas > 2000) return { ok: false, error: `El aviso ${i + 1} necesita las horas (de 0 a 2000)` };
        if (!p.asunto) return { ok: false, error: `El aviso ${i + 1} necesita un asunto` };
        if (i && p.horas <= pasos[i - 1].horas) return { ok: false, error: `Los avisos van de menos a más horas: el ${i + 1} no puede ir antes que el ${i}` };
      }
      r[f.k] = pasos;
    } else if (f.t === 'sitios') {
      const arr = (Array.isArray(v) ? v : []).slice(0, 5);
      const sitios = [];
      for (const [i, s] of arr.entries()) {
        const o = {};
        for (const [k, , req] of CAMPOS_SITIO) {
          o[k] = texto(s?.[k], k === 'url' ? 500 : 120);
          if (req && !o[k]) return { ok: false, error: `A la página ${i + 1} le falta «${CAMPOS_SITIO.find((c) => c[0] === k)[1]}»` };
        }
        if (!urlPublica(o.url)) return { ok: false, error: `La página ${i + 1} tiene que ser una dirección pública que empiece por https://` };
        for (const k of Object.keys(o)) if (!o[k]) delete o[k];
        sitios.push(o);
      }
      r[f.k] = sitios;
    }
  }
  if (a.cada.tipo === 'horas' && 'cada_horas' in e) {
    const n = Number(e.cada_horas);
    if (!a.cada.opts.includes(n)) return { ok: false, error: 'Elige una frecuencia de la lista' };
    r.cada_horas = n;
  }
  if (a.cada.opcional && 'programado' in e) r.programado = e.programado === true || e.programado === 'true';

  // Requisitos que dependen de otros campos (solo los visibles)
  for (const f of a.campos) {
    if (!f.k || !visible(f, r)) continue;
    if (f.req && !String(r[f.k] ?? '').trim()) return { ok: false, error: `Falta «${f.label}»` };
    if (f.t === 'select') {       // también lo ya guardado: p. ej. si se ha quitado una conexión
      const opt = f.opts.find((o) => o[0] === r[f.k]);
      if (!opt) return { ok: false, error: `Elige una opción válida en «${f.label}»` };
      if (opt[2]?.conexion && !con.has(opt[2].conexion)) return { ok: false, error: `«${opt[1]}» necesita que conecte tu cuenta de ${CONEXIONES[opt[2].conexion]}. Escríbeme y lo dejo hecho.` };
    }
    if (f.t === 'sitios' && !(r[f.k] || []).length) return { ok: false, error: 'Añade al menos una página de opiniones' };
  }
  if (id === 'carritos' && r.horas_limite <= r.pasos[r.pasos.length - 1].horas) {
    return { ok: false, error: 'El carrito se da por perdido después del último aviso: sube las horas límite' };
  }
  if (id === 'facturas' && r.fuente !== 'demo') {
    for (const k of ['nombre', 'nif', 'direccion', 'cp_poblacion']) {
      if (!r.emisor?.[k]) return { ok: false, error: 'Para facturar pedidos reales rellena el nombre fiscal, el NIF y la dirección' };
    }
    if (!/^[A-Z]?\d{7,8}[A-Z0-9]$/i.test(String(r.emisor.nif).replace(/[\s-]/g, ''))) return { ok: false, error: 'El NIF no tiene una forma válida (p. ej. B12345678)' };
  }
  return { ok: true, ajustes: r };
}

// ---- Horarios (en hora de Madrid) ----
const TZ_DENORO = 'Europe/Madrid';
function horaMadrid(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ_DENORO, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
// Último instante (<= ahora) en que tocaba la cita semanal (dia 1 = lunes, hora local)
function ultimaCitaSemanal(ahora, dia, hora) {
  const t = horaMadrid(ahora);
  let dias = (t.dow - dia + 7) % 7;
  if (dias === 0 && (t.h < hora)) dias = 7;
  // medianoche local de hoy ≈ ahora - (h*60+min) minutos; se corrige el desfase del cambio de hora
  const cita = ahora - ((t.h * 60 + t.min) * 60000) - dias * 86400000 + hora * 3600000;
  const c = horaMadrid(cita);
  return cita - ((c.h - hora) * 3600000) - (c.min * 60000) - (new Date(cita).getUTCSeconds() * 1000 + new Date(cita).getUTCMilliseconds());
}

// ¿Qué ejecuciones tocan ahora para un cliente? Devuelve [{ auto, modo, clave }]
function ejecucionesPendientes(ahora, token, servicios, estados) {
  const out = [];
  const ultima = (clave) => { const e = estados[clave]; return e?.ultima ? new Date(e.ultima).getTime() : 0; };
  for (const a of AUTOS) {
    const s = servicios?.[a.id];
    if (a.propio || !s?.activo) continue;
    const aj = { ...ajustesPorDefecto(a.id), ...(s.ajustes || {}) };
    const activado = s.activado_en ? new Date(s.activado_en).getTime() : 0;
    const clave = `${token}:auto-${a.id}`;
    if (a.cada.tipo === 'horas') {
      const horas = a.cada.opts.includes(Number(aj.cada_horas)) ? Number(aj.cada_horas) : a.cada.def;
      if (ahora - ultima(clave) >= horas * 3600000 - 5 * 60000) out.push({ auto: a.id, modo: a.id === 'resenas' ? 'vigilancia' : null, clave });
      const sem = a.cada.semanal;
      if (sem && aj[sem.campo] !== false) {
        const claveR = `${clave}-resumen`;
        const cita = ultimaCitaSemanal(ahora, sem.dia, sem.hora);
        if (Math.max(ultima(claveR), activado) < cita) out.push({ auto: a.id, modo: 'resumen', clave: claveR });
      }
    } else if (a.cada.tipo === 'semanal') {
      if (a.cada.opcional && aj.programado === false) continue;
      const cita = ultimaCitaSemanal(ahora, a.cada.dia, a.cada.hora);
      if (Math.max(ultima(clave), activado) < cita) out.push({ auto: a.id, modo: null, clave });
    }
  }
  return out;
}

// La configuración que recibe el workflow de la automatización
function entradaAutomatizacion(cliente, id, ajustes, modo, clave, emailFrom) {
  const aj = { ...ajustesPorDefecto(id), ...(ajustes || {}) };
  const config = { ...aj, tienda: cliente.nombre, email_to: cliente.email || '', telegram_chat_id: String(cliente.telegram_chat_id || ''), email_from: emailFrom };
  delete config.cada_horas; delete config.programado; delete config.resumen_semanal;
  if (id === 'carritos' && !config.email_bajas) config.email_bajas = cliente.email || emailFrom;
  if (id === 'stock' && !config.proveedor) config.proveedor = 'tu proveedor';
  if (id === 'facturas') {
    // Vacío = que se queden los datos de ejemplo del workflow (solo se permite con pedidos de ejemplo)
    const em = Object.fromEntries(Object.entries(config.emisor || {}).filter(([, v]) => v));
    if (Object.keys(em).length) config.emisor = em; else delete config.emisor;
  }
  if (id === 'resenas') config.sitios = (config.sitios || []).map((s) => ({ ...s }));
  return { token: cliente.token, auto: id, modo: modo || null, clave, config };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AUTOS, AUTO, CONEXIONES, CAMPOS_SITIO, ajustesPorDefecto, limpiarAjustes, visible, urlPublica,
    ultimaCitaSemanal, ejecucionesPendientes, entradaAutomatizacion, horaMadrid };
}
