package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/seroneymatoke/pingfox/backend/internal/api"
	"github.com/seroneymatoke/pingfox/backend/internal/db"
	"github.com/seroneymatoke/pingfox/backend/internal/mailer"
	"github.com/seroneymatoke/pingfox/backend/internal/models"
	"github.com/seroneymatoke/pingfox/backend/internal/scheduler"
	"github.com/seroneymatoke/pingfox/backend/internal/stripeclient"
	"github.com/seroneymatoke/pingfox/frontend"
)

func main() {
	autoCreate := false
	for _, arg := range os.Args[1:] {
		if arg == "autocreate=true" || arg == "autocreate=True" {
			autoCreate = true
		}
	}
	// Database setup
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL env var not set")
	}

	store, err := db.NewPostgresStore(databaseURL, autoCreate)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	log.Println("✓ Connected to Postgres")

	// Email setup
	var emailSender mailer.Sender = mailer.StubSender{} // default
	gmailAddr := os.Getenv("PINGFOX_GMAIL_ADDRESS")
	gmailPass := os.Getenv("PINGFOX_GMAIL_PASSWORD")
	if gmailAddr != "" && gmailPass != "" {
		emailSender = mailer.NewGmailSender(gmailAddr, gmailPass)
		log.Println("✓ Gmail SMTP configured")
	} else {
		log.Println("⚠ Gmail not configured, using stub (prints to console)")
	}

	// Server setup
	stripe := &stripeclient.StubClient{}
	server, err := api.NewServer(store, stripe, emailSender, frontend.TemplatesFS, frontend.TemplatesGlob, frontend.LandingPageHTML)
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}

	// Start scheduler in background
	go func() {
		notifier := &emailNotifier{sender: emailSender}
		ticker := time.NewTicker(10 * time.Second)
		for range ticker.C {
			log.Println("[scheduler] tick at", time.Now())
			if err := scheduler.Run(store, notifier, time.Now()); err != nil {
				log.Printf("[scheduler] error: %v", err)
			} else {
				log.Println("[scheduler] completed successfully")
			}
		}
	}()

	// Start HTTP server
	log.Println("PingFox backend listening on :8443 (HTTPS)")
	if err := http.ListenAndServeTLS(":8443", "localhost+1.pem", "localhost+1-key.pem", server.Routes()); err != nil {
		log.Fatal(err)
	}
}

type emailNotifier struct {
	sender mailer.Sender
}

func (n *emailNotifier) SendPing(inv *models.Invoice, stage scheduler.Stage) error {
	log.Printf("[emailNotifier] sending %s ping for invoice %d to %s", stage, inv.ID, inv.ClientEmail)

	email, err := mailer.RenderStage(string(stage), mailer.TemplateData{
		InvoiceID:  inv.ID,
		ClientName: inv.ClientName,
		Amount:     mailer.FormatDollars(inv.AmountCents),
		DueDate:    inv.DueDate.Format("Jan 2, 2006"),
		PayLink:    "https://pingfox.com/pay/" + inv.ExternalRef,
		SenderName: "PingFox",
	})
	if err != nil {
		log.Printf("[emailNotifier] render error: %v", err)
		return err
	}
	email.To = inv.ClientEmail

	log.Printf("[emailNotifier] sending email to %s with subject: %s", email.To, email.Subject)
	err = n.sender.Send(email)
	if err != nil {
		log.Printf("[emailNotifier] send error: %v", err)
		return err
	}
	log.Printf("[emailNotifier] email sent successfully")
	return nil
}
