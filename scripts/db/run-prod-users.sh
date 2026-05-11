#!/usr/bin/env bash
# Usage: bash scripts/db/run-prod-users.sh <prod-rray|prod-rray-admin> \
#            --host <rds-endpoint> --port 5432 \
#            --admin-user <admin-username> --admin-password <admin-password>
#
# Runs a production user creation SQL script directly against a PostgreSQL
# endpoint (e.g. AWS RDS). This script is NOT called by any automated
# deployment pipeline and is NOT run via Docker Compose.
#
# The password for the new user must be set inside the SQL file before running.
# Replace the 'CHANGE_ME_SECURE_PASSWORD' placeholder and store the credential
# in AWS Secrets Manager.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SCRIPT_NAME="${1:-}"
PG_HOST="${2:-}"
PG_PORT="5432"
PG_ADMIN_USER="${PGUSER:-postgres}"
PG_ADMIN_PASSWORD="${PGPASSWORD:-}"
DB_NAME="reconciliation_platform"

usage() {
  printf 'Usage: %s <prod-rray|prod-rray-admin>\n' "$0"
  printf '  Environment variables or PGHOST/PGUSER/PGPASSWORD must be set.\n'
  printf '  Example:\n'
  printf '    PGHOST=mydb.cluster.us-east-1.rds.amazonaws.com \\\n'
  printf '    PGUSER=postgres PGPASSWORD=secret \\\n'
  printf '    bash scripts/db/run-prod-users.sh prod-rray\n'
}

case "$SCRIPT_NAME" in
  prod-rray)
    SQL_FILE="$ROOT_DIR/scripts/db/production/create-user-prod-rray.sql"
    ;;
  prod-rray-admin)
    SQL_FILE="$ROOT_DIR/scripts/db/production/create-user-prod-rray-admin.sql"
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

PG_HOST="${PGHOST:-${PG_HOST:-}}"
if [[ -z "$PG_HOST" ]]; then
  printf 'PGHOST is required (the RDS endpoint hostname).\n' >&2
  usage >&2
  exit 1
fi

if grep -q 'CHANGE_ME_SECURE_PASSWORD' "$SQL_FILE"; then
  printf 'ERROR: The password placeholder in %s has not been replaced.\n' "$SQL_FILE" >&2
  printf 'Set a strong password in the SQL file before running.\n' >&2
  exit 1
fi

printf 'Running %s against %s:%s/%s as %s...\n' \
  "$(basename "$SQL_FILE")" "$PG_HOST" "$PG_PORT" "$DB_NAME" "$PG_ADMIN_USER"

PGHOST="$PG_HOST" PGPORT="$PG_PORT" PGUSER="$PG_ADMIN_USER" PGPASSWORD="$PG_ADMIN_PASSWORD" \
  psql -d "$DB_NAME" -f "$SQL_FILE"

printf 'Production user script complete.\n'
