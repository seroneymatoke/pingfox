"""Verification email delivery with a testable local transport."""

from email.message import EmailMessage
from html import escape
import os
import smtplib
from urllib.parse import urlparse

from flask import current_app


def send_verification_email(recipient: str, verification_url: str) -> None:
    if current_app.testing:
        current_app.extensions.setdefault("pingfox_test_emails", []).append({"to": recipient, "url": verification_url})
        return

    sender = os.environ.get("PINGFOX_GMAIL_ADDRESS", "")
    password = os.environ.get("PINGFOX_GMAIL_PASSWORD", "")
    if not sender or not password:
        raise RuntimeError("Email delivery is not configured")

    message = EmailMessage()
    message["Subject"] = "Confirm your PingFox email"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(f"Welcome to PingFox. Confirm your email address to finish creating your account:\n\n{verification_url}\n\nIf the button in the email does not work, copy and paste the link above into your browser.\n\nThis link expires in 24 hours.\n\nThis email was sent to {recipient} because a PingFox account was created using this email address. If you did not create this account, you can safely ignore this email; no account will be activated until the address is verified.")
    safe_verification_url = escape(verification_url, quote=True)
    safe_recipient = escape(recipient)
    parsed_url = urlparse(verification_url)
    logo_url = escape(f"{parsed_url.scheme}://{parsed_url.netloc}/pingfox-favicon.svg", quote=True)
    message.add_alternative(f"""
      <!doctype html><html><body style="margin:0;background:#0a0b0f;color:#f3f1ec;font-family:Arial,sans-serif">
        <div style="padding:40px 20px;background:#0a0b0f">
          <div style="max-width:520px;margin:0 auto;padding:36px;background:#15161d;border:1px solid #2d2e38;border-radius:16px">
            <div style="display:flex;align-items:center;font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#f3f1ec"><img src="{logo_url}" width="32" height="32" alt="PingFox fox mark" style="display:block;margin-right:9px;border-radius:8px" />PingFox</div>
            <div style="margin-top:42px;color:#ff6b3d;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Confirm your email</div>
            <h1 style="margin:10px 0 0;font-family:Georgia,serif;font-size:36px;line-height:1.1;color:#f3f1ec">Keep the cash moving.</h1>
            <p style="margin:18px 0 0;color:#9b9ca6;font-size:15px;line-height:1.7">Confirm your email to finish creating your PingFox account and start setting up your workspace.</p>
            <p style="margin:28px 0 16px"><a href="{safe_verification_url}" style="display:inline-block;padding:14px 22px;background:#ff6b3d;color:#17100d;border-radius:9px;font-weight:bold;text-decoration:none">Confirm email <span style="font-size:18px">→</span></a></p>
            <p style="margin:0 0 20px;color:#777985;font-size:12px;line-height:1.6">Button not working? Copy and paste this link into your browser:<br><a href="{safe_verification_url}" style="display:block;margin-top:6px;color:#ff8a65;text-decoration:underline;word-break:break-all">{safe_verification_url}</a></p>
            <p style="margin:0;color:#777985;font-size:12px;line-height:1.6">This link expires in 24 hours. This email was sent to <strong style="color:#9b9ca6">{safe_recipient}</strong> because a PingFox account was created using this email address. If you did not create this account, you can safely ignore this email; no account will be activated until the address is verified.</p>
          </div>
          <p style="max-width:520px;margin:18px auto 0;color:#666873;text-align:center;font-size:11px">Gentle nudges, real results.</p>
        </div>
      </body></html>
    """, subtype="html")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
        smtp.login(sender, password)
        smtp.send_message(message)
