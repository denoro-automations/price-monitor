// Tras revisar a un cliente desde el panel
const r = $input.all().map((i) => i.json);
const fin = r.find((x) => x && x.error);
return [{ json: { status: fin ? 500 : 200, respuesta: fin ? { ok: false, error: fin.error } : { ok: true, mensaje: 'Revisión terminada' } } }];
