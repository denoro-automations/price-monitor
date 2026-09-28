// Servidor de prueba del panel único, sin n8n: sirve los paneles tal cual salen de build.py y responde
// la API con el mismo código (api.js) sobre unas tablas en memoria. «Ejecutar ahora» lanza de verdad
// la versión «para un cliente» de cada automatización con el mini-ejecutor de los tests.
// Uso: node n8n/saas/test/servidor-local.js  →  http://localhost:8787/webhook/denoro/admin (clave: clave-admin)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { runCode } = require('./harness');
const { crearMotor } = require('./mini-n8n');

const PORT = Number(process.env.PORT || 8787);
const WF = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflows', f), 'utf8'));
const panelApi = WF('panel-api.json');
const htmlDe = (nombre) => new Function(`return (() => {${panelApi.nodes.find((n) => n.name === nombre).parameters.jsCode}\n})();`)()[0].json.html
  .replace(/'__BOT_USERNAME__'/g, "'denoro1_bot'");
const CONSTS = { "'__ADMIN_KEY__'": "'clave-admin'", "'__PANEL_URL__'": `'http://localhost:${PORT}/webhook/denoro/panel'`, "'__EMAIL_FROM__'": "'avisos@denoro.test'",
  "'__WF_FICHAS__'": "'auto-fichas.json'", "'__WF_STOCK__'": "'auto-stock.json'", "'__WF_CARRITOS__'": "'auto-carritos.json'",
  "'__WF_RESENAS__'": "'auto-resenas.json'", "'__WF_FACTURAS__'": "'auto-facturas.json'", "'__WF_INFORME__'": "'auto-informe.json'" };

const clientes = {};
const motor = crearMotor({ dataTables: { __TABLE_ESTADO__: {} } });
const estado = motor.dataTables.__TABLE_ESTADO__;

async function llamar(body) {
  const nodes = { API: [{ json: { body } }], 'Leer clientes': Object.values(clientes).map((j) => ({ json: j })),
    'Leer estado': Object.values(estado).filter((e) => (body.token ? e.clave.startsWith(body.token + ':') : /:(__cliente|auto-)/.test(e.clave))).map((j) => ({ json: j })) };
  const r = (await runCode('api.js', { consts: CONSTS, nodes, http: async () => ({ statusCode: 404, body: '' }) }))[0].json;
  if (r.siguiente === 'guardar') { clientes[r.fila.token] = { ...clientes[r.fila.token], ...r.fila, createdAt: clientes[r.fila.token]?.createdAt || new Date().toISOString() }; return [200, r.respuesta]; }
  if (r.siguiente === 'probar') return [200, { ok: true, mensaje: 'Prueba enviada (simulada en local).' }];
  if (r.siguiente === 'revisar') return [200, { ok: true, mensaje: 'Revisión simulada en local' }];
  if (r.siguiente === 'ejecutar') {
    try { await motor.ejecutar(WF(r.workflow_id), [{ json: r }]); return [200, { ok: true, mensaje: 'Hecho. Tienes el resultado abajo y en tu email o Telegram.' }]; }
    catch (e) {
      estado[r.clave] = { clave: r.clave, token: r.token, snapshot: '', resumen: JSON.stringify({ ultima: new Date().toISOString(), ok: false, error: e.message.replace(/^\[[^\]]+\] /, '') }) };
      return [200, { ok: false, error: `No ha podido terminar: ${e.message.replace(/^\[[^\]]+\] /, '')}` }];
    }
  }
  return [r.status, r.respuesta];
}

// Un cliente de ejemplo con todo contratado, para abrir el panel directamente
async function semilla() {
  const [, r] = await llamar({ admin_key: 'clave-admin', accion: 'admin_crear', nombre: 'Tienda Demo', email: 'demo@tienda.test', telegram_chat_id: '123456789',
    servicios: ['fichas', 'stock', 'carritos', 'resenas', 'facturas', 'monitor', 'informe'], max_vigilancias: 10 });
  return r.token;
}

semilla().then((token) => {
  http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/webhook/denoro/panel') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(htmlDe('HTML panel')); }
    if (url.pathname === '/webhook/denoro/admin') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(htmlDe('HTML admin')); }
    if (url.pathname === '/webhook/denoro/api' && req.method === 'POST') {
      let b = ''; for await (const ch of req) b += ch;
      const [status, data] = await llamar(JSON.parse(b || '{}'));
      res.writeHead(status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(data));
    }
    res.writeHead(404); res.end('no');
  }).listen(PORT, () => {
    console.log(`Admin:  http://localhost:${PORT}/webhook/denoro/admin   (clave: clave-admin)`);
    console.log(`Panel:  http://localhost:${PORT}/webhook/denoro/panel?t=${token}`);
  });
});
