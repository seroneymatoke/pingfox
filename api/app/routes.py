"""HTTP routes matching the first behavior-compatible Go API slice."""

from datetime import datetime
from functools import wraps
from datetime import timedelta, timezone
import hashlib
import json
import os
import re
from secrets import token_urlsafe
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from flask import Blueprint, current_app, jsonify, make_response, redirect, request
from werkzeug.security import check_password_hash, generate_password_hash

from .auth import current_user, require_user
from .mailer import send_invoice_email, send_verification_email
from .models import Invoice, repository

api = Blueprint("api", __name__)
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def public_app_url() -> str:
    """Resolve the frontend origin for local development and Vercel production."""
    configured_url = current_app.config.get("APP_URL", "").strip()
    if configured_url:
        return configured_url.rstrip("/")
    if current_app.debug or current_app.testing:
        return "http://127.0.0.1:5173"
    if os.environ.get("VERCEL_ENV") == "production":
        return "https://pingfox.com"
    vercel_url = os.environ.get("VERCEL_PROJECT_PRODUCTION_URL") or os.environ.get("VERCEL_URL")
    if vercel_url:
        hostname = vercel_url.removeprefix("https://").removeprefix("http://").rstrip("/")
        return f"https://{hostname}"
    return "https://pingfox.com"


def invoice_json(invoice: Invoice) -> dict:
    return {
        "id": invoice.id,
        "user_id": invoice.user_id,
        "client_name": invoice.client_name,
        "client_email": invoice.client_email,
        "amount_cents": invoice.amount_cents,
        "due_date": invoice.due_date.isoformat(),
        "status": invoice.status,
        "pings_sent": invoice.pings_sent,
        "last_ping_at": invoice.last_ping_at.isoformat() if invoice.last_ping_at else None,
        "invoice_number": invoice.invoice_number,
        "invoice_terms": invoice.invoice_terms,
        "payment_terms": invoice.payment_terms,
        "payment_url": f"{public_app_url()}/invoices/{invoice.payment_token}",
    }


def user_json(user) -> dict:
    """Return profile data safe for normal client responses; never expose tax_id."""
    return {
        "user_id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "phone": user.phone,
        "business_name": user.business_name,
        "business_logo": user.business_logo,
        "invoice_terms": user.invoice_terms,
        "payment_terms": user.payment_terms,
        "cancellation_description": user.cancellation_description,
        "payment_description": user.payment_description,
        "residence_address": user.residence_address,
        "city": user.city,
        "region": user.region,
        "postal_code": user.postal_code,
        "country": user.country,
        "timezone": user.timezone,
        "plan": user.plan,
        "subscription_status": user.subscription_status,
        "subscription_cancel_at": user.subscription_cancel_at.isoformat() if user.subscription_cancel_at else None,
        "invoices_created": user.invoices_created,
        "onboarding_complete": bool(user.full_name and user.residence_address and user.country),
        "email_verified": user.email_verified,
    }


@api.post("/signup")
def signup():
    body = request.get_json(silent=True) or {}
    email = str(body.get("email", "")).strip()
    password = str(body.get("password", ""))
    if not EMAIL_PATTERN.fullmatch(email) or len(password) < 8:
        return jsonify(error="Enter a valid email and a password with at least 8 characters."), 400
    if body.get("terms_accepted") is not True or body.get("privacy_accepted") is not True:
        return jsonify(error="You must accept the Terms and Privacy Policy to create an account."), 400
    try:
        verification_token = token_urlsafe(32)
        verification_expires_at = datetime.now(timezone.utc) + timedelta(hours=current_app.config["VERIFICATION_TOKEN_TTL_HOURS"])
        user = repository.create_user(
            email,
            generate_password_hash(password),
            full_name="",
            phone="",
            business_name="",
            tax_id="",
            residence_address="",
            city="",
            region="",
            postal_code="",
            country="",
            timezone="UTC",
            terms_accepted=True,
            privacy_accepted=True,
            email_verified=False,
            verification_token_hash=hashlib.sha256(verification_token.encode()).hexdigest(),
            verification_expires_at=verification_expires_at,
        )
    except ValueError as error:
        return jsonify(error=str(error)), 409

    verification_url = f"{public_app_url()}/api/verify-email?token={quote(verification_token)}"
    try:
        send_verification_email(user.email, verification_url)
    except RuntimeError as error:
        return jsonify(error="email_delivery_not_configured", message=str(error)), 503
    return jsonify(email=user.email, verification_required=True, message="Check your email to verify your PingFox account."), 202


