// Package oauth implements a minimal OAuth2 authorization-code flow
// using only net/http + encoding/json — no external dependency, so
// this compiles today. It's provider-agnostic: Google and GitHub (or
// any other standard OAuth2 provider) plug in via a ProviderConfig,
// not separate code paths.
//
// SETUP NEEDED BEFORE THIS WORKS END TO END:
//   - Register an OAuth app with Google Cloud Console / GitHub Developer
//     Settings, get a client ID + secret
//   - Set them via env vars (see cmd/server/main.go) — never hardcode
//   - Set the redirect URI in the provider's dashboard to match
//     exactly what BuildAuthURL sends (http://localhost:8080/auth/{provider}/callback in dev)
package oauth

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

type ProviderConfig struct {
	Name         string // "google" | "github"
	ClientID     string
	ClientSecret string
	AuthURL      string
	TokenURL     string
	UserInfoURL  string
	Scopes       string
	RedirectURL  string
}

var Google = func(clientID, clientSecret, redirectURL string) ProviderConfig {
	return ProviderConfig{
		Name:         "google",
		ClientID:     clientID,
		ClientSecret: clientSecret,
		AuthURL:      "https://accounts.google.com/o/oauth2/v2/auth",
		TokenURL:     "https://oauth2.googleapis.com/token",
		UserInfoURL:  "https://www.googleapis.com/oauth2/v3/userinfo",
		Scopes:       "openid email",
		RedirectURL:  redirectURL,
	}
}

var GitHub = func(clientID, clientSecret, redirectURL string) ProviderConfig {
	return ProviderConfig{
		Name:         "github",
		ClientID:     clientID,
		ClientSecret: clientSecret,
		AuthURL:      "https://github.com/login/oauth/authorize",
		TokenURL:     "https://github.com/login/oauth/access_token",
		UserInfoURL:  "https://api.github.com/user",
		Scopes:       "read:user user:email",
		RedirectURL:  redirectURL,
	}
}

// BuildAuthURL returns the URL to redirect the user to. `state` must
// be a random, per-request value you generate and verify on callback
// (CSRF protection for the OAuth flow) — store it in a short-lived
// cookie, don't skip this.
func (p ProviderConfig) BuildAuthURL(state string) string {
	q := url.Values{
		"client_id":     {p.ClientID},
		"redirect_uri":  {p.RedirectURL},
		"response_type": {"code"},
		"scope":         {p.Scopes},
		"state":         {state},
	}
	return p.AuthURL + "?" + q.Encode()
}

type UserInfo struct {
	Subject string // stable provider user id
	Email   string
}

// ExchangeCode trades the authorization code for an access token, then
// fetches basic profile info. Kept as one method (rather than
// exposing the token) since PingFox never needs to store or reuse the
// provider's access token beyond this one identity lookup.
func (p ProviderConfig) ExchangeCode(code string) (UserInfo, error) {
	token, err := p.exchangeToken(code)
	if err != nil {
		return UserInfo{}, err
	}
	return p.fetchUserInfo(token)
}

func (p ProviderConfig) exchangeToken(code string) (string, error) {
	form := url.Values{
		"client_id":     {p.ClientID},
		"client_secret": {p.ClientSecret},
		"code":          {code},
		"redirect_uri":  {p.RedirectURL},
		"grant_type":    {"authorization_code"},
	}
	req, err := http.NewRequest("POST", p.TokenURL, nil)
	if err != nil {
		return "", err
	}
	req.URL.RawQuery = form.Encode() // works for both providers' token endpoints
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var parsed struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("oauth token parse error: %w", err)
	}
	if parsed.Error != "" || parsed.AccessToken == "" {
		return "", fmt.Errorf("oauth token exchange failed: %s", parsed.Error)
	}
	return parsed.AccessToken, nil
}

func (p ProviderConfig) fetchUserInfo(accessToken string) (UserInfo, error) {
	req, err := http.NewRequest("GET", p.UserInfoURL, nil)
	if err != nil {
		return UserInfo{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return UserInfo{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	switch p.Name {
	case "google":
		var g struct {
			Sub   string `json:"sub"`
			Email string `json:"email"`
		}
		if err := json.Unmarshal(body, &g); err != nil {
			return UserInfo{}, err
		}
		return UserInfo{Subject: g.Sub, Email: g.Email}, nil
	case "github":
		var gh struct {
			ID    int64  `json:"id"`
			Email string `json:"email"`
		}
		if err := json.Unmarshal(body, &gh); err != nil {
			return UserInfo{}, err
		}
		// GitHub's /user often omits email unless it's public — a real
		// implementation should also call /user/emails and pick the
		// primary verified one. Flagged here, not built, to keep this
		// file focused; see IMPLEMENTATION_PLAN.md.
		return UserInfo{Subject: fmt.Sprintf("%d", gh.ID), Email: gh.Email}, nil
	default:
		return UserInfo{}, fmt.Errorf("unknown provider %s", p.Name)
	}
}
