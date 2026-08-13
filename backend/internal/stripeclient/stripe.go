// Package stripeclient isolates every Stripe touchpoint behind one
// interface, so main.go and api/ never import the Stripe SDK directly.
//
// IMPORTANT — this file is a stub. It compiles and runs with zero
// external dependencies so the project builds out of the box, but
// CreatePaymentLink/CreateInstallmentPlan/VerifyWebhook are fakes.
// To go live:
//
//   go get github.com/stripe/stripe-go/v78
//
// then replace StubClient's bodies with real calls to:
//   - stripe.PaymentLink.New / stripe.Invoice.New   (payment links, plans)
//   - webhook.ConstructEvent                         (VerifyWebhook)
//   - account.New with Type=Express                  (Connect onboarding,
//     not shown here — see IMPLEMENTATION_PLAN.md Phase 3)
package stripeclient

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/seroneymatoke/pingfox/backend/internal/models"
)

type Client interface {
	// CreatePaymentLink returns a hosted URL the client can pay
	// directly, under the connected account (acctID) so funds land
	// with the freelancer, not PingFox.
	CreatePaymentLink(acctID string, inv *models.Invoice) (url string, err error)

	// CreateInstallmentPlan sets up N scheduled charges under the
	// connected account and returns a hosted acceptance URL for the
	// client — the "client accepts, first charge fires" flow from the
	// landing page mock.
	CreateInstallmentPlan(acctID string, inv *models.Invoice, installments []models.Installment) (acceptURL string, err error)

	// VerifyWebhook checks the Stripe-Signature header and parses the
	// event. Never trust an unverified webhook body — this is the
	// single most important line of the whole payments integration.
	VerifyWebhook(payload []byte, sigHeader string) (WebhookEvent, error)
}

type WebhookEvent struct {
	Type          string // e.g. "invoice.paid", "payment_intent.succeeded"
	InvoiceRef    string // Stripe invoice/payment intent ID
	AmountCents   int64
	OccurredAt    time.Time
}

// StubClient is an in-memory fake so `go run` works before Stripe keys
// exist. Every "URL" it returns is a local placeholder page — good
// enough to click through the full flow in development.
type StubClient struct{}

func NewStubClient() *StubClient { return &StubClient{} }

func (c *StubClient) CreatePaymentLink(acctID string, inv *models.Invoice) (string, error) {
	return "https://pingfox.local/pay/" + randToken(), nil
}

func (c *StubClient) CreateInstallmentPlan(acctID string, inv *models.Invoice, installments []models.Installment) (string, error) {
	return "https://pingfox.local/plan/" + randToken(), nil
}

func (c *StubClient) VerifyWebhook(payload []byte, sigHeader string) (WebhookEvent, error) {
	// Stub: real implementation MUST use stripe's webhook.ConstructEvent
	// with your webhook signing secret. Never parse the JSON body
	// directly without signature verification in production — an
	// unverified webhook is an open door to fake "payment received"
	// events.
	return WebhookEvent{Type: "invoice.paid", OccurredAt: time.Now()}, nil
}

func randToken() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
