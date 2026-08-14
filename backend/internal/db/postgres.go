// Package db provides storage via GORM + Postgres.
package db

import (
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/seroneymatoke/pingfox/backend/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// NewPostgresStore connects to Postgres via the DSN (Data Source Name).
// The DSN is typically: "user=postgres password=xxx host=xxx port=5432 dbname=pingfox"
// For Supabase, use your connection string from the dashboard.
func NewPostgresStore(dsn string, autoCreate bool) (*PostgresStore, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("postgres connection failed: %w", err)
	}
	if autoCreate {
		// Auto-migrate schema on startup (in prod you'd use real migrations, but this is fine for v1)
		if err := db.Migrator().DropTable(&models.User{}, &models.Invoice{}, &models.PingEvent{}, &models.PaymentPlan{}); err != nil {
			log.Printf("warning: couldn't drop tables: %v", err)
		}
		if err := db.AutoMigrate(
			&models.User{},
			&models.Invoice{},
			&models.PingEvent{},
			&models.PaymentPlan{},
			&models.Session{},
		); err != nil {
			return nil, fmt.Errorf("migration failed: %w", err)
		}
	}

	return &PostgresStore{db: db}, nil
}

type PostgresStore struct {
	db *gorm.DB
}

// Invoice methods
func (s *PostgresStore) CreateInvoice(inv *models.Invoice) (*models.Invoice, error) {
	inv.ID = 0 // let DB auto-increment
	inv.PublicID = uuid.New().String()

	token, err := randomToken(32)
	if err != nil {
		return nil, err
	}
	inv.PublicToken = token

	if err := s.db.Create(inv).Error; err != nil {
		return nil, err
	}
	return inv, nil
}

func (s *PostgresStore) GetInvoice(id int64) (*models.Invoice, error) {
	var inv models.Invoice
	if err := s.db.First(&inv, id).Error; err != nil {
		return nil, err
	}
	return &inv, nil
}

func (s *PostgresStore) ListInvoicesByUser(userID int64) ([]*models.Invoice, error) {
	var invoices []*models.Invoice
	if err := s.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&invoices).Error; err != nil {
		return nil, err
	}
	return invoices, nil
}