@api.get("/verify-email")
def verify_email():
    token = request.args.get("token", "")
    user = repository.get_user_by_verification_hash(hashlib.sha256(token.encode()).hexdigest())
    if user is None or user.verification_expires_at is None or user.verification_expires_at < datetime.now(timezone.utc):
        return redirect(f"{public_app_url()}/?verified=invalid#login")
    user.email_verified = True
    user.verification_token_hash = ""
    user.verification_expires_at = None
    repository.save_user(user)
    session_token = repository.create_session(user.id)
    response = make_response(redirect(f"{public_app_url()}/?verified=success#onboarding"))
    response.set_cookie(
        "pingfox_session",
        session_token,
        httponly=True,
        secure=current_app.config["COOKIE_SECURE"],
        samesite="Lax",
        path="/",
    )
    return response


@api.post("/resend-verification")
def resend_verification():
    email = str((request.get_json(silent=True) or {}).get("email", "")).strip()
    user = repository.get_user_by_email(email)
    if user is None or user.email_verified:
        return jsonify(message="If that account needs verification, an email has been sent."), 202
    verification_token = token_urlsafe(32)
    user.verification_token_hash = hashlib.sha256(verification_token.encode()).hexdigest()
    user.verification_expires_at = datetime.now(timezone.utc) + timedelta(hours=current_app.config["VERIFICATION_TOKEN_TTL_HOURS"])
    repository.save_user(user)
    verification_url = f"{public_app_url()}/api/verify-email?token={quote(verification_token)}"
    send_verification_email(user.email, verification_url)
    return jsonify(message="If that account needs verification, an email has been sent."), 202


@api.put("/onboarding")
@require_user
def onboarding():
    body = request.get_json(silent=True) or {}
    required_fields = ("full_name", "residence_address", "country")
    if any(not str(body.get(field, "")).strip() for field in required_fields):
        return jsonify(error="Please complete your name, address, and country."), 400
    user = current_user()
    user.full_name = str(body["full_name"]).strip()
    user.phone = str(body.get("phone", "")).strip()
    user.business_name = str(body.get("business_name", "")).strip()
    user.tax_id = str(body.get("tax_id", "")).strip()
    user.residence_address = str(body["residence_address"]).strip()
    user.city = str(body.get("city", "")).strip()
    user.region = str(body.get("region", "")).strip()
    user.postal_code = str(body.get("postal_code", "")).strip()
    user.country = str(body["country"]).strip()
    user.timezone = str(body.get("timezone", "UTC")).strip() or "UTC"
    repository.save_user(user)
    return jsonify(user_json(user))


@api.put("/settings/profile")
@require_user
def update_profile():
    body = request.get_json(silent=True) or {}
    user = current_user()
    required_fields = ("full_name", "residence_address", "country")
    if any(not str(body.get(field, "")).strip() for field in required_fields):
        return jsonify(error="Please complete your name, address, and country."), 400
    for field in ("full_name", "phone", "business_name", "business_logo", "invoice_terms", "payment_terms", "cancellation_description", "payment_description", "tax_id", "residence_address", "city", "region", "postal_code", "country", "timezone"):
        setattr(user, field, str(body.get(field, getattr(user, field))).strip())
    repository.save_user(user)
    return jsonify(user_json(user))


@api.put("/settings/invoice")
@require_user
def update_invoice_settings():
    body = request.get_json(silent=True) or {}
    user = current_user()
    for field in ("business_logo", "invoice_terms", "payment_terms", "cancellation_description", "payment_description"):
        setattr(user, field, str(body.get(field, getattr(user, field))).strip())
    repository.save_user(user)
    return jsonify(user_json(user))


