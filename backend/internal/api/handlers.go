// Package api wires HTTP routes to the store/scheduler/stripeclient.
// Handlers stay thin — decisions live in scheduler and stripeclient,
// this package just translates HTTP <-> those calls.
package api

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/seroneymatoke/pingfox/backend/internal/auth"
	"github.com/seroneymatoke/pingfox/backend/internal/db"
	"github.com/seroneymatoke/pingfox/backend/internal/mailer"
	"github.com/seroneymatoke/pingfox/backend/internal/models"
	"github.com/seroneymatoke/pingfox/backend/internal/oauth"
	"github.com/seroneymatoke/pingfox/backend/internal/scheduler"
	"github.com/seroneymatoke/pingfox/backend/internal/stripeclient"
)

type Server struct {
	Store       db.Store
	Stripe      stripeclient.Client
	Tmpl        *template.Template
	Mailer      mailer.Sender
	LandingHTML []byte
}

// NewServer parses templates from an embed.FS rather than a filesystem
// path. This is the deliberate fix for a whole class of "works on my
// machine, breaks in Docker" bugs: a relative path like
// "../frontend/templates" depends on whatever the process's current
// working directory happens to be — `go run`, a Docker WORKDIR, and a
// systemd service unit can all set that differently, and each mismatch
// is the same error with a different path. Embedding the templates at
// compile time removes the filesystem lookup entirely — wherever the
// binary runs, the templates are already inside it.
//
// landingHTML is the raw bytes of the marketing landing page (also
// embedded, via frontend.LandingPageHTML), served as-is at GET / since
// it's a fully self-contained static file with no server-side data.
func NewServer(store db.Store, stripe stripeclient.Client, mailSender mailer.Sender, templatesFS embed.FS, templatesGlob string, landingHTML []byte) (*Server, error) {
	tmpl, err := template.ParseFS(templatesFS, templatesGlob)
	if err != nil {
		return nil, err
	}
	return &Server{Store: store, Stripe: stripe, Tmpl: tmpl, Mailer: mailSender, LandingHTML: landingHTML}, nil
}

func (s *Server) handleLandingPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(s.LandingHTML)
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	// Public — no identity to resolve yet.
	mux.HandleFunc("GET /{$}", s.handleLandingPage) // {$} matches only exactly "/", not every unmatched path
	mux.HandleFunc("GET /signup", s.handleSignupForm)
	mux.HandleFunc("POST /signup", s.handleSignupFormSubmit)
	mux.HandleFunc("GET /login", s.handleLoginForm)
	mux.HandleFunc("POST /login", s.handleLoginFormSubmit)
	mux.HandleFunc("GET /logout", s.handleLogout)
	mux.HandleFunc("GET /auth/{provider}/start", s.handleOAuthStart)
	mux.HandleFunc("GET /auth/{provider}/callback", s.handleOAuthCallback)
	mux.HandleFunc("POST /webhooks/stripe", s.handleStripeWebhook)
	mux.HandleFunc("GET /invoices/{publicID}", s.handlePublicInvoice)
	mux.HandleFunc("POST /invoices/{id}/mark-paid", s.handleMarkInvoicePaid)

	// Protected — every handler here reads the user from context via
	// auth.UserFromContext, never from a path/body parameter.
	protected := http.NewServeMux()
	protected.HandleFunc("GET /dashboard", s.handleDashboard)
	protected.HandleFunc("POST /invoices", s.handleCreateInvoice)
	protected.HandleFunc("POST /invoices/{id}/ping", s.handlePingNow)
	protected.HandleFunc("POST /invoices/{id}/reclaim", s.handleReclaim)
	protected.HandleFunc("DELETE /account", s.handleDeleteAccount)

	mux.Handle("/dashboard", auth.Middleware(s.Store)(protected))
	mux.Handle("/invoices", auth.Middleware(s.Store)(protected))
	mux.Handle("/invoices/", auth.Middleware(s.Store)(protected))
	mux.Handle("/account", auth.Middleware(s.Store)(protected))

	return mux
}

// --- Signup / login (password) -----------------------------------------

type signupRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// handleSignup creates a real account with a server-generated API key
// and issues a session cookie. Password is hashed before it ever
// touches the store — see auth.HashPassword and its production note.
//
// GDPR note: this is also the point a verification email should be
// sent (EmailVerified starts false for password accounts) — wire
// that into the emailNotifier once Phase 4's real provider is in
// place; for now this is a stub matching the existing notifier pattern.
func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	body, _ := io.ReadAll(r.Body)
	if err := json.Unmarshal(body, &req); err != nil || req.Email == "" || len(req.Password) < 8 {
		http.Error(w, `{"error":"valid email and password (min 8 chars) required"}`, http.StatusBadRequest)
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		http.Error(w, `{"error":"could not process password"}`, http.StatusInternalServerError)
		return
	}

	user, err := s.Store.CreateUserWithPassword(req.Email, hash)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusConflict)
		return
	}

	log.Printf("[email stub] would send verification email to %s", user.Email)
	s.startSession(w, user, true) // show API key once, at signup
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	body, _ := io.ReadAll(r.Body)
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}

	user, err := s.Store.GetUserByEmail(req.Email)
	if err != nil || user.PasswordHash == "" {
		// Same generic error whether the email doesn't exist or the
		// account is OAuth-only — don't leak which.
		http.Error(w, `{"error":"invalid email or password"}`, http.StatusUnauthorized)
		return
	}
	if !auth.VerifyPassword(req.Password, user.PasswordHash) {
		http.Error(w, `{"error":"invalid email or password"}`, http.StatusUnauthorized)
		return
	}
	s.startSession(w, user, false)
}

