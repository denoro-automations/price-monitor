"""Punto de entrada: python monitor.py --config config.yaml"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import __version__
from .compare import detect_changes, detect_undercuts, sort_events
from .config import ConfigError, load_config, load_env
from .connectors import fetch_source
from .http import FetchError, HttpClient
from .notify import send_email, send_telegram
from .report import email_html, telegram_text
from .storage import Store

log = logging.getLogger("denoro")


def run(cfg: dict, *, notify: bool = True, fetch=fetch_source, now: str | None = None) -> dict:
    ts = now or datetime.now(timezone.utc).isoformat(timespec="seconds")
    h = cfg["http"]
    http = HttpClient(delay=(h["delay_min"], h["delay_max"]), retries=h["retries"],
                      timeout=h["timeout"], respect_robots=h["respect_robots"])
    store = Store(cfg["storage"]["database"])
    export_dir = Path(cfg["storage"]["export_dir"])
    export_dir.mkdir(parents=True, exist_ok=True)
    run_id = store.start_run(ts)
    a = cfg["alerts"]
    events, errors, all_products, per_source = [], [], [], {}
    try:
        for src in cfg["sources"]:
            try:
                products = fetch(src, http)
            except (FetchError, ValueError, KeyError) as exc:
                log.error("Fuente %s: %s", src["id"], exc)
                errors.append(f"{src['id']}: {exc}")
                continue
            if not products:
                errors.append(f"{src['id']}: 0 productos (¿ha cambiado la web o los selectores?)")
                continue
            previous = store.previous_snapshot(src["id"])
            # si una fuente devuelve muchos menos productos que antes, no se avisa de "retirados"
            partial = previous and len(products) < 0.5 * len(previous)
            if partial:
                errors.append(f"{src['id']}: solo {len(products)} de {len(previous)} productos; "
                              "no se avisará de productos retirados")
            events += detect_changes(products, previous,
                                     min_change_pct=a["min_change_pct"], min_change_abs=a["min_change_abs"],
                                     track_new=a["track_new"], track_removed=a["track_removed"] and not partial)
            store.save(run_id, products)
            all_products += products
            per_source[src["id"]] = len(products)
        events += detect_undercuts(all_products, cfg.get("my_products") or [])
        events = sort_events(events)
        status = "error" if not all_products else ("partial" if errors else "ok")
        store.finish_run(run_id, status, len(all_products), len(events), errors)

        report = {"timestamp": ts, "status": status, "products": len(all_products),
                  "sources": per_source, "errors": errors,
                  "events": [e.to_dict() for e in events]}
        (export_dir / "last_report.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        csv_path = store.export_csv(export_dir / "price_history.csv", days=90)
        html = email_html(report, events)
        (export_dir / "last_report.html").write_text(html, encoding="utf-8")

        should_notify = notify and (events or errors or a["notify_when_no_changes"])
        if should_notify:
            subject = (f"Denoro · {len(events)} cambios en la competencia" if events
                       else "Denoro · Monitor de precios: sin cambios")
            for sender in (lambda: send_telegram(telegram_text(report, events)),
                           lambda: send_email(subject, html, [csv_path])):
                try:
                    sender()
                except Exception as exc:  # un canal caído no debe tumbar al otro
                    log.error("Fallo enviando aviso: %s", exc)
                    report["errors"].append(f"aviso: {exc}")
        return report
    finally:
        store.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="monitor", description="Denoro · monitor de precios y stock")
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--env", default=".env", help="fichero con credenciales (Telegram/SMTP)")
    ap.add_argument("--no-notify", action="store_true", help="no enviar avisos (solo guardar)")
    ap.add_argument("--export", metavar="CSV", help="exportar el histórico completo y salir")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    load_env(args.env)
    try:
        cfg = load_config(args.config)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2
    if args.export:
        store = Store(cfg["storage"]["database"])
        print(store.export_csv(args.export))
        store.close()
        return 0
    report = run(cfg, notify=not args.no_notify)
    print(json.dumps({k: report[k] for k in ("timestamp", "status", "products", "sources", "errors")}
                     | {"events": len(report["events"])}, indent=2, ensure_ascii=False))
    return {"ok": 0, "partial": 0, "error": 1}[report["status"]]


if __name__ == "__main__":
    sys.exit(main())
