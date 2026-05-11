#!/usr/bin/env bash
# Deploy (or redeploy) the full Docker Compose stack for a given environment.
#
# Usage (via npm scripts — preferred):
#   npm run docker:deploy          # dev environment
#   npm run docker:deploy:stage    # stage environment
#
# Usage (direct):
#   DOCKER_ENV_FILE=.env.docker.dev \
#   DOCKER_ENV_FALLBACK_FILE=.env.docker.dev.example \
#   DOCKER_COMPOSE_EXTRA_FILE=compose.dev.yaml \
#   bash scripts/ops/deploy.sh
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
FALLBACK_FILE_INPUT="${DOCKER_ENV_FALLBACK_FILE:-$ROOT_DIR/.env.docker.dev.example}"
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

compose_args=(-f "$ROOT_DIR/compose.yaml")
append_extra_compose_files

if [[ -f "$ENV_FILE" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
elif [[ -f "$FALLBACK_FILE" ]]; then
  compose_args+=(--env-file "$FALLBACK_FILE")
fi

bash "$ROOT_DIR/scripts/ops/validate-env.sh"
docker compose "${compose_args[@]}" up --build -d postgres
docker compose "${compose_args[@]}" up --build migrate
docker compose "${compose_args[@]}" up --build -d api web
bash "$ROOT_DIR/scripts/ops/health-check.sh"

echo "Local stack deployed."