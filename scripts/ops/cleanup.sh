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
  SOURCE_FILE="$ENV_FILE"
elif [[ -f "$FALLBACK_FILE" ]]; then
  SOURCE_FILE="$FALLBACK_FILE"
else
  SOURCE_FILE=""
fi

if [[ -f "$ENV_FILE" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
elif [[ -f "$FALLBACK_FILE" ]]; then
  compose_args+=(--env-file "$FALLBACK_FILE")
fi

PROJECT_NAME="reconciliation-platform"
if [[ -n "$SOURCE_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SOURCE_FILE"
  set +a
  PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$PROJECT_NAME}"
fi

cleanup_project_network() {
  local network_name="$1"
  local attached_names

  attached_names="$(docker network inspect "$network_name" --format '{{range $id, $container := .Containers}}{{println $container.Name}}{{end}}' 2>/dev/null || true)"

  if [[ -n "$attached_names" ]]; then
    while IFS= read -r container_name; do
      [[ -z "$container_name" ]] && continue
      if [[ "$container_name" == "$PROJECT_NAME-"* ]]; then
        docker rm -f "$container_name" >/dev/null 2>&1 || true
      fi
    done <<< "$attached_names"
  fi

  docker network rm "$network_name" >/dev/null 2>&1 || true
}

disconnect_project_helpers() {
  local network_name="$1"
  local attached_names

  attached_names="$(docker network inspect "$network_name" --format '{{range $id, $container := .Containers}}{{println $container.Name}}{{end}}' 2>/dev/null || true)"

  if [[ -z "$attached_names" ]]; then
    return
  fi

  while IFS= read -r container_name; do
    [[ -z "$container_name" ]] && continue
    if [[ "$container_name" == "$PROJECT_NAME-"* ]]; then
      docker rm -f "$container_name" >/dev/null 2>&1 || true
    fi
  done <<< "$attached_names"
}

disconnect_project_helpers "${PROJECT_NAME}_edge"
disconnect_project_helpers "${PROJECT_NAME}_app"
disconnect_project_helpers "${PROJECT_NAME}_data"

docker compose "${compose_args[@]}" down --remove-orphans

if [[ "${1:-}" == "--prune-volumes" ]]; then
  docker compose "${compose_args[@]}" down --remove-orphans --volumes
fi

cleanup_project_network "${PROJECT_NAME}_edge"
cleanup_project_network "${PROJECT_NAME}_app"
cleanup_project_network "${PROJECT_NAME}_data"

echo "Local production-like stack cleaned up."