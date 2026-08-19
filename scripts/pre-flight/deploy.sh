#!/usr/bin/env bash
# Deploy (or redeploy) the full Docker Compose stack for a given environment.
#
# Usage (via npm scripts — preferred):
#   npm run docker:deploy          # dev environment
#   npm run docker:deploy:stage    # stage environment
#
# Usage (direct):
#   DOCKER_ENV_FILE=.env.docker.dev \
#   DOCKER_ENV_FALLBACK_FILE=.env.docker.dev.fallback \
#   DOCKER_COMPOSE_EXTRA_FILE=compose.dev.yaml \
#   bash scripts/pre-flight/deploy.sh
#
# Required env vars (set in the env file):
#   POSTGRES_PASSWORD, COMPOSE_PROJECT_NAME
#
# Optional env vars:
#   DOCKER_ENV_FILE            — path to the active env file (default: .env.docker.dev)
#   DOCKER_ENV_FALLBACK_FILE   — path to the example/fallback env file
#   DOCKER_COMPOSE_EXTRA_FILE  — path to the environment overlay compose file
#
# What it does:
#   1. Validates env file presence and required variables (via validate-env.sh)
#   2. Pulls/builds images if needed
#   3. Starts all services with `docker compose up -d --build`
#   4. Waits for the gateway health endpoint to become ready
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

extract_service_block_from_compose_config() {
  local service_name="$1"
  docker compose "${compose_args[@]}" config 2>/dev/null | awk -v service="$service_name" '
    $0 ~ "^  " service ":" { in_service=1; print; next }
    in_service && $0 ~ "^  [A-Za-z0-9_-]+:" { exit }
    in_service { print }
  '
}

resolve_service_build_target() {
  local service_name="$1"
  local service_block
  service_block="$(extract_service_block_from_compose_config "$service_name")"
  printf '%s\n' "$service_block" | sed -n 's/^[[:space:]]*target:[[:space:]]*//p' | head -n 1
}

compose_args=(-f "$ROOT_DIR/compose.yaml")
append_extra_compose_files

if [[ -f "$ENV_FILE" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
elif [[ -f "$FALLBACK_FILE" ]]; then
  compose_args+=(--env-file "$FALLBACK_FILE")
fi

bash "$ROOT_DIR/scripts/pre-flight/validate-env.sh"
DEPLOY_ENV="dev"
if [[ "${DOCKER_COMPOSE_EXTRA_FILE:-}" == *"stage"* ]] || [[ "$ENV_FILE" == *"stage"* ]]; then
  DEPLOY_ENV="stage"
fi

if [[ "$DEPLOY_ENV" == "dev" || "$DEPLOY_ENV" == "stage" ]]; then
  bash "$ROOT_DIR/scripts/pre-flight/generate-tls-cert.sh" "$DEPLOY_ENV"
fi

if [[ "$DEPLOY_ENV" == "dev" || "$DEPLOY_ENV" == "stage" ]]; then
  export AUX_HEALTH_CHECK_REQUIRED="${AUX_HEALTH_CHECK_REQUIRED:-true}"
  export AUX_HEALTH_CHECK_RETRIES="${AUX_HEALTH_CHECK_RETRIES:-90}"
fi

if [[ "${DOCKER_BUILD_NO_CACHE:-false}" == "true" ]]; then
  docker compose "${compose_args[@]}" build --no-cache
else
  docker compose "${compose_args[@]}" build
fi
docker compose "${compose_args[@]}" up -d postgres
bash "$ROOT_DIR/scripts/pre-flight/run-users.sh" "$DEPLOY_ENV"
docker compose "${compose_args[@]}" up migrate
# Re-run after migrations: the first run-users.sh call above only sets up
# Postgres roles, since reconciliation_user doesn't exist until migrations
# create it. This second call seeds the application login accounts now that
# the table is present.
bash "$ROOT_DIR/scripts/pre-flight/run-users.sh" "$DEPLOY_ENV"
docker compose "${compose_args[@]}" up -d --force-recreate api worker web
if has_compose_service "pgweb"; then
  docker compose "${compose_args[@]}" up -d pgweb
fi
if has_compose_service "nginx-ui"; then
  docker compose "${compose_args[@]}" up -d nginx-ui
fi

api_build_target="$(resolve_service_build_target "api")"
if [[ "$api_build_target" == "dev" ]]; then
  if docker compose "${compose_args[@]}" exec -T api sh -lc 'ls node_modules/.bin/vitest >/dev/null 2>&1'; then
    echo "Verified dev tooling image: vitest is present in the api container."
  else
    echo "api service resolved to target=dev, but vitest is missing from the running container." >&2
    echo "Rebuild with: docker compose ${compose_args[*]} build --no-cache api" >&2
    exit 1
  fi
fi

bash "$ROOT_DIR/scripts/pre-flight/health-check.sh"

echo "Local stack deployed."