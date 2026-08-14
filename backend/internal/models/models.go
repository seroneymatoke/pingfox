// Package models defines the core domain types used across PingFox.
//
// These types deliberately depend only on the Go standard library, so
// handlers, database storage, scheduling, and payment integrations can
// use them without creating import cycles.
package models

import "time"

// InvoiceStatus describes the current payment/recovery state of an invoice.
type InvoiceStatus string

const (
	StatusPending    InvoiceStatus = "pending"     // Invoice is not due yet.
	StatusOverdue    InvoiceStatus = "overdue"     // Due date passed, but under 30 days overdue.
	StatusCritical   InvoiceStatus = "critical"    // 30 or more days overdue; eligible for reclaim actions.
	StatusPlanActive InvoiceStatus = "plan_active" // Customer accepted a payment plan.
	StatusPaid       InvoiceStatus = "paid"        // Fully paid; reminders must stop.
)

// VATTreatment determines whether VAT is absent, contained in entered prices,
// or added above the entered line-item subtotal.
type VATTreatment string

const (
	VATNone      VATTreatment = "none"
	VATInclusive VATTreatment = "inclusive"
	VATExclusive VATTreatment = "exclusive"
)

// Invoice is PingFox's local record of an invoice.
//
// Money is stored as integer minor units (cents for EUR/USD/GBP) to avoid
// floating-point rounding errors. For example, €100.16 is stored as 10016.
// Stripe or the user's accounting system remains the payment ledger; PingFox
// stores the data needed for reminders, invoice presentation, and reconciliation.
type Invoice struct {
	ID     int64
	UserID int64

	// InvoiceNumber is the user-facing, unique sequential reference shown on
	// the issued invoice (for example, PF-2026-0001). ID is internal only.
	InvoiceNumber string
	ExternalRef   string // Stripe or accounting-system reference, when available.

	// Customer billing details. ClientAddress is optional at draft stage, but
	// should be required before issuing an invoice in a compliance-focused flow.
	ClientName    string
	ClientEmail   string
	ClientAddress string
	ClientVATID   string

	// Issuer fields are copied from the user's business profile at the time the
	// invoice is issued. Keeping a snapshot means historical invoices do not
	// silently change if the account profile is edited later.
	IssuerName    string
	IssuerAddress string
	IssuerVATID   string
	IssuerTaxID   string

	Currency string // ISO 4217 code, for example "EUR".

	// Amounts are stored in minor units. AmountCents is the gross amount due and
	// remains for compatibility with reminder, payment-plan, and Stripe code.
	AmountCents   int64
	SubtotalCents int64
	VATCents      int64
	VATRateBasis  int64 // VAT percentage × 100; 1900 represents 19.00%.
	VATTreatment  VATTreatment

	IssueDate        time.Time
	DueDate          time.Time
	ServiceDate      *time.Time // Date of supply/service when different from IssueDate.
	PaymentTerms     string
	PurchaseOrderRef string
	Notes            string

	Status     InvoiceStatus
	PingsSent  int
	LastPingAt *time.Time
	PlanID     *int64

	// PublicID and PublicToken support an unguessable view-only client URL.
	// Validate both values server-side before rendering a public invoice page.
	PublicID    string
	PublicToken string

	CreatedAt time.Time
	UpdatedAt time.Time
}

// InvoiceLineItem is one immutable-priced billable item belonging to an invoice.
// UnitPriceCents × Quantity should equal LineTotalCents before tax treatment.
type InvoiceLineItem struct {
	ID        int64
	InvoiceID int64
	Position  int

	Description    string
	Quantity       int64 // Whole-unit quantity for v1. Expand later if fractional quantities are required.
	UnitPriceCents int64
	LineTotalCents int64

	CreatedAt time.Time
	UpdatedAt time.Time
}

// PingEvent is an audit record for a reminder actually sent by PingFox.
type PingEvent struct {
	ID        int64
	InvoiceID int64
	Stage     string // "heads_up", "nudge", "follow_up", "escalation", or "manual".
	Channel   string // "email" or "sms".
	SentAt    time.Time
}

// PaymentPlan tracks a payment-plan offer or acceptance. Stripe executes the
// installments; this model stores PingFox's local view of that state.
type PaymentPlan struct {
	ID           int64
	InvoiceID    int64
	Installments string `gorm:"type:jsonb"`
	Status       string // "offered", "accepted", "completed", or "broken".
	AcceptedAt   *time.Time
	CreatedAt    time.Time
}

// Installment represents one payment within a payment plan.
type Installment struct {
	SequenceNo  int
	AmountCents int64
	DueDate     time.Time
	Paid        bool
	PaidAt      *time.Time
	StripeRef   string // Stripe PaymentIntent or Invoice ID after charging.
}

// User is a PingFox account holder—a freelancer or agency—not an end client.
type User struct {
	ID            int64
	Email         string
	EmailVerified bool

	// PasswordHash is populated for password accounts. OAuth accounts use
	// OAuthProvider and OAuthSubject instead.
	PasswordHash  string
	PasswordSalt  string
	OAuthProvider string // "google", "github", or empty for password accounts.
	OAuthSubject  string // Stable ID returned by the OAuth provider.

	ConsentAt time.Time // Timestamp of terms/privacy consent.
	APIKey    string    // Server-generated key for future integrations/API access.
	PlanTier  PlanTier

	// Business profile values used to populate invoice issuer snapshots.
	BusinessName    string
	BusinessAddress string
	BusinessVATID   string
	BusinessTaxID   string

	// StripeAccountID identifies the user's connected Stripe account.
	// PingFox does not custody their customer funds.
	StripeAccountID string

	CreatedAt time.Time
}

// PlanTier controls feature and invoice limits for an account.
type PlanTier string

const (
	PlanFree    PlanTier = "free"
	PlanStarter PlanTier = "starter"
	PlanGrowth  PlanTier = "growth"

	// FreeTierInvoiceLimit is enforced server-side when an invoice is created.
	FreeTierInvoiceLimit = 3
)

// Session represents a persistent authenticated browser session.
type Session struct {
	Token     string `gorm:"primaryKey"`
	UserID    int64
	ExpiresAt time.Time
	CreatedAt time.Time
}
