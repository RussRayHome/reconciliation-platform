#!/usr/bin/env bash
# Restore a PostgreSQL database from a pg_dump backup file.
#
# Usage (via npm scripts — preferred):
#   npm run db:restore:dev                                      # restores most recent dev backup
#   npm run db:restore:stage                                    # restores most recent stage backup
#
# Usage (direct):
#   DOCKER_ENV_FILE=.env.docker.dev \
#   DOCKER_ENV_FALLBACK_FILE=.env.docker.dev.fallback \
#   DOCKER_COMPOSE_EXTRA_FILE=compose.dev.yaml \
#   bash scripts/db/restore.sh dev [path/to/dump-file]
#
# If no dump file is specified, restores from the most recent .backups/recon-<env>-*.dump.
#
# What it does:
#   1. Stops api, web, pgweb (keeps postgres running)
#   2. Copies the dump file into the postgres container
#   3. Terminates active database connections
#   4. Restores with pg_restore -j 4 (parallel, --clean --if-exists)
#   5. Re-applies user creation (grants)
#   6. Restarts api, web, pgweb
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENVIRONMENT="${1:-dev}"
DUMP_FILE="${2:-}"

case "$ENVIRONMENT" in
  dev)
    ENV_FILE="${DOCKER_ENV_FILE:-$ROOT_DIR/.env.docker.dev}"
    FALLBACK_FILE="${DOCKER_ENV_FALLBACK_FILE:-$ROOT_DIR/.env.docker.dev.fallback}"
    COMPOSE_EXTRA="${DOCKER_COMPOSE_EXTRA_FILE:-$ROOT_DIR/compose.dev.yaml}"
    ;;
  stage)
    ENV_FILE="${DOCKER_ENV_FILE:-$ROOT_DIR/.env.docker.stage}"
    FALLBACK_FILE="${DOCKER_ENV_FALLBACK_FILE:-$ROOT_DIR/.env.docker.stage.fallback}"
    COMPOSE_EXTRA="${DOCKER_COMPOSE_EXTRA_FILE:-$ROOT_DIR/compose.stage.yaml}"
    ;;
  *)
    printf 'Usage: %s <dev|stage> [dump-file]\n' "$0" >&2
    exit 1
    ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  SOURCE_FILE="$ENV_FILE"
elif [[ -f "$FALLBACK_FILE" ]]; then
  SOURCE_FILE="$FALLBACK_FILE"
else
  printf 'Missing environment file: %s or %s\n' "$ENV_FILE" "$FALLBACK_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SOURCE_FILE"
set +a

if [[ -z "$DUMP_FILE" ]]; then
  DUMP_FILE="$(ls -t "$ROOT_DIR/.backups/recon-${ENVIRONMENT}-"*.dump 2>/dev/null | head -1 || true)"
  if [[ -z "$DUMP_FILE" ]]; then
    printf 'No backup files found in .backups/ for environment: %s\n' "$ENVIRONMENT" >&2
    printf 'Run: npm run db:backup:%s\n' "$ENVIRONMENT" >&2
    exit 1
  fi
  printf 'No dump file specified — using most recent: %s\n' "$DUMP_FILE"
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  printf 'Dump file not found: %s\n' "$DUMP_FILE" >&2
  exit 1
fi

compose_args=(-f "$ROOT_DIR/compose.yaml" -f "$COMPOSE_EXTRA" --env-file "$SOURCE_FILE")

if ! docker compose "${compose_args[@]}" exec -T postgres \
    pg_isready -U "${POSTGRES_USER:-recon_app}" -d "${POSTGRES_DB:-reconciliation_platform}" >/dev/null 2>&1; then
  printf 'Postgres is not running. Starting it now...\n'
  docker compose "${compose_args[@]}" up -d postgres
  printf 'Waiting for postgres to be ready...\n'
  local_retries=0
  until docker compose "${compose_args[@]}" exec -T postgres \
      pg_isready -U "${POSTGRES_USER:-recon_app}" -d "${POSTGRES_DB:-reconciliation_platform}" >/dev/null 2>&1; do
    local_retries=$((local_retries + 1))
    if (( local_retries > 30 )); then
      printf 'Postgres did not become ready in time.\n' >&2
      exit 1
    fi
    sleep 2
  done
fi

printf 'Stopping api, web, and pgweb to release database connections...\n'
docker compose "${compose_args[@]}" stop api web 2>/dev/null || true
if docker compose "${compose_args[@]}" config --services 2>/dev/null | grep -q '^pgweb$'; then
  docker compose "${compose_args[@]}" stop pgweb 2>/dev/null || true
fi

printf 'Terminating active database connections...\n'
docker compose "${compose_args[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER:-recon_app}" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB:-reconciliation_platform}' AND pid <> pg_backend_pid();" \
  >/dev/null

printf 'Copying dump file into container...\n'
docker compose "${compose_args[@]}" cp "$DUMP_FILE" "postgres:/tmp/restore.dump"

printf 'Restoring from %s...\n' "$DUMP_FILE"
docker compose "${compose_args[@]}" exec -T postgres \
  pg_restore \
    -j 4 \
    -U "${POSTGRES_USER:-recon_app}" \
    -d "${POSTGRES_DB:-reconciliation_platform}" \
    --clean \
    --if-exists \
    --no-owner \
    /tmp/restore.dump

docker compose "${compose_args[@]}" exec -T postgres rm /tmp/restore.dump

printf 'Re-applying user grants...\n'
bash "$ROOT_DIR/scripts/db/run-users.sh" "$ENVIRONMENT"

printf 'Restarting api and web services...\n'
docker compose "${compose_args[@]}" up -d api web
if docker compose "${compose_args[@]}" config --services 2>/dev/null | grep -q '^pgweb$'; then
  docker compose "${compose_args[@]}" up -d pgweb
fi

printf 'Restore complete from: %s\n' "$DUMP_FILE"
