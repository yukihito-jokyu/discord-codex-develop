#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_MODE=false

if [ "${1:-}" = "--dev" ]; then
  DEV_MODE=true
fi

# Load .env
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

if [ -z "${TUNNEL_TOKEN:-}" ]; then
  echo "TUNNEL_TOKEN is not set" >&2
  exit 1
fi

command -v cloudflared >/dev/null 2>&1 || {
  echo "cloudflared not found in PATH" >&2
  exit 1
}

mkdir -p "$PROJECT_ROOT/logs"

cd "$PROJECT_ROOT"

if [ "$DEV_MODE" = true ]; then
  mkdir -p "$PROJECT_ROOT/run"
  nohup cloudflared tunnel run --token "$TUNNEL_TOKEN" > logs/cloudflared.log 2>&1 &
  echo $! > "$PROJECT_ROOT/run/cloudflared.pid"
  echo "Cloudflared started with PID $(cat "$PROJECT_ROOT/run/cloudflared.pid")"
else
  cloudflared tunnel run --token "$TUNNEL_TOKEN"
fi
