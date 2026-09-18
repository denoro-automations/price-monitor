// Copia de seguridad semanal: empaqueta las tablas de Denoro y las manda por email
const clientes = $('Leer clientes').all().map((i) => i.json).filter((r) => r && r.token);
const estados = $('Leer estado').all().map((i) => i.json).filter((r) => r && r.clave);
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
const now = new Date();
const fecha = now.toISOString().slice(0, 10);
const copia = {
  generado: now.toISOString(),
  clientes: clientes.map((c) => ({ ...c, config: parse(c.config, {}) })),
  estado: estados.map((e) => ({ ...e, snapshot: parse(e.snapshot, null), resumen: parse(e.resumen, {}) })),
};
const json = JSON.stringify(copia, null, 1);
const productos = copia.estado.reduce((a, e) => a + (e.resumen?.productos || 0), 0);
const activos = copia.clientes.filter((c) => c.activo).length;
const vigilancias = copia.clientes.reduce((a, c) => a + (c.config.vigilancias || []).length, 0);
const mb = Math.round((json.length / 1048576) * 100) / 100;
const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#35322c">
<h2 style="color:#191713;margin:0 0 12px">Copia de seguridad · ${fecha}</h2>
<p>Adjunto el fichero con los clientes y el estado de sus vigilancias.</p>
<ul>
<li><b>${copia.clientes.length}</b> clientes (${activos} activos)</li>
<li><b>${vigilancias}</b> enlaces vigilados</li>
<li><b>${productos.toLocaleString('es-ES')}</b> productos en seguimiento</li>
<li>Tamaño: ${mb} MB</li>
</ul>
<p style="font-size:13px;color:#6e6a61">El código y los workflows se versionan en GitHub. Para la copia local, ejecuta <code>backup-denoro.ps1</code> en la carpeta del proyecto.</p></div>`;
return [{
  json: { asunto: `🗄️ Denoro · Copia de seguridad ${fecha} (${copia.clientes.length} clientes)`, email_html: html,
          clientes: copia.clientes.length, vigilancias, productos },
  binary: { copia: { data: Buffer.from(json, 'utf8').toString('base64'), mimeType: 'application/json',
                     fileName: `denoro-copia-${fecha}.json`, fileExtension: 'json' } },
}];