@api.put("/settings/password")
@require_user
def update_password():
    body = request.get_json(silent=True) or {}
    user = current_user()
    current_password = str(body.get("current_password", ""))
    new_password = str(body.get("new_password", ""))
    if not check_password_hash(user.password, current_password):
        return jsonify(error="Current password is incorrect."), 400
    if len(new_password) < 8:
        return jsonify(error="Use at least 8 characters for your new password."), 400
    user.password = generate_password_hash(new_password)
    repository.save_user(user)
    return jsonify(message="Password updated successfully.")


@api.put("/settings/email")
@require_user
def update_email():
    body = request.get_json(silent=True) or {}
    user = current_user()
    email = str(body.get("email", "")).strip()
    if not EMAIL_PATTERN.fullmatch(email):
        return jsonify(error="Enter a valid email address."), 400
    if not check_password_hash(user.password, str(body.get("current_password", ""))):
        return jsonify(error="Current password is incorrect."), 400
    existing = repository.get_user_by_email(email)
    if existing is not None and existing.id != user.id:
        return jsonify(error="That email address is already in use."), 409
    user.email = email
    repository.save_user(user)
    return jsonify(user_json(user))


@api.get("/subscription")
@require_user
def subscription():
    user = current_user()
    history = [{"event": event.event_type, "plan": event.plan, "created_at": event.created_at.isoformat()} for event in repository.subscription_events_for(user.id)]
    return jsonify(plan=user.plan, status=user.subscription_status, cancel_at=user.subscription_cancel_at.isoformat() if user.subscription_cancel_at else None, history=history)


@api.get("/plans")
def plans():
    return jsonify(plans=[
        {"id": "free", "name": "Free", "price": 0, "description": "For trying PingFox on a handful of invoices.", "features": ["3 invoices forever", "PDF or manual invoice entry", "Fixed ping schedule"]},
        {"id": "starter", "name": "Starter", "price": 19, "description": "For freelancers and solo consultants.", "features": ["Up to 25 active invoices", "Custom ping sequence and tone", "Email and SMS pings", "Stripe and QuickBooks sync"]},
        {"id": "growth", "name": "Growth", "price": 49, "description": "For small agencies with a few hands on billing.", "features": ["Unlimited invoices", "Team seats", "Escalation rules and payment plans"], "coming_soon": True},
    ])


@api.post("/subscription/upgrade")
@require_user
def request_upgrade():
    body = request.get_json(silent=True) or {}
    if body.get("plan") != "starter":
        return jsonify(error="Only the Starter plan is available for upgrade requests."), 400
    user = current_user()
    if user.plan == "starter":
        return jsonify(plan=user.plan, status=user.subscription_status, message="You are already on the Starter plan.")
    repository.add_subscription_event(user.id, "upgrade_requested", "starter")
    return jsonify(plan=user.plan, requested_plan="starter", status="upgrade_requested", message="Starter checkout will be available when billing is connected."), 202


@api.post("/subscription/cancel")
@require_user
def cancel_subscription():
    user = current_user()
    if user.plan == "free":
        return jsonify(error="The Free plan does not have an active subscription."), 400
    user.subscription_status = "cancel_at_period_end"
    user.subscription_cancel_at = datetime.now(timezone.utc)
    repository.save_user(user)
    repository.add_subscription_event(user.id, "cancellation_scheduled", user.plan)
    return jsonify(plan=user.plan, status=user.subscription_status, cancel_at=user.subscription_cancel_at.isoformat())


@api.post("/login")
def login():
    body = request.get_json(silent=True) or {}
    user = repository.get_user_by_email(str(body.get("email", "")).strip())
    if user is None or not check_password_hash(user.password, str(body.get("password", ""))):
        return jsonify(error="invalid email or password"), 401
    if not user.email_verified:
        return jsonify(error="email_verification_required", message="Verify your email before logging in."), 403

    token = repository.create_session(user.id)
    response = jsonify(**user_json(user))
    response.set_cookie("pingfox_session", token, httponly=True, secure=current_app.config["COOKIE_SECURE"], samesite="Lax", path="/")
    return response


