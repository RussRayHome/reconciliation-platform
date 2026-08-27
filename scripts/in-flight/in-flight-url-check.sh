#!/usr/bin/env bash
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

trim_path_segment() {
  local segment="$1"
  segment="${segment#${segment%%[![:space:]]*}}"
  segment="${segment%${segment##*[![:space:]]}}"
  segment="${segment#/}"
  segment="${segment%/}"
  printf '%s\n' "$segment"
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

if [[ "$SOURCE_FILE" == "$FALLBACK_FILE" ]]; then
  guard_env_fallback "$FALLBACK_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$SOURCE_FILE"
set +a

configured_segment="$(trim_path_segment "${VITE_ENVIRONMENT_PATH_SEGMENT:-}")"
if [[ -z "$configured_segment" ]]; then
  if [[ "${DOCKER_COMPOSE_EXTRA_FILE:-}" == *"stage"* ]]; then
    configured_segment="stage"
  elif [[ "${DOCKER_COMPOSE_EXTRA_FILE:-}" == *"dev"* ]]; then
    configured_segment="dev"
  fi
fi

gateway_base="http://127.0.0.1:${PUBLIC_WEB_PORT}"

resolve_gateway_url() {
  local route="$1"
  if [[ -n "$configured_segment" ]]; then
    printf '%s/%s/%s\n' "$gateway_base" "$configured_segment" "$route"
  else
    printf '%s/%s\n' "$gateway_base" "$route"
  fi
}

check_url() {
  local label="$1"
  local url="$2"

  curl --fail --silent --show-error --location "$url" >/dev/null
  echo "In-flight URL check passed: ${label} (${url})"
}

check_url "Nginx health (unproxied)" "${gateway_base}/healthz"
check_url "Application" "${gateway_base}/"
check_url "API proxy health" "${gateway_base}/api/health"
check_url "Docs" "$(resolve_gateway_url "docs")"

if docker compose "${compose_args[@]}" config --services 2>/dev/null | grep -q '^pgweb$'; then
  check_url "pgweb" "$(resolve_gateway_url "pgweb")"
fi

echo "All in-flight URL checks passed."