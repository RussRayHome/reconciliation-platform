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
#   bash scripts/pre-flight/health-check.sh
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

has_compose_service() {
  local service_name="$1"
  local service_list

  service_list="$(docker compose "${compose_args[@]}" config --services 2>/dev/null)" || return 1
  grep -qx "$service_name" <<< "$service_list"
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local retries="${3:-${HEALTH_CHECK_RETRIES:-30}}"
  local delay_seconds="${HEALTH_CHECK_DELAY_SECONDS:-2}"
  local attempt=1

  while (( attempt <= retries )); do
    # --insecure is a no-op against a plain http:// URL, so this is safe to pass unconditionally
    # rather than branching on scheme -- the dev/stage gateway checks below are https, against the
    # cert generate-tls-cert.sh produces (mkcert-trusted when available, self-signed otherwise;
    # --insecure skips verification either way so this check works regardless).
    if curl --fail --silent --show-error --insecure "$url" >/dev/null; then
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

is_service_running() {
  local service_name="$1"
  docker compose "${compose_args[@]}" ps --services --status running | grep -qx "$service_name"
}

is_truthy() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
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

# Same DEPLOY_ENV derivation as deploy.sh. Dev publishes HTTPS only (compose.yaml no longer
# publishes a host port for plain HTTP -- see compose.yaml's `web` service). Stage now also has a
# trusted cert mounted (compose.stage.yaml, certs/stage -- see generate-tls-cert.sh), but keeps
# republishing plain HTTP alongside it, so both get checked there.
DEPLOY_ENV="dev"
if [[ "${DOCKER_COMPOSE_EXTRA_FILE:-}" == *"stage"* ]] || [[ "$ENV_FILE" == *"stage"* ]]; then
  DEPLOY_ENV="stage"
fi

if [[ "$DEPLOY_ENV" == "dev" ]]; then
  gateway_base_url="https://127.0.0.1:${PUBLIC_WEB_HTTPS_PORT:-4174}"
else
  gateway_base_url="https://127.0.0.1:${PUBLIC_WEB_HTTPS_PORT:-4274}"
fi

wait_for_http "Gateway" "${gateway_base_url}/healthz"
wait_for_http "API" "${gateway_base_url}/api/health"

if [[ "$DEPLOY_ENV" == "stage" ]]; then
  wait_for_http "Gateway (plain HTTP)" "http://127.0.0.1:${PUBLIC_WEB_PORT}/healthz"
fi

wait_for_postgres

pgweb_enabled=false
pgweb_healthy=false
if has_compose_service "pgweb"; then
  pgweb_enabled=true
  PGWEB_PORT="${PGWEB_PORT:-8081}"
  if ! is_service_running "pgweb"; then
    if is_truthy "${AUX_HEALTH_CHECK_REQUIRED:-false}"; then
      echo "Postgres Admin service (pgweb) is configured but not running." >&2
      exit 1
    else
      echo "Warning: Postgres Admin service (pgweb) is configured but not running; skipping health check because AUX_HEALTH_CHECK_REQUIRED is false."
    fi
  elif wait_for_http "Postgres Admin" "http://127.0.0.1:${PGWEB_PORT}/" "${AUX_HEALTH_CHECK_RETRIES:-60}"; then
    pgweb_healthy=true
  elif is_truthy "${AUX_HEALTH_CHECK_REQUIRED:-false}"; then
    exit 1
  else
    echo "Warning: Postgres Admin health check did not pass at http://127.0.0.1:${PGWEB_PORT}/; continuing because AUX_HEALTH_CHECK_REQUIRED is false."
  fi
fi

nginx_ui_enabled=false
nginx_ui_healthy=false
if has_compose_service "nginx-ui"; then
  nginx_ui_enabled=true
  NGINX_UI_HTTP_PORT="${NGINX_UI_HTTP_PORT:-8082}"
  if ! is_service_running "nginx-ui"; then
    if is_truthy "${AUX_HEALTH_CHECK_REQUIRED:-false}"; then
      echo "Nginx UI service (nginx-ui) is configured but not running." >&2
      exit 1
    else
      echo "Warning: Nginx UI service (nginx-ui) is configured but not running; skipping health check because AUX_HEALTH_CHECK_REQUIRED is false."
    fi
  elif wait_for_http "Nginx UI" "http://127.0.0.1:${NGINX_UI_HTTP_PORT}/" "${AUX_HEALTH_CHECK_RETRIES:-60}"; then
    nginx_ui_healthy=true
  elif is_truthy "${AUX_HEALTH_CHECK_REQUIRED:-false}"; then
    exit 1
  else
    echo "Warning: Nginx UI health check did not pass at http://127.0.0.1:${NGINX_UI_HTTP_PORT}/; continuing because AUX_HEALTH_CHECK_REQUIRED is false."
  fi
fi

echo "Gateway, API, and PostgreSQL health checks passed."

if [[ "$pgweb_enabled" == "true" && "$pgweb_healthy" == "true" ]]; then
  echo "Postgres Admin health check passed."
fi

if [[ "$nginx_ui_enabled" == "true" && "$nginx_ui_healthy" == "true" ]]; then
  echo "Nginx UI health check passed."
fi
