#!/usr/bin/env bash
# Usage: bash scripts/pre-flight/run-users.sh <dev|stage>
#
# Runs the dev/stage user creation SQL against the target Docker Compose
# environment. The postgres container must already be running.
#
# This script is used by docker deploy workflows and can also be run manually.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_FILE="$ROOT_DIR/scripts/db/dev-stage/create-users.psql"

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
APP_DB_NAME="${POSTGRES_DB:-reconciliation_platform}"
APP_DB_PASSWORD="${POSTGRES_PASSWORD:-}"

if [[ -z "$APP_DB_PASSWORD" ]]; then
  printf 'POSTGRES_PASSWORD is missing in %s\n' "$SOURCE_FILE" >&2
  exit 1
fi

compose_args=(-f "$ROOT_DIR/compose.yaml" -f "$COMPOSE_EXTRA" --env-file "$SOURCE_FILE")

max_wait_seconds=60
elapsed_seconds=0
while ! docker compose "${compose_args[@]}" exec -T postgres pg_isready \
    -U "$APP_DB_USER" -d "$APP_DB_NAME" >/dev/null 2>&1; do
  if (( elapsed_seconds >= max_wait_seconds )); then
    printf 'Postgres is not ready in the %s environment after %ss.\n' "$ENVIRONMENT" "$max_wait_seconds" >&2
    printf '  npm run docker:deploy:%s\n' "$ENVIRONMENT" >&2
    exit 1
  fi
  sleep 2
  elapsed_seconds=$((elapsed_seconds + 2))
done

printf 'Running dev/stage user creation against %s environment...\n' "$ENVIRONMENT"

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

docker compose "${compose_args[@]}" exec -T postgres \
  psql \
    -U "$APP_DB_USER" \
    -d "$APP_DB_NAME" \
  < "$SQL_FILE"

printf 'User creation complete for %s.\n' "$ENVIRONMENT"
