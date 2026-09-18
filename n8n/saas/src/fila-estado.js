// Deja solo las columnas de la tabla denoro_estado
return $input.all().map((i) => ({ json: { clave: i.json.clave, token: i.json.token, snapshot: i.json.snapshot, resumen: i.json.resumen } }));
