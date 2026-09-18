// Revisa TODAS las vigilancias de un cliente, compara con la revisión anterior y prepara:
//  - una fila de estado por vigilancia (tabla denoro_estado)
//  - un aviso (Telegram/email) si hay cambios o errores nuevos
const http = (o) => this.helpers.httpRequest(o);
const EMAIL_FROM = '__EMAIL_FROM__';
const clienteRow = $('Leer cliente').all().map((i) => i.json).find((r) => r && r.token);
const input = $('Al revisar un cliente').first().json;
if (!clienteRow) return [{ json: { tipo: 'fin', ok: false, error: `cliente ${input.token} no encontrado` } }];
const estados = Object.fromEntries($('Leer estado').all().map((i) => i.json).filter((r) => r && r.clave).map((r) => [r.clave, r]));
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
const cfg = parse(clienteRow.config, {});
const watches = cfg.vigilancias || [];
const opts = { umbral_pct: cfg.umbral_pct ?? 1, avisar_nuevos: cfg.avisar_nuevos ?? true, avisar_retirados: cfg.avisar_retirados ?? true, avisar_stock: cfg.avisar_stock ?? true };
const now = new Date();
const out = [];
const events = [];
const errors = [];
const allProducts = [];
let nuevosBaseline = 0, productosBaseline = 0;

for (const w of watches) {
  const clave = `${clienteRow.token}:${w.id}`;
  const prevRow = estados[clave];
  const prev = prevRow ? parse(prevRow.snapshot, null) : null;
  const prevRes = prevRow ? parse(prevRow.resumen, {}) : {};
  const label = w.nombre || w.url;
  let res;
  try {
    res = await fetchWatch(http, w);
  } catch (e) {
    const msg = `${label}: ${e.message}`;
    const fallos = (prevRes.fallos || 0) + 1;
    // se avisa al 2º fallo seguido (evita falsas alarmas por un corte puntual) y no se repite
    if (fallos === 2) errors.push(msg);
    out.push({ clave, token: clienteRow.token, snapshot: prevRow ? prevRow.snapshot : '', resumen: JSON.stringify({ ...prevRes, ultima: now.toISOString(), error: e.message, fallos }) });
    continue;
  }
  const productos = res.productos.map((p) => ({ ...p, watch: label }));
  allProducts.push(...productos);
  const prevCount = prev ? Object.keys(prev).length : 0;
  const parcial = prev && productos.length < 0.5 * prevCount && !res.retirado;
  if (prev) {
    const ev = compareSnapshots(productos, prev, { ...opts, parcial, moneda: w.moneda });
    if (res.retirado && w.tipo !== 'shopify_tienda' && w.tipo !== 'woo_tienda' && !prevRes.retirado) {
      ev.push({ kind: 'removed_product', p: { name: w.nombre || w.url, price: null, url: w.url, currency: w.moneda } });
    }
    ev.forEach((e) => { e.watch = label; });
    events.push(...ev);
  } else {
    nuevosBaseline++;
    productosBaseline += productos.length;
  }
  // ¿un competidor vende más barato que tú?
  if (w.mi_precio && productos[0] && productos[0].price !== null && productos.length === 1) {
    const p = productos[0];
    const limite = Number(w.mi_precio) * (1 - (Number(w.tolerancia_pct) || 0) / 100);
    const antes = prev && Object.values(prev)[0];
    const yaAvisado = antes && antes.p !== null && antes.p < limite && antes.p === p.price;
    if (p.price < limite && !yaAvisado) {
      events.push({ kind: 'undercut', p, mine: Number(w.mi_precio), watch: label,
                    pct: Math.round(((p.price - w.mi_precio) / w.mi_precio) * 10000) / 100 });
    }
  }
  const snap = parcial ? { ...prev, ...snapshotOf(productos) } : snapshotOf(productos);
  out.push({ clave, token: clienteRow.token, snapshot: JSON.stringify(snap),
             resumen: JSON.stringify({ ultima: now.toISOString(), productos: productos.length, error: parcial ? 'lectura parcial' : '', fallos: 0,
                                       retirado: Boolean(res.retirado), precio: productos.length === 1 ? productos[0].price : null,
                                       moneda: productos[0]?.currency || w.moneda || '', stock: productos.length === 1 ? productos[0].stock : null,
                                       cambios: prev ? events.filter((e) => e.watch === label).length : 0 }) });
}
events.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.pct || 0) - (b.pct || 0));

// fila resumen del cliente (última revisión)
const prevCli = parse(estados[`${clienteRow.token}:__cliente`]?.resumen, {});
out.push({ clave: `${clienteRow.token}:__cliente`, token: clienteRow.token, snapshot: '',
           resumen: JSON.stringify({ ...prevCli, ultima: now.toISOString(), vigilancias: watches.length, productos: allProducts.length,
                                     cambios: events.length, errores: errors.length,
                                     con_error: out.filter((r) => { try { return JSON.parse(r.resumen).fallos > 0; } catch (e) { return false; } }).length, historial: [{ at: now.toISOString(), cambios: events.length }].concat(prevCli.historial || []).slice(0, 30) }) });

const items = out.map((r) => ({ json: { tipo: 'estado', ...r } }));
const bienvenida = !events.length && nuevosBaseline > 0 && !prevCli.bienvenida_enviada ? { productos: productosBaseline, webs: nuevosBaseline } : null;
if (bienvenida) items[items.length - 1].json.resumen = JSON.stringify({ ...parse(items[items.length - 1].json.resumen, {}), bienvenida_enviada: true });
if (events.length || errors.length || bienvenida) {
  const m = buildMessages({ cliente: clienteRow, events, errors, stats: { productos: allProducts.length }, bienvenida, fecha: now });
  const csv = csvOf(allProducts, now);
  items.push({
    json: { tipo: 'aviso', ...m, telegram_chat_id: clienteRow.telegram_chat_id || '', email_to: clienteRow.email || '', email_from: EMAIL_FROM,
            enviar_telegram: Boolean(clienteRow.telegram_chat_id), enviar_email: Boolean(clienteRow.email), cambios: events.length },
    binary: { csv: { data: Buffer.from(csv, 'utf8').toString('base64'), mimeType: 'text/csv', fileName: `precios-${now.toISOString().slice(0, 10)}.csv`, fileExtension: 'csv' } },
  });
}
return items;