@api.post("/logout")
def logout():
    repository.delete_session(request.cookies.get("pingfox_session", ""))
    response = jsonify(status="logged_out")
    response.delete_cookie("pingfox_session", path="/")
    return response


@api.get("/me")
def me():
    user = current_user()
    if user is None:
        return jsonify(error="unauthorized"), 401
    return jsonify(user_json(user))


@api.get("/dashboard")
@require_user
def dashboard():
    user = current_user()
    query = request.args.get("q", "").strip().lower()
    status = request.args.get("status", "")
    sort_by = request.args.get("sort", "due")
    order = request.args.get("order", "asc")
    invoices = repository.invoices_for(user.id)
    invoices = [
        invoice for invoice in invoices
        if (not query or query in invoice.client_name.lower() or query in invoice.client_email.lower())
        and (status != "paid" or invoice.status == "paid")
        and (status != "unpaid" or invoice.status != "paid")
    ]
    key = {
        "amount": lambda invoice: invoice.amount_cents,
        "client": lambda invoice: invoice.client_name.lower(),
        "due": lambda invoice: invoice.due_date,
    }.get(sort_by, lambda invoice: invoice.due_date)
    invoices.sort(key=key, reverse=order == "desc")
    return jsonify(
        invoices=[invoice_json(invoice) for invoice in invoices],
        plan=user.plan,
        invoices_created=user.invoices_created,
        invoice_limit=current_app.config["FREE_TIER_INVOICE_LIMIT"] if user.plan == "free" else None,
        can_add_invoice=user.plan != "free" or user.invoices_created < current_app.config["FREE_TIER_INVOICE_LIMIT"],
    )


@api.post("/invoices")
@require_user
def create_invoice():
    user = current_user()
    if user.plan == "free" and user.invoices_created >= current_app.config["FREE_TIER_INVOICE_LIMIT"]:
        return jsonify(
            error="free_tier_limit_reached",
            message="Free plan is limited to 3 invoices. Upgrade to add more.",
            upgrade_url="https://pingfox.com/upgrade",
        ), 402

    body = request.get_json(silent=True) or {}
    try:
        due_date = datetime.fromisoformat(str(body["due_date"]).replace("Z", "+00:00"))
        amount_cents = int(body["amount_cents"])
    except (KeyError, TypeError, ValueError):
        return jsonify(error="invalid due_date or amount_cents"), 400

    invoice = repository.create_invoice(Invoice(
        id=0,
        user_id=user.id,
        client_name=str(body.get("client_name", "")),
        client_email=str(body.get("client_email", "")),
        amount_cents=amount_cents,
        due_date=due_date,
        invoice_number=str(body.get("invoice_number", "")),
        invoice_terms=user.invoice_terms,
        payment_terms=user.payment_terms,
    ))
    return jsonify(invoice_json(invoice)), 201


@api.get("/public/invoices/<payment_token>")
def public_invoice(payment_token: str):
    invoice = repository.get_invoice_by_payment_token(payment_token)
    if invoice is None:
        return jsonify(error="invoice not found"), 404
    user = repository.get_user(invoice.user_id)
    if user is None:
        return jsonify(error="invoice not found"), 404
    return jsonify(
        invoice_number=invoice.invoice_number or str(invoice.id),
        client_name=invoice.client_name,
        amount_cents=invoice.amount_cents,
        due_date=invoice.due_date.isoformat(),
        status=invoice.status,
        invoice_terms=invoice.invoice_terms,
        payment_terms=invoice.payment_terms,
        payment_description=user.payment_description,
        business_name=user.business_name.strip() or user.full_name.strip() or "Your billing contact",
        business_logo=user.business_logo,
        payment_url=f"{public_app_url()}/invoices/{invoice.payment_token}",
    )


