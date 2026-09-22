// Antes de descargar nada, mira el robots.txt de cada web. Si alguna no permite la lectura
// automática de esas páginas, el workflow se para y dice qué fuente quitar.
// Deja pasar los mismos items que recibe, en el mismo orden (el nodo de comparar cuenta con ello).
const items = $input.all();
const BOT = 'denoropricemonitor';
const UA = 'DenoroPriceMonitor/2.0 (+https://github.com/denoro-automations/price-monitor)';
const http = (o) => this.helpers.httpRequest(o);

// Convierte un patrón de robots.txt (con * y $) en una expresión regular.
const aRegex = (p) => {
  const fin = p.endsWith('$');
  const cuerpo = (fin ? p.slice(0, -1) : p).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + cuerpo + (fin ? '$' : ''));
};

const permitido = (texto, ruta) => {
  const grupos = [];
  let actual = null;
  let leyendoAgentes = false;
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const linea = bruta.replace(/#.*/, '').trim();
    const m = linea.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const clave = m[1].toLowerCase();
    const valor = m[2].trim();
    if (clave === 'user-agent') {
      if (!actual || !leyendoAgentes) { actual = { agentes: [], reglas: [] }; grupos.push(actual); }
      actual.agentes.push(valor.toLowerCase());
      leyendoAgentes = true;
    } else if (clave === 'allow' || clave === 'disallow') {
      leyendoAgentes = false;
      if (actual && valor) actual.reglas.push({ permite: clave === 'allow', patron: valor });
    } else {
      leyendoAgentes = false;
    }
  }
  // Manda el grupo que nombra a este bot; si no hay, el de "*".
  const propios = grupos.filter((g) => g.agentes.some((a) => a !== '*' && BOT.includes(a)));
  const aplicables = propios.length ? propios : grupos.filter((g) => g.agentes.includes('*'));
  let mejor = null;
  for (const r of aplicables.flatMap((g) => g.reglas)) {
    if (!aRegex(r.patron).test(ruta)) continue;
    // La regla más específica (más larga) gana; en empate, gana la que permite.
    if (!mejor || r.patron.length > mejor.patron.length || (r.patron.length === mejor.patron.length && r.permite)) mejor = r;
  }
  return mejor ? mejor.permite : true;
};

// El sandbox de n8n no incluye URL(): origen y ruta a mano.
const partes = (url) => {
  const m = String(url).match(/^(https?:\/\/[^/?#]+)([^#]*)/i);
  return m ? { origen: m[1].toLowerCase(), ruta: m[2] || '/' } : null;
};

const robots = {};
for (const it of items) {
  const p = partes(it.json.url);
  if (!p || p.origen in robots) continue;
  try {
    const r = await http({ url: p.origen + '/robots.txt', method: 'GET', returnFullResponse: true, ignoreHttpStatusErrors: true,
      timeout: 20000, json: false, headers: { 'User-Agent': UA } });
    robots[p.origen] = { estado: Number(r.statusCode || 0), texto: typeof r.body === 'string' ? r.body : String(r.body ?? '') };
  } catch (e) {
    robots[p.origen] = { estado: 0, error: e.message || String(e) };
  }
}

const bloqueadas = new Set();
const dudosas = new Set();
for (const it of items) {
  const p = partes(it.json.url);
  if (!p) continue;
  const r = robots[p.origen];
  if (r.estado >= 500 || !r.estado) { dudosas.add(`${it.json.fuente} (${p.origen})`); continue; }
  // 4xx (sin robots.txt, o no accesible): por convención se entiende que no hay restricciones.
  if (r.estado >= 400) continue;
  if (!permitido(r.texto, p.ruta)) bloqueadas.add(`${it.json.fuente} (${it.json.url})`);
}
if (bloqueadas.size) {
  throw new Error(`Estas webs no permiten la lectura automática según su robots.txt: ${[...bloqueadas].join(', ')}. Quítalas de "fuentes" en el nodo Configuración.`);
}
if (dudosas.size) {
  throw new Error(`No se ha podido comprobar el robots.txt de: ${[...dudosas].join(', ')}. Se reintentará en la próxima pasada.`);
}
return items;
