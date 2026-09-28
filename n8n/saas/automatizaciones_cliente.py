"""Convierte cada automatización (un workflow para una sola tienda) en su versión «para un cliente»
del panel único de Denoro.

La automatización original se configura editando el bloque CONFIGURACIÓN del nodo Configuración.
Esta versión:
  - se lanza desde el panel o desde el planificador (Execute Workflow Trigger), que le pasan
    { token, auto, modo, clave, config } con los ajustes que el cliente guardó en su panel;
  - mezcla esos ajustes sobre los valores por defecto del bloque CONFIGURACIÓN (las mismas validaciones);
  - guarda la memoria de cada cliente por separado (reseñas vistas, correlativo de facturas...);
  - al terminar anota el resultado en la tabla denoro_estado para enseñarlo en el panel.

No se toca el código de las automatizaciones: se parte del workflow.json que generan sus build.py.
"""
import copy
import json
import uuid
from pathlib import Path

NS = uuid.UUID("6b1f3f4e-0d0e-4c55-9d7e-7d3d2a1f0003")
RAIZ = Path(__file__).resolve().parents[3]          # carpeta denoro-automations
SRC = Path(__file__).resolve().parent / "src"

# id del panel -> (workflow de origen, nombre, texto cuando no hay nada que contar)
ORIGENES = {
    "fichas": ("ecommerce-automations/fichas-producto/workflow.json", "Fichas de producto", "Sin productos pendientes"),
    "stock": ("ecommerce-automations/stock-proveedor/workflow.json", "Stock del proveedor", "Sin cambios de stock"),
    "carritos": ("ecommerce-automations/carritos/workflow.json", "Carritos abandonados", "Ningún carrito necesitaba aviso"),
    "resenas": ("ecommerce-automations/resenas/workflow.json", "Vigilancia de reseñas", "Sin reseñas negativas nuevas"),
    "facturas": ("ecommerce-automations/facturas/workflow.json", "Facturas y albaranes", "Nada que facturar"),
    "informe": ("weekly-report/n8n-workflow.json", "Informe semanal", "Informe generado"),
}

MEZCLA = """
// ---- Panel único de Denoro: los ajustes del cliente llegan en la entrada ----
const __ENTRADA = $input.first().json || {};
const __limpio = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, x]) => x !== '' && x !== null && x !== undefined));
const __mezclar = (b, o) => {
  const r = { ...b };
  for (const [k, v] of Object.entries(o || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) r[k] = { ...b[k], ...__limpio(v) };
    else if (v !== undefined && v !== null) r[k] = v;
  }
  return r;
};
const CONFIG = { ...__mezclar(CONFIG_BASE, __ENTRADA.config), __token: String(__ENTRADA.token || ''), __auto: String(__ENTRADA.auto || ''), __clave: String(__ENTRADA.clave || '') };
if (!CONFIG.__token || !CONFIG.__clave) throw new Error('Esta versión se lanza desde el panel de Denoro (falta el cliente)');
"""

ESTADO_CLIENTE = """const __estadoCliente = () => { const g = $getWorkflowStaticData('global'); const k = String($('Configuración').first().json.__token || '_'); g.clientes = g.clientes || {}; return (g.clientes[k] = g.clientes[k] || {}); };
"""


def _nid(name):
    return str(uuid.uuid5(NS, name))


def _config(code):
    marca = "const CONFIG = {"
    assert code.count(marca) == 1, "el nodo Configuración debe tener un único bloque CONFIG"
    code = code.replace(marca, "const CONFIG_BASE = {")
    fin = "// ============================================================================"
    i = code.index(fin, code.index("const CONFIG_BASE = {"))
    j = code.index("\n", i) + 1
    return code[:j] + MEZCLA + code[j:]


def _conectar(conns, src, dst, out=0):
    main = conns.setdefault(src, {"main": []})["main"]
    while len(main) <= out:
        main.append([])
    main[out].append({"node": dst, "type": "main", "index": 0})


def _servicio_con_credencial(n):
    t, p = n["type"], n.get("parameters", {})
    if t == "n8n-nodes-base.shopify":
        return "Shopify"
    if t == "n8n-nodes-base.wooCommerce":
        return "WooCommerce"
    if t == "n8n-nodes-base.httpRequest" and p.get("authentication") == "predefinedCredentialType":
        return {"shopifyAccessTokenApi": "Shopify", "wooCommerceApi": "WooCommerce", "openAiApi": "OpenAI"}.get(p.get("nodeCredentialType"), "tu tienda")
    return None


