"""Envío de avisos por Telegram y por email (SMTP). Las credenciales se leen de variables de entorno."""
from __future__ import annotations

import json
import logging
import os
import smtplib
import ssl
import urllib.request
from email.message import EmailMessage
from pathlib import Path

log = logging.getLogger(__name__)
TELEGRAM_LIMIT = 4000


def _chunks(text: str, size: int = TELEGRAM_LIMIT) -> list[str]:
    parts, current = [], ""
    for line in text.split("\n"):
        if len(current) + len(line) + 1 > size and current:
            parts.append(current)
            current = ""
        current += line + "\n"
    if current.strip():
        parts.append(current)
    return parts


def send_telegram(text: str, token: str | None = None, chat_id: str | None = None) -> int:
    token = token or os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = chat_id or os.getenv("TELEGRAM_CHAT_ID")
    if not (token and chat_id):
        log.info("Telegram no configurado: se omite")
        return 0
    sent = 0
    for part in _chunks(text):
        payload = json.dumps({"chat_id": chat_id, "text": part, "parse_mode": "HTML",
                              "disable_web_page_preview": True}).encode()
        req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=payload,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            if json.loads(resp.read()).get("ok"):
                sent += 1
    log.info("Telegram: %d mensaje(s) enviados", sent)
    return sent


def build_email(subject: str, html: str, sender: str, to: list[str],
                attachments: list[Path] = ()) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, sender, ", ".join(to)
    msg.set_content("Tu cliente de correo no muestra HTML. Abre el CSV adjunto para ver los datos.")
    msg.add_alternative(html, subtype="html")
    for path in attachments:
        path = Path(path)
        subtype = "csv" if path.suffix == ".csv" else "octet-stream"
        maintype = "text" if subtype == "csv" else "application"
        msg.add_attachment(path.read_bytes(), maintype=maintype, subtype=subtype, filename=path.name)
    return msg


def send_email(subject: str, html: str, attachments: list[Path] = ()) -> bool:
    host = os.getenv("SMTP_HOST")
    to = [x.strip() for x in os.getenv("EMAIL_TO", "").split(",") if x.strip()]
    if not (host and to):
        log.info("Email no configurado: se omite")
        return False
    user, password = os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASSWORD", "")
    port = int(os.getenv("SMTP_PORT", "587"))
    msg = build_email(subject, html, os.getenv("EMAIL_FROM", user), to, attachments)
    ctx = ssl.create_default_context()
    if port == 465:
        server = smtplib.SMTP_SSL(host, port, context=ctx, timeout=30)
    else:
        server = smtplib.SMTP(host, port, timeout=30)
        server.starttls(context=ctx)
    with server:
        if user:
            server.login(user, password)
        server.send_message(msg)
    log.info("Email enviado a %s", ", ".join(to))
    return True
