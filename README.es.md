# Monitor de precios y stock de la competencia

**Denoro Automations** · Deja de revisar a mano las tiendas de tu competencia. Este monitor revisa su catálogo cada pocas horas y te envía **un único resumen** por Telegram y por email cuando cambia algo importante.

## Qué detecta
- 🔻 **Un competidor vende más barato que tú** (con tolerancia configurable)
- 📉 📈 **Bajadas y subidas de precio** por encima de un umbral (p. ej. ≥1 %)
- ⛔ ✅ **Productos agotados o que vuelven a tener stock**
- 🆕 🗑️ **Productos nuevos y retirados**

Cada aviso incluye un **CSV** (se abre en Excel) con todos los precios actuales. Las versiones de n8n comparan cada revisión con la anterior (guardan la última foto de precios); la versión Python además guarda el histórico completo en SQLite y exporta los últimos 90 días a CSV.

## Tiendas compatibles
- **Shopify**: solo necesita la URL de la tienda (usa su `/products.json` público).
- **WooCommerce**: solo necesita la URL (usa la Store API pública).
- **Cualquier web HTML**: se configuran 4 o 5 selectores CSS.

Es respetuoso y fiable: todas las versiones miran el `robots.txt` antes de leer (el workflow de n8n se para y dice qué fuente quitar), hacen pausas entre peticiones, se identifican con su propio User-Agent y **no avisan de productos "retirados" si una web carga a medias**. La versión Python y el panel multi-cliente además reintentan ante errores `429/5xx`. Solo lee datos públicos y no personales.

## Opción A: n8n (sin código)
1. En n8n: **Import from File** → `n8n-workflow.json` y `n8n-error-workflow.json`.
2. Edita el bloque **CONFIGURACIÓN** del nodo *Configuración*, incluidos `email_to`, `email_from` y `telegram_chat_id`. Mientras queden los valores de ejemplo, el workflow se para con un mensaje claro. Deja un canal vacío (`''`) para desactivarlo.
3. Elige tus credenciales en **Telegram** y **Enviar email** (SMTP; con Gmail, usa una contraseña de aplicación).
4. En *Settings → Error workflow* elige **Denoro — Avisos de error**.
5. Activa el workflow (por defecto se ejecuta cada 6 horas).

> n8n solo guarda el histórico en ejecuciones **activas**, no en las pruebas manuales. Por eso `modo_demo: true` simula algunos cambios cuando todavía no hay datos. Con clientes reales, ponlo en `false`.

## Opción B: Python (servidor, cron o Docker)
```bash
pip install -r requirements.txt
cp config.example.yaml config.yaml
cp .env.example .env
python monitor.py --config config.yaml   # --no-notify para probar sin enviar avisos
```
Los resultados se guardan en `data/`: `history.sqlite`, `price_history.csv`, `last_report.json` y `last_report.html`.

## Calidad
- 30 tests automáticos (`python -m pytest`).
- El JavaScript de n8n está en `n8n/src/`, con sus propios tests (`node n8n/test/test_price_monitor.js`). `python n8n/build.py` vuelve a generar el workflow.

## Versión multi-cliente (panel para clientes)
Cada cliente entra en su panel, pega los enlaces que quiere vigilar y elige dónde recibir los avisos: ver [SAAS.md](SAAS.md).

## ¿Lo quieres para tu tienda?
Planes a precio cerrado desde 149 €: hasta 3, 10 o 30 enlaces vigilados (una tienda entera cuenta como uno), avisos por Telegram y email y tu propio panel. El Premium añade el informe semanal de tu tienda en PDF. Detalles y presupuesto: [https://denoro-automations.github.io/](https://denoro-automations.github.io/).

*Los datos de la demo son de books.toscrape.com, una web pública creada para practicar scraping.*
