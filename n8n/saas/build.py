#!/usr/bin/env python3
"""Genera los 3 workflows del Monitor de precios multi-cliente (Denoro SaaS).

Uso:  python n8n/saas/build.py
Los IDs de las tablas y del sub-workflow se ponen al instalar (ver README-SAAS.md);
aquí van como marcadores __ID__ que el script de instalación sustituye.
"""
import importlib.util
import json
import uuid
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("common", HERE.parent / "common.py")
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
c.HERE = HERE.parent
NS = uuid.UUID("6b1f3f4e-0d0e-4c55-9d7e-7d3d2a1f0002")
SRC = HERE / "src"
OUT = HERE / "workflows"
ENGINE = {"api.js", "revisar.js"}


def js(name):
    code = (SRC / name).read_text(encoding="utf-8")
    if name in ENGINE:
        code = (SRC / "engine.js").read_text(encoding="utf-8") + "\n" + (SRC / "messages.js").read_text(encoding="utf-8") + "\n" + code
    return code


def html(name):
    page = (SRC / name).read_text(encoding="utf-8")
    return page.replace("/*CSS*/", (SRC / "shared.css").read_text(encoding="utf-8"))


def node(name, type_, version, pos, params, **extra):
    return {"id": str(uuid.uuid5(NS, name)), "name": name, "type": type_, "typeVersion": version,
            "position": pos, "parameters": params, **extra}


def table(key, label):
    return {"__rl": True, "mode": "id", "value": f"__TABLE_{key}__", "cachedResultName": label}


def dt_get(name, pos, key, label, conditions=None, match="allConditions", **extra):
    params = {"resource": "row", "operation": "get", "dataTableId": table(key, label), "returnAll": True}
    if conditions:
        params["matchType"] = match
        params["filters"] = {"conditions": [{"keyName": k, "condition": op, "keyValue": v} for k, op, v in conditions]}
    return node(name, "n8n-nodes-base.dataTable", 1.1, pos, params, alwaysOutputData=True, executeOnce=True, **extra)


def dt_upsert(name, pos, key, label, match_col):
    return node(name, "n8n-nodes-base.dataTable", 1.1, pos, {
        "resource": "row", "operation": "upsert", "dataTableId": table(key, label), "matchType": "allConditions",
        "filters": {"conditions": [{"keyName": match_col, "condition": "eq", "keyValue": f"={{{{ $json.{match_col} }}}}"}]},
        "columns": {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": [], "schema": []},
        "options": {}}, retryOnFail=True, maxTries=3, waitBetweenTries=1000)


def webhook(name, pos, method, path):
    return node(name, "n8n-nodes-base.webhook", 2.1, pos, {
        "httpMethod": method, "path": path, "responseMode": "responseNode", "options": {}},
        webhookId=str(uuid.uuid5(NS, "hook-" + path)))


def respond(name, pos, body_expr, code_expr, content_type=None):
    options = {"responseCode": code_expr}
    headers = [{"name": "Cache-Control", "value": "no-store"}, {"name": "X-Robots-Tag", "value": "noindex"},
               {"name": "Access-Control-Allow-Origin", "value": "*"}]
    if content_type:
        headers.insert(0, {"name": "Content-Type", "value": content_type})
    options["responseHeaders"] = {"entries": headers}
    params = ({"respondWith": "text", "responseBody": body_expr, "options": options} if content_type
              else {"respondWith": "json", "responseBody": body_expr, "options": options})
    return node(name, "n8n-nodes-base.respondToWebhook", 1.4, pos, params)


def rule(value, field="siguiente"):
    return {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
                           "conditions": [{"leftValue": f"={{{{ $json.{field} }}}}", "rightValue": value,
                                           "operator": {"type": "string", "operation": "equals"}}],
                           "combinator": "and"}, "renameOutput": True, "outputKey": value}


def switch(name, pos, values, field="siguiente"):
    return node(name, "n8n-nodes-base.switch", 3, pos, {"rules": {"values": [rule(v, field) for v in values]}, "options": {}})


def execute(name, pos, **extra):
    return node(name, "n8n-nodes-base.executeWorkflow", 1.2, pos, {
        "source": "database",
        "workflowId": {"__rl": True, "mode": "id", "value": "__WORKFLOW_REVISAR__"},
        "workflowInputs": {"mappingMode": "defineBelow", "value": {}, "matchingColumns": [], "schema": [],
                           "attemptToConvertTypes": False, "convertFieldsToString": True},
        "mode": "each", "options": {"waitForSubWorkflow": True}}, **extra)


