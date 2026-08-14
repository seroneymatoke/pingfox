// Package models holds the core domain types for PingFox.
// Kept dependency-free (stdlib only) so it's usable from any layer
// (db, api, scheduler) without import cycles.
package models

import (
	"time"
)

type InvoiceStatus string

const (
	StatusPending    InvoiceStatus = "pending"     // not yet due
	StatusOverdue    InvoiceStatus = "overdue"     // past due, < 30 days
	StatusCritical   InvoiceStatus = "critical"    // 30+ days overdue
	StatusPlanActive InvoiceStatus = "plan_active" // payment plan accepted, installments running
	StatusPaid       InvoiceStatus = "paid"
)

// Invoice mirrors what PingFox tracks locally. The source of truth for
// money movement is always Stripe (or QuickBooks) — this is a read
// model kept in sync via webhooks and periodic reconciliation, not the
// ledger of record.
type Invoice struct {
	ID          int64
	UserID      int64
	ExternalRef string
	ClientName  string
	ClientEmail string
	AmountCents int64
	Currency    string
	DueDate     time.Time
	Status      InvoiceStatus
	PingsSent   int
	LastPingAt  *time.Time
	PlanID      *int64
	PublicID    string // Add this line
	PublicToken string // Add this line
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// PingEvent records every reminder actually sent, so the ping engine
// never needs to re-derive history from scratch and so users can see
// a full audit trail per invoice.
type PingEvent struct {
	ID        int64
	InvoiceID int64
	Stage     string // "heads_up" | "nudge" | "follow_up" | "escalation"
	Channel   string // "email" | "sms"
	SentAt    time.Time
}

// PaymentPlan represents an offered/accepted installment schedule.
// Stripe (via Stripe Billing or repeated Invoicing) is the actual
// executor — this row tracks what PingFox offered and its state.
type PaymentPlan struct {
	ID           int64
	InvoiceID    int64
	Installments string `gorm:"type:jsonb"` // Store as JSON instead of a slice
	Status       string
	AcceptedAt   *time.Time
	CreatedAt    time.Time
}

type Installment struct {
	SequenceNo  int
	AmountCents int64
	DueDate     time.Time
	Paid        bool
	PaidAt      *time.Time
	StripeRef   string // Stripe PaymentIntent or Invoice ID once charged
}

// User is a PingFox account holder (the freelancer/agency), not their
// end client. StripeAccountID is their *connected* account under
// Stripe Connect — PingFox platform funds never mix with this.
//
// APIKey is server-generated at signup and is the identity used for
// agentic/API access (MCP, Zapier, direct API calls) — it is never
// accepted as a client-supplied value anywhere. PlanTier gates the
// free-tier invoice limit.
//
// A user authenticates via EITHER password (PasswordHash/Salt set,
// OAuthProvider empty) OR OAuth (OAuthProvider/OAuthSubject set,
// PasswordHash empty) — never both, never neither.
//
// GDPR note: this struct intentionally holds the minimum PII needed
// to operate the account (email, auth material). Client PII (name,
// email) lives on Invoice, not here, and is scoped per-invoice so an
// erasure request can remove exactly what's needed — see DeleteUser
// in db.Store and the erasure notes in migrations/001_init.sql.
type User struct {
	ID              int64
	Email           string
	EmailVerified   bool
	PasswordHash    string // empty if this account uses OAuth
	PasswordSalt    string
	OAuthProvider   string    // "google" | "github" | "" for password accounts
	OAuthSubject    string    // provider's stable user id ("sub" claim / GitHub user id)
	ConsentAt       time.Time // when the user accepted terms/privacy policy — evidence of lawful basis
	APIKey          string
	PlanTier        PlanTier
	StripeAccountID string // Stripe Connect account ID (acct_...)
	CreatedAt       time.Time
}

type PlanTier string

const (
	PlanFree    PlanTier = "free"
	PlanStarter PlanTier = "starter"
	PlanGrowth  PlanTier = "growth"
)

const FreeTierInvoiceLimit = 3

type Session struct {
	Token     string `gorm:"primaryKey"`
	UserID    int64
	ExpiresAt time.Time
	CreatedAt time.Time
}
