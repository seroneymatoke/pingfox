# Multi-stage build. The whole point of embedding templates via
# go:embed (see frontend/embed.go) is that this Dockerfile doesn't
# need to carefully COPY the frontend/templates directory to some
# exact runtime path and hope WORKDIR lines up — the templates are
# already inside the compiled binary by the time this build finishes.

FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY backend/ backend/
COPY frontend/ frontend/
RUN go build -o /pingfox ./backend/cmd/server

# Runtime stage: notice there's no COPY of frontend/templates here at
# all — deliberately. If the app needed that copy to succeed, that
# would be the exact class of bug this whole change was meant to
# eliminate.
FROM alpine:3.19
COPY --from=build /pingfox /pingfox
EXPOSE 8080
ENTRYPOINT ["/pingfox"]
