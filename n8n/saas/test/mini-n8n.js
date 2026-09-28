// Ejecutor mínimo de workflows de n8n para los tests: recorre el grafo con los datos de verdad
// (nodos Code, IF, Switch, Merge) y sustituye por dobles los que salen fuera (email, Telegram,
// HTTP, tablas). Sirve para probar de punta a punta las versiones «para un cliente».
const RESERVED = new Set(['n8n-nodes-base.stickyNote']);

function evalExpr(str, ctx) {
  if (typeof str !== 'string' || !str.startsWith('=')) return str;
  const body = str.slice(1);
  const only = body.match(/^\{\{([\s\S]*)\}\}$/);
  const run = (expr) => new Function('$json', '$', '$input', `return (${expr});`)(ctx.json, ctx.$, ctx.$input);
  if (only) return run(only[1]);
  return body.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(run(e)));
}

function crearMotor({ staticData = {}, dataTables = {}, stubs = {} } = {}) {
  const enviados = { email: [], telegram: [], http: [] };
  async function ejecutar(wf, entrada) {
    const nodes = Object.fromEntries(wf.nodes.filter((n) => !RESERVED.has(n.type)).map((n) => [n.name, n]));
    const salidas = {};             // nombre -> items (última ejecución, salida con datos)
    const pendMerge = {};
    const cola = [];
    const trigger = wf.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger' || n.type === 'n8n-nodes-base.manualTrigger');
    const wrap = (arr) => ({ all: () => arr, first: () => arr[0], last: () => arr[arr.length - 1], item: arr[0] });
    const $ = (name) => { if (!(name in salidas)) throw new Error(`$('${name}') todavía no se ha ejecutado`); return wrap(salidas[name]); };
    const hijos = (name, out) => ((wf.connections[name]?.main || [])[out] || []);
    const empujar = (name, outputs) => {
      outputs.forEach((items, i) => {
        if (!items || !items.length) return;
        for (const c of hijos(name, i)) cola.push([c.node, c.index, items]);
      });
    };
    salidas[trigger.name] = entrada;
    empujar(trigger.name, [entrada]);
    let pasos = 0;
    while (cola.length) {
      if (++pasos > 500) throw new Error('bucle');
      const [name, idx, itemsIn] = cola.shift();
      const n = nodes[name];
      let items = itemsIn;
      if (n.type === 'n8n-nodes-base.merge') {
        const esperadas = new Set(Object.values(wf.connections).flatMap((c) => (c.main || []).flat().filter((x) => x.node === name).map((x) => x.index)));
        pendMerge[name] = pendMerge[name] || {};
        pendMerge[name][idx] = (pendMerge[name][idx] || []).concat(items);
        if (Object.keys(pendMerge[name]).length < esperadas.size) continue;
        items = [...esperadas].sort().flatMap((k) => pendMerge[name][k]);
        delete pendMerge[name];
        salidas[name] = items; empujar(name, [items]); continue;
      }
      if (n.executeOnce) items = items.slice(0, 1);
      let outputs;
      const p = n.parameters;
      try {
        if (n.type === 'n8n-nodes-base.code') {
          const ctx = { helpers: { httpRequest: stubs.httpRequest || (async () => { throw new Error('sin red'); }) } };
          const fn = new Function('$', '$input', '$getWorkflowStaticData', 'Buffer', `return (async () => {${p.jsCode}\n})();`);
          const res = await fn.call(ctx, $, wrap(items), () => staticData, Buffer);
          outputs = [(res || []).map((r) => (r && r.json ? r : { json: r }))];
        } else if (n.type === 'n8n-nodes-base.if') {
          const t = [], f = [];
          for (const it of items) {
            const conds = p.conditions.conditions.map((c) => Boolean(evalExpr(c.leftValue, { json: it.json, $, $input: wrap(items) })));
            (conds.every(Boolean) ? t : f).push(it);
          }
          outputs = [t, f];
        } else if (n.type === 'n8n-nodes-base.switch') {
          const rules = p.rules.values;
          outputs = rules.map(() => []);
          for (const it of items) {
            const i = rules.findIndex((r) => r.conditions.conditions.every((c) => evalExpr(c.leftValue, { json: it.json, $ }) === c.rightValue));
            if (i >= 0) outputs[i].push(it);
          }
        } else if (n.type === 'n8n-nodes-base.emailSend') {
          outputs = [items.map((it) => {
            const ctx = { json: it.json, $ };
            const m = { from: evalExpr(p.fromEmail, ctx), to: evalExpr(p.toEmail, ctx), subject: evalExpr(p.subject, ctx), adjuntos: Object.keys(it.binary || {}) };
            enviados.email.push(m);
            if (!m.to) { if (n.onError === 'continueRegularOutput') return { json: { error: 'No recipients defined' } }; throw new Error('No recipients defined'); }
            return { json: { accepted: [m.to] }, pairedItem: 0 };
          })];
        } else if (n.type === 'n8n-nodes-base.telegram') {
          outputs = [items.map((it) => { enviados.telegram.push({ chat: evalExpr(p.chatId, { json: it.json, $ }), text: evalExpr(p.text, { json: it.json, $ }) }); return { json: { ok: true } }; })];
        } else if (n.type === 'n8n-nodes-base.httpRequest') {
          outputs = [items.map((it) => { const url = evalExpr(p.url, { json: it.json, $ }); enviados.http.push(url); return stubs.http ? stubs.http(url, it) : { json: {}, binary: { data: { data: 'JVBERi0xLjQ=', mimeType: 'application/pdf', fileName: 'x.pdf' } } }; })];
        } else if (n.type === 'n8n-nodes-base.dataTable') {
          const table = p.dataTableId.value;
          dataTables[table] = dataTables[table] || {};
          for (const it of items) dataTables[table][it.json.clave || it.json.token] = { ...it.json };
          outputs = [items];
        } else if (n.type === 'n8n-nodes-base.executeWorkflowTrigger') {
          outputs = [items];
        } else {
          throw new Error(`Tipo de nodo no soportado en los tests: ${n.type} (${name})`);
        }
      } catch (e) {
        if (n.onError === 'continueRegularOutput') outputs = [items.map(() => ({ json: { error: e.message } }))];
        else { e.message = `[${name}] ${e.message}`; throw e; }
      }
      if (n.alwaysOutputData && !outputs.some((o) => o.length)) outputs[0] = [{ json: {} }];
      salidas[name] = outputs.find((o) => o.length) || [];
      empujar(name, outputs);
    }
    return salidas;
  }
  return { ejecutar, enviados, staticData, dataTables };
}
module.exports = { crearMotor };
