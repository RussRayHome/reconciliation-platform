#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE_INPUT="${DOCKER_ENV_FILE:-${DOCKER_COMPOSE_ENV_FILE:-$ROOT_DIR/.env.docker.dev}}"
if [[ "$ENV_FILE_INPUT" = /* ]]; then
  ENV_FILE="$ENV_FILE_INPUT"
else
  ENV_FILE="$ROOT_DIR/${ENV_FILE_INPUT#./}"
fi
FALLBACK_FILE="$ROOT_DIR/.env.docker.dev.example"

compose_args=(-f "$ROOT_DIR/compose.yaml")
if [[ -f "$ENV_FILE" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
elif [[ -f "$FALLBACK_FILE" ]]; then
  compose_args+=(--env-file "$FALLBACK_FILE")
fi

compose_project_name="${COMPOSE_PROJECT_NAME:-reconciliation-platform}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  compose_project_name="${COMPOSE_PROJECT_NAME:-$compose_project_name}"
elif [[ -f "$FALLBACK_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$FALLBACK_FILE"
  set +a
  compose_project_name="${COMPOSE_PROJECT_NAME:-$compose_project_name}"
fi

declare -a check_ids=()
declare -a check_names=()
declare -a check_statuses=()
declare -a check_details=()

pass_count=0
warn_count=0
fail_count=0

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

print_last_lines() {
  local file_path="$1"
  local max_lines="$2"
  local -a lines=()
  local line

  while IFS= read -r line || [[ -n "$line" ]]; do
    lines+=("$line")
    if (( ${#lines[@]} > max_lines )); then
      lines=("${lines[@]:1}")
    fi
  done <"$file_path"

  for line in "${lines[@]}"; do
    printf '%s\n' "$line"
  done
}

print_summary() {
  printf '\nDocker Pre-Flight Summary (Build Phase)\n'
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

abort_if_daemon_missing() {
  local tmp
  tmp="$(mktemp)"

  if docker info >"$tmp" 2>&1; then
    record_check "1" "Docker daemon running" "PASS" "docker info succeeded"
    rm -f "$tmp"
    return
  fi

  record_check "1" "Docker daemon running" "FAIL" "docker info failed; start Docker Desktop and retry"
  printf '\nDocker daemon output:\n'
  cat "$tmp"
  rm -f "$tmp"
  print_summary
  printf '\nFix required: start Docker Desktop, then re-run this script.\n'
  exit 1
}

check_dockerignore_completeness() {
  local -a files=()
  local file
  local missing
  local details=""

  while IFS= read -r file; do
    [[ -n "$file" ]] && files+=("$file")
  done < <(find "$ROOT_DIR" -name ".dockerignore" -not -path "*/node_modules/*" 2>/dev/null || true)

  if (( ${#files[@]} == 0 )); then
    record_check "2" ".dockerignore completeness" "WARN" "No .dockerignore file found"
    return
  fi

  for file in "${files[@]}"; do
    missing=()
    grep -Eq '^[[:space:]]*\.env(\*|$)|/\.env' "$file" || missing+=(".env")
    grep -Eq 'node_modules' "$file" || missing+=("node_modules")
    grep -Eq '(^|/)\.git(/|$)' "$file" || missing+=(".git")
    grep -Eq '(^|/)dist(/|$)' "$file" || missing+=("dist")
    grep -Eq '(^|/)coverage(/|$)' "$file" || missing+=("coverage")
    grep -Eq '\*\.log|\.log' "$file" || missing+=("*.log")

    if (( ${#missing[@]} > 0 )); then
      local rel
      rel="${file#"$ROOT_DIR/"}"
      if [[ -n "$details" ]]; then
        details+="; "
      fi
      details+="${rel} missing ${missing[*]}"
    fi
  done

  if [[ -n "$details" ]]; then
    record_check "2" ".dockerignore completeness" "WARN" "$details"
  else
    record_check "2" ".dockerignore completeness" "PASS" "All required entries present"
  fi
}

check_dockerfile_linting() {
  local -a dockerfiles=()
  local file
  local lint_failures=0
  local lint_warnings=0
  local details=""
  local output_file
  local has_hadolint=0

  while IFS= read -r file; do
    [[ -n "$file" ]] && dockerfiles+=("$file")
  done < <(find "$ROOT_DIR" -name "Dockerfile*" -not -path "*/node_modules/*" 2>/dev/null || true)

  if (( ${#dockerfiles[@]} == 0 )); then
    record_check "3" "Dockerfile linting" "WARN" "No Dockerfile found"
    return
  fi

  if command -v hadolint >/dev/null 2>&1; then
    has_hadolint=1
  fi

  for file in "${dockerfiles[@]}"; do
    output_file="$(mktemp)"

    if (( has_hadolint == 1 )); then
      hadolint "$file" >"$output_file" 2>&1 || true
    else
      docker run --rm -i hadolint/hadolint <"$file" >"$output_file" 2>&1 || true
    fi

    if grep -Eiq '\berror\b' "$output_file"; then
      lint_failures=$((lint_failures + 1))
      if [[ -z "$details" ]]; then
        details="${file#"$ROOT_DIR/"}: error findings"
      fi
    elif grep -Eiq '\bwarning\b' "$output_file"; then
      lint_warnings=$((lint_warnings + 1))
      if [[ -z "$details" ]]; then
        details="${file#"$ROOT_DIR/"}: warning findings"
      fi
    fi

    rm -f "$output_file"
  done

  if (( lint_failures > 0 )); then
    record_check "3" "Dockerfile linting" "FAIL" "$details"
  elif (( lint_warnings > 0 )); then
    record_check "3" "Dockerfile linting" "WARN" "$details"
  else
    if (( has_hadolint == 1 )); then
      record_check "3" "Dockerfile linting" "PASS" "hadolint found no warnings/errors"
    else
      record_check "3" "Dockerfile linting" "PASS" "hadolint container found no warnings/errors"
    fi
  fi
}

check_secret_scan() {
  local matches
  local hardcoded_count=0
  local first_hardcoded=""
  local line
  local content

  matches="$(grep -rn "password\|secret\|api_key\|private_key\|token" \
    --include="Dockerfile*" \
    --include="docker-compose*.yml" \
    --include="docker-compose*.yaml" \
    --include="compose*.yml" \
    --include="compose*.yaml" \
    -i "$ROOT_DIR" 2>/dev/null || true)"

  if [[ -z "$matches" ]]; then
    record_check "4" "Secret scan" "PASS" "No secret-like patterns found"
    return
  fi

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    content="${line#*:}"
    content="${content#*:}"

    if [[ "$content" == *'${'* ]]; then
      continue
    fi

    if printf '%s\n' "$content" | grep -Eiq '(password|secret|api_key|private_key|token)'; then
      hardcoded_count=$((hardcoded_count + 1))
      if [[ -z "$first_hardcoded" ]]; then
        first_hardcoded="${line#"$ROOT_DIR/"}"
      fi
    fi
  done <<< "$matches"

  if (( hardcoded_count > 0 )); then
    record_check "4" "Secret scan" "FAIL" "Potential hardcoded secret lines: ${hardcoded_count}; first hit ${first_hardcoded}"
  else
    record_check "4" "Secret scan" "WARN" "Keyword hits found, but all appear to use env interpolation"
  fi
}

check_port_conflicts() {
  local listeners

  listeners="$(lsof -i :4000 -i :4173 -i :5432 -i :5173 2>/dev/null | grep LISTEN || true)"
  if [[ -n "$listeners" ]]; then
    local first_line
    first_line="$(printf '%s\n' "$listeners" | grep -m1 . || true)"
    record_check "5" "Port conflict check" "FAIL" "Ports in use; first listener: ${first_line}"
  else
    record_check "5" "Port conflict check" "PASS" "Ports 4000, 4173, 5432, and 5173 are free"
  fi
}

check_required_env_file() {
  if [[ -f "$ROOT_DIR/.env.docker" ]]; then
    record_check "6" "Required environment file" "PASS" ".env.docker exists"
  elif [[ -f "$ROOT_DIR/.env.docker.dev.example" ]]; then
    record_check "6" "Required environment file" "WARN" "Only .env.docker.dev.example exists; run cp .env.docker.dev.example .env.docker"
  else
    record_check "6" "Required environment file" "WARN" "Neither .env.docker nor .env.docker.dev.example exists"
  fi
}

build_image_and_detect_target() {
  local build_log
  local build_output_status=0
  local built_image_ref=""
  local size_bytes=""
  local size_mb=0
  local whoami_result=""
  local trivy_output=""
  local critical_count=0
  local high_count=0
  local count_line

  build_log="$(mktemp)"

  if [[ -f "$ROOT_DIR/Dockerfile" ]]; then
    if docker build --no-cache -t preflight-check:test "$ROOT_DIR" >"$build_log" 2>&1; then
      record_check "7" "Build Docker image" "PASS" "Built preflight-check:test"
      built_image_ref="preflight-check:test"
    else
      build_output_status=1
      record_check "7" "Build Docker image" "FAIL" "docker build failed"
    fi
  else
    if docker compose "${compose_args[@]}" build >"$build_log" 2>&1; then
      built_image_ref="${compose_project_name}-api:latest"

      if ! docker image inspect "$built_image_ref" >/dev/null 2>&1; then
        built_image_ref="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^${compose_project_name}-api:" | grep -m1 . || true)"
      fi

      if [[ -z "$built_image_ref" ]]; then
        built_image_ref="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^${compose_project_name}-" | grep -m1 . || true)"
      fi

      if [[ -z "$built_image_ref" ]]; then
        record_check "7" "Build Docker image" "FAIL" "docker compose build succeeded but no image ID was resolved"
        build_output_status=1
      else
        record_check "7" "Build Docker image" "PASS" "docker compose build succeeded (image ${built_image_ref:0:12})"
      fi
    else
      build_output_status=1
      record_check "7" "Build Docker image" "FAIL" "docker compose build failed"
    fi
  fi

  if (( build_output_status == 1 )); then
    printf '\nLast 20 lines of build output:\n'
    print_last_lines "$build_log" 20
    record_check "8" "Image size check" "WARN" "Skipped due to build failure"
    record_check "9" "Non-root user check" "WARN" "Skipped due to build failure"
    record_check "10" "Dev dependency leak check" "WARN" "Skipped due to build failure"
    record_check "11" "Security vulnerability scan" "WARN" "Skipped due to build failure"
    rm -f "$build_log"
    return
  fi

  size_bytes="$(docker image inspect "$built_image_ref" --format='{{.Size}}' 2>/dev/null || true)"
  if [[ -z "$size_bytes" ]]; then
    record_check "8" "Image size check" "FAIL" "Unable to inspect image size"
  else
    size_mb=$((size_bytes / 1024 / 1024))
    if (( size_mb < 300 )); then
      record_check "8" "Image size check" "PASS" "${size_mb} MB"
    elif (( size_mb <= 600 )); then
      record_check "8" "Image size check" "WARN" "${size_mb} MB (consider multi-stage optimization)"
    else
      record_check "8" "Image size check" "FAIL" "${size_mb} MB exceeds 600 MB"
    fi
  fi

  whoami_result="$(docker run --rm "$built_image_ref" whoami 2>/dev/null || true)"
  if [[ -z "$whoami_result" ]]; then
    record_check "9" "Non-root user check" "WARN" "Unable to determine runtime user"
  elif [[ "$whoami_result" == "root" ]]; then
    record_check "9" "Non-root user check" "WARN" "Container runs as root; add USER directive"
  else
    record_check "9" "Non-root user check" "PASS" "Container runs as ${whoami_result}"
  fi

  if docker run --rm "$built_image_ref" ls node_modules/.bin/vitest >/dev/null 2>&1; then
    record_check "10" "Dev dependency leak check" "FAIL" "vitest binary exists inside runtime image"
  else
    record_check "10" "Dev dependency leak check" "PASS" "No vitest binary found in runtime image"
  fi

  if command -v trivy >/dev/null 2>&1; then
    trivy_output="$(trivy image --exit-code 0 --severity HIGH,CRITICAL "$built_image_ref" 2>&1 || true)"

    while IFS= read -r count_line; do
      [[ -z "$count_line" ]] && continue
      critical_count=$((critical_count + ${count_line##* }))
    done < <(printf '%s\n' "$trivy_output" | grep -Eo 'CRITICAL: [0-9]+' || true)

    while IFS= read -r count_line; do
      [[ -z "$count_line" ]] && continue
      high_count=$((high_count + ${count_line##* }))
    done < <(printf '%s\n' "$trivy_output" | grep -Eo 'HIGH: [0-9]+' || true)

    if (( critical_count > 0 )); then
      record_check "11" "Security vulnerability scan" "FAIL" "CRITICAL=${critical_count}, HIGH=${high_count}"
    elif (( high_count > 0 )); then
      record_check "11" "Security vulnerability scan" "WARN" "CRITICAL=0, HIGH=${high_count}"
    else
      record_check "11" "Security vulnerability scan" "PASS" "No HIGH/CRITICAL vulnerabilities detected"
    fi
  else
    if docker scout cves "$built_image_ref" >/dev/null 2>&1; then
      record_check "11" "Security vulnerability scan" "WARN" "Trivy missing; docker scout cves executed without severity gating"
    else
      record_check "11" "Security vulnerability scan" "WARN" "Skipping CVE scan; install Trivy"
    fi
  fi

  rm -f "$build_log"
}

main() {
  printf 'Running Docker pre-flight checks (phases 1-2) in %s\n\n' "$ROOT_DIR"

  abort_if_daemon_missing
  check_dockerignore_completeness
  check_dockerfile_linting
  check_secret_scan
  check_port_conflicts
  check_required_env_file
  build_image_and_detect_target

  print_summary

  if (( fail_count > 0 )); then
    printf '\nOne or more checks failed. Fix FAIL items before deployment.\n'
    exit 1
  fi

  printf '\nPre-flight checks completed with no FAIL items.\n'
}

main "$@"