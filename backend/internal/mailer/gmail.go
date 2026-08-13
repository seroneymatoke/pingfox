package mailer

import (
	"fmt"
	"net/smtp"
)

// GmailSender sends emails via Gmail SMTP.
// Set PINGFOX_GMAIL_ADDRESS and PINGFOX_GMAIL_PASSWORD env vars before use.
type GmailSender struct {
	senderEmail string
	password    string
}

func NewGmailSender(email, password string) *GmailSender {
	return &GmailSender{senderEmail: email, password: password}
}

func (s *GmailSender) Send(email Email) error {
	auth := smtp.PlainAuth("", s.senderEmail, s.password, "smtp.gmail.com")
	addr := "smtp.gmail.com:587"

	// Build the email body
	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s",
		s.senderEmail, email.To, email.Subject, email.Body)

	if err := smtp.SendMail(addr, auth, s.senderEmail, []string{email.To}, []byte(msg)); err != nil {
		return fmt.Errorf("failed to send email: %w", err)
	}
	return nil
}
