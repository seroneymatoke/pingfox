"""Environment-backed Flask configuration."""

import os


class Config:
    SECRET_KEY = os.environ.get("PINGFOX_SECRET_KEY", "dev-only-change-me")
    DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///pingfox.db")
    FREE_TIER_INVOICE_LIMIT = 3
    COOKIE_SECURE = os.environ.get("PINGFOX_COOKIE_SECURE", "false").lower() == "true"
    # Keep this optional so deployments can derive the public URL from Vercel.
    APP_URL = os.environ.get("PINGFOX_APP_URL", "")
    STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
    ADMIN_EMAILS = os.environ.get("PINGFOX_ADMIN_EMAILS", "")
    VERIFICATION_TOKEN_TTL_HOURS = 24
