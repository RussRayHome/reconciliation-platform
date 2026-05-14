#!/usr/bin/env bash
# Run pending database schema migrations inside the running postgres container.
#
# Usage (via npm scripts — preferred):
#   npm run docker:migrate
#
# Usage (direct):
#   DOCKER_ENV_FILE=.env.docker.dev \
#   DOCKER_ENV_FALLBACK_FILE=.env.docker.dev.fallback \
#   DOCKER_COMPOSE_EXTRA_FILE=compose.dev.yaml \
#   bash scripts/ops/run-migrations.sh
#
# Prerequisites: the postgres container must already be running (npm run docker:deploy first).
# Migrations are also applied automatically on API boot when RUN_DB_MIGRATIONS_ON_BOOT=true.
# Use this script for manual migration runs or to verify migration state without restarting the API.
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

compose_args=(-f "$ROOT_DIR/compose.yaml")
append_extra_compose_files
if [[ -f "$ENV_FILE" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
elif [[ -f "$FALLBACK_FILE" ]]; then
  compose_args+=(--env-file "$FALLBACK_FILE")
fi

bash "$ROOT_DIR/scripts/ops/validate-env.sh"
docker compose "${compose_args[@]}" up --build migrate