"""Detección de cambios entre dos fotos de una fuente."""
from __future__ import annotations

from .models import Event, Product


def detect_changes(current: list[Product], previous: dict[str, Product], *,
                   min_change_pct: float = 0.0, min_change_abs: float = 0.01,
                   track_new: bool = True, track_removed: bool = True) -> list[Event]:
    events: list[Event] = []
    if not previous:                       # primera ejecución: solo se guarda la base
        return events
    seen = set()
    for p in current:
        seen.add(p.key)
        old = previous.get(p.key)
        if old is None:
            if track_new:
                events.append(Event("new_product", p))
            continue
        if p.price is not None and old.price:
            delta = p.price - old.price
            pct = round(delta / old.price * 100, 2)
            if abs(delta) >= min_change_abs and abs(pct) >= min_change_pct:
                events.append(Event("price_drop" if delta < 0 else "price_rise", p,
                                    old_price=old.price, change_pct=pct))
        if old.in_stock is True and p.in_stock is False:
            events.append(Event("out_of_stock", p))
        elif old.in_stock is False and p.in_stock is True:
            events.append(Event("back_in_stock", p))
    if track_removed:
        for key, old in previous.items():
            if key not in seen:
                events.append(Event("removed_product", old))
    return events


def detect_undercuts(current: list[Product], watchlist: list[dict]) -> list[Event]:
    """Avisa cuando un competidor vende por debajo de tu precio (tabla 'my_products' de la config)."""
    index = {(p.source, p.key): p for p in current}
    by_url = {(p.source, p.url): p for p in current}
    events = []
    for item in watchlist:
        my_price = float(item["my_price"])
        margin = float(item.get("tolerance_pct", 0))
        for source, ref in (item.get("competitors") or {}).items():
            p = index.get((source, ref)) or by_url.get((source, ref))
            if p is None or p.price is None:
                continue
            if p.price < my_price * (1 - margin / 100):
                pct = round((p.price - my_price) / my_price * 100, 2)
                events.append(Event("undercut", p, my_price=my_price, change_pct=pct,
                                    note=item.get("name", "")))
    return events


PRIORITY = ["undercut", "price_drop", "out_of_stock", "back_in_stock", "price_rise",
            "new_product", "removed_product"]


def sort_events(events: list[Event]) -> list[Event]:
    return sorted(events, key=lambda e: (PRIORITY.index(e.kind), e.change_pct or 0))
