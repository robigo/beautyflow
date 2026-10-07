#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.production"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.prod.yml"

fail=0
pass() { printf 'PASS  %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }

[[ -f "$ENV_FILE" ]] || { bad ".env.production is missing"; exit 1; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

[[ -n "${API_DOMAIN:-}" && "$API_DOMAIN" != "api.example.com" ]] && pass "API domain configured" || bad "API_DOMAIN is not configured"
[[ "${CLIENT_ORIGIN:-}" == https://* ]] && pass "CLIENT_ORIGIN uses HTTPS" || bad "CLIENT_ORIGIN must be HTTPS"
(( ${#JWT_SECRET:-0} >= 32 )) && pass "JWT secret length >= 32" || bad "JWT_SECRET is too short"
[[ "${DATABASE_URL:-}" != *localhost* && "${DATABASE_URL:-}" != *127.0.0.1* ]] && pass "Database is not localhost" || bad "Production DB points to localhost"

rendered="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config 2>/dev/null || true)"
[[ -n "$rendered" ]] || bad "Compose config failed"

if grep -Eq 'published: "?3000"?|published: "?5432"?' <<<"$rendered"; then
  bad "Private port 3000 or 5432 is published"
else
  pass "Private app/database ports are not published"
fi

if grep -Eq 'published: "?443"?' <<<"$rendered"; then
  pass "HTTPS port 443 is published"
else
  bad "HTTPS port 443 is not published"
fi

if [[ -n "${API_DOMAIN:-}" ]] && command -v curl >/dev/null 2>&1; then
  if curl --fail --silent --max-time 10 "https://$API_DOMAIN/health" >/dev/null; then
    pass "HTTPS health endpoint reachable"
    headers="$(curl --silent --head --max-time 10 "https://$API_DOMAIN/" || true)"
    grep -qi '^strict-transport-security:' <<<"$headers" && pass "HSTS present" || bad "HSTS missing"
    grep -qi '^x-content-type-options:' <<<"$headers" && pass "X-Content-Type-Options present" || bad "X-Content-Type-Options missing"
    grep -qi '^x-frame-options:' <<<"$headers" && pass "X-Frame-Options present" || bad "X-Frame-Options missing"
  else
    warn "Public HTTPS health endpoint is not reachable yet"
  fi
fi

echo
if (( fail )); then
  echo "Security gate: FAIL"
  exit 1
fi

echo "Security gate: PASS"
