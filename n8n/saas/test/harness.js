// Ejecuta los nodos Code del SaaS fuera de n8n (mismo ensamblado que build.py)
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const WITH_ENGINE = new Set(['api.js', 'revisar.js']);

function assemble(file, consts = {}) {
  let code = read(file);
  if (WITH_ENGINE.has(file)) code = read('engine.js') + '\n' + read('messages.js') + '\n' + code;
  for (const [k, v] of Object.entries(consts)) code = code.split(k).join(v);
  return code;
}

async function runCode(file, { input = [], nodes = {}, http = null, consts = {} } = {}) {
  const code = assemble(file, consts);
  const wrap = (arr) => ({ all: () => arr, first: () => arr[0], item: arr[0] });
  const $ = (name) => { if (!(name in nodes)) throw new Error(`Nodo no encontrado: ${name}`); return wrap(nodes[name]); };
  const ctx = { helpers: { httpRequest: http || (async () => { throw new Error('sin red en los tests'); }) } };
  const fn = new Function('$', '$input', 'Buffer', 'URL', 'crypto', `return (async () => {${code}\n})();`);
  return fn.call(ctx, $, wrap(input), Buffer, undefined, undefined);
}

// Servidor HTTP falso: rutas -> {status, body, headers} o función
function fakeHttp(routes) {
  const calls = [];
  const fn = async (o) => {
    calls.push(o.url);
    for (const [pattern, resp] of Object.entries(routes)) {
      if (o.url.includes(pattern)) {
        const r = typeof resp === 'function' ? resp(o) : resp;
        if (r instanceof Error) throw r;
        let body = r.body;
        if (o.json && typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* se queda en texto */ } }
        if (!o.json && typeof body === 'object') body = JSON.stringify(body);
        return { statusCode: r.status ?? 200, body, headers: r.headers || {} };
      }
    }
    return { statusCode: 404, body: o.json ? { message: 'not found' } : 'Not found', headers: {} };
  };
  fn.calls = calls;
  return fn;
}
module.exports = { runCode, fakeHttp, assemble };
