#!/usr/bin/env bash
# OWASP ZAP passive + active scan against the web frontend of the stage environment.
#
# Usage (via npm scripts — preferred):
#   npm run security:scan:zap:web:stage         # standard scan
#   npm run security:scan:zap:web:stage:strict  # fail on warnings (ZAP_FAIL_ON_WARN=true)
#
# Prerequisites:
#   - Stage stack must be running (npm run docker:deploy:stage)
#   - Docker must be running (ZAP executes inside its own container)
#
# Required env vars (in .env.docker.stage):
#   PUBLIC_WEB_PORT — port the nginx gateway is listening on
#
# Optional env vars:
#   ZAP_FAIL_ON_WARN=true — treat ZAP warnings as failures (used in strict mode)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/pre-flight/lib/env-fallback-guard.sh"

ENV_FILE_INPUT="${DOCKER_ENV_FILE:-${DOCKER_COMPOSE_ENV_FILE:-$ROOT_DIR/.env.docker.stage}}"
if [[ "$ENV_FILE_INPUT" = /* ]]; then
  ENV_FILE="$ENV_FILE_INPUT"
else
  ENV_FILE="$ROOT_DIR/${ENV_FILE_INPUT#./}"
fi

FALLBACK_FILE_INPUT="${DOCKER_ENV_FALLBACK_FILE:-$ROOT_DIR/.env.docker.stage.fallback}"
if [[ "$FALLBACK_FILE_INPUT" = /* ]]; then
  FALLBACK_FILE="$FALLBACK_FILE_INPUT"
else
  FALLBACK_FILE="$ROOT_DIR/${FALLBACK_FILE_INPUT#./}"
fi

EXTRA_COMPOSE_FILES="${DOCKER_COMPOSE_EXTRA_FILE:-compose.stage.yaml}"
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
ZAP_TARGET_URL="${ZAP_TARGET_URL:-http://web:8080}"
ZAP_SPIDER_MINUTES="${ZAP_SPIDER_MINUTES:-2}"
ZAP_FAIL_ON_WARN="${ZAP_FAIL_ON_WARN:-false}"

REPORT_DIR_INPUT="${ZAP_REPORT_DIR:-$ROOT_DIR/test-results/security/zap-web-stage}"
if [[ "$REPORT_DIR_INPUT" = /* ]]; then
  REPORT_DIR="$REPORT_DIR_INPUT"
else
  REPORT_DIR="$ROOT_DIR/${REPORT_DIR_INPUT#./}"
fi

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

resolve_compose_file_path() {
  local input_path="$1"
  if [[ "$input_path" = /* ]]; then
    printf '%s\n' "$input_path"
  else
    printf '%s\n' "$ROOT_DIR/${input_path#./}"
  fi
}

append_extra_compose_files() {
  local configured_files="$1"
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
append_extra_compose_files "$EXTRA_COMPOSE_FILES"

SOURCE_FILE=""
if [[ -f "$ENV_FILE" ]]; then
  SOURCE_FILE="$ENV_FILE"
  compose_args+=(--env-file "$ENV_FILE")
elif [[ -f "$FALLBACK_FILE" ]]; then
  guard_env_fallback "$FALLBACK_FILE"
  SOURCE_FILE="$FALLBACK_FILE"
  compose_args+=(--env-file "$FALLBACK_FILE")
fi

if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is unavailable; start Docker and retry.\n' >&2
  exit 1
fi

if [[ -n "$SOURCE_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SOURCE_FILE"
  set +a
fi

mkdir -p "$REPORT_DIR"

printf 'Starting Stage web service for OWASP ZAP scan...\n'
docker compose "${compose_args[@]}" up -d web >/dev/null

web_container_id="$(docker compose "${compose_args[@]}" ps -q web | head -n 1)"
if [[ -z "$web_container_id" ]]; then
  printf 'Unable to resolve the Stage web container ID.\n' >&2
  exit 1
fi

ready=0
for _ in $(seq 1 45); do
  health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$web_container_id" 2>/dev/null || true)"
  case "$health_status" in
    healthy|running)
      ready=1
      break
      ;;
    unhealthy|exited|dead)
      break
      ;;
  esac
  sleep 2
done

if (( ready == 0 )); then
  printf 'Stage web service did not become ready for ZAP scanning.\n' >&2
  exit 1
fi

web_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$web_container_id" 2>/dev/null || true)"
web_network="$(printf '%s\n' "$web_networks" | grep -E '_edge$' | head -n 1 || true)"
if [[ -z "$web_network" ]]; then
  web_network="$(printf '%s\n' "$web_networks" | grep -m1 . || true)"
fi

if [[ -z "$web_network" ]]; then
  printf 'Unable to resolve the Stage web Docker network for ZAP.\n' >&2
  exit 1
fi

PUBLIC_WEB_PORT="${PUBLIC_WEB_PORT:-4273}"
printf 'Running OWASP ZAP baseline scan against %s (internal target) and host port %s...\n' "$ZAP_TARGET_URL" "$PUBLIC_WEB_PORT"

set +e
docker run --rm \
  --network "$web_network" \
  -v "$REPORT_DIR:/zap/wrk:rw" \
  "$ZAP_IMAGE" \
  zap-baseline.py \
  -t "$ZAP_TARGET_URL" \
  -m "$ZAP_SPIDER_MINUTES" \
  -J zap-report.json \
  -r zap-report.html \
  -w zap-report.md \
  -x zap-report.xml
zap_exit_code=$?
set -e

printf 'ZAP artifacts written to %s\n' "$REPORT_DIR"

case "$zap_exit_code" in
  0)
    printf 'OWASP ZAP completed with no FAIL findings.\n'
    exit 0
    ;;
  1)
    printf 'OWASP ZAP reported FAIL findings.\n' >&2
    exit 1
    ;;
  2)
    if is_truthy "$ZAP_FAIL_ON_WARN"; then
      printf 'OWASP ZAP reported WARN findings and ZAP_FAIL_ON_WARN is enabled.\n' >&2
      exit 2
    fi
    printf 'OWASP ZAP reported WARN findings (non-blocking by configuration).\n'
    exit 0
    ;;
  3)
    printf 'OWASP ZAP scan failed due to runtime or configuration error.\n' >&2
    exit 3
    ;;
  *)
    printf 'OWASP ZAP exited with unexpected code %s.\n' "$zap_exit_code" >&2
    exit "$zap_exit_code"
    ;;
esac