# PingFox

Automated invoice-chasing for freelancers and small agencies. Client
pays through Stripe Connect (funds go directly to the freelancer —
PingFox never touches the money). Reminders escalate automatically;
30+ day overdue invoices get a manual "reclaim" flow (firmer note,
payment plan, loop in a teammate).

## Repo layout

```
pingfox/
  backend/                 Go backend (stdlib only right now — see below)
    cmd/server/main.go     entrypoint, wires everything together
    internal/
      models/              core domain types
      db/                  storage interface + in-memory impl (swap for Postgres)
      scheduler/            ping-sequence timing/logic, pure functions
      stripeclient/         Stripe boundary (currently stubbed)
      api/                  HTTP handlers
    migrations/001_init.sql Postgres schema for when you outgrow in-memory
  frontend/
    embed.go                    go:embed directives — templates AND landing.html compile into the binary
    landing.html                the real marketing landing page — served at GET / (see below)
    templates/dashboard.html    real server-rendered page (html/template + htmx)
```

## Auth model (added)

Two signup/login paths, both landing on the same account model:

- **Email + password** — `POST /signup` (email + password, min 8
  chars), `POST /login`. Passwords are salted + iterated-SHA256
  hashed (`internal/auth/password.go`) — **this is an interim stdlib-only
  implementation**; swap for bcrypt (`go get golang.org/x/crypto/bcrypt`)
  before real users sign up. The file is written so that swap only
  touches one place.
- **OAuth (Google / GitHub)** — `GET /auth/{provider}/start` redirects
  to the provider; `GET /auth/{provider}/callback` completes it. Needs
  env vars set before it works end to end:
  ```
  PINGFOX_GOOGLE_CLIENT_ID / PINGFOX_GOOGLE_CLIENT_SECRET
  PINGFOX_GITHUB_CLIENT_ID / PINGFOX_GITHUB_CLIENT_SECRET
  ```
  Register the redirect URI (`http://localhost:8080/auth/{provider}/callback`
  in dev) in each provider's OAuth app settings — it must match exactly.

Both paths issue: a **session cookie** (`pingfox_session`, httpOnly)
for the web dashboard, and a **server-generated API key** (shown once,
at signup) for programmatic/agentic access (MCP, Zapier, direct API).
`internal/auth/auth.go` is the single place identity is resolved from
either credential — handlers use `auth.UserFromContext(...)` and never
trust a client-supplied user_id.

The free-tier paywall (`models.FreeTierInvoiceLimit`, currently 3,
lifetime not rolling) is enforced in `handleCreateInvoice` against
this resolved identity — so it applies identically whether the
request came from the dashboard, an MCP tool call, or a Zapier zap.

**GDPR:** `DELETE /account` hard-deletes the user and every invoice/
ping/plan tied to them — the right-to-erasure path. `ConsentAt` on
`models.User` records when they accepted the privacy policy/terms,
as evidence of lawful basis. Client PII (name/email) lives scoped to
each `Invoice`, not centrally, so erasure removes exactly what's
needed. Still to do before real launch: a written privacy policy/DPA,
and deciding EU hosting (Fly.io/Railway both support EU regions).

## Dashboard — search & sort

`GET /dashboard` supports `?q=` (search client name/email),
`?status=paid|unpaid`, and `?sort=amount|client|due&order=asc|desc` —
all server-side, so it behaves identically for a browser or an agent
listing invoices via the API.

## Running it locally right now

`go.mod` lives at the **repo root** (not inside `backend/`) — this is
deliberate: it lets `frontend/` and `backend/` share one Go module, so
the HTML templates can be embedded into the binary via `go:embed`
(see `frontend/embed.go`) instead of read from a filesystem path at
runtime. That embedding is what makes the binary immune to "wrong
working directory" bugs — it behaves identically under `go run`,
inside Docker regardless of `WORKDIR`, or run from anywhere at all.

Run from the **repo root**:

```bash
go run ./backend/cmd/server
# -> PingFox backend listening on :8080
```

(Not `cd backend && go run ./cmd/server` — that was the old layout
and will now fail to find the module.)

There's no seed data yet, so `/dashboard` will show "No invoices yet"
until you either (a) add a small seed step in main.go, or (b) build
the invoice-creation endpoint in Phase 2 below.

---

## Implementation plan — start to finish

This is sequenced so every phase leaves you with something that
actually runs, rather than a big-bang integration at the end.

### Phase 0 — Foundations (you are here)
- [x] Repo structure, domain models, storage interface
- [x] In-memory store (dev-only, no setup required)
- [x] Ping-sequence logic (`scheduler.NextStage`, `scheduler.StatusFor`) — pure functions, easy to unit test
- [x] Stripe boundary defined as an interface, currently stubbed
- [x] Basic HTTP routes: dashboard, ping-now, reclaim, webhook receiver
- [x] Landing page (`frontend/landing.html`) — served live at `GET /` — as the reference for visual design and the full reclaim UX

**Do next:** write a few unit tests for `scheduler.NextStage` and
`scheduler.StatusFor` — they're pure functions with no dependencies,
so this is the cheapest, highest-value testing you can do early. Get
comfortable with Go's testing package here before anything else gets
more complex.

