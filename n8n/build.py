#!/usr/bin/env python3
"""Genera los workflows de n8n a partir del código en src/ (así el JS se puede testear aparte).

Uso: python n8n/build.py
"""
import importlib.util
import json
import uuid
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
spec = importlib.util.spec_from_file_location("common", HERE / "common.py")
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
c.HERE = HERE
node, sticky, link, js, NS = c.node, c.sticky, c.link, c.js, c.NS
extraction, telegram_text, email, workflow, error_handler, gate = c.extraction, c.telegram_text, c.email, c.workflow, c.error_handler, c.gate


def price_monitor():
    ua = "DenoroPriceMonitor/2.0 (+https://github.com/denoro-automations/price-monitor)"
    nodes = [
        sticky("Nota: cómo usarlo", [-420, -260], (
            "## Monitor de precios · Denoro\n"
            "1. Edita el bloque **CONFIGURACIÓN** del nodo *Configuración* (webs, tus precios, destinos).\n"
            "2. Elige tus credenciales en **Telegram** y **Enviar email** (SMTP: Gmail con contraseña de aplicación).\n"
            "3. Activa el workflow. El histórico se guarda solo en ejecuciones **activas** (no en pruebas manuales): "
            "por eso `modo_demo` simula cambios cuando no hay datos previos.\n"
            "4. En *Settings → Error workflow* elige **Denoro — Avisos de error**.\n"
            "Antes de leer nada mira el robots.txt de cada web: si alguna no lo permite, se para y dice cuál quitar."), w=420, h=320, color=5),
        node("Cada 6 horas", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 0],
             {"rule": {"interval": [{"field": "hours", "hoursInterval": 6}]}}),
        node("Probar manualmente", "n8n-nodes-base.manualTrigger", 1, [0, 200], {}),
        node("Configuración", "n8n-nodes-base.code", 2, [240, 100], {"jsCode": js("config.js")}),
        node("Comprobar robots.txt", "n8n-nodes-base.code", 2, [360, -80], {"jsCode": js("robots.js")}),
        node("Descargar páginas", "n8n-nodes-base.httpRequest", 4.2, [480, 100], {
            "url": "={{ $json.url }}",
            "sendHeaders": True,
            "headerParameters": {"parameters": [
                {"name": "User-Agent", "value": ua},
                {"name": "Accept-Language", "value": "es-ES,es;q=0.9,en;q=0.8"},
            ]},
            "options": {
                "batching": {"batch": {"batchSize": 1, "batchInterval": 1500}},
                "response": {"response": {"fullResponse": True, "neverError": True, "responseFormat": "text"}},
                "timeout": 20000,
            },
        }, onError="continueRegularOutput", retryOnFail=True, maxTries=3, waitBetweenTries=3000),
        node("Extraer datos HTML", "n8n-nodes-base.html", 1.2, [720, 100], {
            "operation": "extractHtmlContent",
            "sourceData": "json",
            "dataPropertyName": "data",
            "extractionValues": {"values": extraction("nombres", "nombre") + extraction("enlaces", "enlace")
                                 + extraction("precios", "precio") + extraction("stocks", "stock")},
            "options": {"trimValues": True, "cleanUpText": True},
        }, onError="continueRegularOutput", alwaysOutputData=True),
        node("Normalizar y comparar", "n8n-nodes-base.code", 2, [960, 100], {"jsCode": js("compare.js")}),
        node("¿Hay algo que avisar?", "n8n-nodes-base.if", 2, [1200, 100], {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
                "conditions": [{"id": str(uuid.uuid5(NS, "cond-cambios")), "leftValue": "={{ $json.hay_cambios }}",
                                "rightValue": "", "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                "combinator": "and",
            },
            "options": {},
        }),
        gate("¿Telegram activo?", "enviar_telegram", [1440, 0]),
        gate("¿Email activo?", "enviar_email", [1440, 200]),
        telegram_text([1680, 0]),
        email([1680, 200], attachments="csv"),
        node("Sin cambios", "n8n-nodes-base.noOp", 1, [1440, 400], {}),
    ]
    conns = link(("Cada 6 horas", "Configuración"), ("Probar manualmente", "Configuración"),
                 ("Configuración", "Comprobar robots.txt"), ("Comprobar robots.txt", "Descargar páginas"), ("Descargar páginas", "Extraer datos HTML"),
                 ("Extraer datos HTML", "Normalizar y comparar"),
                 ("Normalizar y comparar", "¿Hay algo que avisar?"),
                 ("¿Hay algo que avisar?", "¿Telegram activo?", 0), ("¿Hay algo que avisar?", "¿Email activo?", 0),
                 ("¿Telegram activo?", "Enviar a Telegram", 0), ("¿Email activo?", "Enviar email", 0),
                 ("¿Hay algo que avisar?", "Sin cambios", 1))
    return workflow("Denoro — Monitor de precios y stock", nodes, conns)


if __name__ == "__main__":
    outputs = {ROOT / "n8n-workflow.json": price_monitor(), ROOT / "n8n-error-workflow.json": error_handler()}
    for path, wf in outputs.items():
        path.write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{path.name}: {len(wf['nodes'])} nodos")
