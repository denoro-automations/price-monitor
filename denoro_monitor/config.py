"""Carga de configuración (YAML) y del fichero .env."""
from __future__ import annotations

import os
from pathlib import Path

DEFAULTS = {
    "alerts": {"min_change_pct": 1.0, "min_change_abs": 0.01, "track_new": True,
               "track_removed": True, "notify_when_no_changes": False},
    "http": {"delay_min": 1.0, "delay_max": 2.5, "retries": 3, "timeout": 20, "respect_robots": True},
    "storage": {"database": "data/history.sqlite", "export_dir": "data"},
    "my_products": [],
}


class ConfigError(ValueError):
    pass


def load_env(path: str | Path = ".env") -> None:
    """Lector mínimo de .env (KEY=valor). No pisa variables ya definidas."""
    path = Path(path)
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_config(path: str | Path) -> dict:
    import yaml

    path = Path(path)
    if not path.exists():
        raise ConfigError(f"No existe {path}. Copia config.example.yaml a config.yaml y edítalo.")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    cfg = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULTS.items()}
    for k, v in raw.items():
        cfg[k] = {**cfg[k], **v} if isinstance(cfg.get(k), dict) and isinstance(v, dict) else v
    validate(cfg)
    return cfg


def validate(cfg: dict) -> None:
    sources = cfg.get("sources") or []
    if not sources:
        raise ConfigError("La configuración necesita al menos una fuente en 'sources'.")
    ids = set()
    for i, s in enumerate(sources, 1):
        for field in ("id", "url"):
            if not s.get(field):
                raise ConfigError(f"Fuente #{i}: falta '{field}'.")
        if s["id"] in ids:
            raise ConfigError(f"Fuente repetida: {s['id']}")
        ids.add(s["id"])
        kind = s.get("type", "css")
        if kind == "css":
            sel = s.get("selectors") or {}
            missing = [k for k in ("item", "price") if not sel.get(k)]
            if missing:
                raise ConfigError(f"Fuente {s['id']}: faltan selectores {missing}.")
        elif kind not in ("shopify", "woocommerce"):
            raise ConfigError(f"Fuente {s['id']}: tipo '{kind}' no soportado.")
    for item in cfg.get("my_products") or []:
        if "my_price" not in item:
            raise ConfigError(f"my_products: falta 'my_price' en {item.get('name', item)}")
        unknown = set(item.get("competitors") or {}) - ids
        if unknown:
            raise ConfigError(f"my_products '{item.get('name')}': fuentes desconocidas {sorted(unknown)}")
