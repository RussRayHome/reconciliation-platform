#!/usr/bin/env bash
# Check the health of a running Docker Compose stack (gateway, API, PostgreSQL).
#
# Usage (via npm scripts — preferred):
#   npm run docker:health         # dev environment
#   npm run docker:health:stage   # stage environment
#
# Usage (direct):
#   DOCKER_ENV_FILE=.env.docker.dev \
#   DOCKER_ENV_FALLBACK_FILE=.env.docker.dev.fallback \
#   DOCKER_COMPOSE_EXTRA_FILE=compose.dev.yaml \
#   bash scripts/ops/health-check.sh
#
# What it checks:
#   - Gateway HTTP response on PUBLIC_WEB_PORT (nginx reverse proxy)
#   - API /api/health JSON response
#   - PostgreSQL pg_isready inside the postgres container
#
# Exits 0 if all checks pass, 1 if any fail.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE_INPUT="${DOCKER_ENV_FILE:-${DOCKER_COMPOSE_ENV_FILE:-$ROOT_DIR/.env.docker.dev}}"
if [[ "$ENV_FILE_INPUT" = /* ]]; then
  ENV_FILE="$ENV_FILE_INPUT"
else
  ENV_FILE="$ROOT_DIR/${ENV_FILE_INPUT#./}"
fi
FALLBACK_FILE_INPUT="${DOCKER_ENV_FALLBACK_FILE:-$ROOT_DIR/.env.docker.dev.fallback}"
if [[ "$FALLBACK_FILE_INPUT" = /* ]]; then
  FALLBACK_FILE="$FALLBACK_FILE_INPUT"
else
  FALLBACK_FILE="$ROOT_DIR/${FALLBACK_FILE_INPUT#./}"
fi

resolve_compose_file_path() {
  local input_path="$1"
  if [[ "$input_path" = /* ]]; then
    printf '%s\n' "$input_path"
  else
    printf '%s\n' "$ROOT_DIR/${input_path#./}"
  fi
}

append_extra_compose_files() {
  local configured_files="${DOCKER_COMPOSE_EXTRA_FILE:-}"
  if [[ -z "$configured_files" ]]; then
    return
  fi

  local remaining="$configured_files"
  while [[ -n "$remaining" ]]; do
    local next_path="$remaining"
    if [[ "$remaining" == *:* ]]; then
      next_path="${remaining%%:*}"
      remaining="${remaining#*:}"
    else
      remaining=""
    fi

    if [[ -z "$next_path" ]]; then
      continue
    fi

    compose_args+=(-f "$(resolve_compose_file_path "$next_path")")
  done
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local retries="${HEALTH_CHECK_RETRIES:-30}"
  local delay_seconds="${HEALTH_CHECK_DELAY_SECONDS:-2}"
  local attempt=1

  while (( attempt <= retries )); do
    if curl --fail --silent --show-error "$url" >/dev/null; then
      return 0
    fi

    if (( attempt == retries )); then
      echo "Health check failed for ${label} at ${url} after ${retries} attempts." >&2
      return 1
    fi

    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
}

wait_for_postgres() {
  local retries="${HEALTH_CHECK_RETRIES:-30}"
  local delay_seconds="${HEALTH_CHECK_DELAY_SECONDS:-2}"
  local attempt=1

  while (( attempt <= retries )); do
    if docker compose "${compose_args[@]}" exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null; then
      return 0
    fi

    if (( attempt == retries )); then
      echo "Health check failed for PostgreSQL after ${retries} attempts." >&2
      return 1
    fi

    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
}

compose_args=(-f "$ROOT_DIR/compose.yaml")
append_extra_compose_files
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

wait_for_http "Gateway" "http://127.0.0.1:${PUBLIC_WEB_PORT}/healthz"
wait_for_http "API" "http://127.0.0.1:${PUBLIC_WEB_PORT}/api/health"
wait_for_postgres

pgweb_enabled=false
if docker compose "${compose_args[@]}" config --services 2>/dev/null | grep -q '^pgweb$'; then
  PGWEB_PORT="${PGWEB_PORT:-8081}"
  wait_for_http "Postgres Admin" "http://127.0.0.1:${PGWEB_PORT}/"
  pgweb_enabled=true
fi

nginx_ui_enabled=false
if docker compose "${compose_args[@]}" config --services 2>/dev/null | grep -q '^nginx-ui$'; then
  NGINX_UI_HTTP_PORT="${NGINX_UI_HTTP_PORT:-8082}"
  wait_for_http "Nginx UI" "http://127.0.0.1:${NGINX_UI_HTTP_PORT}/"
  nginx_ui_enabled=true
fi

if [[ "$pgweb_enabled" == "true" && "$nginx_ui_enabled" == "true" ]]; then
  echo "Gateway, API, PostgreSQL, Postgres Admin, and Nginx UI health checks passed."
elif [[ "$pgweb_enabled" == "true" ]]; then
  echo "Gateway, API, PostgreSQL, and Postgres Admin health checks passed."
elif [[ "$nginx_ui_enabled" == "true" ]]; then
  echo "Gateway, API, PostgreSQL, and Nginx UI health checks passed."
else
  echo "Gateway, API, and PostgreSQL health checks passed."
fi
