#!/usr/bin/env bash
# Boot Ignit local dev environment: optional PostgreSQL (docker compose),
# NestJS backend API (watch mode) and Astro SSR web app.
#
# Usage:
#   scripts/dev.sh              db + API + web app (default)
#   scripts/dev.sh --no-docker  skip PostgreSQL; API uses local SQLite
#   DB_MODE=dev-neon scripts/dev.sh   API against a Neon development branch
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
WEB="$ROOT/web"

USE_DOCKER=true
for arg in "$@"; do
  case "$arg" in
    --no-docker) USE_DOCKER=false ;;
    *) echo "unknown option: $arg (supported: --no-docker)" >&2; exit 1 ;;
  esac
done

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' is not installed (or not on PATH)" >&2
    exit 1
  fi
}
need pnpm

: "${DB_MODE:=dev}"
export DB_MODE
if [[ "$DB_MODE" == "dev" ]]; then
  # Local SQLite dev does not mount Better Auth; opt into ALLOW_NO_AUTH=true
  # unless the caller overrides it. When AUTH_MODE=dev credentials are set in
  # backend/.env, dev auth still mounts and guards all routes normally.
  : "${ALLOW_NO_AUTH=true}"
  export ALLOW_NO_AUTH
fi

port_is_used() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null || return 1
}

port_is_ready() {
  curl -sf --max-time 2 "$1" >/dev/null 2>&1
}

if [[ ! -f "$BACKEND/.env" && ! -f "$BACKEND/.env.local" ]]; then
  echo "error: backend/.env (or backend/.env.local) is missing. Copy backend/.env.example to backend/.env or backend/.env.local first." >&2
  exit 1
fi

if [[ "$USE_DOCKER" == true ]]; then
  need docker
  if port_is_used 5432; then
    echo "==> port 5432 already listening (docker or local PostgreSQL)"
  else
    echo "==> starting PostgreSQL (docker compose -d db)"
    (cd "$BACKEND" && docker compose up -d db)
    for _ in $(seq 1 30); do
      if docker exec ignit-db pg_isready -U app -d ignit >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    if ! docker exec ignit-db pg_isready -U app -d ignit >/dev/null 2>&1; then
      echo "error: PostgreSQL did not become ready within 30s" >&2
      exit 1
    fi
    echo "    PostgreSQL ready"
  fi
fi

if [[ ! -d "$BACKEND/node_modules" ]]; then
  echo "==> installing backend dependencies"
  (cd "$BACKEND" && pnpm install)
fi
if [[ ! -d "$WEB/node_modules" ]]; then
  echo "==> installing web dependencies"
  (cd "$WEB" && pnpm install)
fi

if [[ -f "$WEB/.astro/dev.json" ]]; then
  STALE_PID="$(sed -n 's/.*"pid": \([0-9][0-9]*\).*/\1/p' "$WEB/.astro/dev.json" | head -1)"
  if [[ -n "$STALE_PID" ]] && ! kill -0 "$STALE_PID" 2>/dev/null; then
    echo "==> removing stale Astro dev server registry (dead pid $STALE_PID)"
    rm -f "$WEB/.astro/dev.json" "$WEB/.astro/dev.log"
  fi
fi
if port_is_used 3000; then
  echo "error: port 3000 is already in use (another API instance?)" >&2
  exit 1
fi
# The web port is pinned instead of left to Astro's default: the URL printed at the end has to be
# the one the server really answers on. Unpinned, Astro silently drifts to the next free port
# (4330, say) while this script keeps announcing 4321 and the browser gets nothing.
: "${WEB_PORT:=4321}"
if port_is_used "$WEB_PORT"; then
  echo "error: port $WEB_PORT is already in use (another dev server?)" >&2
  exit 1
fi

echo "==> starting Ignit backend API on http://localhost:3000"
(cd "$BACKEND" && pnpm start:dev) &
BACKEND_PID=$!

cleanup() {
  kill "${BACKEND_PID:-0}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 60); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "error: the backend exited before becoming reachable" >&2
    exit 1
  fi
  port_is_ready "http://localhost:3000/session-mode" && break
  sleep 1
done
if ! port_is_ready "http://localhost:3000/session-mode"; then
  echo "error: the API did not answer /session-mode within 60s" >&2
  exit 1
fi

echo "" >&2
MODE="$(curl -sf "http://localhost:3000/session-mode")"
echo "    API ready:  http://localhost:3000  (session-mode: $MODE)" >&2
if [[ "$MODE" == *'"guarded":false'* ]]; then
  echo "    Note:       auth is unmounted on SQLite. Set AUTH_MODE=dev, ADMIN_EMAIL, ADMIN_PASSWORD and DEV_SESSION_SECRET in backend/.env (or backend/.env.local) to enable local multi-account login/signup." >&2
fi
echo "    App ready:  http://localhost:$WEB_PORT  (login: /login, registro: /registro, biblioteca: /biblioteca)" >&2
echo "    Ctrl+C stops both." >&2
echo ""
echo "==> starting Ignit Astro dev server on http://localhost:$WEB_PORT"
(cd "$WEB" && pnpm exec astro dev --port "$WEB_PORT")
