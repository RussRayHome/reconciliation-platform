#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE_INPUT="${DOCKER_ENV_FILE:-${DOCKER_COMPOSE_ENV_FILE:-$ROOT_DIR/.env.docker}}"
if [[ "$ENV_FILE_INPUT" = /* ]]; then
  ENV_FILE="$ENV_FILE_INPUT"
else
  ENV_FILE="$ROOT_DIR/${ENV_FILE_INPUT#./}"
fi
FALLBACK_FILE="$ROOT_DIR/.env.docker.example"

if [[ -f "$ENV_FILE" ]]; then
  SOURCE_FILE="$ENV_FILE"
else
  SOURCE_FILE="$FALLBACK_FILE"
fi

if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "Missing Docker environment file. Expected $ENV_FILE or $FALLBACK_FILE." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SOURCE_FILE"
set +a

required_vars=(PUBLIC_WEB_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL)
for name in "${required_vars[@]}"; do
  value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "Missing required variable: $name" >&2
    exit 1
  fi
done

if [[ "$SOURCE_FILE" == "$FALLBACK_FILE" ]]; then
  echo "Using example Docker environment values from $FALLBACK_FILE"
else
  echo "Using Docker environment values from $ENV_FILE"
fi

echo "PUBLIC_WEB_PORT=$PUBLIC_WEB_PORT"
echo "POSTGRES_DB=$POSTGRES_DB"
echo "POSTGRES_USER=$POSTGRES_USER"