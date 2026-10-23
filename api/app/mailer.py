"""Verification email delivery with a testable local transport."""

import os
import smtplib
from email.message import EmailMessage
from html import escape
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


def send_invoice_email(recipient: str, invoice, payment_url: str, sender_name: str, sender_address: str = "", sender_email: str = "") -> None:
    """Send a branded invoice with an opaque payment link and text fallback."""
    if current_app.testing:
        current_app.extensions.setdefault("pingfox_test_emails", []).append({
            "to": recipient,
            "invoice_id": invoice.id,
            "payment_url": payment_url,
        })
        return

    sender = os.environ.get("PINGFOX_GMAIL_ADDRESS", "")
    password = os.environ.get("PINGFOX_GMAIL_PASSWORD", "")
    if not sender or not password:
        raise RuntimeError("Email delivery is not configured")

    amount = f"${invoice.amount_cents / 100:,.2f}"
    invoice_label = invoice.invoice_number or str(invoice.id)
    due_date = invoice.due_date.date().isoformat()
    subject = f"Invoice {invoice_label} from {sender_name}"
    issuer_details = " · ".join(part for part in (sender_address, sender_email) if part)
    issuer_line = f"Issued by: {sender_name} ({issuer_details})" if issuer_details else f"Issued by: {sender_name}"
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        f"{sender_name} sent you invoice {invoice_label} for {amount}.\n\n"
        f"{issuer_line}\n\n"
        f"Due date: {due_date}\n\n"
        f"View and pay invoice: {payment_url}\n\n"
        "If the button does not work, copy and paste the link above into your browser. "
        "This secure link is unique to this invoice.\n\n"
        f"This email was sent to {recipient} because {sender_name} issued an invoice to this address. "
        "If you were not expecting this invoice, contact the sender before making a payment.\n\n"
        "Powered by PingFox."
    )
    safe_payment_url = escape(payment_url, quote=True)
    safe_recipient = escape(recipient)
    safe_sender_name = escape(sender_name)
    safe_invoice_label = escape(invoice_label)
    safe_due_date = escape(due_date)
    safe_amount = escape(amount)
    safe_sender_address = escape(sender_address)
    safe_sender_email = escape(sender_email)
    issuer_html = "<br>".join(part for part in (safe_sender_address, safe_sender_email) if part)
    parsed_url = urlparse(payment_url)
    logo_url = escape(f"{parsed_url.scheme}://{parsed_url.netloc}/pingfox-favicon.svg", quote=True)
    message.add_alternative(f"""
      <!doctype html><html><body style="margin:0;background:#0a0b0f;color:#f3f1ec;font-family:Arial,sans-serif">
        <div style="padding:40px 20px;background:#0a0b0f">
          <div style="max-width:560px;margin:0 auto;padding:36px;background:#15161d;border:1px solid #2d2e38;border-radius:16px">
            <div style="display:flex;align-items:center;font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#f3f1ec"><img src="{logo_url}" width="32" height="32" alt="PingFox fox mark" style="display:block;margin-right:9px;border-radius:8px" />PingFox</div>
            <div style="margin-top:42px;color:#ff6b3d;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Invoice from {safe_sender_name}</div>
            <h1 style="margin:10px 0 0;font-family:Georgia,serif;font-size:36px;line-height:1.1;color:#f3f1ec">Your invoice is ready.</h1>
            <p style="margin:18px 0 0;color:#9b9ca6;font-size:15px;line-height:1.7"><strong style="color:#f3f1ec">{safe_sender_name}</strong> sent invoice <strong style="color:#f3f1ec">{safe_invoice_label}</strong> for <strong style="color:#ff8a65">{safe_amount}</strong>.</p>
            <div style="margin:26px 0;padding:18px 20px;background:#1d1e27;border:1px solid #30313d;border-radius:12px;color:#9b9ca6;font-size:13px;line-height:1.7"><strong style="color:#f3f1ec">From {safe_sender_name}</strong>{f'<br>{issuer_html}' if issuer_html else ''}<br><br>Due date: <strong style="color:#f3f1ec">{safe_due_date}</strong></div>
            <p style="margin:28px 0 16px"><a href="{safe_payment_url}" style="display:inline-block;padding:14px 22px;background:#ff6b3d;color:#17100d;border-radius:9px;font-weight:bold;text-decoration:none">View and pay invoice <span style="font-size:18px">→</span></a></p>
            <p style="margin:0 0 20px;color:#777985;font-size:12px;line-height:1.6">Button not working? Copy and paste this secure link into your browser:<br><a href="{safe_payment_url}" style="display:block;margin-top:6px;color:#ff8a65;text-decoration:underline;word-break:break-all">{safe_payment_url}</a></p>
            <p style="margin:0;color:#777985;font-size:12px;line-height:1.6">This email was sent to <strong style="color:#9b9ca6">{safe_recipient}</strong> because {safe_sender_name} issued an invoice to this address. If you were not expecting this invoice, contact the sender before making a payment.</p>
          </div>
          <p style="max-width:560px;margin:18px auto 0;color:#666873;text-align:center;font-size:11px">Powered by PingFox · Gentle nudges, real results.</p>
        </div>
      </body></html>
    """, subtype="html")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
        smtp.login(sender, password)
        smtp.send_message(message)
