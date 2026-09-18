"""Textos del aviso: HTML para email y texto plano para Telegram."""
from __future__ import annotations

from collections import Counter
from html import escape

from .models import Event

LABELS = {
    "undercut": ("Te están ganando en precio", "🔻"),
    "price_drop": ("Bajadas de precio", "📉"),
    "out_of_stock": ("Se han quedado sin stock", "⛔"),
    "back_in_stock": ("Vuelven a tener stock", "✅"),
    "price_rise": ("Subidas de precio", "📈"),
    "new_product": ("Productos nuevos", "🆕"),
    "removed_product": ("Productos retirados", "🗑️"),
}


def money(value: float | None, currency: str = "") -> str:
    if value is None:
        return "—"
    txt = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    sym = {"EUR": " €", "USD": " $", "GBP": " £"}.get(currency, f" {currency}" if currency else "")
    return txt + sym


def _line(e: Event) -> str:
    p = e.product
    if e.kind == "undercut":
        return (f"{p.name} ({p.source}): {money(p.price, p.currency)} vs tu "
                f"{money(e.my_price, p.currency)} ({e.change_pct:+.1f}%)")
    if e.kind in ("price_drop", "price_rise"):
        return (f"{p.name} ({p.source}): {money(e.old_price, p.currency)} → "
                f"{money(p.price, p.currency)} ({e.change_pct:+.1f}%)")
    return f"{p.name} ({p.source}) — {money(p.price, p.currency)}"


def summary_counts(events: list[Event]) -> Counter:
    return Counter(e.kind for e in events)


def telegram_text(report: dict, events: list[Event], max_per_group: int = 10) -> str:
    counts = summary_counts(events)
    lines = [f"<b>Denoro · Monitor de precios</b>",
             f"{report['products']} productos revisados en {len(report['sources'])} webs · "
             f"{len(events)} cambios"]
    for kind, (label, icon) in LABELS.items():
        group = [e for e in events if e.kind == kind]
        if not group:
            continue
        lines.append(f"\n{icon} <b>{label}</b> ({counts[kind]})")
        for e in group[:max_per_group]:
            lines.append("• " + escape(_line(e)))
        if len(group) > max_per_group:
            lines.append(f"… y {len(group) - max_per_group} más (ver email/CSV)")
    if report.get("errors"):
        lines.append("\n⚠️ <b>Fuentes con error</b>")
        lines += ["• " + escape(err) for err in report["errors"]]
    return "\n".join(lines)


def email_html(report: dict, events: list[Event]) -> str:
    counts = summary_counts(events)
    tiles = "".join(
        f'<td style="padding:12px;background:#f4f6f8;border-radius:8px;text-align:center">'
        f'<div style="font-size:22px;font-weight:700;color:#0f2a3d">{v}</div>'
        f'<div style="font-size:12px;color:#5b6b7a">{escape(lbl)}</div></td>'
        for v, lbl in [(report["products"], "productos revisados"),
                       (counts["price_drop"] + counts["undercut"], "bajadas / te ganan"),
                       (counts["out_of_stock"], "sin stock"),
                       (len(events), "cambios totales")])
    sections = []
    for kind, (label, icon) in LABELS.items():
        group = [e for e in events if e.kind == kind]
        if not group:
            continue
        rows = "".join(
            f'<tr><td style="padding:6px 8px;border-bottom:1px solid #e6eaee">'
            f'<a href="{escape(e.product.url)}" style="color:#0f2a3d">{escape(e.product.name)}</a></td>'
            f'<td style="padding:6px 8px;border-bottom:1px solid #e6eaee;color:#5b6b7a">{escape(e.product.source)}</td>'
            f'<td style="padding:6px 8px;border-bottom:1px solid #e6eaee;text-align:right">'
            f'{escape(money(e.old_price if e.old_price is not None else e.my_price, e.product.currency)) if (e.old_price is not None or e.my_price is not None) else ""}</td>'
            f'<td style="padding:6px 8px;border-bottom:1px solid #e6eaee;text-align:right;font-weight:600">'
            f'{escape(money(e.product.price, e.product.currency))}</td>'
            f'<td style="padding:6px 8px;border-bottom:1px solid #e6eaee;text-align:right;'
            f'color:{"#b42318" if (e.change_pct or 0) < 0 else "#067647"}">'
            f'{"" if e.change_pct is None else f"{e.change_pct:+.1f}%"}</td></tr>'
            for e in group)
        sections.append(
            f'<h3 style="margin:24px 0 8px;font-size:16px">{icon} {escape(label)} ({len(group)})</h3>'
            f'<table width="100%" cellspacing="0" style="border-collapse:collapse;font-size:14px">'
            f'<tr style="color:#5b6b7a;font-size:12px;text-align:left"><th style="padding:6px 8px">Producto</th>'
            f'<th style="padding:6px 8px">Web</th><th style="padding:6px 8px;text-align:right">Antes / tu precio</th>'
            f'<th style="padding:6px 8px;text-align:right">Ahora</th><th style="padding:6px 8px;text-align:right">Cambio</th></tr>'
            f'{rows}</table>')
    errors = ""
    if report.get("errors"):
        errors = ('<p style="margin-top:24px;padding:12px;background:#fef3f2;border-radius:8px;color:#b42318">'
                  "<b>Fuentes con error:</b><br>" + "<br>".join(escape(x) for x in report["errors"]) + "</p>")
    body = "".join(sections) or '<p style="color:#5b6b7a">Sin cambios desde la última revisión.</p>'
    return f"""<!doctype html><html><body style="margin:0;background:#eef1f4;font-family:Arial,Helvetica,sans-serif;color:#1d2939">
<table width="100%" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="640" cellspacing="0" style="background:#fff;border-radius:12px;padding:28px">
<tr><td><div style="font-size:12px;letter-spacing:.08em;color:#5b6b7a;text-transform:uppercase">Denoro Automations</div>
<h2 style="margin:4px 0 4px;font-size:22px;color:#0f2a3d">Monitor de precios de la competencia</h2>
<div style="color:#5b6b7a;font-size:13px">{escape(report['timestamp'])} · {len(report['sources'])} webs</div>
<table width="100%" cellspacing="8" style="margin-top:16px"><tr>{tiles}</tr></table>
{body}{errors}
<p style="margin-top:28px;font-size:12px;color:#98a2b3">Adjunto: histórico completo en CSV.</p>
</td></tr></table></td></tr></table></body></html>"""
