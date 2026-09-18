// ============ CONFIGURACIÓN DEL CLIENTE (edita solo este bloque) ============
const CONFIG = {
  // true: si no hay datos previos, simula cambios para enseñar cómo llegan los avisos.
  // Ponlo en false con clientes reales.
  modo_demo: true,

  // Destinos de los avisos (las credenciales se eligen en los nodos Telegram y Gmail)
  telegram_chat_id: 'TU_CHAT_ID',
  email_to: 'cliente@ejemplo.com',
  email_from: 'avisos@tu-dominio.com',   // la cuenta SMTP que envía

  // Qué se considera un cambio relevante
  umbral_cambio_pct: 1,        // ignora variaciones menores del 1 %
  avisar_nuevos: true,
  avisar_retirados: true,
  avisar_sin_cambios: false,

  // Webs de la competencia. Tipos: 'shopify', 'woocommerce' o 'css'.
  fuentes: [
    {
      id: 'books-toscrape', tipo: 'css', moneda: 'GBP', paginas: 5,
      // {page} se sustituye por el número de página
      url: 'https://books.toscrape.com/catalogue/page-{page}.html',
      // "selector@atributo" lee un atributo; cada selector debe devolver un valor por producto
      selectores: {
        nombre: 'article.product_pod h3 a@title',
        enlace: 'article.product_pod h3 a@href',
        precio: 'article.product_pod .price_color',
        stock: 'article.product_pod .availability',
      },
    },
    // { id: 'competidor-shopify', tipo: 'shopify', url: 'https://tienda-competidor.com', moneda: 'EUR', paginas: 4 },
    // { id: 'competidor-woo', tipo: 'woocommerce', url: 'https://otra-tienda.es', paginas: 4 },
  ],

  // Tus productos: avisa si un competidor vende más barato que tú
  mis_productos: [
    {
      nombre: 'A Light in the Attic (mi tienda)', mi_precio: 55.0, tolerancia_pct: 2,
      competidores: { 'books-toscrape': 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html' },
    },
  ],
};
// ============================================================================

// Destinos: vacío = canal desactivado; valores de ejemplo = error claro
const PLACEHOLDER = /ejemplo\.com|tu-dominio|TU_CHAT_ID/i;
for (const k of ['email_to', 'email_from', 'telegram_chat_id']) {
  if (PLACEHOLDER.test(String(CONFIG[k] || ''))) {
    throw new Error(`Configura "${k}" en el nodo Configuración (ahora tiene un valor de ejemplo). Déjalo vacío ('') para desactivar ese canal.`);
  }
}
if (!CONFIG.email_to && !CONFIG.telegram_chat_id) throw new Error('Configura al menos un canal: email_to o telegram_chat_id');
if (CONFIG.telegram_chat_id && !/^-?\d+$|^@\w+$/.test(String(CONFIG.telegram_chat_id))) {
  throw new Error('telegram_chat_id debe ser un número (p. ej. 123456789) o @canal');
}
if (CONFIG.email_to && !CONFIG.email_from) throw new Error('Falta email_from (la cuenta SMTP que envía)');

const NONE = 'denoro-none'; // selector que no encuentra nada (para fuentes JSON)
const splitSel = (s) => {
  if (!s) return { css: NONE, attr: '' };
  const at = s.lastIndexOf('@');
  return at > 0 ? { css: s.slice(0, at), attr: s.slice(at + 1) } : { css: s, attr: '' };
};

const ids = new Set();
const items = [];
for (const f of CONFIG.fuentes) {
  if (!f.id || !f.url) throw new Error('Cada fuente necesita "id" y "url"');
  if (ids.has(f.id)) throw new Error(`Fuente repetida: ${f.id}`);
  ids.add(f.id);
  const tipo = f.tipo || 'css';
  const base = f.url.replace(/\/+$/, '');
  const paginas = Math.max(1, Number(f.paginas || 1));
  for (let page = 1; page <= paginas; page++) {
    let url;
    if (tipo === 'shopify') {
      const path = f.coleccion ? `/collections/${f.coleccion}/products.json` : '/products.json';
      url = `${base}${path}?limit=250&page=${page}`;
    } else if (tipo === 'woocommerce') {
      url = `${base}/wp-json/wc/store/v1/products?per_page=100&page=${page}` + (f.categoria ? `&category=${f.categoria}` : '');
    } else if (tipo === 'css') {
      if (!f.selectores || !f.selectores.precio) throw new Error(`Fuente ${f.id}: falta selectores.precio`);
      if (paginas > 1 && !f.url.includes('{page}')) throw new Error(`Fuente ${f.id}: usa {page} en la URL para leer varias páginas`);
      url = f.url.replace('{page}', String(page));
    } else {
      throw new Error(`Fuente ${f.id}: tipo "${tipo}" no soportado`);
    }
    const s = f.selectores || {};
    items.push({ json: {
      fuente: f.id, tipo, moneda: f.moneda || '', pagina: page, url, base,
      sel: { nombre: splitSel(s.nombre), enlace: splitSel(s.enlace), precio: splitSel(tipo === 'css' ? s.precio : ''), stock: splitSel(s.stock) },
      config: CONFIG,
    } });
  }
}
for (const p of CONFIG.mis_productos || []) {
  for (const id of Object.keys(p.competidores || {})) {
    if (!ids.has(id)) throw new Error(`mis_productos "${p.nombre}": la fuente ${id} no existe`);
  }
}
return items;
