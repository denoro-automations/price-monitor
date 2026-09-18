"""Conversión robusta de textos de precio: '£51.77', '1.299,00 €', '$1,299', 'Desde 9,95€'."""
from __future__ import annotations

import re

_SYMBOLS = {"€": "EUR", "£": "GBP", "$": "USD", "US$": "USD"}
_NUM = re.compile(r"\d[\d.,\s  ]*")


def parse_price(text: str | None) -> float | None:
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    m = _NUM.search(str(text))
    if not m:
        return None
    raw = re.sub(r"[\s  ]", "", m.group(0)).rstrip(".,")
    if "," in raw and "." in raw:
        # el separador que aparece último es el decimal
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
    elif "," in raw:
        head, _, tail = raw.rpartition(",")
        raw = (head.replace(",", "") + "." + tail) if len(tail) in (1, 2) else raw.replace(",", "")
    elif raw.count(".") > 1 or ("." in raw and len(raw.rpartition(".")[2]) == 3):
        raw = raw.replace(".", "")          # 1.299 -> miles
    try:
        return round(float(raw), 2)
    except ValueError:
        return None


def detect_currency(text: str | None) -> str:
    if not text:
        return ""
    for sym in ("US$", "€", "£", "$"):
        if sym in text:
            return _SYMBOLS[sym]
    m = re.search(r"\b(EUR|USD|GBP|MXN|CHF)\b", text.upper())
    return m.group(1) if m else ""
