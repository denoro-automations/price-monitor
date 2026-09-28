// Tras guardar la marca, sigue con la petición tal cual (es la entrada de la automatización)
const { marca, ...peticion } = $('Procesar petición').first().json;
return [{ json: peticion }];
