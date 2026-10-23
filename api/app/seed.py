"""Idempotent local/demo account and invoice fixtures."""

import os
from datetime import UTC, datetime, timedelta

from werkzeug.security import generate_password_hash

from .models import Invoice, User, repository


DEMO_PASSWORD = "DemoPassword123!"
DEMO_ACCOUNTS = [
    ("atlas@demo.pingfox.local", "Atlas Creative", "active", True),
    ("ember@demo.pingfox.local", "Ember Consulting", "active", True),
    ("maple@demo.pingfox.local", "Maple & Co.", "active", True),
    ("northstar@demo.pingfox.local", "Northstar Studio", "active", True),
    ("cedar@demo.pingfox.local", "Cedar Works", "active", True),
    ("orbit@demo.pingfox.local", "Orbit Labs", "active", True),
    ("harbor@demo.pingfox.local", "Harbor Design", "suspended", True),
    ("meadow@demo.pingfox.local", "Meadow Services", "closed", True),
    ("incomplete@demo.pingfox.local", "", "active", False),
]
INVOICE_STATUSES = (
    ("pending", 125000),
    ("overdue", 248000),
    ("paid", 87500),
)


def _apply_demo_profile(user: User, business_name: str, status: str, verified: bool, incomplete: bool = False) -> None:
    user.email_verified = verified
    user.account_status = status
    user.plan = "free"
    user.subscription_status = "active"
    user.terms_accepted = True
    user.privacy_accepted = True
    if incomplete:
        user.full_name = ""
        user.business_name = ""
        user.residence_address = ""
        user.city = ""
        user.region = ""
        user.postal_code = ""
        user.country = ""
        return
    user.full_name = f"{business_name} Billing"
    user.business_name = business_name
    user.residence_address = "100 Demo Avenue"
    user.city = "San Francisco"
    user.region = "CA"
    user.postal_code = "94105"
    user.country = "US"
    user.invoice_terms = "Payment is due by the date shown on this invoice."
    user.payment_terms = "Net 30"
    user.payment_description = "Thank you for working with us."


def _upsert_user(email: str, business_name: str, status: str, verified: bool, incomplete: bool = False, reset_demo_password: bool = False) -> User:
    user = repository.get_user_by_email(email)
    if user is None:
        user = repository.create_user(email, generate_password_hash(DEMO_PASSWORD), email_verified=verified)
    elif reset_demo_password:
        user.password = generate_password_hash(DEMO_PASSWORD)
    _apply_demo_profile(user, business_name, status, verified, incomplete)
    repository.save_user(user)
    return user


def _seed_invoices(user: User, account_index: int) -> None:
    if not user.email.endswith("@demo.pingfox.local") or user.account_status != "active" or not user.email_verified:
        return
    existing = {invoice.invoice_number for invoice in repository.invoices_for(user.id)}
    for invoice_index, (status, amount_cents) in enumerate(INVOICE_STATUSES, start=1):
        invoice_number = f"DEMO-{account_index:02d}-{invoice_index:02d}"
        if invoice_number in existing:
            continue
        due_date = datetime.now(UTC) - timedelta(days=8) if status == "overdue" else datetime.now(UTC) + timedelta(days=14)
        invoice = repository.create_invoice(Invoice(id=0, user_id=user.id, client_name=f"Demo Client {invoice_index}", client_email=f"client{invoice_index}@example.com", amount_cents=amount_cents, due_date=due_date, status=status, invoice_number=invoice_number, invoice_terms=user.invoice_terms, payment_terms=user.payment_terms))
        repository.save_invoice(invoice)


def seed_demo_data() -> None:
    """Create/update only the known demo fixtures; never delete user data."""
    admin_email = os.environ.get("PINGFOX_SUPER_ADMIN_EMAIL") or os.environ.get("PINGFOX_GMAIL_ADDRESS")
    if not admin_email:
        return
    admin = _upsert_user(admin_email.strip().lower(), "PingFox Operations", "active", True, reset_demo_password=True)
    admin.full_name = "PingFox Super Admin"
    repository.save_user(admin)
    for index, (email, business_name, status, verified) in enumerate(DEMO_ACCOUNTS, start=1):
        user = _upsert_user(email, business_name, status, verified, incomplete=not verified, reset_demo_password=True)
        _seed_invoices(user, index)
