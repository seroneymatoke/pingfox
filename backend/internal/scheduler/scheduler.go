// Package scheduler owns the ping-sequence rules: when a reminder is
// due, what stage it's at, and when an invoice should be flagged
// critical (30+ days overdue) rather than just overdue.
//
// This is deliberately pure logic with no HTTP, no DB driver, and no
// Stripe import — it takes an Invoice and "now", and returns a
// decision. That makes it trivial to unit test and to reuse from
// both the background worker and, later, a manual "ping now" button
// in the API.
package scheduler

import (
	"log"
	"time"

	"github.com/seroneymatoke/pingfox/backend/internal/models"
)

type Stage string

const (
	StageHeadsUp    Stage = "heads_up"   // 3 days before due
	StageNudge      Stage = "nudge"      // due date, still unpaid
	StageFollowUp   Stage = "follow_up"  // 7 days overdue
	StageEscalation Stage = "escalation" // 30 days overdue
	StageNone       Stage = ""           // nothing due right now
)

// NextStage decides which ping stage (if any) an invoice is due for,
// given the current time. It's intentionally simple: each stage fires
// once, based on days-until/-since the due date. A real system also
// needs to check "have we already pinged for this stage" — that check
// lives in the caller (scheduler.Run), since it needs PingEvent
// history from the store, which this pure function doesn't have.
func NextStage(inv *models.Invoice, now time.Time) Stage {
	daysUntilDue := int(inv.DueDate.Sub(now).Hours() / 24)
	daysOverdue := -daysUntilDue

	switch {
	case daysUntilDue >= 3:
		return StageHeadsUp
	case daysUntilDue <= 0 && daysOverdue == 0:
		return StageNudge
	case daysOverdue > 0 && daysOverdue < 7: // Add this — covers 1-6 days overdue
		return StageFollowUp
	case daysOverdue >= 7 && daysOverdue < 30:
		return StageFollowUp
	case daysOverdue >= 30:
		return StageEscalation
	default:
		return StageNone
	}
}

// StatusFor derives the display status from days overdue. Called
// after every sync/webhook so the UI status pill always matches the
// underlying due date math, not just the last webhook received.
func StatusFor(inv *models.Invoice, now time.Time) models.InvoiceStatus {
	if inv.Status == models.StatusPaid || inv.Status == models.StatusPlanActive {
		return inv.Status // terminal/managed states aren't recomputed from due date
	}
	daysOverdue := int(now.Sub(inv.DueDate).Hours() / 24)
	switch {
	case daysOverdue >= 30:
		return models.StatusCritical
	case daysOverdue > 0:
		return models.StatusOverdue
	default:
		return models.StatusPending
	}
}

// Store is the minimal slice of db.Store the scheduler needs. Defined
// here (not imported from db) so this package has zero dependency on
// the db package's concrete types — keeps the dependency graph one-way.
type Store interface {
	DueForPing(now time.Time) ([]*models.Invoice, error)
	RecordPing(invoiceID int64, stage, channel string) error
	UpdateInvoiceStatus(id int64, status models.InvoiceStatus) error
}

type Notifier interface {
	SendPing(inv *models.Invoice, stage Stage) error
}

// Run executes one scheduling pass: pull candidate invoices, work out
// what's due, send it, record it. Intended to be called on a ticker
// (e.g. every 15 minutes) from cmd/server/main.go — see the comment
// there for why polling this way is fine even though invoice *status*
// itself is webhook-driven, not polled.
func Run(store Store, notifier Notifier, now time.Time) error {
	invoices, err := store.DueForPing(now)
	if err != nil {
		return err
	}
	log.Printf("[scheduler] found %d invoices due for pinging", len(invoices)) // Add this

	for _, inv := range invoices {
		newStatus := StatusFor(inv, now)
		if newStatus != inv.Status {
			if err := store.UpdateInvoiceStatus(inv.ID, newStatus); err != nil {
				return err
			}
			inv.Status = newStatus
		}
		if inv.LastPingAt != nil {
			timeSinceLastPing := now.Sub(*inv.LastPingAt)
			if timeSinceLastPing < 24*time.Hour { // Don't ping more than once per day
				continue
			}
		}

		stage := NextStage(inv, now)
		if stage == StageNone {
			continue
		}

		channel := "email"
		if stage == StageEscalation {
			channel = "email" // escalation is a manual/reclaim flow in v1, not auto-sent — see api/reclaim.go
			continue
		}

		if err := notifier.SendPing(inv, stage); err != nil {
			return err
		}
		if err := store.RecordPing(inv.ID, string(stage), channel); err != nil {
			return err
		}
	}
	return nil
}
