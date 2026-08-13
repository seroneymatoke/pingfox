// Package mailer owns every outbound email PingFox sends — both the
// automatic ping sequence (scheduler.Stage) and the manual reclaim
// actions (firmer note, payment plan offer, loop-in-teammate). Content
// lives here, once, so the scheduler and the reclaim handler both
// render from the same source instead of duplicating copy (the
// landing-page mock's JS templates were a preview of this content,
// not a second copy to keep in sync — this file is now the real one).
//
// Sending is still a stub (log.Printf) — see Sender interface at the
// bottom. Swap in Postmark/SendGrid there; nothing above it changes.
package mailer

import (
	"bytes"
	"fmt"
	"text/template"
)

type Email struct {
	To      string
	Subject string
	Body    string
}

// --- Automatic ping sequence templates ----------------------------------

var stageTemplates = map[string]struct {
	subject string
	body    string
}{
	"heads_up": {
		subject: "Invoice #{{.InvoiceID}} due in a few days",
		body: `Hi {{.ClientName}},

Just a heads-up — invoice #{{.InvoiceID}} for {{.Amount}} is due on {{.DueDate}}.

No action needed yet, just flagging it early.

Thanks,
{{.SenderName}}`,
	},
	"nudge": {
		subject: "Invoice #{{.InvoiceID}} due today",
		body: `Hi {{.ClientName}},

Invoice #{{.InvoiceID}} for {{.Amount}} is due today. Just checking this landed okay on your end.

Pay now: {{.PayLink}}

Thanks,
{{.SenderName}}`,
	},
	"follow_up": {
		subject: "Following up — invoice #{{.InvoiceID}} is overdue",
		body: `Hi {{.ClientName}},

Invoice #{{.InvoiceID}} for {{.Amount}} was due on {{.DueDate}} and hasn't come through yet. Could you let me know when I can expect payment?

Pay now: {{.PayLink}}

Thanks,
{{.SenderName}}`,
	},
	"manual": {
		// Same copy as follow_up — a manually triggered "Ping now" is
		// deliberately the same tone/content as the automatic day-7
		// follow-up, just fired on demand rather than on schedule.
		subject: "Following up — invoice #{{.InvoiceID}}",
		body: `Hi {{.ClientName}},

Just following up on invoice #{{.InvoiceID}} for {{.Amount}}, due {{.DueDate}}.

Pay now: {{.PayLink}}

Thanks,
{{.SenderName}}`,
	},
}

// --- Reclaim (30+ day escalation) templates ------------------------------
// These mirror exactly what was drafted and clicked-through in
// frontend/landing.html (served live at GET /) — same three actions, same tone.

var reclaimTemplates = map[string]struct {
	subject   string
	body      string
	toClient  bool // false = goes to the user's teammate, not the client
}{
	"firmer": {
		subject: "Invoice #{{.InvoiceID}} — payment now {{.DaysOverdue}} days overdue",
		body: `Hi {{.ClientName}},

Invoice #{{.InvoiceID}} for {{.Amount}} was due on {{.DueDate}} and is now {{.DaysOverdue}} days overdue. This is a follow-up reminder — I haven't been able to reach anyone on this yet.

Could someone confirm a payment date this week? Happy to hop on a call if something's holding this up.

Pay now: {{.PayLink}}

Thanks,
{{.SenderName}}`,
		toClient: true,
	},
	"plan": {
		subject: "A simpler way to clear invoice #{{.InvoiceID}}",
		body: `Hi {{.ClientName}},

I know {{.Amount}} in one go isn't always easy to move quickly. I've set up a payment plan so this is easier to clear — review and accept below. No new paperwork, and the first payment goes through automatically once you accept.

Review & accept plan: {{.PlanLink}}

Thanks,
{{.SenderName}}`,
		toClient: true,
	},
	"loop": {
		subject: "Heads up: invoice #{{.InvoiceID}} needs a second touch",
		body: `Hey,

Invoice #{{.InvoiceID}} to {{.ClientName}} ({{.Amount}}) is {{.DaysOverdue}} days overdue with {{.PingsSent}} pings sent and no response. Flagging in case you have a contact there or want to take the next step.

Invoice: #{{.InvoiceID}}
Client: {{.ClientName}}
Amount: {{.Amount}}
Pings sent: {{.PingsSent}}

— Sent automatically by PingFox`,
		toClient: false,
	},
}

// TemplateData is the single shape every template above renders from.
// Not every field is used by every template — text/template simply
// ignores fields a given template doesn't reference.
type TemplateData struct {
	InvoiceID   int64
	ClientName  string
	Amount      string // pre-formatted, e.g. "$2,400" — formatting money belongs at the call site, not here
	DueDate     string // pre-formatted, e.g. "Jan 8, 2026"
	DaysOverdue int
	PingsSent   int
	PayLink     string
	PlanLink    string
	SenderName  string // the PingFox user's display name/business name
}

// RenderStage builds the email for a scheduler.Stage (or "manual").
func RenderStage(stage string, data TemplateData) (Email, error) {
	t, ok := stageTemplates[stage]
	if !ok {
		return Email{}, fmt.Errorf("no template for stage %q", stage)
	}
	return render(t.subject, t.body, data)
}

// RenderReclaim builds the email for a reclaim action ("firmer",
// "plan", or "loop"). The caller (api.handleReclaim) decides the
// recipient — client email for firmer/plan, teammate email for loop —
// using reclaimTemplates[action].toClient if it needs to branch on that.
func RenderReclaim(action string, data TemplateData) (Email, error) {
	t, ok := reclaimTemplates[action]
	if !ok {
		return Email{}, fmt.Errorf("no template for reclaim action %q", action)
	}
	return render(t.subject, t.body, data)
}

// IsReclaimToClient reports whether the given reclaim action's email
// goes to the client (firmer, plan) or an internal teammate (loop) —
// callers need this to pick the right recipient address.
func IsReclaimToClient(action string) bool {
	t, ok := reclaimTemplates[action]
	return ok && t.toClient
}

func render(subjectTpl, bodyTpl string, data TemplateData) (Email, error) {
	subject, err := renderTpl(subjectTpl, data)
	if err != nil {
		return Email{}, err
	}
	body, err := renderTpl(bodyTpl, data)
	if err != nil {
		return Email{}, err
	}
	return Email{Subject: subject, Body: body}, nil
}

func renderTpl(tpl string, data TemplateData) (string, error) {
	t, err := template.New("").Parse(tpl)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// --- Sending ---------------------------------------------------------

// Sender is the boundary to a real provider. Swap StubSender for
// Postmark/SendGrid when Phase 4 is reached — nothing above this
// interface changes.
type Sender interface {
	Send(email Email) error
}

type StubSender struct{}

func (StubSender) Send(email Email) error {
	fmt.Printf("[email stub] To: %s\nSubject: %s\n\n%s\n---\n", email.To, email.Subject, email.Body)
	return nil
}

// FormatDollars is a small shared helper so every call site formats
// AmountCents the same way instead of drifting — cents -> "$X,XXX.XX".
func FormatDollars(cents int64) string {
	return fmt.Sprintf("$%d.%02d", cents/100, cents%100)
}