def sticky(name, pos, text, w=420, h=260, color=5):
    return node(name, "n8n-nodes-base.stickyNote", 1, pos, {"content": text, "width": w, "height": h, "color": color})


def panel_api():
    token_like = "={{ $('API').first().json.body.token ? $('API').first().json.body.token + ':%' : '%:__cliente' }}"
    req = "$('Procesar petición').first().json"
    nodes = [
        sticky("Nota", [-520, -420], (
            "## Denoro · Panel y API\n"
            "- **/webhook/denoro/panel?t=TOKEN** → panel del cliente\n"
            "- **/webhook/denoro/admin** → alta de clientes (clave en *Procesar petición*)\n"
            "- **/webhook/denoro/api** → API que usan los dos paneles\n\n"
            "Credenciales: elige las tuyas en los nodos de **Prueba Telegram** y **Prueba email**."), w=460, h=240),
        webhook("Panel", [-400, -120], "GET", "denoro/panel"),
        node("HTML panel", "n8n-nodes-base.code", 2, [-180, -120], {"jsCode": js("html-panel.js")}),
        respond("Responder panel", [40, -120], "={{ $json.html }}", 200, "text/html; charset=utf-8"),
        webhook("Admin", [-400, 60], "GET", "denoro/admin"),
        node("HTML admin", "n8n-nodes-base.code", 2, [-180, 60], {"jsCode": js("html-admin.js")}),
        respond("Responder admin", [40, 60], "={{ $json.html }}", 200, "text/html; charset=utf-8"),

        webhook("API", [-400, 320], "POST", "denoro/api"),
        dt_get("Leer clientes", [-180, 320], "CLIENTES", "denoro_clientes"),
        dt_get("Leer estado", [40, 320], "ESTADO", "denoro_estado", [("clave", "like", token_like)]),
        node("Procesar petición", "n8n-nodes-base.code", 2, [260, 320], {"jsCode": js("api.js")}),
        switch("¿Qué hago?", [480, 320], ["guardar", "probar", "revisar", "responder"]),
        node("Fila cliente", "n8n-nodes-base.code", 2, [720, 140], {"jsCode": js("fila.js")}),
        dt_upsert("Guardar cliente", [940, 140], "CLIENTES", "denoro_clientes", "token"),
        respond("Responder", [1180, 320], f"={{{{ {req}.respuesta }}}}", f"={{{{ {req}.status }}}}"),

        node("Prueba Telegram", "n8n-nodes-base.telegram", 1.2, [720, 480], {
            "chatId": f"={{{{ {req}.telegram_chat_id }}}}", "text": f"={{{{ {req}.telegram }}}}",
            "additionalFields": {"appendAttribution": False, "parse_mode": "HTML"}},
            onError="continueRegularOutput", alwaysOutputData=True),
        node("Prueba email", "n8n-nodes-base.emailSend", 2.1, [940, 480], {
            "fromEmail": f"={{{{ {req}.email_from }}}}", "toEmail": f"={{{{ {req}.email_to }}}}",
            "subject": f"={{{{ {req}.asunto }}}}", "emailFormat": "html", "html": f"={{{{ {req}.email_html }}}}",
            "options": {"appendAttribution": False}},
            onError="continueRegularOutput", alwaysOutputData=True),
        node("Resultado prueba", "n8n-nodes-base.code", 2, [1160, 480], {"jsCode": js("resultado-prueba.js")}),
        respond("Responder prueba", [1380, 480], "={{ $json.respuesta }}", "={{ $json.status }}"),

        execute("Revisar este cliente", [720, 660], onError="continueRegularOutput", alwaysOutputData=True),
        node("Resultado revisión", "n8n-nodes-base.code", 2, [940, 660], {"jsCode": js("resultado-revision.js")}, executeOnce=True),
        respond("Responder revisión", [1160, 660], "={{ $json.respuesta }}", "={{ $json.status }}"),
    ]
    conns = c.link(
        ("Panel", "HTML panel"), ("HTML panel", "Responder panel"),
        ("Admin", "HTML admin"), ("HTML admin", "Responder admin"),
        ("API", "Leer clientes"), ("Leer clientes", "Leer estado"), ("Leer estado", "Procesar petición"),
        ("Procesar petición", "¿Qué hago?"),
        ("¿Qué hago?", "Fila cliente", 0), ("Fila cliente", "Guardar cliente"), ("Guardar cliente", "Responder"),
        ("¿Qué hago?", "Prueba Telegram", 1), ("Prueba Telegram", "Prueba email"), ("Prueba email", "Resultado prueba"),
        ("Resultado prueba", "Responder prueba"),
        ("¿Qué hago?", "Revisar este cliente", 2), ("Revisar este cliente", "Resultado revisión"),
        ("Resultado revisión", "Responder revisión"),
        ("¿Qué hago?", "Responder", 3),
    )
    return c.workflow("Denoro SaaS — Panel y API", nodes, conns)


