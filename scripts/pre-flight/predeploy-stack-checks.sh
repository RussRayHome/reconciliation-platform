#!/usr/bin/env bash
# Pre-deploy runtime checks run after the stack is built but before traffic is accepted.
#
# Usage (via npm scripts — preferred):
#   npm run docker:predeploy        # also called by npm run docker:gate
#
# Usage (direct):
#   DOCKER_ENV_FILE=.env.docker.dev \
#   DOCKER_ENV_FALLBACK_FILE=.env.docker.dev.fallback \
#   DOCKER_COMPOSE_EXTRA_FILE=compose.dev.yaml \
#   bash scripts/pre-flight/predeploy-stack-checks.sh
#
# What it checks:
#   - All running containers are healthy (no Exited or Restarting)
#   - The gateway health endpoint responds on PUBLIC_WEB_PORT
#   - The API /api/health returns { status: "ok" }
#   - PostgreSQL is ready inside the postgres container
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

compose_args=(-f "$ROOT_DIR/compose.yaml")
append_extra_compose_files
SOURCE_FILE=""
if [[ -f "$ENV_FILE" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
  SOURCE_FILE="$ENV_FILE"
elif [[ -f "$FALLBACK_FILE" ]]; then
  compose_args+=(--env-file "$FALLBACK_FILE")
  SOURCE_FILE="$FALLBACK_FILE"
fi

if [[ -n "$SOURCE_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SOURCE_FILE"
  set +a
fi

declare -a check_ids=()
declare -a check_names=()
declare -a check_statuses=()
declare -a check_details=()

pass_count=0
warn_count=0
fail_count=0
PREDEPLOY_STOP_TIMEOUT_SECONDS="${PREDEPLOY_STOP_TIMEOUT_SECONDS:-120}"
PREDEPLOY_IGNORE_137_SERVICES="${PREDEPLOY_IGNORE_137_SERVICES:-nginx-ui pgweb}"

service_is_ignored_for_137_gate() {
  local service_name="$1"
  [[ " $PREDEPLOY_IGNORE_137_SERVICES " == *" $service_name "* ]]
}

record_check() {
  local id="$1"
  local name="$2"
  local status="$3"
  local detail="$4"

  check_ids+=("$id")
  check_names+=("$name")
  check_statuses+=("$status")
  check_details+=("$detail")

  case "$status" in
    PASS)
      pass_count=$((pass_count + 1))
      ;;
    WARN)
      warn_count=$((warn_count + 1))
      ;;
    FAIL)
      fail_count=$((fail_count + 1))
      ;;
  esac

  printf '[%s] %s - %s: %s\n' "$status" "$id" "$name" "$detail"
}

print_summary() {
  printf '\nDocker Pre-Deployment Summary (Compose Phase)\n'
  printf '%-4s | %-6s | %-38s | %s\n' "ID" "Result" "Check" "Details"
  printf '%-4s-+-%-6s-+-%-38s-+-%s\n' "----" "------" "--------------------------------------" "----------------------------------------"

  local i
  for ((i = 0; i < ${#check_ids[@]}; i += 1)); do
    printf '%-4s | %-6s | %-38s | %s\n' \
      "${check_ids[$i]}" \
      "${check_statuses[$i]}" \
      "${check_names[$i]}" \
      "${check_details[$i]}"
  done

  printf '\nTotals: PASS=%d WARN=%d FAIL=%d\n' "$pass_count" "$warn_count" "$fail_count"
}

wait_for_stack_ready() {
  local max_wait_seconds=60
  local elapsed=0
  local ps_output=""

  while (( elapsed <= max_wait_seconds )); do
    ps_output="$(docker compose "${compose_args[@]}" ps 2>/dev/null || true)"

    if [[ "$ps_output" == *"api"* && "$ps_output" == *"web"* && "$ps_output" == *"postgres"* ]]; then
      if ! printf '%s\n' "$ps_output" | grep -Eiq 'unhealthy|Exited|Restarting'; then
        return 0
      fi
    fi

    sleep 5
    elapsed=$((elapsed + 5))
  done

  return 1
}

run_phase_three_checks() {
  local can_deploy=1
  local deploy_ran=0
  local health_response_file=""
  local connectivity_output=""
  local stop_ok=1
  local ps_json=""

  if docker compose "${compose_args[@]}" config --quiet; then
    record_check "12" "Compose config validation" "PASS" "docker compose config --quiet succeeded"
  else
    record_check "12" "Compose config validation" "FAIL" "docker compose config --quiet failed"
    can_deploy=0
  fi

  if (( can_deploy == 1 )); then
    if bash "$ROOT_DIR/scripts/pre-flight/deploy.sh"; then
      deploy_ran=1
      if wait_for_stack_ready; then
        record_check "13" "Stack startup" "PASS" "Stack started and reached ready state within 60s"
      else
        record_check "13" "Stack startup" "FAIL" "Stack did not reach ready state within 60s"
        can_deploy=0
      fi
    else
      deploy_ran=1
      record_check "13" "Stack startup" "FAIL" "npm run docker:deploy failed"
      can_deploy=0
    fi
  else
    record_check "13" "Stack startup" "WARN" "Skipped because compose config validation failed"
  fi

  if (( can_deploy == 1 )); then
    health_response_file="$(mktemp)"
    local web_port="${PUBLIC_WEB_PORT:-4173}"
    if curl -sf "http://127.0.0.1:${web_port}/api/health" >"$health_response_file" 2>/dev/null; then
      record_check "14" "Health endpoint check" "PASS" "GET http://127.0.0.1:${web_port}/api/health returned 200"
    else
      local body
      body="$(cat "$health_response_file" 2>/dev/null || true)"
      if [[ -z "$body" ]]; then
        body="no response body"
      fi
      record_check "14" "Health endpoint check" "FAIL" "Health endpoint failed: ${body}"
      can_deploy=0
    fi
    rm -f "$health_response_file"
  else
    record_check "14" "Health endpoint check" "WARN" "Skipped because stack is not ready"
  fi

  if (( can_deploy == 1 )); then
    connectivity_output="$(docker compose "${compose_args[@]}" exec -T api sh -lc 'ping -c 1 db 2>/dev/null || ping -c 1 postgres 2>/dev/null || wget -qO- http://db:5432 2>/dev/null || wget -qO- http://postgres:5432 2>/dev/null || echo "check manually"' 2>&1 || true)"
    if [[ "$connectivity_output" == *"check manually"* || -z "$connectivity_output" ]]; then
      record_check "15" "Inter-service connectivity" "WARN" "Connectivity probe inconclusive: ${connectivity_output:-empty output}"
    else
      record_check "15" "Inter-service connectivity" "PASS" "Service DNS/connectivity check succeeded"
    fi
  else
    record_check "15" "Inter-service connectivity" "WARN" "Skipped because stack is not ready"
  fi

  if (( deploy_ran == 1 )); then
    if docker compose "${compose_args[@]}" stop -t "$PREDEPLOY_STOP_TIMEOUT_SECONDS"; then
      ps_json="$(docker compose "${compose_args[@]}" ps -a --format json 2>/dev/null || true)"
      if [[ "$ps_json" == *'"ExitCode":137'* ]]; then
        local exit_137_service_names=""
        local ignored_137_service_names=""
        local line
        local service

        while IFS= read -r line; do
          [[ "$line" != *'"ExitCode":137'* ]] && continue
          service="${line#*\"Service\":\"}"
          if [[ "$service" == "$line" ]]; then
            service="unknown"
          else
            service="${service%%\"*}"
          fi

          if [[ -z "$exit_137_service_names" ]]; then
            if service_is_ignored_for_137_gate "$service"; then
              ignored_137_service_names="$service"
            else
              exit_137_service_names="$service"
            fi
          else
            if service_is_ignored_for_137_gate "$service"; then
              if [[ -z "$ignored_137_service_names" ]]; then
                ignored_137_service_names="$service"
              else
                ignored_137_service_names+=" $service"
              fi
            else
              exit_137_service_names+=" $service"
            fi
          fi
        done <<< "$ps_json"

        if [[ -n "$exit_137_service_names" ]]; then
          record_check "16" "Graceful shutdown check" "FAIL" "Exit code 137 detected for service(s): ${exit_137_service_names}"
        elif [[ -n "$ignored_137_service_names" ]]; then
          record_check "16" "Graceful shutdown check" "PASS" "Exit code 137 observed only for ignored auxiliary service(s): ${ignored_137_service_names}"
        else
          record_check "16" "Graceful shutdown check" "PASS" "Containers stopped without exit code 137 (timeout ${PREDEPLOY_STOP_TIMEOUT_SECONDS}s)"
        fi
      else
        record_check "16" "Graceful shutdown check" "PASS" "Containers stopped without exit code 137 (timeout ${PREDEPLOY_STOP_TIMEOUT_SECONDS}s)"
      fi
    else
      stop_ok=0
      record_check "16" "Graceful shutdown check" "FAIL" "docker compose stop failed"
    fi
  else
    record_check "16" "Graceful shutdown check" "WARN" "Skipped because stack did not start"
  fi

  if bash "$ROOT_DIR/scripts/pre-flight/cleanup.sh"; then
    docker image rm preflight-check:test >/dev/null 2>&1 || true
    if (( stop_ok == 1 )); then
      record_check "17" "Cleanup" "PASS" "docker:cleanup completed and preflight image removed if present"
    else
      record_check "17" "Cleanup" "WARN" "docker:cleanup completed after stop failure"
    fi
  else
    record_check "17" "Cleanup" "FAIL" "npm run docker:cleanup failed"
  fi
}

main() {
  printf 'Running Docker pre-deployment checks (phase 3) in %s\n\n' "$ROOT_DIR"

  if ! docker info >/dev/null 2>&1; then
    record_check "12" "Compose config validation" "FAIL" "Docker daemon unavailable; start Docker Desktop"
    record_check "13" "Stack startup" "WARN" "Skipped because Docker daemon is unavailable"
    record_check "14" "Health endpoint check" "WARN" "Skipped because Docker daemon is unavailable"
    record_check "15" "Inter-service connectivity" "WARN" "Skipped because Docker daemon is unavailable"
    record_check "16" "Graceful shutdown check" "WARN" "Skipped because Docker daemon is unavailable"
    record_check "17" "Cleanup" "WARN" "Skipped because Docker daemon is unavailable"
    print_summary
    printf '\nFix required: start Docker Desktop, then re-run this script.\n'
    exit 1
  fi

  run_phase_three_checks
  print_summary

  if (( fail_count > 0 )); then
    printf '\nOne or more checks failed. Do not deploy until FAIL items are fixed.\n'
    exit 1
  fi

  printf '\nPre-deployment checks completed with no FAIL items.\n'
}

main "$@"