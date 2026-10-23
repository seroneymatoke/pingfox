"""Authentication helpers shared by Flask routes."""

from functools import wraps

from flask import current_app, g, jsonify, request

from .models import repository


def current_user():
    if getattr(g, "user", None) is not None:
        return g.user

    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer "):
        g.user = repository.get_user_by_api_key(authorization.removeprefix("Bearer "))
    else:
        g.user = repository.user_for_session(request.cookies.get("pingfox_session", ""))
    return g.user


def require_user(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            return jsonify(error="unauthorized"), 401
        if not current_user().email_verified:
            return jsonify(error="email_verification_required"), 403
        if current_user().account_status != "active":
            return jsonify(error="account_unavailable", message="This account is not active."), 403
        return function(*args, **kwargs)

    return wrapped


def require_admin(function):
    @wraps(function)
    @require_user
    def wrapped(*args, **kwargs):
        configured_admins = {email.strip().lower() for email in current_app.config.get("ADMIN_EMAILS", "").split(",") if email.strip()}
        if current_user().email.lower() not in configured_admins:
            return jsonify(error="forbidden"), 403
        return function(*args, **kwargs)

    return wrapped
