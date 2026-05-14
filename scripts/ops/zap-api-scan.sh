#!/usr/bin/env bash
# OWASP ZAP passive + active scan against the REST API of the stage environment.
#
# Usage (via npm scripts — preferred):
#   npm run security:scan:zap:api:stage         # standard scan
#   npm run security:scan:zap:api:stage:strict  # fail on warnings (ZAP_FAIL_ON_WARN=true)
#
# Prerequisites:
#   - Stage stack must be running (npm run docker:deploy:stage)
#   - Docker must be running (ZAP executes inside its own container)
#   - zap-api-stage-targets.txt contains the list of API URL patterns to scan
#
# Optional env vars:
#   ZAP_FAIL_ON_WARN=true — treat ZAP warnings as failures (used in strict mode)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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
ZAP_API_BASE_URL="${ZAP_API_BASE_URL:-http://api:4000}"
ZAP_SPIDER_MINUTES="${ZAP_SPIDER_MINUTES:-2}"
ZAP_FAIL_ON_WARN="${ZAP_FAIL_ON_WARN:-false}"
ZAP_API_TARGETS="${ZAP_API_TARGETS:-}"

TARGETS_FILE_INPUT="${ZAP_API_TARGETS_FILE:-$ROOT_DIR/scripts/ops/zap-api-stage-targets.txt}"
if [[ "$TARGETS_FILE_INPUT" = /* ]]; then
  TARGETS_FILE="$TARGETS_FILE_INPUT"
else
  TARGETS_FILE="$ROOT_DIR/${TARGETS_FILE_INPUT#./}"
fi

REPORT_DIR_INPUT="${ZAP_REPORT_DIR:-$ROOT_DIR/test-results/security/zap-api-stage}"
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

trim_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
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

read_api_targets() {
  local -a targets=()

  if [[ -n "$ZAP_API_TARGETS" ]]; then
    IFS=',' read -r -a raw_targets <<< "$ZAP_API_TARGETS"
    for raw_target in "${raw_targets[@]}"; do
      local target
      target="$(trim_whitespace "$raw_target")"
      if [[ -n "$target" ]]; then
        targets+=("$target")
      fi
    done
  elif [[ -f "$TARGETS_FILE" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      local target
      target="$(trim_whitespace "$line")"
      if [[ -z "$target" || "$target" == \#* ]]; then
        continue
      fi
      targets+=("$target")
    done < "$TARGETS_FILE"
  fi

  if (( ${#targets[@]} == 0 )); then
    targets=("/api/health")
  fi

  printf '%s\n' "${targets[@]}"
}

build_target_url() {
  local target="$1"
  if [[ "$target" =~ ^https?:// ]]; then
    printf '%s\n' "$target"
    return
  fi

  printf '%s/%s\n' "${ZAP_API_BASE_URL%/}" "${target#/}"
}

slugify_target() {
  local value="$1"
  local slug
  slug="$(printf '%s' "$value" | sed -E 's|https?://||g; s|[^a-zA-Z0-9]+|_|g; s|^_+||; s|_+$||')"
  if [[ -z "$slug" ]]; then
    slug="target"
  fi

  printf '%s\n' "$slug"
}

compose_args=(-f "$ROOT_DIR/compose.yaml")
append_extra_compose_files "$EXTRA_COMPOSE_FILES"

SOURCE_FILE=""
if [[ -f "$ENV_FILE" ]]; then
  SOURCE_FILE="$ENV_FILE"
  compose_args+=(--env-file "$ENV_FILE")
elif [[ -f "$FALLBACK_FILE" ]]; then
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

printf 'Starting Stage API service for OWASP ZAP scan...\n'
docker compose "${compose_args[@]}" up -d api >/dev/null

api_container_id="$(docker compose "${compose_args[@]}" ps -q api | head -n 1)"
if [[ -z "$api_container_id" ]]; then
  printf 'Unable to resolve the Stage API container ID.\n' >&2
  exit 1
fi

ready=0
for _ in $(seq 1 45); do
  health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_container_id" 2>/dev/null || true)"
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
  printf 'Stage API service did not become ready for ZAP scanning.\n' >&2
  exit 1
fi

api_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$api_container_id" 2>/dev/null || true)"
api_network="$(printf '%s\n' "$api_networks" | grep -E '_app$' | head -n 1 || true)"
if [[ -z "$api_network" ]]; then
  api_network="$(printf '%s\n' "$api_networks" | grep -m1 . || true)"
fi

if [[ -z "$api_network" ]]; then
  printf 'Unable to resolve the Stage API Docker network for ZAP.\n' >&2
  exit 1
fi

api_targets=()
while IFS= read -r target_line; do
  if [[ -n "$target_line" ]]; then
    api_targets+=("$target_line")
  fi
done < <(read_api_targets)

summary_file="$REPORT_DIR/scan-summary.csv"
printf 'target,exit_code,artifact_dir\n' > "$summary_file"

had_fail=0
had_warn=0
had_error=0
scan_index=0

for target in "${api_targets[@]}"; do
  scan_index=$((scan_index + 1))
  target_url="$(build_target_url "$target")"
  slug="$(slugify_target "$target_url" | cut -c1-64)"
  target_report_dir="$REPORT_DIR/target-${scan_index}-${slug}"
  mkdir -p "$target_report_dir"

  printf 'Running OWASP ZAP baseline scan for API target %s...\n' "$target_url"

  set +e
  docker run --rm \
    --network "$api_network" \
    -v "$target_report_dir:/zap/wrk:rw" \
    "$ZAP_IMAGE" \
    zap-baseline.py \
    -t "$target_url" \
    -m "$ZAP_SPIDER_MINUTES" \
    -J "zap-report.json" \
    -r "zap-report.html" \
    -w "zap-report.md" \
    -x "zap-report.xml"
  target_exit_code=$?
  set -e

  printf '%s,%s,%s\n' "$target_url" "$target_exit_code" "$target_report_dir" >> "$summary_file"

  case "$target_exit_code" in
    0)
      ;;
    1)
      had_fail=1
      ;;
    2)
      had_warn=1
      ;;
    3)
      had_error=1
      ;;
    *)
      had_error=1
      ;;
  esac
done

printf 'ZAP artifacts written to %s\n' "$REPORT_DIR"

if (( had_fail == 1 )); then
  printf 'OWASP ZAP reported FAIL findings for one or more API targets.\n' >&2
  exit 1
fi

if (( had_error == 1 )); then
  printf 'OWASP ZAP reported runtime/configuration errors for one or more API targets.\n' >&2
  exit 3
fi

if (( had_warn == 1 )); then
  if is_truthy "$ZAP_FAIL_ON_WARN"; then
    printf 'OWASP ZAP reported WARN findings for API targets and ZAP_FAIL_ON_WARN is enabled.\n' >&2
    exit 2
  fi

  printf 'OWASP ZAP reported WARN findings for API targets (non-blocking by configuration).\n'
  exit 0
fi

printf 'OWASP ZAP completed with no FAIL findings for API targets.\n'