### Phase 1 — Real persistence (Postgres)
- Stand up Postgres locally (Docker is the easiest path: `docker run -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16`)
- Apply `migrations/001_init.sql` (pick a migration tool — `golang-migrate` is the standard, simple choice)
- Write a `PostgresStore` implementing the same `db.Store` interface as `InMemoryStore` — this is the payoff of having defined that interface early: nothing in `api/` or `scheduler/` changes, you only swap what `main.go` constructs
- Use `database/sql` + `github.com/jackc/pgx/v5/stdlib` as the driver (well-maintained, widely used, works with plain `database/sql`)

**Why this order:** you want real persistence before auth or Stripe,
because both of those need to actually survive a restart to be
testable at all.

### Phase 2 — Auth + real invoice CRUD
- Add a `users` signup/login flow — for v1, simplest reasonable option is email + magic link (no password to manage) or a basic session-cookie + bcrypt password setup
- Add middleware that resolves the logged-in user and injects `userID` into the request context — replace the hardcoded `demoUserID` in `handleDashboard`
- Build manual invoice entry (form -> `CreateInvoice`) — this is your fallback path for users without Stripe/QuickBooks, and the fastest way to get your *own* first test data in
- Flesh out `dashboard.html` into the real UI, pulling visual details from `frontend/landing.html` (ripple motif, fox branding, status pill colors, the reclaim panel)

### Phase 3 — Stripe Connect integration
This is the highest-stakes phase — take it slowly and test in Stripe's sandbox extensively before going near real money.

- `go get github.com/stripe/stripe-go/v78`
- Implement Stripe Connect Express onboarding: a user clicks "Connect Stripe," you create an Express account (`account.New`), redirect them through Stripe's hosted onboarding, store the returned `acct_...` ID on their `User` row
- Implement real `CreatePaymentLink` — Stripe Payment Links or Checkout Sessions, created **on behalf of the connected account** (`stripe.Params{StripeAccount: acctID}`) so funds route correctly
- Implement real `CreateInstallmentPlan` — either multiple scheduled Invoices, or a Stripe Subscription with a fixed number of cycles, again scoped to the connected account
- Implement real `VerifyWebhook` using `webhook.ConstructEvent` with your webhook signing secret (from the Stripe dashboard) — **never** skip signature verification
- Register the webhook endpoint in Stripe's dashboard (or via CLI: `stripe listen --forward-to localhost:8080/webhooks/stripe` for local dev)
- Handle `invoice.paid` / `payment_intent.succeeded`: resolve the Stripe ref back to your local invoice/installment, mark paid, stop pings — the TODO already flagged in `handleStripeWebhook`
- Add the `processed_webhook_events` idempotency check from the migration — Stripe redelivers events, and double-processing a payment event must never double-charge or double-notify anyone

### Phase 4 — Notifications (real email/SMS)
- Swap `emailNotifier` stub for a real provider — Postmark or SendGrid are both good, low-friction choices for transactional email
- Write the actual email templates for each stage (heads-up, nudge, follow-up) and the three reclaim templates (firmer note, plan offer, loop-in) — content already drafted in the mock, just needs to become real Go templates (`text/template`, since these are emails not HTML pages... though HTML emails are fine too with `html/template`)
- Add SMS via Twilio for the Starter-tier "Email + SMS" feature
- Add the "loop in a teammate" real behavior — needs a lightweight team/seat concept (who's a teammate on this account) before it can actually notify someone

### Phase 5 — Billing PingFox itself
- Separate from Stripe Connect: this is Stripe Billing on **your own** platform Stripe account, charging your users their $19/$49/month subscription
- Standard SaaS billing integration — Stripe Checkout for signup, a webhook handler (a second one, or extended logic in the same handler distinguishing platform-account vs connected-account events) for subscription lifecycle events
- Gate features (invoice count limits, SMS access, team seats) based on the user's current plan

### Phase 6 — Production readiness
- Structured logging (replace `log.Printf` with something like `log/slog`, stdlib since Go 1.21 — no new dependency needed)
- Basic metrics/observability — at minimum, error rates and webhook processing latency
- Deploy target: a single Go binary is trivially deployable — Fly.io, Railway, or a small VPS are all reasonable for this scale; Postgres can be managed (Neon, Supabase, RDS) or self-hosted alongside it
- Backups for Postgres — non-negotiable once real invoice/payment data lives there
- Rate limiting on public endpoints (especially the client-facing payment-plan acceptance page, which needs no login)

---

## Design principles carried through the whole build

- **PingFox never custodies money.** Every payment flows through Stripe Connect directly to the user's own account. This isn't just a technical detail — it's what keeps this a small, bootstrappable SaaS instead of a regulated money-transmitter business.
- **Webhooks, not polling, for payment truth.** The scheduler ticker only drives the *reminder cadence* (day-granularity, fine to poll); actual "has this been paid" truth always comes from a verified Stripe webhook.
- **The `db.Store` interface is the seam.** Every phase above that touches persistence only changes what's constructed in `main.go`. Keep it that way — it's what makes Phase 1 (Postgres swap) a non-event instead of a rewrite.
- **`frontend/landing.html` is a living reference**, not a one-off — it already encodes the full reclaim/payment-plan/webhook UX, and it's served live at `GET /`. When building the real dashboard in Phase 2, treat it as the design spec.
