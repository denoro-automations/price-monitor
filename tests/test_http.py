import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from denoro_monitor.http import FetchError, HttpClient


class Handler(BaseHTTPRequestHandler):
    hits = {}

    def do_GET(self):
        Handler.hits[self.path] = Handler.hits.get(self.path, 0) + 1
        if self.path == "/robots.txt":
            body, code = b"User-agent: *\nDisallow: /privado\n", 200
        elif self.path == "/flaky" and Handler.hits[self.path] < 2:
            body, code = b"", 503
        elif self.path == "/flaky":
            body, code = b'{"ok": true}', 200
        elif self.path == "/404":
            body, code = b"", 404
        else:
            body, code = b"<html>hola</html>", 200
        self.send_response(code)
        self.send_header("Retry-After", "0")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class HttpClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Handler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def client(self, **kw):
        return HttpClient(delay=(0, 0), **kw)

    def test_retries_on_503(self):
        self.assertEqual(self.client().get_json(self.base + "/flaky"), {"ok": True})
        self.assertEqual(Handler.hits["/flaky"], 2)

    def test_respects_robots(self):
        c = self.client()
        self.assertEqual(c.get_text(self.base + "/publico"), "<html>hola</html>")
        with self.assertRaises(FetchError):
            c.get_text(self.base + "/privado/lista")
        self.assertEqual(self.client(respect_robots=False).get_text(self.base + "/privado/x"),
                         "<html>hola</html>")

    def test_404_fails_without_retry(self):
        with self.assertRaises(FetchError):
            self.client().get_text(self.base + "/404")
        self.assertEqual(Handler.hits["/404"], 1)

    def test_invalid_json(self):
        with self.assertRaises(FetchError):
            self.client().get_json(self.base + "/publico")
