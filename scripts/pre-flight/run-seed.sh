#!/usr/bin/env bash
# Insert the baseline seed dataset into the target environment database.
#
# Usage (via npm scripts — preferred):
#   npm run db:seed:dev
#   npm run db:seed:stage
#
# Usage (direct):
#   bash scripts/pre-flight/run-seed.sh <dev|stage>
#
# The seed is idempotent (ON CONFLICT DO NOTHING) — safe to run multiple times.
# The postgres container must already be running.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_FILE="$ROOT_DIR/scripts/db/dev-stage/seed.psql"
ENVIRONMENT="${1:-}"

case "$ENVIRONMENT" in
  dev)
    ENV_FILE="$ROOT_DIR/.env.docker.dev"
    FALLBACK_FILE="$ROOT_DIR/.env.docker.dev.fallback"
    COMPOSE_EXTRA="$ROOT_DIR/compose.dev.yaml"
    ;;
  stage)
    ENV_FILE="$ROOT_DIR/.env.docker.stage"
    FALLBACK_FILE="$ROOT_DIR/.env.docker.stage.fallback"
    COMPOSE_EXTRA="$ROOT_DIR/compose.stage.yaml"
    ;;
  *)
    printf 'Usage: %s <dev|stage>\n' "$0" >&2
    exit 1
    ;;
esac

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

compose_args=(-f "$ROOT_DIR/compose.yaml" -f "$COMPOSE_EXTRA" --env-file "$SOURCE_FILE")

if ! docker compose "${compose_args[@]}" exec -T postgres \
    pg_isready -U "${POSTGRES_USER:-recon_app}" -d "${POSTGRES_DB:-reconciliation_platform}" >/dev/null 2>&1; then
  printf 'Postgres is not ready in the %s environment. Start the stack first:\n' "$ENVIRONMENT" >&2
  printf '  npm run docker:deploy:%s\n' "$ENVIRONMENT" >&2
  exit 1
fi

printf 'Seeding %s database...\n' "$ENVIRONMENT"

docker compose "${compose_args[@]}" exec -T postgres \
  psql \
    -U "${POSTGRES_USER:-recon_app}" \
    -d "${POSTGRES_DB:-reconciliation_platform}" \
  < "$SQL_FILE"

printf 'Seed complete for %s.\n' "$ENVIRONMENT"
