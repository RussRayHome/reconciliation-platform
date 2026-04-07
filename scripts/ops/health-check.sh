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

compose_args=(-f "$ROOT_DIR/compose.yaml")
if [[ -f "$ENV_FILE" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
  SOURCE_FILE="$ENV_FILE"
else
  compose_args+=(--env-file "$FALLBACK_FILE")
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

curl --fail --silent --show-error "http://127.0.0.1:${PUBLIC_WEB_PORT}/healthz" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${PUBLIC_WEB_PORT}/api/health" >/dev/null
docker compose "${compose_args[@]}" exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null

echo "Gateway, API, and PostgreSQL health checks passed."