@api.post("/invoices/<int:invoice_id>/send")
@require_user
def send_invoice(invoice_id: int):
    invoice = repository.invoices.get(invoice_id)
    user = current_user()
    if invoice is None or invoice.user_id != user.id:
        return jsonify(error="not found"), 404
    recipient = str((request.get_json(silent=True) or {}).get("recipient", invoice.client_email)).strip()
    if not EMAIL_PATTERN.fullmatch(recipient):
        return jsonify(error="Enter a valid recipient email address."), 400
    sender_name = user.business_name.strip() or user.full_name.strip() or "Your billing contact"
    payment_url = f"{public_app_url()}/api/pay/{invoice.payment_token}"
    try:
        send_invoice_email(recipient, invoice, payment_url, sender_name)
    except RuntimeError as error:
        return jsonify(error="email_delivery_not_configured", message=str(error)), 503
    return jsonify(message="Invoice email sent.", recipient=recipient, payment_url=payment_url)


@api.get("/pay/<payment_token>")
def pay_invoice(payment_token: str):
    invoice = repository.get_invoice_by_payment_token(payment_token)
    if invoice is None:
        return jsonify(error="payment link not found"), 404
    if invoice.status == "paid":
        return jsonify(error="invoice already paid", status="paid"), 409
    stripe_key = current_app.config.get("STRIPE_SECRET_KEY", "").strip()
    payment_url = f"{public_app_url()}/api/pay/{invoice.payment_token}"
    if not stripe_key:
        return jsonify(error="stripe_not_configured", message="Stripe checkout is not configured yet.", payment_url=payment_url), 503
    payload = urlencode({
        "mode": "payment",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": f"PingFox invoice {invoice.invoice_number or invoice.id}",
        "line_items[0][price_data][unit_amount]": invoice.amount_cents,
        "line_items[0][quantity]": 1,
        "success_url": f"{public_app_url()}/?payment=success&invoice={invoice.id}",
        "cancel_url": f"{public_app_url()}/?payment=cancelled&invoice={invoice.id}",
        "metadata[invoice_id]": invoice.id,
        "metadata[payment_token]": invoice.payment_token,
    }).encode()
    request = Request("https://api.stripe.com/v1/checkout/sessions", data=payload, headers={"Authorization": f"Bearer {stripe_key}", "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urlopen(request, timeout=10) as response:
            checkout = json.loads(response.read().decode())
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        current_app.logger.warning("Stripe checkout creation failed: %s", error)
        return jsonify(error="stripe_checkout_unavailable", message="We could not start Stripe checkout. Please try again."), 502
    return redirect(checkout["url"])


@api.delete("/invoices/<int:invoice_id>")
@require_user
def delete_invoice(invoice_id: int):
    invoice = repository.invoices.get(invoice_id)
    if invoice is None or invoice.user_id != current_user().id:
        return jsonify(error="not found"), 404
    repository.delete_invoice(invoice_id)
    return jsonify(status="deleted", invoices_created=current_user().invoices_created)


@api.post("/invoices/<int:invoice_id>/ping")
@require_user
def ping_invoice(invoice_id: int):
    invoice = repository.invoices.get(invoice_id)
    if invoice is None or invoice.user_id != current_user().id:
        return jsonify(error="not found"), 404
    if invoice.status in {"paid", "plan_active"}:
        return jsonify(error="invoice is paid or on an active plan — nothing to ping"), 409
    invoice.pings_sent += 1
    invoice.last_ping_at = datetime.now().astimezone()
    repository.save_invoice(invoice)
    return jsonify(status="sent")


@api.post("/invoices/<int:invoice_id>/mark-paid")
@require_user
def mark_invoice_paid(invoice_id: int):
    invoice = repository.invoices.get(invoice_id)
    if invoice is None or invoice.user_id != current_user().id:
        return jsonify(error="not found"), 404
    invoice.status = "paid"
    repository.save_invoice(invoice)
    return jsonify(status="paid")
