#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"
ENV_FILE="$SCRIPT_DIR/.env.production"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo
  echo "==> $*"
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

load_env() {
  [[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE. Copy .env.production.example to .env.production first."
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

validate_env() {
  load_env

  local required=(API_DOMAIN CLIENT_ORIGIN DATABASE_URL JWT_SECRET)
  local key
  for key in "${required[@]}"; do
    [[ -n "${!key:-}" ]] || die "$key is required in .env.production"
  done

  [[ "$API_DOMAIN" != "api.example.com" ]] || die "Replace the placeholder API_DOMAIN."
  [[ "$CLIENT_ORIGIN" != "https://example.vercel.app" ]] || die "Replace the placeholder CLIENT_ORIGIN."
  [[ "$JWT_SECRET" != "replace-with-at-least-32-random-bytes" ]] || die "Replace the placeholder JWT_SECRET."
  (( ${#JWT_SECRET} >= 32 )) || die "JWT_SECRET must be at least 32 characters."
  [[ "$DATABASE_URL" == postgresql://* || "$DATABASE_URL" == postgres://* ]] || die "DATABASE_URL must be a PostgreSQL URL."

  if [[ "$DATABASE_URL" == *"127.0.0.1"* || "$DATABASE_URL" == *"localhost"* ]]; then
    die "Production DATABASE_URL must not point at localhost."
  fi

  if [[ "$DATABASE_URL" != *"sslmode=require"* ]]; then
    echo "WARNING: DATABASE_URL does not contain sslmode=require."
  fi

  chmod 600 "$ENV_FILE" 2>/dev/null || true
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

preflight() {
  need docker
  need curl
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
  docker info >/dev/null 2>&1 || die "Docker daemon is not reachable."

  validate_env

  info "Checking repository state"
  if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$REPO_ROOT" status --short
    echo "Commit: $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  fi

  info "Validating Compose"
  compose config >/dev/null

  info "Checking that private application/database ports are not published"
  local rendered
  rendered="$(compose config)"
  if grep -Eq 'published: "?3000"?|published: "?5432"?' <<<"$rendered"; then
    die "Port 3000 or 5432 is published. Production must expose only 80/443."
  fi

  info "Preflight passed"
}

build() {
  preflight
  info "Building production API image"
  compose build --pull api
}

migrate() {
  preflight
  [[ "${ALLOW_MIGRATIONS:-}" == "YES" ]] || die "Migration blocked. Re-run with ALLOW_MIGRATIONS=YES after reviewing the target DATABASE_URL."
  echo
  echo "Migration target host:"
  python3 - <<'PY' 2>/dev/null || true
import os
from urllib.parse import urlparse
u=urlparse(os.environ["DATABASE_URL"])
print(f"  host={u.hostname} db={u.path.lstrip('/')}")
PY
  info "Running migrations once"
  compose run --rm --no-deps api pnpm run db:migrate
}

up() {
  preflight
  info "Starting BeautyFlow API and HTTPS proxy"
  compose up -d --remove-orphans
  compose ps
}

verify() {
  preflight
  info "Waiting for API health"
  local tries=30
  until curl --fail --silent --show-error "https://$API_DOMAIN/health" >/dev/null; do
    tries=$((tries - 1))
    (( tries > 0 )) || {
      compose ps
      compose logs --tail=120 api caddy
      die "Health check failed for https://$API_DOMAIN/health"
    }
    sleep 2
  done

  info "Checking public HTTPS endpoint"
  curl --fail --silent --show-error "https://$API_DOMAIN/health"
  echo

  info "Checking security headers"
  curl --silent --show-error --head "https://$API_DOMAIN/" |     grep -Ei 'strict-transport-security|x-content-type-options|x-frame-options|referrer-policy' || true

  info "Verification passed"
}

status() {
  load_env
  compose ps
}

logs() {
  load_env
  compose logs --tail=200 -f api caddy
}

stop_stack() {
  load_env
  compose stop
}

usage() {
  cat <<'EOF'
Usage: ./deploy.sh COMMAND

Commands:
  preflight   Validate Docker, env, Compose and port exposure.
  build       Run preflight and build the production API image.
  migrate     Run DB migrations only when ALLOW_MIGRATIONS=YES is set.
  up          Start/recreate API + Caddy.
  verify      Verify HTTPS health and security headers.
  status      Show container status.
  logs        Follow API and Caddy logs.
  stop        Stop the stack without deleting volumes.
  all         Run preflight, build, up and verify. DOES NOT run migrations.

Examples:
  cp .env.production.example .env.production
  ./deploy.sh preflight
  ./deploy.sh build
  ALLOW_MIGRATIONS=YES ./deploy.sh migrate
  ./deploy.sh up
  ./deploy.sh verify

Safety:
  "all" intentionally never runs migrations.
  Database migrations require explicit ALLOW_MIGRATIONS=YES.
EOF
}

cmd="${1:-}"
case "$cmd" in
  preflight) preflight ;;
  build) build ;;
  migrate) migrate ;;
  up) up ;;
  verify) verify ;;
  status) status ;;
  logs) logs ;;
  stop) stop_stack ;;
  all) preflight; build; up; verify ;;
  *) usage; [[ -n "$cmd" ]] && exit 2 ;;
esac