func (s *PostgresStore) CountInvoicesByUser(userID int64) (int, error) {
	var count int64
	if err := s.db.Model(&models.Invoice{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return 0, err
	}
	return int(count), nil
}

func (s *PostgresStore) UpdateInvoiceStatus(id int64, status models.InvoiceStatus) error {
	return s.db.Model(&models.Invoice{}).Where("id = ?", id).Update("status", status).Error
}

func (s *PostgresStore) RecordPing(invoiceID int64, stage, channel string) error {
	ping := &models.PingEvent{
		InvoiceID: invoiceID,
		Stage:     stage,
		Channel:   channel,
		SentAt:    time.Now(),
	}
	if err := s.db.Create(ping).Error; err != nil {
		return err
	}
	// Also increment pings_sent and update last_ping_at on the invoice
	return s.db.Model(&models.Invoice{}).Where("id = ?", invoiceID).
		Updates(map[string]interface{}{
			"pings_sent":   gorm.Expr("pings_sent + 1"),
			"last_ping_at": time.Now(),
		}).Error
}

func (s *PostgresStore) DueForPing(now time.Time) ([]*models.Invoice, error) {
	var invoices []*models.Invoice
	err := s.db.Where("status NOT IN (?, ?)", models.StatusPaid, models.StatusPlanActive).Find(&invoices).Error
	return invoices, err
}

// PaymentPlan methods
func (s *PostgresStore) CreatePaymentPlan(plan *models.PaymentPlan) (*models.PaymentPlan, error) {
	if err := s.db.Create(plan).Error; err != nil {
		return nil, err
	}
	return plan, nil
}

func (s *PostgresStore) GetPaymentPlan(id int64) (*models.PaymentPlan, error) {
	var plan models.PaymentPlan
	if err := s.db.First(&plan, id).Error; err != nil {
		return nil, err
	}
	return &plan, nil
}

func (s *PostgresStore) MarkInstallmentPaid(planID int64, sequenceNo int, stripeRef string, paidAt time.Time) error {
	// This is simplified for now — real implementation would update the Installments array properly
	return nil
}

// User methods
func (s *PostgresStore) CreateUser(email string) (*models.User, error) {
	// This old method is deprecated — use CreateUserWithPassword or CreateOAuthUser instead
	return nil, fmt.Errorf("use CreateUserWithPassword or CreateOAuthUser")
}

func (s *PostgresStore) CreateUserWithPassword(email, passwordHash string) (*models.User, error) {
	user := &models.User{
		Email:        email,
		PasswordHash: passwordHash,
		PlanTier:     models.PlanFree,
		ConsentAt:    time.Now(),
		CreatedAt:    time.Now(),
	}
	// Generate API key
	key, err := randomToken(32)
	if err != nil {
		return nil, err
	}
	user.APIKey = key

	if err := s.db.Create(user).Error; err != nil {
		return nil, err
	}
	return user, nil
}

func (s *PostgresStore) GetUserByID(id int64) (*models.User, error) {
	var user models.User
	if err := s.db.First(&user, id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *PostgresStore) GetUserByEmail(email string) (*models.User, error) {
	var user models.User
	if err := s.db.Where("email = ?", email).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *PostgresStore) GetUserByAPIKey(key string) (*models.User, error) {
	var user models.User
	if err := s.db.Where("api_key = ?", key).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *PostgresStore) GetUserByStripeAccount(acctID string) (*models.User, error) {
	var user models.User
	if err := s.db.Where("stripe_account_id = ?", acctID).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *PostgresStore) CreateSession(userID int64) (string, error) {
	token, err := randomToken(32)
	if err != nil {
		return "", err
	}
	session := &models.Session{
		Token:     token,
		UserID:    userID,
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
		CreatedAt: time.Now(),
	}
	if err := s.db.Create(session).Error; err != nil {
		return "", err
	}
	return token, nil
}

func (s *PostgresStore) GetSessionUserID(token string) (int64, error) {
	var session models.Session
	if err := s.db.Where("token = ? AND expires_at > ?", token, time.Now()).First(&session).Error; err != nil {
		return 0, fmt.Errorf("invalid or expired session")
	}
	return session.UserID, nil
}

func (s *PostgresStore) DeleteUser(userID int64) error {
	// Hard delete the user and everything tied to them (GDPR right to erasure)
	if err := s.db.Where("user_id = ?", userID).Delete(&models.Invoice{}).Error; err != nil {
		return err
	}
	if err := s.db.Where("user_id = ?", userID).Delete(&models.PingEvent{}).Error; err != nil {
		return err
	}
	return s.db.Delete(&models.User{}, userID).Error
}

// CreateUserWithOAuth creates or retrieves a user authenticated via OAuth.
func (s *PostgresStore) CreateUserWithOAuth(email, provider, subject string) (*models.User, error) {
	// Try to find existing OAuth user
	var user models.User
	err := s.db.Where("oauth_provider = ? AND oauth_subject = ?", provider, subject).First(&user).Error
	if err == nil {
		return &user, nil // Already exists
	}

	// Create new OAuth user
	key, err := randomToken(32)
	if err != nil {
		return nil, err
	}
	user = models.User{
		Email:         email,
		OAuthProvider: provider,
		OAuthSubject:  subject,
		APIKey:        key,
		PlanTier:      models.PlanFree,
		ConsentAt:     time.Now(),
		CreatedAt:     time.Now(),
	}
	if err := s.db.Create(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *PostgresStore) GetUserByOAuth(provider, subject string) (*models.User, error) {
	var user models.User
	if err := s.db.Where("oauth_provider = ? AND oauth_subject = ?", provider, subject).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}
