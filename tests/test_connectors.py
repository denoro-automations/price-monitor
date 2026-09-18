import unittest

from denoro_monitor.connectors import fetch_source
from tests.helpers import FakeHttp

BOOKS = {"id": "books", "type": "css", "url": "https://books.toscrape.com/catalogue/page-1.html",
         "currency": "GBP",
         "selectors": {"item": "article.product_pod", "name": "h3 a@title", "link": "h3 a@href",
                       "price": ".price_color", "stock": ".availability", "next": "li.next a@href"}}


class CssConnectorTest(unittest.TestCase):
    def test_follows_pagination_and_parses(self):
        http = FakeHttp({"page-1": "books_page1.html", "page-2": "books_page2.html"})
        products = {p.name: p for p in fetch_source(BOOKS, http)}
        self.assertEqual(len(http.calls), 2)
        self.assertEqual(len(products), 3)
        attic = products["A Light in the Attic"]
        self.assertEqual(attic.price, 51.77)
        self.assertEqual(attic.currency, "GBP")
        self.assertTrue(attic.in_stock)
        self.assertEqual(attic.url,
                         "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html")
        self.assertFalse(products["Soumission"].in_stock)

    def test_stops_on_pagination_loop(self):
        http = FakeHttp({"page-1": "books_page1.html", "page-2": "books_page1.html"})
        cfg = {**BOOKS, "selectors": {**BOOKS["selectors"], "next": "li.next a@href"}}
        fetch_source(cfg, http)
        self.assertEqual(len(http.calls), 2)       # page-1 -> page-2 -> page-2 (visto) -> fin


class ShopifyConnectorTest(unittest.TestCase):
    def test_variants_and_sale(self):
        http = FakeHttp({"products.json": "shopify_products.json"})
        cfg = {"id": "shop", "type": "shopify", "url": "https://tienda.com/", "currency": "EUR"}
        products = {p.key: p for p in fetch_source(cfg, http)}
        tee = products["camiseta-organica"]
        self.assertEqual(tee.price, 24.9)               # precio mínimo entre variantes
        self.assertEqual(tee.regular_price, 29.9)
        self.assertTrue(tee.on_sale)
        self.assertTrue(tee.in_stock)                   # basta una variante disponible
        self.assertEqual(tee.url, "https://tienda.com/products/camiseta-organica")
        self.assertFalse(products["sudadera-capucha"].in_stock)
        self.assertIn("limit=250", http.calls[0])
        self.assertEqual(len(http.calls), 1)            # < 250 productos: no pide más páginas

    def test_collection_and_pagination(self):
        full = {"products": [{"id": i, "title": f"P{i}", "handle": f"p{i}",
                              "variants": [{"price": "1.00", "available": True}]} for i in range(250)]}
        pages = {"page=1": full, "page=2": {"products": []}}
        http = FakeHttp({k: v for k, v in pages.items()})
        cfg = {"id": "s", "type": "shopify", "url": "https://t.com", "collection": "ofertas"}
        products = fetch_source(cfg, http)
        self.assertEqual(len(products), 250)
        self.assertIn("/collections/ofertas/products.json", http.calls[0])
        self.assertEqual(len(http.calls), 2)


class WooConnectorTest(unittest.TestCase):
    def test_minor_units(self):
        http = FakeHttp({"wc/store": "woo_products.json"})
        cfg = {"id": "woo", "type": "woocommerce", "url": "https://tienda.es"}
        products = {p.name: p for p in fetch_source(cfg, http)}
        mug = products["Taza Cerámica"]
        self.assertEqual((mug.price, mug.regular_price, mug.currency, mug.key), (9.9, 12.9, "EUR", "TAZ-01"))
        self.assertIsNone(products["Gorra"].regular_price)   # sin rebaja
        self.assertEqual(products["Gorra"].key, "11")        # sin SKU: usa el id
        self.assertFalse(products["Gorra"].in_stock)

    def test_unknown_type(self):
        with self.assertRaises(ValueError):
            fetch_source({"id": "x", "type": "magento", "url": "u"}, FakeHttp({}))
