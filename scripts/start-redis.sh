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

mkdir -p "$PROJECT_ROOT/logs"

cd "$PROJECT_ROOT"

if [ "$DEV_MODE" = true ]; then
  mkdir -p "$PROJECT_ROOT/run"
  nohup nix develop --command redis-server --pidfile "$PROJECT_ROOT/run/redis.pid" > logs/redis.log 2>&1 &
  echo "Redis starting (PID file: $PROJECT_ROOT/run/redis.pid)"
else
  nix develop --command redis-server
fi
