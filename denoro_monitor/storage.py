"""Histórico en SQLite: cada ejecución guarda una foto de todos los productos."""
from __future__ import annotations

import csv
import sqlite3
from pathlib import Path

from .models import Product

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    products INTEGER DEFAULT 0,
    events INTEGER DEFAULT 0,
    errors TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS observations (
    run_id INTEGER NOT NULL REFERENCES runs(id),
    source TEXT NOT NULL,
    key TEXT NOT NULL,
    name TEXT,
    price REAL,
    regular_price REAL,
    currency TEXT,
    in_stock INTEGER,
    url TEXT,
    PRIMARY KEY (run_id, source, key)
);
CREATE INDEX IF NOT EXISTS idx_obs_product ON observations(source, key);
"""


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    def close(self) -> None:
        self.db.close()

    def start_run(self, ts: str) -> int:
        cur = self.db.execute("INSERT INTO runs(started_at) VALUES (?)", (ts,))
        self.db.commit()
        return cur.lastrowid

    def finish_run(self, run_id: int, status: str, products: int, events: int, errors: list[str]) -> None:
        self.db.execute("UPDATE runs SET status=?, products=?, events=?, errors=? WHERE id=?",
                        (status, products, events, "\n".join(errors), run_id))
        self.db.commit()

    def previous_snapshot(self, source: str) -> dict[str, Product]:
        """Última foto guardada de una fuente (la de la ejecución anterior que la leyó bien)."""
        row = self.db.execute("SELECT MAX(run_id) FROM observations WHERE source=?", (source,)).fetchone()
        if not row or row[0] is None:
            return {}
        rows = self.db.execute("SELECT * FROM observations WHERE source=? AND run_id=?", (source, row[0]))
        return {r["key"]: Product(source=r["source"], key=r["key"], name=r["name"], price=r["price"],
                                  regular_price=r["regular_price"], currency=r["currency"] or "",
                                  in_stock=None if r["in_stock"] is None else bool(r["in_stock"]),
                                  url=r["url"] or "")
                for r in rows}

    def save(self, run_id: int, products: list[Product]) -> None:
        self.db.executemany(
            "INSERT OR REPLACE INTO observations VALUES (?,?,?,?,?,?,?,?,?)",
            [(run_id, p.source, p.key, p.name, p.price, p.regular_price, p.currency,
              None if p.in_stock is None else int(p.in_stock), p.url) for p in products])
        self.db.commit()

    def export_csv(self, dest: str | Path, days: int | None = None) -> Path:
        dest = Path(dest)
        query = ("SELECT r.started_at AS timestamp, o.source, o.key, o.name, o.price, o.regular_price, "
                 "o.currency, o.in_stock, o.url FROM observations o JOIN runs r ON r.id=o.run_id")
        params: tuple = ()
        if days:
            query += " WHERE r.started_at >= datetime('now', ?)"
            params = (f"-{int(days)} days",)
        rows = self.db.execute(query + " ORDER BY r.started_at, o.source, o.name", params).fetchall()
        with dest.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["timestamp", "source", "key", "name", "price", "regular_price",
                        "currency", "in_stock", "url"])
            w.writerows([tuple(r) for r in rows])
        return dest

    def price_history(self, source: str, key: str) -> list[tuple[str, float]]:
        rows = self.db.execute(
            "SELECT r.started_at, o.price FROM observations o JOIN runs r ON r.id=o.run_id "
            "WHERE o.source=? AND o.key=? ORDER BY r.started_at", (source, key))
        return [(r[0], r[1]) for r in rows]
