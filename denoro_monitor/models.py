from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class Product:
    """Un producto observado en una web de la competencia."""
    source: str
    key: str                 # identificador estable dentro de la fuente (handle, sku, url)
    name: str
    price: float | None
    currency: str = ""
    in_stock: bool | None = None
    url: str = ""
    regular_price: float | None = None   # precio sin rebaja, si la web lo muestra
    extra: dict = field(default_factory=dict)

    @property
    def on_sale(self) -> bool:
        return (self.price is not None and self.regular_price is not None
                and self.regular_price > self.price)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["on_sale"] = self.on_sale
        return d


@dataclass
class Event:
    """Algo que merece un aviso."""
    kind: str                # price_drop, price_rise, out_of_stock, back_in_stock, new_product, removed_product, undercut
    product: Product
    old_price: float | None = None
    change_pct: float | None = None
    my_price: float | None = None
    note: str = ""

    def to_dict(self) -> dict:
        return {"kind": self.kind, "product": self.product.to_dict(), "old_price": self.old_price,
                "change_pct": self.change_pct, "my_price": self.my_price, "note": self.note}
