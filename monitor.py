#!/usr/bin/env python3
"""Denoro Automations — Monitor de precios y stock de la competencia.

Uso:  python monitor.py --config config.yaml
"""
import sys

from denoro_monitor.cli import main

if __name__ == "__main__":
    sys.exit(main())
