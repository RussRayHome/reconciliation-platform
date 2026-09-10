#!/usr/bin/env bash
# Tear down a Docker Compose stack and remove its associated volumes and orphan containers.
#
# Usage (via npm scripts — preferred):
#   npm run docker:cleanup         # dev environment
#   npm run docker:cleanup:stage   # stage environment
#
# Usage (direct):
#   DOCKER_ENV_FILE=.env.docker.dev \
#   DOCKER_ENV_FALLBACK_FILE=.env.docker.dev.fallback \
#   DOCKER_COMPOSE_EXTRA_FILE=compose.dev.yaml \
#   bash scripts/pre-flight/cleanup.sh
#
# WARNING: Removes named volumes (database data). Run only when you want a clean slate.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/pre-flight/lib/env-fallback-guard.sh"
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
  SOURCE_FILE="$ENV_FILE"
elif [[ -f "$FALLBACK_FILE" ]]; then
  guard_env_fallback "$FALLBACK_FILE"
  SOURCE_FILE="$FALLBACK_FILE"
else
  SOURCE_FILE=""
fi

if [[ -f "$ENV_FILE" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
elif [[ -f "$FALLBACK_FILE" ]]; then
  compose_args+=(--env-file "$FALLBACK_FILE")
fi

# Captured BEFORE the `set -a; source` below, which exports every name in the env file and so
# OVERWRITES an explicit COMPOSE_PROJECT_NAME the caller set. Standard Compose precedence is the
# other way round -- shell environment wins over an env file -- and callers rely on that.
CALLER_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"

PROJECT_NAME="reconciliation-platform"
if [[ -n "$SOURCE_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SOURCE_FILE"
  set +a
  PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$PROJECT_NAME}"
fi

# The caller's explicit choice wins over the file's.
#
# Not hypothetical. `deploy-cleanup.test.ts` writes its env file to a FIXED path
# ($TMPDIR/reconciliation-platform.integration.env), rewritten on every module load with the
# current PID stamped into COMPOSE_PROJECT_NAME. Vitest loads that module more than once, so the
# name in the file can belong to a different run than the containers on disk. On 2026-09-10 that
# left a six-container project (`...-integration-29118`) running while the file said `...-30193`:
# teardown targeted a project that did not exist and printed "Local stack cleaned up." It is a
# race, which is why orphans accumulated slowly rather than every run -- 714 images by 2026-09-10,
# the accumulation #215 chased.
PROJECT_NAME="${CALLER_PROJECT_NAME:-$PROJECT_NAME}"
export COMPOSE_PROJECT_NAME="$PROJECT_NAME"

# Passed explicitly so `docker compose down` and this script's own network/container sweep below
# can never disagree about which project they act on. Previously compose inferred the project from
# --env-file while the sweep used $PROJECT_NAME, and the two could diverge.
compose_args+=(-p "$PROJECT_NAME")

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

# Post-condition, not decoration. This script's actual failure mode was printing success while
# removing nothing -- indistinguishable from working, which is why orphans went unnoticed. Assert
# the outcome rather than assume it: anything still carrying this project's prefix means the
# teardown did not do what the next line is about to claim.
#
# grep -F: the project name is data, and an unanchored pattern containing regex metacharacters
# would match the wrong thing or nothing at all.
surviving="$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -F "${PROJECT_NAME}-" || true)"
if [[ -n "$surviving" ]]; then
  echo "Cleanup did NOT remove every container for project '$PROJECT_NAME':" >&2
  while IFS= read -r leftover; do
    [[ -z "$leftover" ]] && continue
    echo "  $leftover" >&2
  done <<< "$surviving"
  exit 1
fi

echo "Cleaned up project: $PROJECT_NAME"
echo "Local stack cleaned up."