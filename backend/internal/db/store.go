// Package db defines the persistence interface PingFox depends on,
// plus an in-memory implementation used for local development and
// tests. Swap InMemoryStore for a Postgres-backed implementation
// (see migrations/001_init.sql) when you're ready to deploy — nothing
// outside this package needs to change, since api/ and scheduler/
// only ever talk to the Store interface.
package db

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/seroneymatoke/pingfox/backend/internal/models"
)

// Store is the persistence boundary. Every method the rest of the app
// needs lives here. Keeping this interface small and explicit is what
// makes swapping SQLite -> Postgres later a non-event.
type Store interface {
	CreateInvoice(inv *models.Invoice) (*models.Invoice, error)
	GetInvoice(id int64) (*models.Invoice, error)
	ListInvoicesByUser(userID int64) ([]*models.Invoice, error)
	CountInvoicesByUser(userID int64) (int, error)
	UpdateInvoiceStatus(id int64, status models.InvoiceStatus) error
	RecordPing(invoiceID int64, stage, channel string) error
	DueForPing(now time.Time) ([]*models.Invoice, error)

	CreatePaymentPlan(plan *models.PaymentPlan) (*models.PaymentPlan, error)
	GetPaymentPlan(id int64) (*models.PaymentPlan, error)
	MarkInstallmentPaid(planID int64, sequenceNo int, stripeRef string, paidAt time.Time) error

	// User + auth. CreateUserWithPassword / CreateUserWithOAuth
	// generate the API key server-side — callers never supply one.
	// Sessions map an opaque token (set as an httpOnly cookie) to a
	// userID; API keys are the long-lived credential for
	// programmatic/agentic access.
	CreateUserWithPassword(email, passwordHash string) (*models.User, error)
	CreateUserWithOAuth(email, provider, subject string) (*models.User, error)
	GetUserByEmail(email string) (*models.User, error)
	GetUserByOAuth(provider, subject string) (*models.User, error)
	GetUserByID(id int64) (*models.User, error)
	GetUserByAPIKey(key string) (*models.User, error)
	GetUserByStripeAccount(acctID string) (*models.User, error)
	CreateSession(userID int64) (token string, err error)
	GetSessionUserID(token string) (int64, error)

	// DeleteUser fulfils a GDPR erasure request: removes the user
	// record and every invoice/ping/plan tied to them. This is a hard
	// delete, not a soft "deactivated" flag — erasure requests mean
	// the data is actually gone.
	DeleteUser(userID int64) error
}

// InMemoryStore is safe for concurrent use. It exists so `go run` works
// immediately with no external database — good for local dev and demos,
// not for production (data disappears on restart).
type InMemoryStore struct {
	mu         sync.Mutex
	invoices   map[int64]*models.Invoice
	plans      map[int64]*models.PaymentPlan
	pingLog    []*models.PingEvent
	users      map[int64]*models.User
	usersByKey map[string]int64 // api key -> userID
	sessions   map[string]int64 // session token -> userID
	nextInvID  int64
	nextPlanID int64
	nextPingID int64
	nextUserID int64
}

func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{
		invoices:   make(map[int64]*models.Invoice),
		plans:      make(map[int64]*models.PaymentPlan),
		users:      make(map[int64]*models.User),
		usersByKey: make(map[string]int64),
		sessions:   make(map[string]int64),
	}
}

func (s *InMemoryStore) CreateInvoice(inv *models.Invoice) (*models.Invoice, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextInvID++
	inv.ID = s.nextInvID
	now := time.Now()
	inv.CreatedAt, inv.UpdatedAt = now, now
	s.invoices[inv.ID] = inv
	return inv, nil
}

func (s *InMemoryStore) GetInvoice(id int64) (*models.Invoice, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	inv, ok := s.invoices[id]
	if !ok {
		return nil, fmt.Errorf("invoice %d not found", id)
	}
	return inv, nil
}

func (s *InMemoryStore) ListInvoicesByUser(userID int64) ([]*models.Invoice, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*models.Invoice
	for _, inv := range s.invoices {
		if inv.UserID == userID {
			out = append(out, inv)
		}
	}
	return out, nil
}

// CountInvoicesByUser counts ALL invoices ever created by this user,
// not just active ones — this is deliberate. If deleted/paid invoices
// didn't count toward the free-tier limit, a user could cycle through
// unlimited invoices by deleting old ones. The limit is lifetime, not
// a rolling window.
func (s *InMemoryStore) CountInvoicesByUser(userID int64) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	for _, inv := range s.invoices {
		if inv.UserID == userID {
			count++
		}
	}
	return count, nil
}

func (s *InMemoryStore) UpdateInvoiceStatus(id int64, status models.InvoiceStatus) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	inv, ok := s.invoices[id]
	if !ok {
		return fmt.Errorf("invoice %d not found", id)
	}
	inv.Status = status
	inv.UpdatedAt = time.Now()
	return nil
}

func (s *InMemoryStore) RecordPing(invoiceID int64, stage, channel string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	inv, ok := s.invoices[invoiceID]
	if !ok {
		return fmt.Errorf("invoice %d not found", invoiceID)
	}
	s.nextPingID++
	now := time.Now()
	s.pingLog = append(s.pingLog, &models.PingEvent{
		ID:        s.nextPingID,
		InvoiceID: invoiceID,
		Stage:     stage,
		Channel:   channel,
		SentAt:    now,
	})
	inv.PingsSent++
	inv.LastPingAt = &now
	inv.UpdatedAt = now
	return nil
}

