// Marca «en curso» cada automatización que se va a lanzar (columnas de denoro_estado)
const previos = Object.fromEntries($('Leer estado').all().map((i) => i.json).filter((r) => r && r.clave).map((r) => [r.clave, r.resumen]));
const parse = (s) => { try { return s ? JSON.parse(s) : {}; } catch (e) { return {}; } };
const ahora = new Date().toISOString();
return $input.all().map((i) => ({ json: { clave: i.json.clave, token: i.json.token, snapshot: '',
  resumen: JSON.stringify({ ...parse(previos[i.json.clave]), en_curso: ahora }) } }));
