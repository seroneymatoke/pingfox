#!/usr/bin/env bash

set -euo pipefail

environment="${1:-local}"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$environment" in
  local)
    env_file="$project_root/settings.local.env"
    template="$project_root/settings.local.env.example"
    ;;
  production)
    env_file="$project_root/settings.production.env"
    template="$project_root/settings.production.env.example"
    ;;
  *)
    echo "Usage: source ./scripts/load-env.sh [local|production]" >&2
    return 2 2>/dev/null || exit 2
    ;;
esac

if [[ ! -f "$env_file" ]]; then
  if [[ "$environment" == "local" && -f "$project_root/settings.env" ]]; then
    env_file="$project_root/settings.env"
    echo "Using legacy settings.env; migrate it to settings.local.env when convenient." >&2
  else
  echo "Missing $env_file" >&2
  echo "Copy $template to $env_file and fill in its values first." >&2
  return 1 2>/dev/null || exit 1
  fi
fi

# shellcheck disable=SC1090
source "$env_file"
echo "Loaded PingFox $environment environment from $env_file"
