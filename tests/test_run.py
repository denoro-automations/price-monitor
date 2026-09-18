import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from denoro_monitor.cli import main, run
from denoro_monitor.config import DEFAULTS, ConfigError, load_config, validate
from denoro_monitor.http import FetchError
from denoro_monitor.models import Product
from denoro_monitor.notify import _chunks, build_email
from denoro_monitor.report import email_html, telegram_text
from denoro_monitor.storage import Store


def make_cfg(tmp, sources=None, **alerts):
    cfg = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULTS.items()}
    cfg["sources"] = sources or [{"id": "shop", "type": "shopify", "url": "https://t.com"}]
    cfg["storage"] = {"database": f"{tmp}/h.sqlite", "export_dir": f"{tmp}/out"}
    cfg["alerts"] = {**cfg["alerts"], **alerts}
    return cfg


class FakeFetch:
    """Devuelve una lista distinta de productos en cada ejecución."""

    def __init__(self, *runs):
        self.runs = list(runs)

    def __call__(self, src, http):
        result = self.runs.pop(0)
        if isinstance(result, Exception):
            raise result
        return [Product(source=src["id"], key=k, name=k, price=p, in_stock=s, currency="EUR", url=f"https://t.com/{k}")
                for k, p, s in result]


class RunTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_two_runs_detect_changes_and_write_outputs(self):
        cfg = make_cfg(self.tmp)
        cfg["my_products"] = [{"name": "Mi camiseta", "my_price": 20, "competitors": {"shop": "tee"}}]
        fetch = FakeFetch([("tee", 25.0, True), ("mug", 10.0, True)],
                          [("tee", 19.0, True), ("mug", 10.0, False)])
        first = run(cfg, notify=False, fetch=fetch, now="2026-09-01T08:00:00+00:00")
        self.assertEqual((first["status"], first["products"], first["events"]), ("ok", 2, []))
        second = run(cfg, notify=False, fetch=fetch, now="2026-09-01T14:00:00+00:00")
        kinds = [e["kind"] for e in second["events"]]
        self.assertEqual(kinds, ["undercut", "price_drop", "out_of_stock"])
        out = Path(self.tmp, "out")
        self.assertEqual(json.loads((out / "last_report.json").read_text())["products"], 2)
        self.assertIn("Te están ganando en precio", (out / "last_report.html").read_text())
        csv_rows = (out / "price_history.csv").read_text().strip().splitlines()
        self.assertEqual(len(csv_rows), 5)       # cabecera + 2 productos x 2 ejecuciones
        store = Store(cfg["storage"]["database"])
        self.assertEqual([p for _, p in store.price_history("shop", "tee")], [25.0, 19.0])
        store.close()

    def test_failing_source_does_not_stop_others(self):
        cfg = make_cfg(self.tmp, sources=[{"id": "bad", "type": "shopify", "url": "https://x"},
                                          {"id": "good", "type": "shopify", "url": "https://y"}])
        report = run(cfg, notify=False, fetch=FakeFetch(FetchError("HTTP 403"), [("a", 1.0, True)]))
        self.assertEqual(report["status"], "partial")
        self.assertEqual(report["sources"], {"good": 1})
        self.assertIn("bad: HTTP 403", report["errors"][0])

    def test_all_sources_fail(self):
        report = run(make_cfg(self.tmp), notify=False, fetch=FakeFetch(FetchError("caída")))
        self.assertEqual(report["status"], "error")

    def test_partial_scrape_does_not_flag_removed(self):
        cfg = make_cfg(self.tmp)
        many = [(f"p{i}", 1.0, True) for i in range(10)]
        fetch = FakeFetch(many, many[:2])
        run(cfg, notify=False, fetch=fetch)
        report = run(cfg, notify=False, fetch=fetch)
        self.assertEqual([e["kind"] for e in report["events"]], [])
        self.assertIn("no se avisará", report["errors"][0])

    def test_notifications_sent_only_with_changes(self):
        cfg = make_cfg(self.tmp)
        fetch = FakeFetch([("a", 10.0, True)], [("a", 10.0, True)], [("a", 5.0, True)])
        with mock.patch("denoro_monitor.cli.send_telegram") as tg, \
                mock.patch("denoro_monitor.cli.send_email") as mail:
            run(cfg, fetch=fetch)
            run(cfg, fetch=fetch)
            self.assertEqual(tg.call_count, 0)
            mail.side_effect = RuntimeError("SMTP caído")
            report = run(cfg, fetch=fetch)
        self.assertEqual(tg.call_count, 1)
        self.assertIn("aviso: SMTP caído", report["errors"])
        self.assertIn("📉", tg.call_args[0][0])

    def test_main_with_bad_config(self):
        path = Path(self.tmp, "c.yaml")
        path.write_text("sources: []\n")
        self.assertEqual(main(["--config", str(path), "--env", "/nope"]), 2)


class ConfigTest(unittest.TestCase):
    def test_example_config_is_valid(self):
        cfg = load_config(Path(__file__).parent.parent / "config.example.yaml")
        self.assertEqual(cfg["sources"][0]["id"], "books-toscrape")
        self.assertEqual(cfg["http"]["retries"], 3)

    def test_validation_errors(self):
        bad = [
            {"sources": [{"id": "a"}]},
            {"sources": [{"id": "a", "url": "u"}, {"id": "a", "url": "u"}]},
            {"sources": [{"id": "a", "url": "u", "type": "css", "selectors": {"item": "x"}}]},
            {"sources": [{"id": "a", "url": "u", "type": "shopify"}],
             "my_products": [{"name": "x", "my_price": 1, "competitors": {"zzz": "k"}}]},
        ]
        for cfg in bad:
            with self.subTest(cfg=cfg), self.assertRaises(ConfigError):
                validate(cfg)


class OutputTest(unittest.TestCase):
    def test_telegram_chunks_and_escaping(self):
        from denoro_monitor.models import Event
        p = Product(source="s", key="k", name="<Taza & plato>", price=5, currency="EUR")
        events = [Event("price_drop", p, old_price=10, change_pct=-50.0)] * 30
        text = telegram_text({"products": 1, "sources": {"s": 1}, "errors": []}, events)
        self.assertIn("&lt;Taza &amp; plato&gt;", text)
        self.assertIn("… y 20 más", text)
        self.assertIn("10,00 € → 5,00 €", text)
        self.assertTrue(all(len(c) <= 4000 for c in _chunks("x" * 50 + "\n" * 1 + ("y" * 100 + "\n") * 100)))

    def test_email_with_attachment(self):
        tmp = Path(tempfile.mkdtemp(), "h.csv")
        tmp.write_text("a,b\n")
        html = email_html({"timestamp": "t", "products": 0, "sources": {}, "errors": ["x: fallo"]}, [])
        self.assertIn("Sin cambios", html)
        msg = build_email("Asunto", html, "yo@x.com", ["a@x.com", "b@x.com"], [tmp])
        self.assertEqual(msg["To"], "a@x.com, b@x.com")
        self.assertEqual([a.get_filename() for a in msg.iter_attachments()], ["h.csv"])


if __name__ == "__main__":
    unittest.main()