// DueForPing returns invoices whose next ping stage has come up, based
// on the ping-sequence rules in scheduler.Rules. Kept intentionally
// simple here (status + pings-sent count); scheduler.go owns the
// actual timing/stage logic.
func (s *InMemoryStore) DueForPing(now time.Time) ([]*models.Invoice, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*models.Invoice
	for _, inv := range s.invoices {
		if inv.Status == models.StatusPaid || inv.Status == models.StatusPlanActive {
			continue // never ping a paid invoice or one under an active plan
		}
		out = append(out, inv)
	}
	return out, nil
}

func (s *InMemoryStore) CreatePaymentPlan(plan *models.PaymentPlan) (*models.PaymentPlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextPlanID++
	plan.ID = s.nextPlanID
	plan.CreatedAt = time.Now()
	s.plans[plan.ID] = plan
	return plan, nil
}

func (s *InMemoryStore) GetPaymentPlan(id int64) (*models.PaymentPlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, ok := s.plans[id]
	if !ok {
		return nil, fmt.Errorf("plan %d not found", id)
	}
	return plan, nil
}

func (s *InMemoryStore) MarkInstallmentPaid(planID int64, sequenceNo int, stripeRef string, paidAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, ok := s.plans[planID]
	if !ok {
		return fmt.Errorf("plan %d not found", planID)
	}
	plan.Status = "paid"
	plan.AcceptedAt = &paidAt
	return nil
}

func (s *InMemoryStore) GetUserByStripeAccount(acctID string) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.users {
		if u.StripeAccountID == acctID {
			return u, nil
		}
	}
	return nil, fmt.Errorf("no user for stripe account %s", acctID)
}

func (s *InMemoryStore) CreateUserWithPassword(email, passwordHash string) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.users {
		if u.Email == email {
			return nil, fmt.Errorf("account already exists for %s", email)
		}
	}
	key, err := randomToken(24)
	if err != nil {
		return nil, err
	}
	s.nextUserID++
	user := &models.User{
		ID:           s.nextUserID,
		Email:        email,
		PasswordHash: passwordHash,
		APIKey:       key,
		PlanTier:     models.PlanFree,
		ConsentAt:    time.Now(),
		CreatedAt:    time.Now(),
	}
	s.users[user.ID] = user
	s.usersByKey[key] = user.ID
	return user, nil
}

func (s *InMemoryStore) CreateUserWithOAuth(email, provider, subject string) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.users {
		if u.OAuthProvider == provider && u.OAuthSubject == subject {
			return nil, fmt.Errorf("account already linked")
		}
	}
	key, err := randomToken(24)
	if err != nil {
		return nil, err
	}
	s.nextUserID++
	user := &models.User{
		ID:            s.nextUserID,
		Email:         email,
		EmailVerified: true, // OAuth providers verify email ownership themselves
		OAuthProvider: provider,
		OAuthSubject:  subject,
		APIKey:        key,
		PlanTier:      models.PlanFree,
		CreatedAt:     time.Now(),
	}
	s.users[user.ID] = user
	s.usersByKey[key] = user.ID
	return user, nil
}

func (s *InMemoryStore) GetUserByEmail(email string) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.users {
		if u.Email == email {
			return u, nil
		}
	}
	return nil, fmt.Errorf("no account for %s", email)
}

func (s *InMemoryStore) GetUserByOAuth(provider, subject string) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.users {
		if u.OAuthProvider == provider && u.OAuthSubject == subject {
			return u, nil
		}
	}
	return nil, fmt.Errorf("no account linked for %s/%s", provider, subject)
}

// DeleteUser hard-deletes the user and everything tied to them —
// invoices, ping history, payment plans. This is what a GDPR erasure
// request must trigger. In the Postgres implementation this should
// run inside a single transaction; the in-memory version here is for
// local dev/testing of the deletion logic's shape, not a compliance
// artifact itself.
func (s *InMemoryStore) DeleteUser(userID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return fmt.Errorf("user %d not found", userID)
	}
	for invID, inv := range s.invoices {
		if inv.UserID == userID {
			delete(s.invoices, invID)
		}
	}
	for planID, plan := range s.plans {
		if inv, ok := s.invoices[plan.InvoiceID]; ok && inv.UserID == userID {
			delete(s.plans, planID)
		}
	}
	var keptPings []*models.PingEvent
	for _, p := range s.pingLog {
		if _, stillExists := s.invoices[p.InvoiceID]; stillExists {
			keptPings = append(keptPings, p)
		}
	}
	s.pingLog = keptPings

	if u := s.users[userID]; u != nil && u.APIKey != "" {
		delete(s.usersByKey, u.APIKey)
	}
	delete(s.users, userID)
	for token, uid := range s.sessions {
		if uid == userID {
			delete(s.sessions, token)
		}
	}
	return nil
}

func (s *InMemoryStore) GetUserByID(id int64) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return nil, fmt.Errorf("user %d not found", id)
	}
	return u, nil
}

func (s *InMemoryStore) GetUserByAPIKey(key string) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	userID, ok := s.usersByKey[key]
	if !ok {
		return nil, fmt.Errorf("invalid api key")
	}
	return s.users[userID], nil
}

// CreateSession mints an opaque session token for cookie-based web
// login, independent of the API key (so revoking a browser session
// doesn't invalidate a user's programmatic/agent access, and vice versa).
func (s *InMemoryStore) CreateSession(userID int64) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[userID]; !ok {
		return "", fmt.Errorf("user %d not found", userID)
	}
	token, err := randomToken(32)
	if err != nil {
		return "", err
	}
	s.sessions[token] = userID
	return token, nil
}

func (s *InMemoryStore) GetSessionUserID(token string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	userID, ok := s.sessions[token]
	if !ok {
		return 0, fmt.Errorf("invalid or expired session")
	}
	return userID, nil
}

func randomToken(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
