// Panel único: catálogo, API de automatizaciones, planificador y las seis versiones «para un cliente»
// ejecutadas de punta a punta con sus datos de ejemplo. Uso: node n8n/saas/test/test_panel_unico.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runCode } = require('./harness');
const { crearMotor } = require('./mini-n8n');
const A = require('../src/automatizaciones.js');

const WF = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflows', f), 'utf8'));
const CONSTS = { "'__ADMIN_KEY__'": "'clave-admin'", "'__PANEL_URL__'": "'https://app.test/webhook/denoro/panel'", "'__EMAIL_FROM__'": "'avisos@denoro.test'",
  "'__WF_FICHAS__'": "'wf-fichas'", "'__WF_STOCK__'": "'wf-stock'", "'__WF_CARRITOS__'": "'wf-carritos'", "'__WF_RESENAS__'": "'wf-resenas'",
  "'__WF_FACTURAS__'": "'wf-facturas'", "'__WF_INFORME__'": "'wf-informe'" };
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const cliente = (over = {}, cfg = {}) => ({ token: 'tokA', nombre: 'Moda Sol', email: 'sol@moda.test', telegram_chat_id: '123456789', activo: true,
  config: JSON.stringify({ vigilancias: [], max_vigilancias: 10, frecuencia_horas: 6, ...cfg }), ...over });
async function api(body, clientes, estados = []) {
  const r = await runCode('api.js', { consts: CONSTS, nodes: { API: [{ json: { body } }], 'Leer clientes': clientes.map((j) => ({ json: j })), 'Leer estado': estados.map((j) => ({ json: j })) } });
  return r[0].json;
}