def version_cliente(auto_id, table_estado):
    ruta, nombre, sin_novedad = ORIGENES[auto_id]
    wf = copy.deepcopy(json.loads((RAIZ / ruta).read_text(encoding="utf-8")))
    nodes, conns = wf["nodes"], wf["connections"]
    by_name = {n["name"]: n for n in nodes}

    # 1) disparadores: fuera el manual y los programados; entra el del panel
    triggers = [n for n in nodes if n["type"] in ("n8n-nodes-base.manualTrigger", "n8n-nodes-base.scheduleTrigger")]
    destinos = []
    for t in triggers:
        for salida in conns.pop(t["name"], {"main": []})["main"]:
            for d in salida:
                if d["node"] not in destinos:
                    destinos.append(d["node"])
    # reseñas: los nodos «Modo vigilancia/resumen» fijaban el modo; ahora lo trae la entrada
    for modo in ("Modo vigilancia", "Modo resumen"):
        if modo in by_name:
            conns.pop(modo, None)
            destinos = [d for d in destinos if d not in ("Modo vigilancia", "Modo resumen")]
            if "Configuración" not in destinos:
                destinos.append("Configuración")
    quitar = {t["name"] for t in triggers} | {"Modo vigilancia", "Modo resumen"}
    x0, y0 = by_name["Configuración"]["position"]
    wf["nodes"] = nodes = [n for n in nodes if n["name"] not in quitar]
    entrada = {"id": _nid(auto_id + "-entrada"), "name": "Al ejecutar para un cliente", "type": "n8n-nodes-base.executeWorkflowTrigger",
               "typeVersion": 1.1, "position": [x0 - 240, y0], "parameters": {"inputSource": "passthrough"}}
    nodes.append(entrada)
    for d in destinos:
        _conectar(conns, entrada["name"], d)

    # 2) Configuración: ajustes del cliente encima de los valores por defecto
    cfg = by_name["Configuración"]
    cfg["parameters"]["jsCode"] = _config(cfg["parameters"]["jsCode"])

    # 3) memoria (staticData) separada por cliente
    for n in nodes:
        code = n["parameters"].get("jsCode")
        if code and "$getWorkflowStaticData('global')" in code:
            n["parameters"]["jsCode"] = ESTADO_CLIENTE + code.replace("$getWorkflowStaticData('global')", "__estadoCliente()")

    # 3b) conexiones con credencial propia (Shopify, WooCommerce, OpenAI): una credencial de n8n vale para
    #     UNA tienda, no para cada cliente. Hasta que cada cliente tenga la suya, el nodo se sustituye por uno
    #     que se para con un mensaje claro (el panel ya no deja elegir esas fuentes sin la conexión hecha).
    for n in nodes:
        servicio = _servicio_con_credencial(n)
        if servicio:
            n.update({"type": "n8n-nodes-base.code", "typeVersion": 2, "parameters": {"jsCode": (
                f"// Versión para el panel: la conexión con {servicio} de cada cliente se configura aparte.\n"
                f"throw new Error('La conexión con {servicio} de esta tienda aún no está hecha. Escríbeme y la dejo configurada.');")}})
            for k in ("credentials", "onError", "alwaysOutputData", "retryOnFail", "maxTries", "waitBetweenTries"):
                n.pop(k, None)

    # 4) resultado para el panel, colgando del nodo que monta el aviso
    informes = [s for s, c in conns.items() for salida in c["main"] for d in salida if d["node"] == "¿Email activo?"]
    assert informes, f"{auto_id}: no encuentro el nodo que monta el aviso"
    xs = max(by_name[s]["position"][0] for s in informes)
    ys = max(by_name[s]["position"][1] for s in informes)
    res_code = (SRC / "auto-resultado.js").read_text(encoding="utf-8").replace("__SIN_NOVEDAD__", json.dumps(sin_novedad, ensure_ascii=False))
    resultado = {"id": _nid(auto_id + "-resultado"), "name": "Resultado para el panel", "type": "n8n-nodes-base.code", "typeVersion": 2,
                 "position": [xs + 220, ys + 260], "parameters": {"jsCode": res_code}, "executeOnce": True}
    guardar = {"id": _nid(auto_id + "-guardar"), "name": "Guardar resultado", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1,
               "position": [xs + 440, ys + 260], "parameters": {
                   "resource": "row", "operation": "upsert",
                   "dataTableId": {"__rl": True, "mode": "id", "value": table_estado, "cachedResultName": "denoro_estado"},
                   "matchType": "allConditions",
                   "filters": {"conditions": [{"keyName": "clave", "condition": "eq", "keyValue": "={{ $json.clave }}"}]},
                   "columns": {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": [], "schema": []}, "options": {}},
               "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 1000}
    nodes += [resultado, guardar]
    for s in informes:
        _conectar(conns, s, resultado["name"])
    if "¿Hay reseñas negativas?" in by_name:          # vigilancia sin quejas: también se anota
        _conectar(conns, "¿Hay reseñas negativas?", resultado["name"], 1)
    _conectar(conns, resultado["name"], guardar["name"])

    # 5) nota y ajustes del workflow
    for n in nodes:
        if n["type"] == "n8n-nodes-base.stickyNote":
            n["parameters"]["content"] = (
                f"## {nombre} · versión para el panel\n"
                "La lanzan el **panel de Denoro** (botón *Ejecutar ahora*) y el **Planificador de automatizaciones**.\n"
                "Los ajustes de cada cliente llegan en la entrada y se mezclan con los valores por defecto del nodo "
                "**Configuración**: aquí no hay que editar nada.\n\n"
                "Se genera con `n8n/saas/build.py` a partir del workflow original: no lo edites a mano.")
            n["parameters"]["height"] = 220
            break
    wf["name"] = f"Denoro SaaS — {nombre}"
    wf["settings"] = {**wf.get("settings", {}), "callerPolicy": "workflowsFromSameOwner", "errorWorkflow": "__WORKFLOW_ERRORES__"}
    wf["pinData"] = {}
    return wf