def contacto():
    """Recoge las solicitudes de presupuesto de la web (GitHub Pages) y las manda a Telegram y al email."""
    nodes = [
        sticky("Nota", [-420, -280], (
            "## Denoro · Solicitudes de la web\n"
            "La landing (GitHub Pages) envía aquí el formulario de presupuesto.\n"
            "1. Publica n8n en internet (túnel o servidor).\n"
            "2. Pon esa URL en `ENDPOINT` dentro de `app.js` de la web.\n"
            "Sin eso, el formulario abre el correo del visitante (no se pierde ninguna solicitud)."), w=420, h=200),
        webhook("Solicitud de la web", [-200, 0], "POST", "denoro/contacto"),
        node("Preparar aviso", "n8n-nodes-base.code", 2, [20, 0], {"jsCode": js("contacto.js")}),
        c.gate("¿Válida?", "enviar", [240, 0]),
        node("Avisar por Telegram", "n8n-nodes-base.telegram", 1.2, [480, -100], {
            "chatId": "__TELEGRAM_CHAT__", "text": "={{ $json.telegram }}",
            "additionalFields": {"appendAttribution": False, "parse_mode": "HTML"}},
            onError="continueRegularOutput", retryOnFail=True, maxTries=3, waitBetweenTries=3000),
        node("Enviarme el email", "n8n-nodes-base.emailSend", 2.1, [700, -100], {
            "fromEmail": "__EMAIL_FROM__", "toEmail": "__EMAIL_TO__",
            "subject": "={{ $('Preparar aviso').first().json.asunto }}", "emailFormat": "html",
            "html": "={{ $('Preparar aviso').first().json.email_html }}",
            "options": {"appendAttribution": False, "replyTo": "={{ $('Preparar aviso').first().json.email }}"}},
            onError="continueRegularOutput", retryOnFail=True, maxTries=3, waitBetweenTries=3000),
        respond("Responder a la web", [940, 0], "={{ $('Preparar aviso').first().json.respuesta }}",
                "={{ $('Preparar aviso').first().json.status }}"),
    ]
    conns = c.link(("Solicitud de la web", "Preparar aviso"), ("Preparar aviso", "¿Válida?"),
                   ("¿Válida?", "Avisar por Telegram", 0), ("Avisar por Telegram", "Enviarme el email"),
                   ("Enviarme el email", "Responder a la web"), ("¿Válida?", "Responder a la web", 1))
    return c.workflow("Denoro — Solicitudes de la web", nodes, conns)


def backup():
    """Cada domingo manda por email una copia de las tablas (los workflows y el código están en GitHub)."""
    nodes = [
        sticky("Nota", [-420, -260], (
            "## Denoro · Copia de seguridad\n"
            "Cada domingo a las 23:00 te envías por email un JSON con los clientes y su estado.\n"
            "El código y los workflows viven en GitHub; para la copia local está `backup-denoro.ps1`."), w=420, h=170),
        node("Cada domingo 23:00", "n8n-nodes-base.scheduleTrigger", 1.2, [-200, 0],
             {"rule": {"interval": [{"field": "weeks", "weeksInterval": 1, "triggerAtDay": [0], "triggerAtHour": 23, "triggerAtMinute": 0}]}}),
        node("Probar manualmente", "n8n-nodes-base.manualTrigger", 1, [-200, 180], {}),
        dt_get("Leer clientes", [40, 80], "CLIENTES", "denoro_clientes"),
        dt_get("Leer estado", [260, 80], "ESTADO", "denoro_estado"),
        node("Empaquetar copia", "n8n-nodes-base.code", 2, [480, 80], {"jsCode": js("backup.js")}),
        node("Enviarme la copia", "n8n-nodes-base.emailSend", 2.1, [700, 80], {
            "fromEmail": "__EMAIL_FROM__", "toEmail": "__EMAIL_TO__",
            "subject": "={{ $json.asunto }}", "emailFormat": "html", "html": "={{ $json.email_html }}",
            "options": {"appendAttribution": False, "attachments": "copia"}},
            retryOnFail=True, maxTries=3, waitBetweenTries=5000),
    ]
    conns = c.link(("Cada domingo 23:00", "Leer clientes"), ("Probar manualmente", "Leer clientes"),
                   ("Leer clientes", "Leer estado"), ("Leer estado", "Empaquetar copia"),
                   ("Empaquetar copia", "Enviarme la copia"))
    return c.workflow("Denoro — Copia de seguridad", nodes, conns)


