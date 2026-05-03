#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_MODE=false

if [ "${1:-}" = "--dev" ]; then
  DEV_MODE=true
fi

# Load Nix environment
if [ -e /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
  . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
fi

# Load .env
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

mkdir -p "$PROJECT_ROOT/logs"

cd "$PROJECT_ROOT"

if [ "$DEV_MODE" = true ]; then
  mkdir -p "$PROJECT_ROOT/run"
  nohup nix develop --command bash -c "pnpm build && pnpm start" > logs/bot.log 2>&1 &
  echo $! > "$PROJECT_ROOT/run/bot.pid"
  echo "Bot started with PID $(cat "$PROJECT_ROOT/run/bot.pid")"
else
  nix develop --command pnpm start
fi
