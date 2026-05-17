#!/usr/bin/env bash
# Create a compressed PostgreSQL dump of the target environment database.
#
# Usage (via npm scripts — preferred):
#   npm run db:backup          # dev
#   npm run db:backup:dev      # dev
#   npm run db:backup:stage    # stage
#
# Usage (direct):
#   DOCKER_ENV_FILE=.env.docker.dev \
#   DOCKER_ENV_FALLBACK_FILE=.env.docker.dev.fallback \
#   DOCKER_COMPOSE_EXTRA_FILE=compose.dev.yaml \
#   bash scripts/pre-flight/backup.sh dev
#
# Output:
#   .backups/recon-<env>-<YYYYMMDD-HHMMSS>.dump  (pg_dump custom format, compressed)
#
# Restore with:
#   bash scripts/pre-flight/restore.sh <dev|stage> [dump-file]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENVIRONMENT="${1:-dev}"

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
    printf 'Usage: %s <dev|stage>\n' "$0" >&2
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

compose_args=(-f "$ROOT_DIR/compose.yaml" -f "$COMPOSE_EXTRA" --env-file "$SOURCE_FILE")

if ! docker compose "${compose_args[@]}" exec -T postgres \
    pg_isready -U "${POSTGRES_USER:-recon_app}" -d "${POSTGRES_DB:-reconciliation_platform}" >/dev/null 2>&1; then
  printf 'Postgres is not ready in the %s environment. Start the stack first:\n' "$ENVIRONMENT" >&2
  printf '  npm run docker:deploy:%s\n' "$ENVIRONMENT" >&2
  exit 1
fi

BACKUP_DIR="$ROOT_DIR/.backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/recon-${ENVIRONMENT}-${TIMESTAMP}.dump"

printf 'Backing up %s database to %s...\n' "$ENVIRONMENT" "$BACKUP_FILE"

docker compose "${compose_args[@]}" exec -T postgres \
  pg_dump \
    -Fc \
    -U "${POSTGRES_USER:-recon_app}" \
    -d "${POSTGRES_DB:-reconciliation_platform}" \
  > "$BACKUP_FILE"

BACKUP_SIZE="$(du -sh "$BACKUP_FILE" | cut -f1)"
printf 'Backup complete: %s (%s)\n' "$BACKUP_FILE" "$BACKUP_SIZE"
