import unittest

from denoro_monitor.compare import detect_changes, detect_undercuts, sort_events
from denoro_monitor.models import Product


def P(key, price, stock=True, source="s"):
    return Product(source=source, key=key, name=key.upper(), price=price, in_stock=stock, url=f"u/{key}")


class DetectChangesTest(unittest.TestCase):
    def test_first_run_is_baseline(self):
        self.assertEqual(detect_changes([P("a", 10)], {}), [])

    def test_all_event_kinds(self):
        prev = {k: p for k, p in [("a", P("a", 10)), ("b", P("b", 10)), ("c", P("c", 10)),
                                   ("d", P("d", 10, stock=False)), ("gone", P("gone", 5))]}
        cur = [P("a", 8), P("b", 12), P("c", 10, stock=False), P("d", 10), P("new", 3)]
        kinds = sorted(e.kind for e in detect_changes(cur, prev))
        self.assertEqual(kinds, ["back_in_stock", "new_product", "out_of_stock",
                                 "price_drop", "price_rise", "removed_product"])
        drop = next(e for e in detect_changes(cur, prev) if e.kind == "price_drop")
        self.assertEqual((drop.old_price, drop.change_pct), (10, -20.0))

    def test_thresholds(self):
        prev = {"a": P("a", 100), "b": P("b", 100)}
        cur = [P("a", 99.5), P("b", 97)]
        events = detect_changes(cur, prev, min_change_pct=1.0)
        self.assertEqual([e.product.key for e in events], ["b"])
        self.assertEqual(detect_changes([P("a", 100.004)], {"a": P("a", 100)}, min_change_abs=0.01), [])

    def test_can_disable_new_and_removed(self):
        events = detect_changes([P("new", 1)], {"old": P("old", 1)}, track_new=False, track_removed=False)
        self.assertEqual(events, [])

    def test_missing_price_is_ignored(self):
        self.assertEqual(detect_changes([P("a", None)], {"a": P("a", 10)}), [])


class UndercutTest(unittest.TestCase):
    def test_by_key_and_url_with_tolerance(self):
        cur = [P("a", 9.0), P("b", 9.9)]
        watch = [{"name": "Mi A", "my_price": 10, "competitors": {"s": "a"}},
                 {"name": "Mi B", "my_price": 10, "tolerance_pct": 2, "competitors": {"s": "u/b"}},
                 {"name": "Mi C", "my_price": 10, "competitors": {"s": "no-existe"}}]
        events = detect_undercuts(cur, watch)
        self.assertEqual([(e.note, e.change_pct) for e in events], [("Mi A", -10.0)])

    def test_sorting_puts_undercuts_first(self):
        prev = {"a": P("a", 10)}
        events = detect_changes([P("a", 5)], prev) + detect_undercuts(
            [P("a", 5)], [{"my_price": 6, "competitors": {"s": "a"}}])
        self.assertEqual([e.kind for e in sort_events(events)], ["undercut", "price_drop"])
