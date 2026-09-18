"""Conectores de tienda. Cada uno devuelve la lista completa de productos de una fuente.

- shopify:     usa el endpoint público /products.json que exponen las tiendas Shopify.
- woocommerce: usa la Store API pública /wp-json/wc/store/v1/products.
- css:         cualquier web HTML, con selectores CSS definidos en la configuración.
"""
from __future__ import annotations

import logging
from typing import Callable
from urllib.parse import urlencode, urljoin

from .http import HttpClient
from .models import Product
from .prices import detect_currency, parse_price

log = logging.getLogger(__name__)


def _base(url: str) -> str:
    return url.rstrip("/")


# --------------------------------------------------------------------------- Shopify
def parse_shopify(data: dict, source: str, base_url: str, currency: str = "") -> list[Product]:
    out = []
    for p in data.get("products", []):
        variants = p.get("variants") or [{}]
        prices = [parse_price(v.get("price")) for v in variants if v.get("price") is not None]
        compare = [parse_price(v.get("compare_at_price")) for v in variants if v.get("compare_at_price")]
        price = min(prices) if prices else None
        regular = max(compare) if compare else None
        out.append(Product(
            source=source,
            key=p.get("handle") or str(p.get("id")),
            name=p.get("title", "").strip(),
            price=price,
            regular_price=regular if regular and price and regular > price else None,
            currency=currency,
            in_stock=any(bool(v.get("available")) for v in variants),
            url=f"{_base(base_url)}/products/{p.get('handle')}",
            extra={"vendor": p.get("vendor", ""), "type": p.get("product_type", ""),
                   "variants": len(variants)},
        ))
    return out


def fetch_shopify(cfg: dict, http: HttpClient) -> list[Product]:
    base = _base(cfg["url"])
    path = f"/collections/{cfg['collection']}/products.json" if cfg.get("collection") else "/products.json"
    products: list[Product] = []
    for page in range(1, int(cfg.get("max_pages", 20)) + 1):
        data = http.get_json(f"{base}{path}?{urlencode({'limit': 250, 'page': page})}")
        batch = parse_shopify(data, cfg["id"], base, cfg.get("currency", ""))
        if not batch:
            break
        products.extend(batch)
        if len(batch) < 250:
            break
    return products


# ----------------------------------------------------------------------- WooCommerce
def parse_woocommerce(items: list, source: str) -> list[Product]:
    out = []
    for p in items:
        pr = p.get("prices", {})
        unit = int(pr.get("currency_minor_unit", 2))
        conv = lambda v: round(int(v) / 10 ** unit, 2) if v not in (None, "") else None  # noqa: E731
        price, regular = conv(pr.get("price")), conv(pr.get("regular_price"))
        out.append(Product(
            source=source,
            key=p.get("sku") or str(p.get("id")),
            name=p.get("name", "").strip(),
            price=price,
            regular_price=regular if regular and price and regular > price else None,
            currency=pr.get("currency_code", ""),
            in_stock=p.get("is_in_stock"),
            url=p.get("permalink", ""),
        ))
    return out


def fetch_woocommerce(cfg: dict, http: HttpClient) -> list[Product]:
    base = _base(cfg["url"])
    products: list[Product] = []
    for page in range(1, int(cfg.get("max_pages", 20)) + 1):
        query = {"per_page": 100, "page": page}
        if cfg.get("category"):
            query["category"] = cfg["category"]
        items = http.get_json(f"{base}/wp-json/wc/store/v1/products?{urlencode(query)}")
        if not items:
            break
        products.extend(parse_woocommerce(items, cfg["id"]))
        if len(items) < 100:
            break
    return products


# ------------------------------------------------------------------------------- CSS
def _text(node, selector: str | None) -> str | None:
    if not selector:
        return None
    attr = None
    if "@" in selector:                       # "a@href" -> atributo href del <a>
        selector, attr = selector.rsplit("@", 1)
    el = node.select_one(selector) if selector else node
    if el is None:
        return None
    return el.get(attr) if attr else el.get_text(" ", strip=True)


def parse_css(html: str, page_url: str, cfg: dict) -> tuple[list[Product], str | None]:
    from bs4 import BeautifulSoup  # dependencia solo para este conector

    sel = cfg["selectors"]
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for card in soup.select(sel["item"]):
        name = _text(card, sel.get("name")) or ""
        price_txt = _text(card, sel["price"])
        link = _text(card, sel.get("link"))
        url = urljoin(page_url, link) if link else page_url
        stock_txt = _text(card, sel.get("stock"))
        in_stock = None
        if stock_txt is not None:
            words = [w.lower() for w in cfg.get("out_of_stock_words",
                     ["out of stock", "agotado", "sin stock", "sold out", "no disponible"])]
            in_stock = not any(w in stock_txt.lower() for w in words)
        regular_txt = _text(card, sel.get("regular_price"))
        out.append(Product(
            source=cfg["id"],
            key=url if cfg.get("key", "url") == "url" else (_text(card, cfg["key"]) or url),
            name=name,
            price=parse_price(price_txt),
            regular_price=parse_price(regular_txt),
            currency=cfg.get("currency") or detect_currency(price_txt),
            in_stock=in_stock,
            url=url,
        ))
    nxt = _text(soup, sel["next"]) if sel.get("next") else None
    return out, (urljoin(page_url, nxt) if nxt else None)


def fetch_css(cfg: dict, http: HttpClient) -> list[Product]:
    products: list[Product] = []
    url, pages, seen = cfg["url"], 0, set()
    while url and url not in seen and pages < int(cfg.get("max_pages", 50)):
        seen.add(url)
        batch, url = parse_css(http.get_text(url), url, cfg)
        products.extend(batch)
        pages += 1
    return products


CONNECTORS: dict[str, Callable[[dict, HttpClient], list[Product]]] = {
    "shopify": fetch_shopify,
    "woocommerce": fetch_woocommerce,
    "css": fetch_css,
}


def fetch_source(cfg: dict, http: HttpClient) -> list[Product]:
    kind = cfg.get("type", "css")
    if kind not in CONNECTORS:
        raise ValueError(f"Tipo de fuente desconocido: {kind} (usa {', '.join(CONNECTORS)})")
    products = CONNECTORS[kind](cfg, http)
    # sin duplicados por clave (Shopify/CSS pueden repetir productos entre páginas)
    unique = {p.key: p for p in products}
    log.info("%s: %d productos", cfg["id"], len(unique))
    return list(unique.values())
