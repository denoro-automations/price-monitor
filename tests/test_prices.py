import unittest

from denoro_monitor.prices import detect_currency, parse_price


class ParsePriceTest(unittest.TestCase):
    def test_formats(self):
        cases = {"£51.77": 51.77, "1.299,00 €": 1299.0, "$1,299.00": 1299.0, "Desde 9,95€": 9.95,
                 "1.299 €": 1299.0, "2 499,90 €": 2499.9, "12": 12.0, "0,5 €": 0.5, 19.9: 19.9}
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(parse_price(text), expected)

    def test_invalid(self):
        for text in (None, "", "Agotado"):
            self.assertIsNone(parse_price(text))

    def test_currency(self):
        self.assertEqual(detect_currency("£51.77"), "GBP")
        self.assertEqual(detect_currency("12,00 €"), "EUR")
        self.assertEqual(detect_currency("US$ 5"), "USD")
        self.assertEqual(detect_currency("12 MXN"), "MXN")
        self.assertEqual(detect_currency("12"), "")
