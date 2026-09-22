# Monitor de precios multi-cliente (panel de Denoro)

Cada cliente entra en **su propio panel**, pega los enlaces de la competencia que quiere vigilar y elige dónde recibir los avisos. No hace falta que yo toque nada: el workflow lee esa configuración y revisa los enlaces con la frecuencia que el cliente haya elegido.

```
Cliente  →  /webhook/denoro/panel?t=TOKEN   (panel web)
Denoro   →  /webhook/denoro/admin           (alta de clientes)
                     │
                     ▼
           /webhook/denoro/api   ──►  tabla denoro_clientes  (quién vigila qué)
                                      tabla denoro_estado    (última foto de precios)
                     ▲
Planificador (cada hora) ──► Revisar cliente ──► Telegram / email
```

## Qué puede pegar el cliente
| Pega… | Qué hace el sistema |
|---|---|
| Página de un producto de **cualquier tienda** | Lee precio y stock de los datos estructurados de la página (JSON-LD, Open Graph, microdatos). Si no los tiene, busca el precio por aproximación y avisa de que conviene comprobarlo. |
| Producto de una tienda **Shopify** | Usa su ficha pública `/products/<handle>.js` (precio, rebaja y stock por variante). |
| **Tienda entera Shopify** (inicio o colección) | Catálogo completo vía `/products.json`. |
| **Tienda entera WooCommerce** | Catálogo completo vía la Store API pública. |

Al pegar el enlace, el panel enseña una **vista previa** con los primeros productos y sus precios: el cliente ve que la tienda se ha leído bien antes de guardar. Si una web bloquea las consultas automáticas (algunas tiendas grandes lo hacen) lo dice con un mensaje claro en vez de fallar en silencio.

Además, en los productos sueltos el cliente puede poner **su propio precio** y recibe un aviso cuando un competidor se le pone por debajo (con un margen configurable).

## Los tres workflows
| Workflow | Para qué |
|---|---|
| **Denoro SaaS — Panel y API** | Sirve el panel del cliente, el panel de administración y la API que usan los dos. |
| **Denoro SaaS — Revisar cliente** | Revisa todos los enlaces de un cliente, compara con la revisión anterior, guarda el estado y envía el aviso. |
| **Denoro SaaS — Planificador** | Cada hora mira qué clientes toca revisar (1, 3, 6, 12 o 24 h) y lanza el anterior para cada uno. Si un cliente falla, los demás siguen. |

Los avisos salen del bot de Telegram y de la cuenta SMTP de Denoro: el cliente no configura nada técnico, solo su email o su chat ID.

## Instalación en otro n8n
1. **Tablas** (*Data tables*):
   - `denoro_clientes`: `token`, `nombre`, `email`, `telegram_chat_id` (texto), `activo` (booleano), `config` (texto)
   - `denoro_estado`: `clave`, `token`, `snapshot` (texto), `resumen` (texto)
2. `python n8n/saas/build.py` genera los 3 workflows en `n8n/saas/workflows/`.
3. Sustituye los marcadores antes de importarlos (o desde el editor):
   - `__TABLE_CLIENTES__`, `__TABLE_ESTADO__` → los IDs de las tablas
   - `__WORKFLOW_REVISAR__` → el ID del workflow «Revisar cliente»
   - `__ADMIN_KEY__` → tu clave de administrador
   - `__EMAIL_FROM__` → la cuenta SMTP que envía
   - `__PANEL_URL__` → `https://tu-dominio/webhook/denoro/panel`
   - `__BOT_USERNAME__` → el usuario de tu bot de Telegram
4. Elige credenciales (SMTP y Telegram) en los nodos de envío, asigna el *Error workflow* y **publica** los tres.

## Detalles que evitan sustos
- **Un fallo puntual no dispara avisos**: se avisa al segundo fallo seguido de un enlace y no se repite hasta que se arregla.
- **Lectura parcial**: si una tienda devuelve menos de la mitad de productos que la última vez, no avisa de "productos retirados".
- **Sin avisos repetidos**: mientras el precio no cambie, el aviso de "te están ganando" no se repite.
- **Primera revisión**: solo toma precios de referencia y manda un mensaje de bienvenida con cuántos productos vigila.
- **Educado con las webs**: respeta `robots.txt`, pausa entre peticiones al mismo dominio, reintentos con espera y se identifica con su propio User-Agent.
- **Límite por plan**: cada cliente tiene un máximo de enlaces (3 / 10 / 30 según el plan) que fijas al darlo de alta.

## Código y tests
- Motor y nodos: `n8n/saas/src/` (`engine.js` detecta y extrae, `revisar.js` compara y avisa, `api.js` es la API, `panel.html` y `admin.html` son las pantallas).
- Tests: `node n8n/saas/test/test_saas.js` — detección de los 4 tipos de enlace, webs bloqueadas o caídas, límites del plan, permisos, primera revisión, cambios, fallos repetidos y planificador.

## Para publicarlo en internet
Todo esto corre en el n8n local. Para que un cliente entre desde fuera hace falta exponer n8n con un túnel (Cloudflare) o moverlo a un servidor, y poner `WEBHOOK_URL` para que los enlaces del panel salgan con el dominio bueno.