// startSession issues the session cookie and returns the account
// summary. includeAPIKey is only true at signup — same "shown once"
// pattern as Stripe/GitHub tokens. A lost key needs its own
// "regenerate API key" endpoint rather than re-displaying it on every
// login; flagged here, not built, to keep scope contained — see
// IMPLEMENTATION_PLAN.md.
func (s *Server) startSession(w http.ResponseWriter, user *models.User, includeAPIKey bool) {
	token, err := s.Store.CreateSession(user.ID)
	if err != nil {
		http.Error(w, `{"error":"session creation failed"}`, http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
	resp := map[string]any{
		"user_id": user.ID,
		"email":   user.Email,
		"plan":    user.PlanTier,
	}
	if includeAPIKey {
		resp["api_key"] = user.APIKey
	}
	writeJSON(w, resp)
}

// --- OAuth ---------------------------------------------------------------

// providerConfig resolves an oauth.ProviderConfig from env vars, keyed
// by the {provider} path segment. Real client IDs/secrets must be set
// as PINGFOX_GOOGLE_CLIENT_ID etc — see cmd/server/main.go.
func providerConfig(name string) (oauth.ProviderConfig, bool) {
	base := "http://localhost:8080/auth/" + name + "/callback"
	switch name {
	case "google":
		return oauth.Google(os.Getenv("PINGFOX_GOOGLE_CLIENT_ID"), os.Getenv("PINGFOX_GOOGLE_CLIENT_SECRET"), base), true
	case "github":
		return oauth.GitHub(os.Getenv("PINGFOX_GITHUB_CLIENT_ID"), os.Getenv("PINGFOX_GITHUB_CLIENT_SECRET"), base), true
	default:
		return oauth.ProviderConfig{}, false
	}
}

func (s *Server) handleOAuthStart(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	cfg, ok := providerConfig(provider)
	if !ok {
		http.Error(w, "unknown provider", http.StatusNotFound)
		return
	}
	state, err := randomState()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// Short-lived state cookie, checked on callback — CSRF protection
	// for the OAuth redirect round-trip.
	http.SetCookie(w, &http.Cookie{
		Name: "pingfox_oauth_state", Value: state, Path: "/",
		HttpOnly: true, MaxAge: 600, SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, cfg.BuildAuthURL(state), http.StatusFound)
}

func (s *Server) handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	cfg, ok := providerConfig(provider)
	if !ok {
		http.Error(w, "unknown provider", http.StatusNotFound)
		return
	}

	stateCookie, err := r.Cookie("pingfox_oauth_state")
	if err != nil || stateCookie.Value == "" || stateCookie.Value != r.URL.Query().Get("state") {
		http.Error(w, "invalid oauth state", http.StatusBadRequest)
		return
	}

	info, err := cfg.ExchangeCode(r.URL.Query().Get("code"))
	if err != nil {
		http.Error(w, "oauth exchange failed: "+err.Error(), http.StatusBadGateway)
		return
	}

	user, err := s.Store.GetUserByOAuth(provider, info.Subject)
	if err != nil {
		user, err = s.Store.CreateUserWithOAuth(info.Email, provider, info.Subject)
		if err != nil {
			http.Error(w, "account creation failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}
	s.startSession(w, user, false)
}

func randomState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *Server) handlePublicInvoice(w http.ResponseWriter, r *http.Request) {
	//publicID := r.PathValue("publicID")
	//token := r.URL.Query().Get("token")

	// Find invoice by publicID
	// Compare token to PublicToken
	// If match, render public view with pay button
	// If no match, return 404

	// For now, stub it
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Public invoice view — coming soon"))
}

func (s *Server) handleMarkInvoicePaid(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	inv, _ := s.Store.GetInvoice(id)
	if inv.UserID != user.ID {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	s.Store.UpdateInvoiceStatus(id, models.StatusPaid)
	w.WriteHeader(http.StatusOK)
}

// --- GDPR erasure --------------------------------------------------------

func (s *Server) handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := s.Store.DeleteUser(user.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: auth.SessionCookieName, Value: "", Path: "/", MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

// --- Dashboard -------------------------------------------------------

// handleDashboard supports:
//
//	?q=            case-insensitive search over client name/email
//	?status=paid|unpaid   (unpaid = everything except StatusPaid)
//	?sort=amount|due|client   ?order=asc|desc
//
// All filtering/sorting happens server-side so it works identically
// whether the request came from a browser or an agent listing
// invoices via the API — no client-side-only logic to keep in sync.
func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	invoices, err := s.Store.ListInvoicesByUser(user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	status := r.URL.Query().Get("status")
	sortBy := r.URL.Query().Get("sort")
	order := r.URL.Query().Get("order")

	var filtered []*models.Invoice
	for _, inv := range invoices {
		if q != "" &&
			!strings.Contains(strings.ToLower(inv.ClientName), q) &&
			!strings.Contains(strings.ToLower(inv.ClientEmail), q) {
			continue
		}
		if status == "paid" && inv.Status != models.StatusPaid {
			continue
		}
		if status == "unpaid" && inv.Status == models.StatusPaid {
			continue
		}
		filtered = append(filtered, inv)
	}

	less := func(i, j int) bool {
		a, b := filtered[i], filtered[j]
		switch sortBy {
		case "amount":
			return a.AmountCents < b.AmountCents
		case "client":
			return strings.ToLower(a.ClientName) < strings.ToLower(b.ClientName)
		default: // "due"
			return a.DueDate.Before(b.DueDate)
		}
	}
	sort.Slice(filtered, less)
	if order == "desc" {
		for i, j := 0, len(filtered)-1; i < j; i, j = i+1, j-1 {
			filtered[i], filtered[j] = filtered[j], filtered[i]
		}
	}

	if err := s.Tmpl.ExecuteTemplate(w, "dashboard.html", map[string]any{
		"Invoices": filtered,
		"Plan":     user.PlanTier,
		"Query":    r.URL.Query().Get("q"),
		"Status":   status,
		"Sort":     sortBy,
		"Order":    order,
	}); err != nil {
		log.Printf("template error: %v", err)
	}
}

// --- Create invoice (paywalled) ----------------------------------------

type createInvoiceRequest struct {
	ClientName  string `json:"client_name"`
	ClientEmail string `json:"client_email"`
	AmountCents int64  `json:"amount_cents"`
	DueDate     string `json:"due_date"` // RFC3339 or YYYY-MM-DD
}

// handleCreateInvoice is the single entry point for both onboarding
// paths (manual entry and, later, PDF-upload-and-parse — parsing
// happens upstream of this handler and calls it with the extracted
// fields). The free-tier paywall is enforced HERE, server-side,
// against the authenticated user's lifetime invoice count — this is
// the only place that matters, since it's also what an MCP/Zapier
// call hits, not just the web UI.
func (s *Server) handleCreateInvoice(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if user.PlanTier == models.PlanFree {
		count, err := s.Store.CountInvoicesByUser(user.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if count >= models.FreeTierInvoiceLimit {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired) // 402 — semantically correct, agent-parseable
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error":       "free_tier_limit_reached",
				"message":     fmt.Sprintf("Free plan is limited to %d invoices. Upgrade to add more.", models.FreeTierInvoiceLimit),
				"upgrade_url": "https://pingfox.com/upgrade",
			})
			return
		}
	}

	var req createInvoiceRequest
	body, _ := io.ReadAll(r.Body)
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	dueDate, err := parseFlexibleDate(req.DueDate)
	if err != nil {
		http.Error(w, `{"error":"invalid due_date"}`, http.StatusBadRequest)
		return
	}

	inv, err := s.Store.CreateInvoice(&models.Invoice{
		UserID:      user.ID,
		ClientName:  req.ClientName,
		ClientEmail: req.ClientEmail,
		AmountCents: req.AmountCents,
		Currency:    "usd",
		DueDate:     dueDate,
		Status:      models.StatusPending,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, inv)
}

func parseFlexibleDate(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	return time.Parse("2006-01-02", s)
}

// --- Manual ping ------------------------------------------------------

func (s *Server) handlePingNow(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid invoice id", http.StatusBadRequest)
		return
	}
	inv, err := s.Store.GetInvoice(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if inv.UserID != user.ID {
		// Deliberately 404, not 403 — don't confirm to a caller that
		// an invoice ID exists at all if it isn't theirs.
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if inv.Status == models.StatusPaid || inv.Status == models.StatusPlanActive {
		http.Error(w, "invoice is paid or on an active plan — nothing to ping", http.StatusConflict)
		return
	}

	if err := s.Store.RecordPing(id, "manual", "email"); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// --- Reclaim (30+ day escalation) -------------------------------------

type reclaimRequest struct {
	Action string `json:"action"` // "firmer" | "plan" | "loop"
}

func (s *Server) handleReclaim(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "invalid invoice id", http.StatusBadRequest)
		return
	}
	var req reclaimRequest
	body, _ := io.ReadAll(r.Body)
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	inv, err := s.Store.GetInvoice(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if inv.UserID != user.ID {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	switch req.Action {
	case "firmer":
		email, err := mailer.RenderReclaim("firmer", reclaimTemplateData(inv))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		email.To = inv.ClientEmail
		if err := s.Mailer.Send(email); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := s.Store.RecordPing(id, string(scheduler.StageEscalation), "email"); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"status": "sent"})

	case "plan":
		installments := buildThreePartPlan(inv)

		// Convert installments slice to JSON string
		installmentsJSON, _ := json.Marshal(installments)
		plan, err := s.Store.CreatePaymentPlan(&models.PaymentPlan{
			InvoiceID:    id,
			Installments: string(installmentsJSON), // Now it's a string
			Status:       "offered",
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		acceptURL, err := s.Stripe.CreateInstallmentPlan(inv.ExternalRef, inv, installments)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		data := reclaimTemplateData(inv)
		data.PlanLink = acceptURL
		email, err := mailer.RenderReclaim("plan", data)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		email.To = inv.ClientEmail
		if err := s.Mailer.Send(email); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"status": "offered", "plan_id": plan.ID, "accept_url": acceptURL})

	case "loop":
		// v1: notify a teammate via email using the same shared
		// template set (mailer.IsReclaimToClient("loop") == false).
		// Real teammate routing (who gets notified) needs a team/seat
		// concept — see IMPLEMENTATION_PLAN.md Phase 4. For now this
		// sends to the account owner's own email as a placeholder
		// recipient so the flow is demonstrable end to end.
		email, err := mailer.RenderReclaim("loop", reclaimTemplateData(inv))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		email.To = user.Email
		if err := s.Mailer.Send(email); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"status": "teammate_notified"})

	default:
		http.Error(w, "unknown action", http.StatusBadRequest)
	}
}

// reclaimTemplateData builds the shared TemplateData from an invoice —
// one place so firmer/plan/loop all populate it identically.
func reclaimTemplateData(inv *models.Invoice) mailer.TemplateData {
	daysOverdue := int(time.Since(inv.DueDate).Hours() / 24)
	return mailer.TemplateData{
		InvoiceID:   inv.ID,
		ClientName:  inv.ClientName,
		Amount:      mailer.FormatDollars(inv.AmountCents),
		DueDate:     inv.DueDate.Format("Jan 2, 2006"),
		DaysOverdue: daysOverdue,
		PingsSent:   inv.PingsSent,
		PayLink:     "https://pingfox.com/pay/" + inv.ExternalRef,
		SenderName:  "PingFox",
	}
}

func buildThreePartPlan(inv *models.Invoice) []models.Installment {
	third := inv.AmountCents / 3
	remainder := inv.AmountCents - third*2 // last installment absorbs rounding
	now := time.Now()
	return []models.Installment{
		{SequenceNo: 1, AmountCents: third, DueDate: now},
		{SequenceNo: 2, AmountCents: third, DueDate: now.AddDate(0, 0, 30)},
		{SequenceNo: 3, AmountCents: remainder, DueDate: now.AddDate(0, 0, 60)},
	}
}

// --- Stripe webhook ----------------------------------------------------

func (s *Server) handleStripeWebhook(w http.ResponseWriter, r *http.Request) {
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	event, err := s.Stripe.VerifyWebhook(payload, r.Header.Get("Stripe-Signature"))
	if err != nil {
		// Signature verification failed — do NOT process. This is the
		// most important error path in the whole payments system.
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}

	switch event.Type {
	case "invoice.paid", "payment_intent.succeeded":
		// TODO: resolve event.InvoiceRef -> local invoice ID (needs a
		// Stripe-ref lookup on Store — omitted here for brevity, see
		// IMPLEMENTATION_PLAN.md Phase 3). Once resolved:
		//   1. mark installment/invoice paid
		//   2. if invoice fully paid -> StatusPaid, stop all pings
		//   3. if it was an installment -> MarkInstallmentPaid, and only
		//      flip to StatusPaid once every installment clears
		log.Printf("received payment event: %+v", event)
	default:
		log.Printf("ignoring unhandled stripe event type: %s", event.Type)
	}

	w.WriteHeader(http.StatusOK)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// --- Form-based signup and login (new) ---

// handleSignupForm serves the HTML signup page
func (s *Server) handleSignupForm(w http.ResponseWriter, r *http.Request) {
	if err := s.Tmpl.ExecuteTemplate(w, "signup.html", nil); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// handleSignupFormSubmit processes form submission from signup.html
func (s *Server) handleSignupFormSubmit(w http.ResponseWriter, r *http.Request) {
	email := r.FormValue("email")
	password := r.FormValue("password")

	if email == "" || password == "" || len(password) < 8 {
		http.Redirect(w, r, "/signup?error=invalid", http.StatusSeeOther)
		return
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		http.Error(w, "password hashing failed", http.StatusInternalServerError)
		return
	}

	user, err := s.Store.CreateUserWithPassword(email, hash)
	if err != nil {
		http.Redirect(w, r, "/signup?error=email+exists", http.StatusSeeOther)
		return
	}

	// Send welcome email
	welcomeEmail := mailer.Email{
		To:      user.Email,
		Subject: "Welcome to PingFox!",
		Body:    fmt.Sprintf("Hi,\n\nWelcome to PingFox!\n\nYour API key (for integrations):\n%s\n\nLog in anytime: https://pingfox.com/login\n\n— PingFox", user.APIKey),
	}
	_ = s.Mailer.Send(welcomeEmail)

	// Create session
	token, err := s.Store.CreateSession(user.ID)
	if err != nil {
		http.Error(w, "session creation failed", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
}

// handleLoginForm serves the HTML login page
func (s *Server) handleLoginForm(w http.ResponseWriter, r *http.Request) {
	if err := s.Tmpl.ExecuteTemplate(w, "login.html", map[string]interface{}{
		"Error": r.URL.Query().Get("error"),
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// handleLoginFormSubmit processes form submission from login.html
func (s *Server) handleLoginFormSubmit(w http.ResponseWriter, r *http.Request) {
	email := r.FormValue("email")
	password := r.FormValue("password")

	user, err := s.Store.GetUserByEmail(email)
	if err != nil || !auth.VerifyPassword(password, user.PasswordHash) {
		http.Redirect(w, r, "/login?error=invalid+credentials", http.StatusSeeOther)
		return
	}

	token, err := s.Store.CreateSession(user.ID)
	if err != nil {
		http.Error(w, "session creation failed", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
}

// handleLogout clears the session
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:   auth.SessionCookieName,
		Value:  "",
		MaxAge: -1,
		Path:   "/",
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