def revisar_cliente():
    nodes = [
        sticky("Nota", [-420, -300], (
            "## Denoro · Revisar un cliente\nLo llaman el *Planificador* y el botón **Revisar ahora** del panel.\n"
            "Lee sus enlaces, compara con la revisión anterior, guarda el estado y avisa por Telegram/email."), w=420, h=180),
        node("Al revisar un cliente", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [-200, 0], {"inputSource": "passthrough"}),
        dt_get("Leer cliente", [20, 0], "CLIENTES", "denoro_clientes", [("token", "eq", "={{ $json.token }}")]),
        dt_get("Leer estado", [240, 0], "ESTADO", "denoro_estado",
               [("clave", "like", "={{ $('Al revisar un cliente').first().json.token + ':%' }}")]),
        node("Revisar", "n8n-nodes-base.code", 2, [460, 0], {"jsCode": js("revisar.js")}),
        switch("¿Estado o aviso?", [680, 0], ["estado", "aviso", "fin"], field="tipo"),
        node("Fila estado", "n8n-nodes-base.code", 2, [920, -160], {"jsCode": js("fila-estado.js")}),
        dt_upsert("Guardar estado", [1140, -160], "ESTADO", "denoro_estado", "clave"),
        c.gate("¿Telegram activo?", "enviar_telegram", [920, 40]),
        c.gate("¿Email activo?", "enviar_email", [920, 220]),
        c.telegram_text([1160, 40]),
        c.email([1160, 220], attachments="csv"),
    ]
    conns = c.link(
        ("Al revisar un cliente", "Leer cliente"), ("Leer cliente", "Leer estado"), ("Leer estado", "Revisar"),
        ("Revisar", "¿Estado o aviso?"),
        ("¿Estado o aviso?", "Fila estado", 0), ("Fila estado", "Guardar estado"),
        ("¿Estado o aviso?", "¿Telegram activo?", 1), ("¿Estado o aviso?", "¿Email activo?", 1),
        ("¿Telegram activo?", "Enviar a Telegram", 0), ("¿Email activo?", "Enviar email", 0),
    )
    wf = c.workflow("Denoro SaaS — Revisar cliente", nodes, conns)
    wf["settings"]["callerPolicy"] = "workflowsFromSameOwner"
    return wf


def planificador():
    nodes = [
        sticky("Nota", [-420, -280], (
            "## Denoro · Planificador\nCada hora mira qué clientes tocan (según la frecuencia que eligieron en su panel) "
            "y lanza *Revisar cliente* para cada uno. Si un cliente falla, los demás siguen."), w=420, h=170),
        node("Cada hora", "n8n-nodes-base.scheduleTrigger", 1.2, [-200, 0], {"rule": {"interval": [{"field": "hours", "hoursInterval": 1}]}}),
        node("Probar manualmente", "n8n-nodes-base.manualTrigger", 1, [-200, 180], {}),
        dt_get("Leer clientes", [20, 80], "CLIENTES", "denoro_clientes"),
        dt_get("Leer resúmenes", [240, 80], "ESTADO", "denoro_estado", [("clave", "like", "%:__cliente")]),
        node("Clientes pendientes", "n8n-nodes-base.code", 2, [460, 80], {"jsCode": js("scheduler.js")}),
        execute("Revisar cliente", [680, 80], onError="continueRegularOutput"),
    ]
    conns = c.link(("Cada hora", "Leer clientes"), ("Probar manualmente", "Leer clientes"),
                   ("Leer clientes", "Leer resúmenes"), ("Leer resúmenes", "Clientes pendientes"),
                   ("Clientes pendientes", "Revisar cliente"))
    return c.workflow("Denoro SaaS — Planificador", nodes, conns)


def inject_html(wf):
    for n in wf["nodes"]:
        code = n["parameters"].get("jsCode", "")
        if "__PANEL_HTML__" in code:
            n["parameters"]["jsCode"] = code.replace("__PANEL_HTML__", json.dumps(html("panel.html"), ensure_ascii=False))
        if "__ADMIN_HTML__" in code:
            n["parameters"]["jsCode"] = code.replace("__ADMIN_HTML__", json.dumps(html("admin.html"), ensure_ascii=False))
    return wf


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for fname, wf in {"panel-api.json": inject_html(panel_api()), "revisar-cliente.json": revisar_cliente(),
                      "planificador.json": planificador(), "contacto.json": contacto(),
                      "backup.json": backup()}.items():
        (OUT / fname).write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{fname}: {len(wf['nodes'])} nodos")
