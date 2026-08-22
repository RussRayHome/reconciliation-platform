#!/usr/bin/env bash
# k6 golden-path regression load test against the stage environment.
#
# Usage (via npm script -- preferred):
#   npm run perf:k6:stage
#
# Prerequisites:
#   - Stage stack must be running (npm run docker:deploy:stage)
#   - The observability stack must be running and joined to Stage's network
#     (docker compose -f compose.observability.yaml up -d) -- this is what makes results visible
#     in Grafana; the load test itself will still run and print a summary without it, just with
#     nowhere durable for the numbers to land.
#   - Docker must be running (k6 executes inside its own container, same isolation pattern as the
#     ZAP scans -- a load generator must never share CPU/network with the system it's measuring)
#
# Optional env vars:
#   K6_VUS, K6_DURATION            -- override the default light load profile (see k6-golden-path.js)
#   K6_IMAGE                       -- override the pinned grafana/k6 image
#   K6_PROMETHEUS_RW_URL           -- override the remote-write target (default: the observability
#                                      stack's own Prometheus, reachable because it joins Stage's
#                                      app network the same way this script's k6 container does)
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
K6_IMAGE="${K6_IMAGE:-grafana/k6:2.2.0}"
K6_PROMETHEUS_RW_URL="${K6_PROMETHEUS_RW_URL:-http://prometheus:9090/api/v1/write}"

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

printf 'Starting Stage API service for k6 load test...\n'
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
  printf 'Stage API service did not become ready for the load test.\n' >&2
  exit 1
fi

api_container_name="$(docker inspect --format '{{.Name}}' "$api_container_id" | sed 's#^/##')"

api_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$api_container_id" 2>/dev/null || true)"
api_network="$(printf '%s\n' "$api_networks" | grep -E '_app$' | head -n 1 || true)"
if [[ -z "$api_network" ]]; then
  printf 'Unable to resolve the Stage API Docker network for k6.\n' >&2
  exit 1
fi

REPORT_DIR="$ROOT_DIR/test-results/perf/k6-stage"
mkdir -p "$REPORT_DIR"

printf 'Running k6 golden-path load test against %s (network %s)...\n' "$api_container_name" "$api_network"

set +e
docker run --rm \
  --network "$api_network" \
  -v "$ROOT_DIR/scripts/perf:/scripts:ro" \
  -v "$ROOT_DIR/docs/sample-files/multi-account-merge-test:/fixtures:ro" \
  -v "$REPORT_DIR:/results:rw" \
  -e "K6_BASE_URL=http://${api_container_name}:4000" \
  -e "K6_PROMETHEUS_RW_SERVER_URL=$K6_PROMETHEUS_RW_URL" \
  -e "K6_VUS=${K6_VUS:-}" \
  -e "K6_DURATION=${K6_DURATION:-}" \
  "$K6_IMAGE" \
  run --out experimental-prometheus-rw --summary-export /results/summary.json /scripts/k6-golden-path.js
k6_exit_code=$?
set -e

printf 'k6 summary written to %s/summary.json\n' "$REPORT_DIR"

if (( k6_exit_code != 0 )); then
  printf 'k6 reported a threshold failure or runtime error (exit %s) -- see summary above.\n' "$k6_exit_code" >&2
  exit "$k6_exit_code"
fi

printf 'k6 golden-path load test completed with no threshold failures.\n'
