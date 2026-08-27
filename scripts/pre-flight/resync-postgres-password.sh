#!/usr/bin/env bash
# Usage: bash scripts/pre-flight/resync-postgres-password.sh <dev|stage>
#
# Fixes a specific, recurring failure mode: Postgres only applies POSTGRES_PASSWORD on first init
# of an EMPTY volume. If the env file's password is ever edited/rotated afterward without
# recreating that volume, the drift is silent until something forces a postgres container
# recreation (a Docker Desktop rebuild, `docker compose up` pulling in a dependency chain, a host
# reboot) -- migrate/api then fail with "password authentication failed for user ...", even though
# the data itself is completely intact and nothing was lost. Confirmed twice: 2026-08-02 and
# 2026-08-27 (the second time via a Docker Desktop rebuild after it got corrupted).
#
# This resyncs the role's password to match whatever the CURRENT env file says, using a local
# (Unix-socket) connection inside the postgres container -- Postgres trusts local connections
# without checking the network password, so this works even without knowing the OLD password.
#
# Also called by run-users.sh as its first step, so a normal `npm run db:users:dev` already
# self-heals this drift before seeding/updating application accounts. Kept as its own script (not
# folded away) so the fix is directly discoverable by name when password drift is the ONLY
# symptom, without needing to also run the full user-seed SQL.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ENVIRONMENT="${1:-}"

resolve_path() {
  local input_path="$1"
  if [[ "$input_path" = /* ]]; then
    printf '%s\n' "$input_path"
  else
    printf '%s\n' "$ROOT_DIR/${input_path#./}"
  fi
}

case "$ENVIRONMENT" in
  dev)
    ENV_FILE="$(resolve_path "${DOCKER_ENV_FILE:-.env.docker.dev}")"
    FALLBACK_FILE="$(resolve_path "${DOCKER_ENV_FALLBACK_FILE:-.env.docker.dev.fallback}")"
    COMPOSE_EXTRA="$(resolve_path "${DOCKER_COMPOSE_EXTRA_FILE:-compose.dev.yaml}")"
    ;;
  stage)
    ENV_FILE="$(resolve_path "${DOCKER_ENV_FILE:-.env.docker.stage}")"
    FALLBACK_FILE="$(resolve_path "${DOCKER_ENV_FALLBACK_FILE:-.env.docker.stage.fallback}")"
    COMPOSE_EXTRA="$(resolve_path "${DOCKER_COMPOSE_EXTRA_FILE:-compose.stage.yaml}")"
    ;;
  *)
    printf 'Usage: %s <dev|stage>\n' "$0" >&2
    exit 1
    ;;
esac

SOURCE_FILE=""
if [[ -f "$ENV_FILE" ]]; then
  SOURCE_FILE="$ENV_FILE"
elif [[ -f "$FALLBACK_FILE" ]]; then
  SOURCE_FILE="$FALLBACK_FILE"
else
  printf 'Missing environment file: %s\n' "$ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SOURCE_FILE"
set +a

APP_DB_USER="${POSTGRES_USER:-recon_app}"
APP_DB_PASSWORD="${POSTGRES_PASSWORD:-}"

if [[ -z "$APP_DB_PASSWORD" ]]; then
  printf 'POSTGRES_PASSWORD is missing in %s\n' "$SOURCE_FILE" >&2
  exit 1
fi

compose_args=(-f "$ROOT_DIR/compose.yaml" -f "$COMPOSE_EXTRA" --env-file "$SOURCE_FILE")

max_wait_seconds=60
elapsed_seconds=0
while ! docker compose "${compose_args[@]}" exec -T postgres pg_isready \
    -U "$APP_DB_USER" >/dev/null 2>&1; do
  if (( elapsed_seconds >= max_wait_seconds )); then
    printf 'Postgres is not ready in the %s environment after %ss.\n' "$ENVIRONMENT" "$max_wait_seconds" >&2
    printf '  npm run docker:deploy:%s\n' "$ENVIRONMENT" >&2
    exit 1
  fi
  sleep 2
  elapsed_seconds=$((elapsed_seconds + 2))
done

printf 'Resyncing %s role password to match %s...\n' "$APP_DB_USER" "$SOURCE_FILE"

docker compose "${compose_args[@]}" exec -T postgres \
  psql \
    -v ON_ERROR_STOP=1 \
    -U "$APP_DB_USER" \
    -d postgres \
    -v app_role="$APP_DB_USER" \
    -v app_password="$APP_DB_PASSWORD" \
    <<'SQL'
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L',
  :'app_role',
  :'app_password'
) \gexec
SQL

printf 'Password resync complete for %s (%s).\n' "$APP_DB_USER" "$ENVIRONMENT"
