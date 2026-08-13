-- Initial schema for PingFox. Written for Postgres.
-- Apply with your migration tool of choice (golang-migrate, goose, atlas, etc).

CREATE TABLE users (
    id                SERIAL PRIMARY KEY,
    email             TEXT NOT NULL UNIQUE,
    stripe_account_id TEXT UNIQUE,          -- Connect account, nullable until onboarded
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    external_ref  TEXT NOT NULL,            -- Stripe or QuickBooks invoice id
    client_name   TEXT NOT NULL,
    client_email  TEXT NOT NULL,
    amount_cents  BIGINT NOT NULL,
    currency      TEXT NOT NULL DEFAULT 'usd',
    due_date      DATE NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    pings_sent    INTEGER NOT NULL DEFAULT 0,
    last_ping_at  TIMESTAMPTZ,
    plan_id       INTEGER,                  -- FK added after payment_plans exists
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, external_ref)
);

CREATE INDEX idx_invoices_user ON invoices(user_id);
CREATE INDEX idx_invoices_status ON invoices(status);

CREATE TABLE ping_events (
    id          SERIAL PRIMARY KEY,
    invoice_id  INTEGER NOT NULL REFERENCES invoices(id),
    stage       TEXT NOT NULL,
    channel     TEXT NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ping_events_invoice ON ping_events(invoice_id);

CREATE TABLE payment_plans (
    id           SERIAL PRIMARY KEY,
    invoice_id   INTEGER NOT NULL REFERENCES invoices(id),
    status       TEXT NOT NULL DEFAULT 'offered',
    accepted_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE invoices ADD CONSTRAINT fk_invoices_plan
    FOREIGN KEY (plan_id) REFERENCES payment_plans(id);

CREATE TABLE installments (
    id            SERIAL PRIMARY KEY,
    plan_id       INTEGER NOT NULL REFERENCES payment_plans(id),
    sequence_no   INTEGER NOT NULL,
    amount_cents  BIGINT NOT NULL,
    due_date      DATE NOT NULL,
    paid          BOOLEAN NOT NULL DEFAULT false,
    paid_at       TIMESTAMPTZ,
    stripe_ref    TEXT,
    UNIQUE (plan_id, sequence_no)
);

-- Webhook idempotency: Stripe can and will redeliver events. Record
-- every processed event ID and check it before acting, or you'll
-- double-mark invoices paid / double-send confirmations.
CREATE TABLE processed_webhook_events (
    stripe_event_id TEXT PRIMARY KEY,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
