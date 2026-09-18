"""Utilidades compartidas para generar workflows de n8n (copiada en cada repo)."""
import json
import uuid
from pathlib import Path

HERE = Path(__file__).parent  # build.py lo ajusta
ROOT = HERE.parent
NS = uuid.UUID("6b1f3f4e-0d0e-4c55-9d7e-7d3d2a1f0001")


def js(name):
    return (HERE / "src" / name).read_text(encoding="utf-8")


def node(name, type_, version, pos, params, **extra):
    return {"id": str(uuid.uuid5(NS, name)), "name": name, "type": type_, "typeVersion": version,
            "position": pos, "parameters": params, **extra}


def sticky(name, pos, content, w=380, h=300, color=7):
    return node(name, "n8n-nodes-base.stickyNote", 1, pos,
                {"content": content, "width": w, "height": h, "color": color})


def link(*pairs):
    conns = {}
    for src, dst, *idx in pairs:
        out = idx[0] if idx else 0
        conns.setdefault(src, {"main": []})
        main = conns[src]["main"]
        while len(main) <= out:
            main.append([])
        main[out].append({"node": dst, "type": "main", "index": 0})
    return conns


def extraction(key, field):
    sel = f"$('Configuración').item.json.sel.{field}"
    return [
        {"key": f"{key}_txt", "cssSelector": f"={{{{ {sel}.css }}}}", "returnValue": "text", "returnArray": True},
        {"key": f"{key}_attr", "cssSelector": f"={{{{ {sel}.css }}}}", "returnValue": "attribute",
         "attribute": f"={{{{ {sel}.attr || 'data-denoro-none' }}}}", "returnArray": True},
    ]


def telegram_text(pos, name="Enviar a Telegram"):
    return node(name, "n8n-nodes-base.telegram", 1.2, pos, {
        "chatId": "={{ $json.telegram_chat_id }}",
        "text": "={{ $json.telegram }}",
        "additionalFields": {"appendAttribution": False, "parse_mode": "HTML", "disable_web_page_preview": True},
    }, retryOnFail=True, maxTries=3, waitBetweenTries=5000)


def email(pos, attachments="", name="Enviar email"):
    options = {"appendAttribution": False}
    if attachments:
        options["attachments"] = attachments
    return node(name, "n8n-nodes-base.emailSend", 2.1, pos, {
        "fromEmail": "={{ $json.email_from }}",
        "toEmail": "={{ $json.email_to }}",
        "subject": "={{ $json.asunto }}",
        "emailFormat": "html",
        "html": "={{ $json.email_html }}",
        "options": options,
    }, retryOnFail=True, maxTries=3, waitBetweenTries=5000)


def gate(name, field, pos):
    """IF que deja pasar solo si el canal está activado (destino no vacío)."""
    return node(name, "n8n-nodes-base.if", 2, pos, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
            "conditions": [{"id": str(uuid.uuid5(NS, "gate-" + name)), "leftValue": f"={{{{ $json.{field} }}}}",
                            "rightValue": "", "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
            "combinator": "and",
        },
        "options": {},
    })


def workflow(name, nodes, connections):
    return {"name": name, "nodes": nodes, "connections": connections, "pinData": {},
            "settings": {"executionOrder": "v1", "saveManualExecutions": True, "timezone": "Europe/Madrid"},
            "meta": {"templateCredsSetupCompleted": False}}


def error_handler():
    nodes = [
        sticky("Nota: avisos de error", [-420, -200], (
            "## Avisos de error · Denoro\nAsígnalo en *Settings → Error workflow* de cada workflow.\n"
            "Rellena el chat de Telegram y el email en el nodo **Destinos** (vacío = canal desactivado)."), w=360, h=180, color=3),
        node("Cuando falle un workflow", "n8n-nodes-base.errorTrigger", 1, [0, 0], {}),
        node("Formatear error", "n8n-nodes-base.code", 2, [240, 0], {"jsCode": js("error-handler.js")}),
        node("Destinos", "n8n-nodes-base.set", 3.4, [480, 0], {
            "assignments": {"assignments": [
                {"id": str(uuid.uuid5(NS, "d1")), "name": "telegram_chat_id", "value": "", "type": "string"},
                {"id": str(uuid.uuid5(NS, "d2")), "name": "email_to", "value": "", "type": "string"},
                {"id": str(uuid.uuid5(NS, "d3")), "name": "email_from", "value": "", "type": "string"},
            ]},
            "includeOtherFields": True,
            "options": {},
        }),
        gate("¿Telegram activo?", "telegram_chat_id !== ''", [720, -100]),
        gate("¿Email activo?", "email_to !== ''", [720, 100]),
        telegram_text([960, -100]),
        email([960, 100]),
    ]
    conns = link(("Cuando falle un workflow", "Formatear error"), ("Formatear error", "Destinos"),
                 ("Destinos", "¿Telegram activo?"), ("Destinos", "¿Email activo?"),
                 ("¿Telegram activo?", "Enviar a Telegram", 0), ("¿Email activo?", "Enviar email", 0))
    return workflow("Denoro — Avisos de error", nodes, conns)


