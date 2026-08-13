# PingFox — Implementation Plan

Sequenced against the actual constraint you're working with: building
your Go skill *through* this product, product validation comes before
technical depth, and you're solo (or up to 4 people) with weak
frontend. Every phase ends in something runnable/demoable — no phase
depends on "finish everything then test."

Rough total: ~3-4 months to a real paying-customer-ready v1, leaving
the rest of your year for iteration, a second project surface if this
one doesn't take off, or going deeper on Go once the product is
stable. Adjust freely — this is a sequencing plan, not a deadline.

---

## Phase 0 — Foundations ✅ done
Repo scaffold, domain models, in-memory store, pure ping-sequence
logic, Stripe interface (stubbed), basic routes, design mock.

**Immediate next action:** write unit tests for `scheduler.NextStage`
and `scheduler.StatusFor`. Cheapest possible Go learning — pure
functions, no mocks needed, and it's the core business logic of the
whole product. Do this before anything else below.

---

## Phase 1 — Validate before building further (1-2 weeks)

This is the phase most likely to get skipped and most important not
to. Before sinking more weeks into infrastructure, confirm someone
would actually pay for this.

- [ ] Write down the exact pitch in one sentence + the $19/$49 pricing
- [ ] Talk to 8-10 freelancers/small agency owners (former colleagues,
      communities, cold DMs) — not "would you use this" (everyone says
      yes), ask "what do you currently do when a client is late" and
      "would you pay $19/month to not have to write that email"
- [ ] If you can, get 2-3 people to agree to try it the moment it's
      live — this becomes your first real users for Phase 5

**Gate to move on:** at least a handful of genuine "yes, send me a
link when it's ready" responses. If you're getting polite shrugs,
better to know now than after Phase 3's Stripe integration work.

---

## Phase 2 — Real persistence + auth + real dashboard (3-4 weeks)

Goal: you can sign up, log in, manually add an invoice, see it on a
dashboard that looks like the mock, and ping it. No Stripe yet — this
phase is entirely about a working, deployable skeleton.

- [ ] Postgres running locally (Docker), apply `migrations/001_init.sql`
- [ ] `PostgresStore` implementing `db.Store` (swap in `main.go` only)
- [ ] Basic auth — email + magic link is simplest (no password
      storage/reset flow to build); session cookie once logged in
- [ ] Middleware resolving `userID` from session, replacing the
      hardcoded `demoUserID`
- [ ] Manual invoice entry form (client name/email, amount, due date)
- [ ] Real `dashboard.html` — port the visual design from
      `frontend/landing.html` (ripple motif, status pills,
      fox branding) into the htmx-driven template
- [ ] Deploy it somewhere (Fly.io or Railway — both take a Go binary
      with minimal config) so it's a real URL, even pre-Stripe

**Gate to move on:** you (or a test user) can sign up, add an invoice,
and see it sit in the dashboard with the correct status color as due
dates pass. This alone is postable/demoable.

**Go-learning note:** this phase is where most of your actual Go
fluency gets built — HTTP handlers, `database/sql`, session/cookie
handling, template rendering. Take it a bit slower here; the payoff is
real competence, not just a working feature.

---

## Phase 3 — Stripe Connect (4-5 weeks — the highest-stakes phase)

Do this entirely in Stripe's test mode first. Do not touch live keys
until Phase 3 is fully working end-to-end in sandbox, including
webhook idempotency.

- [ ] `go get github.com/stripe/stripe-go/v78`
- [ ] Stripe Connect Express onboarding flow — "Connect your Stripe
      account" button, store `acct_...` on the user
- [ ] Real `CreatePaymentLink`, scoped to the connected account
- [ ] Real `CreateInstallmentPlan` (multi-invoice or subscription-cycle
      based — pick whichever Stripe's docs make cleaner once you're
      in there, both are viable)
- [ ] Real `VerifyWebhook` with `webhook.ConstructEvent` + signing
      secret — test locally with `stripe listen --forward-to
      localhost:8080/webhooks/stripe`
- [ ] Webhook handler: resolve Stripe ref → local invoice, mark paid,
      stop pings, handle installment partial-payment case
- [ ] Idempotency table (`processed_webhook_events`) wired in — Stripe
      *will* redeliver events, test this explicitly by replaying one
- [ ] Full manual test: create invoice → generate pay link → pay it in
      test mode → confirm webhook fires → confirm dashboard updates →
      confirm pings stop

**Gate to move on:** a full pay-and-confirm cycle works reliably in
Stripe test mode, including a redelivered webhook not double-processing.

---

## Phase 4 — Notifications (2 weeks)

- [ ] Swap `emailNotifier` stub for Postmark or SendGrid
- [ ] Real templates for all 4 stages + 3 reclaim emails (copy already
      drafted in the mock — port it into `text/template` or
      `html/template`)
- [ ] Confirm the background scheduler ticker actually sends on
      schedule against a couple of test invoices with backdated due
      dates
- [ ] (Optional, can slip to post-launch) Twilio SMS for Starter tier

**Gate to move on:** an invoice you backdate in the DB actually
receives a real, correctly-timed email in your own inbox.

---

## Phase 5 — Soft launch to your Phase 1 contacts (ongoing)

- [ ] Onboard the 2-3 people who said yes in Phase 1, personally,
      not self-serve — walk them through it if needed
- [ ] Watch what breaks. Real usage surfaces problems no amount of
      solo testing will
- [ ] Only after this feels stable: open signups publicly, start
      whatever light marketing motion (communities, content) fits
      the self-serve model

## Phase 6 — PingFox's own billing (parallel with or after Phase 5)
Separate Stripe integration (your platform account, not Connect) —
charging users their $19/$49 subscription. Can launch free-tier-only
initially and add this once you have users worth charging.

## Phase 7 — Production hardening (ongoing, not a gate)
Structured logging, backups, rate limiting on the public
plan-acceptance page, monitoring. Do the minimum viable version of
each before Phase 5's soft launch (backups especially — non-negotiable
once real payment data exists), then improve incrementally.

---

## What to explicitly *not* do yet

- Multi-language support, team seats beyond "notify a teammate",
  QuickBooks integration (Stripe-only is enough for v1), anything
  from the Growth tier feature list — all of this is real but
  premature before Phase 5 tells you if the core loop works at all
- Don't build the % recovery-fee billing logic until you have paying
  customers to apply it to
