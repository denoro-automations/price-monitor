import json
from pathlib import Path

FIX = Path(__file__).parent / "fixtures"


class FakeHttp:
    """Sustituye a HttpClient: sirve ficheros locales según la URL pedida."""

    def __init__(self, routes: dict):
        self.routes = routes
        self.calls = []

    def _body(self, url):
        self.calls.append(url)
        for fragment, target in self.routes.items():
            if fragment in url:
                return target(url) if callable(target) else target
        raise AssertionError(f"URL inesperada: {url}")

    def get_text(self, url):
        body = self._body(url)
        return (FIX / body).read_text(encoding="utf-8") if body.endswith(".html") else body

    def get_json(self, url):
        body = self._body(url)
        if isinstance(body, str) and body.endswith(".json"):
            return json.loads((FIX / body).read_text(encoding="utf-8"))
        return body
