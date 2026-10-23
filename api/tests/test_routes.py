import pytest
from urllib.parse import parse_qs, urlparse

from api.app import create_app
from api.app.models import repository


@pytest.fixture(autouse=True)
def reset_repository():
    repository.reset()


@pytest.fixture
def client():
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def signup_and_login(client):
    response = client.post(
        "/api/signup",
        json={
            "email": "owner@example.com",
            "password": "password123",
            "full_name": "Owner Example",
            "residence_address": "1 Main Street",
            "country": "US",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
        base_url="https://localhost",
    )
    assert response.status_code == 202
    verification_url = client.application.extensions["pingfox_test_emails"][-1]["url"]
    token = parse_qs(urlparse(verification_url).query)["token"][0]
    verification = client.get(f"/api/verify-email?token={token}")
    assert verification.status_code == 302
    assert verification.headers["Location"].endswith("#onboarding")
    return client.post("/api/login", json={"email": "owner@example.com", "password": "password123"}, base_url="https://localhost")


def test_signup_sends_verification_email_without_creating_a_session(client):
    response = signup_and_login(client)

    body = response.get_json()
    assert body["email"] == "owner@example.com"
    assert "pingfox_session" in response.headers["Set-Cookie"]


def test_unverified_login_is_blocked(client):
    response = client.post("/api/signup", json={"email": "pending@example.com", "password": "password123", "terms_accepted": True, "privacy_accepted": True})
    assert response.status_code == 202
    login = client.post("/api/login", json={"email": "pending@example.com", "password": "password123"})
    assert login.status_code == 403
    assert login.get_json()["error"] == "email_verification_required"


def test_signup_validates_email_and_password(client):
    response = client.post("/api/signup", json={"email": "not-an-email", "password": "short"})

    assert response.status_code == 400
    assert "valid email" in response.get_json()["error"]


def test_onboarding_stores_profile_without_exposing_tax_id(client):
    response = client.post(
        "/api/signup",
        json={
            "email": "profile@example.com",
            "password": "password123",
            "terms_accepted": True,
            "privacy_accepted": True,
        },
    )

    assert response.status_code == 202
    token = parse_qs(urlparse(client.application.extensions["pingfox_test_emails"][-1]["url"]).query)["token"][0]
    client.get(f"/api/verify-email?token={token}")
    client.post("/api/login", json={"email": "profile@example.com", "password": "password123"})
    response = client.put(
        "/api/onboarding",
        json={
            "full_name": "Profile Owner",
            "tax_id": "TAX-SECRET",
            "residence_address": "1 Main Street",
            "country": "US",
        },
    )
    assert response.status_code == 200
    assert "tax_id" not in response.get_json()
    assert repository.get_user_by_email("profile@example.com").tax_id == "TAX-SECRET"


def test_session_restores_and_logout_invalidates_it(client):
    signup_and_login(client)

    assert client.get("/api/me").status_code == 200
    assert client.post("/api/logout").status_code == 200
    assert client.get("/api/me").status_code == 401


def test_dashboard_is_protected(client):
    response = client.get("/api/dashboard")

    assert response.status_code == 401
    assert response.get_json() == {"error": "unauthorized"}


def test_invoice_creation_and_dashboard_filtering(client):
    signup_and_login(client)
    response = client.post(
        "/api/invoices",
        json={
            "client_name": "Vantage Retail",
            "client_email": "billing@vantage.example",
            "amount_cents": 782000,
            "due_date": "2026-01-08",
        },
        base_url="https://localhost",
    )

    assert response.status_code == 201
    assert response.get_json()["amount_cents"] == 782000

    dashboard = client.get("/api/dashboard?q=vantage", base_url="https://localhost")
    assert dashboard.status_code == 200
    assert len(dashboard.get_json()["invoices"]) == 1


def test_free_plan_limit_returns_payment_required(client):
    signup_and_login(client)
    payload = {
        "client_name": "Client",
        "client_email": "billing@example.com",
        "amount_cents": 1000,
        "due_date": "2026-01-08",
    }

    for _ in range(3):
        response = client.post("/api/invoices", json=payload, base_url="https://localhost")
        assert response.status_code == 201

    response = client.post("/api/invoices", json=payload, base_url="https://localhost")
    assert response.status_code == 402
    assert response.get_json()["error"] == "free_tier_limit_reached"


def test_free_plan_limit_survives_invoice_deletion(client):
    signup_and_login(client)
    payload = {"client_name": "Client", "client_email": "billing@example.com", "amount_cents": 1000, "due_date": "2026-01-08"}
    created = [client.post("/api/invoices", json=payload, base_url="https://localhost") for _ in range(3)]
    assert all(response.status_code == 201 for response in created)
    deleted = client.delete(f"/api/invoices/{created[0].get_json()['id']}", base_url="https://localhost")
    assert deleted.status_code == 200
    fourth = client.post("/api/invoices", json=payload, base_url="https://localhost")
    assert fourth.status_code == 402
    assert fourth.get_json()["upgrade_url"] == "https://pingfox.com/upgrade"


def test_invoice_settings_are_persisted_and_snapshotted(client):
    signup_and_login(client)
    settings = client.put("/api/settings/invoice", json={"business_logo": "data:image/svg+xml;base64,logo", "invoice_terms": "Payment due on receipt.", "payment_terms": "Due now", "cancellation_description": "Stop reminders anytime.", "payment_description": "Paid — thank you."})
    assert settings.status_code == 200
    first = client.post("/api/invoices", json={"client_name": "Client", "client_email": "billing@example.com", "amount_cents": 1000, "due_date": "2026-01-08"})
    assert first.get_json()["invoice_terms"] == "Payment due on receipt."
    client.put("/api/settings/invoice", json={"invoice_terms": "Updated terms."})
    second = client.post("/api/invoices", json={"client_name": "Client 2", "client_email": "billing2@example.com", "amount_cents": 1000, "due_date": "2026-01-08"})
    assert second.get_json()["invoice_terms"] == "Updated terms."
    assert repository.invoices[first.get_json()["id"]].invoice_terms == "Payment due on receipt."


def test_invoice_has_opaque_payment_link_and_safe_stripe_fallback(client):
    signup_and_login(client)
    created = client.post("/api/invoices", json={"client_name": "Client", "client_email": "billing@example.com", "amount_cents": 1000, "due_date": "2026-01-08"})
    payment_url = created.get_json()["payment_url"]
    payment_token = payment_url.rsplit("/", 1)[-1]
    assert payment_token != str(created.get_json()["id"])
    payment = client.get(f"/api/pay/{payment_token}")
    assert payment.status_code == 503
    assert payment.get_json()["error"] == "stripe_not_configured"

    public = client.get(f"/api/public/invoices/{payment_token}")
    assert public.status_code == 200
    assert "/invoices/" in public.get_json()["payment_url"]


def test_invoice_can_be_sent_with_secure_payment_link(client):
    signup_and_login(client)
    created = client.post("/api/invoices", json={"client_name": "Client", "client_email": "billing@example.com", "amount_cents": 12500, "due_date": "2026-01-08"})
    sent = client.post(f"/api/invoices/{created.get_json()['id']}/send")

    assert sent.status_code == 200
    email = client.application.extensions["pingfox_test_emails"][-1]
    assert email["to"] == "billing@example.com"
    assert email["payment_url"].endswith(created.get_json()["payment_url"].rsplit("/", 1)[-1])


def test_ping_and_mark_paid_are_owner_scoped(client):
    signup_and_login(client)
    created = client.post(
        "/api/invoices",
        json={
            "client_name": "Client",
            "client_email": "billing@example.com",
            "amount_cents": 1000,
            "due_date": "2026-01-08",
        },
        base_url="https://localhost",
    )
    invoice_id = created.get_json()["id"]

    ping = client.post(f"/api/invoices/{invoice_id}/ping", base_url="https://localhost")
    assert ping.status_code == 200
    paid = client.post(f"/api/invoices/{invoice_id}/mark-paid", base_url="https://localhost")
    assert paid.status_code == 200

    ping_again = client.post(f"/api/invoices/{invoice_id}/ping", base_url="https://localhost")
    assert ping_again.status_code == 409


def test_settings_update_profile_password_and_unique_email(client):
    signup_and_login(client)
    profile = client.put("/api/settings/profile", json={"full_name": "Updated Owner", "business_name": "New Studio", "residence_address": "2 Main Street", "country": "US"})
    assert profile.status_code == 200
    assert profile.get_json()["business_name"] == "New Studio"

    password = client.put("/api/settings/password", json={"current_password": "password123", "new_password": "newpassword123"})
    assert password.status_code == 200
    assert client.post("/api/login", json={"email": "owner@example.com", "password": "newpassword123"}).status_code == 200

    repository.create_user("taken@example.com", "hash", email_verified=True)
    duplicate = client.put("/api/settings/email", json={"email": "taken@example.com", "current_password": "newpassword123"})
    assert duplicate.status_code == 409


def test_paid_subscription_can_be_cancelled_at_period_end(client):
    signup_and_login(client)
    user = repository.get_user_by_email("owner@example.com")
    user.plan = "starter"
    repository.save_user(user)

    subscription = client.get("/api/subscription")
    assert subscription.get_json()["plan"] == "starter"
    cancelled = client.post("/api/subscription/cancel")
    assert cancelled.status_code == 200
    assert cancelled.get_json()["status"] == "cancel_at_period_end"
    assert client.get("/api/subscription").get_json()["history"][0]["event"] == "cancellation_scheduled"


def test_free_user_can_request_starter_upgrade_without_bypassing_billing(client):
    signup_and_login(client)
    response = client.post("/api/subscription/upgrade", json={"plan": "starter"})
    assert response.status_code == 202
    assert response.get_json()["requested_plan"] == "starter"
    assert repository.get_user_by_email("owner@example.com").plan == "free"
