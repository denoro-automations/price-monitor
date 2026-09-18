// Ejecuta el código de un nodo Code de n8n fuera de n8n, con los mismos helpers básicos.
const fs = require('fs');
const path = require('path');

function runCode(file, { input = [], nodes = {}, staticData = {}, replace = [] } = {}) {
  let code = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  for (const [a, b] of replace) {
    if (!code.includes(a)) throw new Error(`No encuentro en ${file}: ${a}`);
    code = code.replace(a, b);
  }
  const wrap = (arr) => ({ all: () => arr, first: () => arr[0], item: arr[0] });
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`Nodo no encontrado: ${name}`);
    return wrap(nodes[name]);
  };
  const fn = new Function('$', '$input', '$getWorkflowStaticData', 'Buffer', 'URL', `return (async () => {${code}\n})();`);
  return fn($, wrap(input), () => staticData, Buffer, undefined); // n8n no expone URL
}
module.exports = { runCode };
