// Package frontend exists solely to embed the HTML templates into the
// compiled binary via go:embed. This is what makes the app immune to
// "wrong working directory" path bugs (go run vs Docker WORKDIR vs a
// systemd service, etc.) — the templates are compiled in, not read
// from disk at startup, so there is no runtime path to get wrong.
//
// go:embed can only reference files within or below the directory of
// the file that declares it — that's why this lives in frontend/
// itself rather than in cmd/server or internal/api.
package frontend

import "embed"

//go:embed templates/*.html
var TemplatesFS embed.FS

const TemplatesGlob = "templates/*.html"

//go:embed landing.html
var LandingPageHTML []byte