(async () => {
  // ================= catálogo =================
  eq(A.AUTOS.map((a) => a.id), ['fichas', 'stock', 'carritos', 'resenas', 'facturas', 'monitor', 'informe'], 'las siete del catálogo de la web');
  for (const a of A.AUTOS.filter((x) => !x.propio)) {
    const d = A.limpiarAjustes(a.id, {}, {}, []);
    ok(d.ok, `${a.id}: los valores por defecto son válidos (${d.error})`);
    ok([d.ajustes.fuente, d.ajustes.destino].filter(Boolean).every((v) => v === 'demo'), `${a.id}: empieza con datos de ejemplo`);
  }
  let r = A.limpiarAjustes('fichas', { fuente: 'shopify' }, {}, []);
  ok(!r.ok && /conecte tu cuenta de Shopify/.test(r.error), 'Shopify sin conectar no se puede elegir');
  ok(A.limpiarAjustes('fichas', { fuente: 'shopify' }, {}, ['shopify']).ok, 'con la conexión hecha, sí');
  ok(/Enlace directo al CSV/.test(A.limpiarAjustes('fichas', { fuente: 'csv' }, {}, []).error), 'CSV sin enlace');
  for (const u of ['http://localhost:5678/x', 'https://192.168.1.10/feed.csv', 'http://host.docker.internal:3000', 'ftp://x.com/a', 'https://10.0.0.2/a', 'https://[::1]/']) {
    ok(!A.limpiarAjustes('stock', { fuente: 'url', feed_url: u }, {}, []).ok, `bloquea direcciones internas: ${u}`);
  }
  ok(A.limpiarAjustes('stock', { fuente: 'url', feed_url: 'https://proveedor.com/feed.xml' }, {}, []).ok, 'acepta un feed público');
  r = A.limpiarAjustes('carritos', { pasos: [{ horas: 24, asunto: 'a' }, { horas: 2, asunto: 'b' }] }, {}, []);
  ok(!r.ok && /menos a más horas/.test(r.error), 'pasos desordenados');
  r = A.limpiarAjustes('carritos', { pasos: [{ horas: 1, asunto: 'Hola <b>', cupon: 'VUEL VE' }], horas_limite: 48 }, {}, []);
  ok(r.ok && r.ajustes.pasos[0].asunto === 'Hola b' && r.ajustes.pasos[0].cupon === 'VUELVE', 'limpia el texto de los pasos');
  ok(!A.limpiarAjustes('stock', { max_cambios_pct: 400 }, {}, []).ok, 'números fuera de rango');
  ok(!A.limpiarAjustes('stock', { fuente: 'ftp' }, {}, []).ok, 'opción que no existe');
  ok(!A.limpiarAjustes('stock', { cada_horas: 3 }, {}, []).ok && A.limpiarAjustes('stock', { cada_horas: 6 }, {}, []).ajustes.cada_horas === 6, 'frecuencias de la lista');
  r = A.limpiarAjustes('facturas', { fuente: 'shopify' }, {}, ['shopify']);
  ok(!r.ok && /nombre fiscal/.test(r.error), 'factura real sin datos fiscales');
  r = A.limpiarAjustes('facturas', { fuente: 'shopify', emisor: { nombre: 'Moda Sol SL', nif: 'B1234567X', direccion: 'C/ Mar 1', cp_poblacion: '08001 BCN' } }, {}, ['shopify']);
  ok(r.ok, `factura real con datos fiscales (${r.error})`);
  r = A.limpiarAjustes('resenas', { fuente: 'web', sitios: [] }, {}, []);
  ok(!r.ok && /página de opiniones/.test(r.error), 'reseñas web sin páginas');
  r = A.limpiarAjustes('resenas', { fuente: 'web', sitios: [{ nombre: 'Opiniones', url: 'https://tienda.com/opiniones', bloque: '.op', texto: '.t', autor: '' }] }, {}, []);
  ok(r.ok && !('autor' in r.ajustes.sitios[0]), 'reseñas web con una página (sin campos vacíos)');
  ok(A.limpiarAjustes('stock', { proveedor: 'Pepe', raro: 'x' }, {}, []).ajustes.raro === undefined, 'ignora campos que no existen');

  // ================= API =================
  const antiguo = cliente();                             // de antes del panel único: solo monitor
  let d = await api({ token: 'tokA', accion: 'estado' }, [antiguo]);
  eq(d.respuesta.servicios.map((s) => s.id), ['monitor'], 'un cliente antiguo conserva su monitor');
  d = await api({ token: 'tokA', accion: 'auto_guardar', id: 'stock', ajustes: {} }, [antiguo]);
  eq(d.respuesta.ok, false, 'no puede tocar una automatización que no tiene');

  d = await api({ admin_key: 'clave-admin', accion: 'admin_crear', nombre: 'Casa Luz', email: 'luz@casa.test', servicios: ['stock', 'resenas', 'nada'], conexiones: ['shopify', 'x'] }, [antiguo]);
  eq(d.siguiente, 'guardar'); const cfgLuz = JSON.parse(d.fila.config);
  eq(Object.keys(cfgLuz.servicios).filter((k) => cfgLuz.servicios[k].activo).sort(), ['resenas', 'stock'], 'alta con las automatizaciones elegidas');
  eq(cfgLuz.conexiones, ['shopify'], 'solo conexiones conocidas');
  ok(cfgLuz.servicios.stock.activado_en, 'guarda cuándo se activó');
  d = await api({ admin_key: 'clave-admin', accion: 'admin_crear', nombre: 'Vacía', servicios: [] }, [antiguo]);
  eq(d.status, 400, 'alta sin automatizaciones');

  const luz = { ...d, token: 'tokL', nombre: 'Casa Luz', email: 'luz@casa.test', telegram_chat_id: '', activo: true, config: JSON.stringify(cfgLuz) };
  d = await api({ token: 'tokL', accion: 'estado' }, [antiguo, luz], [{ clave: 'tokL:auto-stock', token: 'tokL', resumen: JSON.stringify({ ultima: '2026-09-28T10:00:00Z', ok: true, titulo: 'Sin cambios' }) }]);
  eq(d.respuesta.servicios.map((s) => s.id), ['stock', 'resenas']);
  eq(d.respuesta.servicios[0].estado.titulo, 'Sin cambios', 'el panel ve el último resultado');
  eq(d.respuesta.servicios[0].ajustes.cada_horas, 4, 'ajustes por defecto');
  eq(d.respuesta.conexiones, ['shopify']);
  d = await api({ token: 'tokL', accion: 'detectar', url: 'https://x.com' }, [luz]);
  eq(d.status, 403, 'sin monitor no puede añadir enlaces');

  d = await api({ token: 'tokL', accion: 'auto_guardar', id: 'stock', ajustes: { destino: 'shopify', dominio_shopify: 'luz.myshopify.com', location_id: '77', cada_horas: 12 } }, [luz]);
  eq(d.siguiente, 'guardar'); const cfg2 = JSON.parse(d.fila.config);
  eq(cfg2.servicios.stock.ajustes.destino, 'shopify'); eq(cfg2.servicios.stock.ajustes.cada_horas, 12);
  ok(cfg2.servicios.stock.activado_en === cfgLuz.servicios.stock.activado_en, 'guardar no cambia la activación');
  d = await api({ token: 'tokL', accion: 'auto_guardar', id: 'resenas', ajustes: { fuente: 'woocommerce', woo_url: 'https://luz.com' } }, [luz]);
  eq(d.status, 400, 'WooCommerce no está conectado para este cliente');

  d = await api({ token: 'tokL', accion: 'auto_ejecutar', id: 'stock' }, [luz]);
  eq(d.siguiente, 'ejecutar'); eq(d.workflow_id, 'wf-stock'); eq(d.clave, 'tokL:auto-stock');
  eq(d.config.email_to, 'luz@casa.test'); eq(d.config.email_from, 'avisos@denoro.test'); eq(d.config.tienda, 'Casa Luz');
  eq(d.config.telegram_chat_id, ''); ok(!('cada_horas' in d.config), 'la frecuencia no viaja al workflow');
  d = await api({ token: 'tokL', accion: 'auto_ejecutar', id: 'resenas', modo: 'resumen' }, [luz]);
  eq([d.modo, d.clave], ['resumen', 'tokL:auto-resenas-resumen'], 'resumen semanal a mano');
  d = await api({ token: 'tokL', accion: 'auto_ejecutar', id: 'stock' }, [luz], [{ clave: 'tokL:auto-stock', resumen: JSON.stringify({ ultima: new Date().toISOString(), ok: true }) }]);
  eq(d.status, 429, 'no se puede lanzar dos veces seguidas');
  d = await api({ token: 'tokL', accion: 'auto_ejecutar', id: 'stock' }, [{ ...luz, email: '', telegram_chat_id: '' }]);
  eq(d.status, 400, 'sin destino de avisos no se ejecuta');
  const sinCon = { ...luz, config: JSON.stringify({ ...cfgLuz, conexiones: [], servicios: { ...cfgLuz.servicios, stock: { ...cfgLuz.servicios.stock, ajustes: cfg2.servicios.stock.ajustes } } }) };
  d = await api({ token: 'tokL', accion: 'auto_ejecutar', id: 'stock' }, [sinCon]);
  ok(d.status === 400 && /Shopify/.test(d.respuesta.error), 'si se quita la conexión, avisa en vez de fallar en n8n');

  d = await api({ admin_key: 'clave-admin', accion: 'admin_actualizar', token: 'tokL', servicios: ['stock', 'monitor'], conexiones: [] }, [luz]);
  const cfg3 = JSON.parse(d.fila.config);
  eq([cfg3.servicios.resenas.activo, cfg3.servicios.monitor.activo, cfg3.servicios.stock.activo], [false, true, true], 'el admin cambia el plan');
  ok(cfg3.servicios.stock.activado_en === cfgLuz.servicios.stock.activado_en, 'mantener una activa no la reinicia');
  d = await api({ admin_key: 'clave-admin', accion: 'admin_listar' }, [antiguo, luz], [{ clave: 'tokL:auto-stock', token: 'tokL', resumen: JSON.stringify({ ultima: '2026-09-28T10:00:00Z', ok: false, error: 'Feed caído' }) }]);
  const fl = d.respuesta.clientes.find((c) => c.token === 'tokL');
  eq(fl.servicios.map((s) => [s.id, s.error]), [['stock', 'Feed caído'], ['resenas', null]], 'el admin ve los fallos de cada automatización');

  // ================= planificador =================
  const lunes10 = Date.parse('2026-09-28T08:00:00Z');   // lunes 10:00 en Madrid
  const serv = { stock: { activo: true, activado_en: '2026-09-01T00:00:00Z', ajustes: { cada_horas: 4 } }, informe: { activo: true, activado_en: '2026-09-01T00:00:00Z' },
    resenas: { activo: true, activado_en: '2026-09-01T00:00:00Z' }, fichas: { activo: true, activado_en: '2026-09-01T00:00:00Z', ajustes: { programado: false } }, carritos: { activo: false } };
  let p = A.ejecucionesPendientes(lunes10, 'tokA', serv, {});
  eq(p.map((x) => `${x.auto}:${x.modo}`).sort(), ['informe:null', 'resenas:resumen', 'resenas:vigilancia', 'stock:null'], 'primera pasada: todo lo que toca');
  const hecho = (h) => ({ ultima: new Date(lunes10 - h * 3600000).toISOString() });
  p = A.ejecucionesPendientes(lunes10, 'tokA', serv, { 'tokA:auto-stock': hecho(1), 'tokA:auto-informe': hecho(1.5), 'tokA:auto-resenas': hecho(0.5), 'tokA:auto-resenas-resumen': hecho(0.9) });
  eq(p, [], 'nada pendiente justo después');
  p = A.ejecucionesPendientes(lunes10, 'tokA', serv, { 'tokA:auto-stock': hecho(3.95), 'tokA:auto-informe': hecho(3), 'tokA:auto-resenas': hecho(2), 'tokA:auto-resenas-resumen': hecho(1) });
  eq(p.map((x) => x.auto).sort(), ['informe', 'resenas', 'stock'], 'stock a las 4 h (con margen), reseñas a las 2 h, informe de esta semana sin hacer');
  p = A.ejecucionesPendientes(lunes10, 'tokA', { informe: { activo: true, activado_en: '2026-09-28T07:30:00Z' } }, {});
  eq(p, [], 'recién activado después de la cita: espera al lunes siguiente');

  const pend = await runCode('planificador-autos.js', { consts: CONSTS, nodes: {
    'Leer clientes': [{ json: luz }, { json: { ...luz, token: 'tokP', activo: false } }, { json: antiguo }],
    'Leer estado': [] } });
  eq(pend.map((x) => [x.json.token, x.json.auto, x.json.workflow_id, x.json.saltar]).sort(), [['tokL', 'resenas', 'wf-resenas', false], ['tokL', 'stock', 'wf-stock', false]],
    'el planificador reparte por cliente, se salta pausados y antiguos, y el resumen espera a su lunes');
  const sinConPend = await runCode('planificador-autos.js', { consts: CONSTS, nodes: { 'Leer clientes': [{ json: sinCon }], 'Leer estado': [] } });
  ok(sinConPend.some((x) => x.json.saltar && /Shopify/.test(x.json.error)), 'ajustes que ya no valen se anotan sin ejecutar');
  const anot = await runCode('planificador-anotar.js', { input: [{ json: { error: { message: 'Boom' } }, pairedItem: { item: 1 } }, { json: { ok: 1 }, pairedItem: { item: 0 } }],
    nodes: { 'Automatizaciones pendientes': [{ json: { clave: 'a:auto-stock', token: 'a', saltar: false } }, { json: { clave: 'b:auto-stock', token: 'b', saltar: false } }] } });
  eq(anot.map((x) => [x.json.clave, JSON.parse(x.json.resumen).error]), [['b:auto-stock', 'Boom']], 'los fallos se anotan en su cliente');

  // ================= las seis automatizaciones, de punta a punta =================
  const motor = crearMotor();
  const entrada = (id, cli, modo) => A.entradaAutomatizacion(cli, id, A.ajustesPorDefecto(id), modo, `${cli.token}:auto-${id}${modo === 'resumen' ? '-resumen' : ''}`, 'avisos@denoro.test');
  const A1 = { token: 'tokA', nombre: 'Moda Sol', email: 'sol@moda.test', telegram_chat_id: '123456789' };
  const B1 = { token: 'tokB', nombre: 'Casa Luz', email: 'luz@casa.test', telegram_chat_id: '' };
  const fila = (clave) => JSON.parse(motor.dataTables.__TABLE_ESTADO__[clave].resumen);
  for (const [id, fichero] of [['fichas', 'auto-fichas.json'], ['stock', 'auto-stock.json'], ['carritos', 'auto-carritos.json'],
    ['resenas', 'auto-resenas.json'], ['facturas', 'auto-facturas.json'], ['informe', 'auto-informe.json']]) {
    const wf = WF(fichero);
    const antes = motor.enviados.email.length;
    await motor.ejecutar(wf, [{ json: entrada(id, A1, id === 'resenas' ? 'vigilancia' : null) }]);
    const f = fila(`tokA:auto-${id}`);
    ok(f.ok && f.titulo && f.demo, `${id}: guarda el resultado para el panel (${f.titulo})`);
    const mios = motor.enviados.email.slice(antes).filter((m) => m.to);   // sin destinatario no sale (pedido sin email)
    ok(mios.every((m) => m.from === 'avisos@denoro.test'), `${id}: sale del remitente de Denoro`);
    ok(mios.every((m) => m.to === 'sol@moda.test'), `${id}: en modo demo todo llega al cliente, nunca a compradores inventados (${mios.map((m) => m.to)})`);
    if (f.avisado) ok(mios.length > 0, `${id}: ha enviado el aviso`);
  }
  ok(motor.enviados.telegram.every((t) => t.chat === '123456789'), 'Telegram al chat del cliente');
  ok(fila('tokA:auto-informe').titulo.includes('Moda Sol'), 'el informe lleva el nombre de la tienda del cliente');

  // memoria separada por cliente
  const fact = WF('auto-facturas.json');
  await motor.ejecutar(fact, [{ json: entrada('facturas', A1) }]);
  ok(/Nada que facturar|0 factura/.test(fila('tokA:auto-facturas').titulo), `segunda pasada del mismo cliente: no se refactura (${fila('tokA:auto-facturas').titulo})`);
  await motor.ejecutar(fact, [{ json: entrada('facturas', B1) }]);
  ok(/5 factura/.test(fila('tokB:auto-facturas').titulo), `otro cliente empieza su propia numeración (${fila('tokB:auto-facturas').titulo})`);
  const numeros = Object.keys(motor.staticData.clientes.tokB.emitidas || {}).length;
  eq(numeros, 5, 'el correlativo de B está en su propia memoria');
  const res = WF('auto-resenas.json');
  await motor.ejecutar(res, [{ json: entrada('resenas', A1, 'vigilancia') }]);
  eq(fila('tokA:auto-resenas').avisado, false, 'reseñas: no repite avisos al mismo cliente');
  await motor.ejecutar(res, [{ json: entrada('resenas', A1, 'resumen') }]);
  ok(/media/.test(fila('tokA:auto-resenas-resumen').titulo), 'reseñas: resumen semanal en su propia fila');

  // errores de configuración: se paran con un mensaje claro
  await assert.rejects(motor.ejecutar(WF('auto-stock.json'), [{ json: { ...entrada('stock', A1), config: { ...entrada('stock', A1).config, email_to: '', telegram_chat_id: '' } } }]), /al menos un canal/); n++;
  await assert.rejects(motor.ejecutar(WF('auto-stock.json'), [{ json: { config: {} } }]), /falta el cliente/); n++;

  // ================= workflows =================
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'workflows'))) {
    const wf = WF(f); const names = new Set(wf.nodes.map((x) => x.name));
    for (const [src, c] of Object.entries(wf.connections)) {
      ok(names.has(src), `${f}: conexión desde ${src}`);
      for (const b of c.main) for (const x of b || []) ok(names.has(x.node), `${f}: conexión a ${x.node}`);
    }
    for (const x of wf.nodes.filter((y) => y.type.endsWith('.code'))) {
      if (!x.name.startsWith('HTML')) for (const m of x.parameters.jsCode.matchAll(/\$\('([^']+)'\)/g)) ok(names.has(m[1]), `${f} · ${x.name}: $('${m[1]}') existe`);
      try { new Function('$', '$input', '$getWorkflowStaticData', `return (async () => {${x.parameters.jsCode}\n})`); n++; }
      catch (e) { assert.fail(`${f} · ${x.name}: el código no compila: ${e.message}`); }
    }
  }
  const panel = WF('panel-api.json').nodes.find((x) => x.name === 'HTML panel').parameters.jsCode;
  ok(panel.includes('--accent:#235b54') && panel.includes('Instrument Serif') && panel.includes('ejecucionesPendientes'), 'el panel lleva la hoja de estilos de la web y el catálogo');
  ok(!panel.includes('/*CSS*/') && !panel.includes('/*AUTOS*/'), 'sin marcadores sin sustituir');

  console.log(`Panel único: ${n} comprobaciones OK`);
})().catch((e) => { console.error(e); process.exit(1); });
