// Package auth resolves "who is making this request" from a verified
// credential — a session cookie (web) or an Authorization: Bearer
// API key (programmatic/agentic access, e.g. an MCP server or Zapier
// integration acting on the user's behalf).
//
// The rule this package exists to enforce: no handler ever trusts a
// user_id supplied in a path, query string, or request body. Every
// protected route resolves the caller's identity here first, and
// everything downstream (invoice ownership checks, the free-tier
// paywall count) uses THAT id, not anything the client claims.
package auth

import (
	"context"
	"net/http"

	"github.com/seroneymatoke/pingfox/backend/internal/db"
	"github.com/seroneymatoke/pingfox/backend/internal/models"
)

type ctxKey string

const userCtxKey ctxKey = "pingfox_user"

const SessionCookieName = "pingfox_session"

// Middleware wraps a handler, requiring either a valid session cookie
// or a valid API key. On success it stores the resolved *models.User
// on the request context. On failure it writes 401 and never calls
// the wrapped handler — there is no "anonymous but allowed" path for
// anything this middleware wraps.
func Middleware(store db.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, err := resolveUser(store, r)
			if err != nil {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), userCtxKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func resolveUser(store db.Store, r *http.Request) (*models.User, error) {
	// Prefer API key (Authorization: Bearer <key>) — this is the path
	// agentic/programmatic callers (MCP server, Zapier) use.
	if key := bearerToken(r); key != "" {
		return store.GetUserByAPIKey(key)
	}

	// Fall back to session cookie for browser-based dashboard use.
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		return nil, err
	}
	userID, err := store.GetSessionUserID(cookie.Value)
	if err != nil {
		return nil, err
	}
	return store.GetUserByID(userID)
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(h) > len(prefix) && h[:len(prefix)] == prefix {
		return h[len(prefix):]
	}
	return ""
}

// UserFromContext retrieves the authenticated user a handler is
// running on behalf of. Handlers should ALWAYS use this for "which
// user's data am I touching" — never a path/query/body parameter.
func UserFromContext(ctx context.Context) (*models.User, bool) {
	u, ok := ctx.Value(userCtxKey).(*models.User)
	return u, ok
}
