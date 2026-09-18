"""Cliente HTTP educado: reintentos con espera, respeto de robots.txt y pausa entre peticiones al mismo dominio."""
from __future__ import annotations

import json
import logging
import random
import time
import urllib.error
import urllib.request
import urllib.robotparser
from urllib.parse import urlsplit

log = logging.getLogger(__name__)

USER_AGENT = "DenoroPriceMonitor/2.0 (+https://github.com/denoro-automations/price-monitor)"
RETRY_STATUS = {429, 500, 502, 503, 504}


class FetchError(RuntimeError):
    pass


class HttpClient:
    def __init__(self, delay: tuple[float, float] = (1.0, 2.5), retries: int = 3,
                 timeout: float = 20, respect_robots: bool = True, user_agent: str = USER_AGENT):
        self.delay = delay
        self.retries = retries
        self.timeout = timeout
        self.respect_robots = respect_robots
        self.user_agent = user_agent
        self._last_hit: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    # --- utilidades -------------------------------------------------------
    def _wait_turn(self, host: str) -> None:
        last = self._last_hit.get(host)
        if last is not None:
            pause = random.uniform(*self.delay) - (time.monotonic() - last)
            if pause > 0:
                time.sleep(pause)
        self._last_hit[host] = time.monotonic()

    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        parts = urlsplit(url)
        base = f"{parts.scheme}://{parts.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                body = self._raw_get(base + "/robots.txt", check_robots=False)
                rp.parse(body.decode("utf-8", "replace").splitlines())
            except FetchError:
                rp = None                       # sin robots.txt accesible: permitido
            self._robots[base] = rp
        rp = self._robots[base]
        return True if rp is None else rp.can_fetch(self.user_agent, url)

    def _raw_get(self, url: str, check_robots: bool = True) -> bytes:
        if check_robots and not self.allowed(url):
            raise FetchError(f"robots.txt no permite acceder a {url}")
        host = urlsplit(url).netloc
        last_exc: Exception | None = None
        for attempt in range(1, self.retries + 1):
            self._wait_turn(host)
            req = urllib.request.Request(url, headers={
                "User-Agent": self.user_agent,
                "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
            })
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return resp.read()
            except urllib.error.HTTPError as exc:
                last_exc = exc
                if exc.code not in RETRY_STATUS:
                    raise FetchError(f"HTTP {exc.code} en {url}") from exc
                wait = float(exc.headers.get("Retry-After") or 2 ** attempt)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                last_exc = exc
                wait = 2 ** attempt
            if attempt < self.retries:
                log.warning("Reintento %d/%d en %s (%s)", attempt, self.retries - 1, url, last_exc)
                time.sleep(min(wait, 30))
        raise FetchError(f"No se pudo descargar {url}: {last_exc}")

    # --- API pública --------------------------------------------------------
    def get_text(self, url: str) -> str:
        return self._raw_get(url).decode("utf-8", "replace")

    def get_json(self, url: str):
        try:
            return json.loads(self._raw_get(url))
        except json.JSONDecodeError as exc:
            raise FetchError(f"{url} no devolvió JSON válido") from exc
