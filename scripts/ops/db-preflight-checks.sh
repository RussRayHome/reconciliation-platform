#!/usr/bin/env bash
# Comprehensive PostgreSQL pre-flight check suite run before database-touching deployments.
#
# Usage (via npm scripts — preferred):
#   npm run docker:db:preflight          # dev environment
#   npm run docker:db:preflight:stage    # stage environment
#
# Usage (direct):
#   DOCKER_ENV_FILE=.env.docker.dev \
#   DOCKER_ENV_FALLBACK_FILE=.env.docker.dev.example \
#   DOCKER_COMPOSE_EXTRA_FILE=compose.dev.yaml \
#   bash scripts/ops/db-preflight-checks.sh
#
# Checks run (in order):
#   DB1  — Docker daemon available
#   DB2  — Environment file resolves and required variables are set
#   DB3  — Postgres container starts (docker compose up -d postgres)
#   DB4  — Postgres readiness (pg_isready)
#   DB10 — Postgres image vulnerability scan (trivy, if available)
#   DB11 — pgAudit extension enabled
#   DB12 — Expected database users exist (rray for dev/stage)
#   DB13 — User role attributes correct (SUPERUSER, CREATEDB, CREATEROLE, LOGIN)
#   DB5  — schema_migrations tracking table exists
#   DB6  — All migration patches applied
#   DB7  — Core tables present
#   DB8  — Required indexes and constraints present
#   DB9  — Transactional DDL/DML/procedure sweep (BEGIN…ROLLBACK)
#   DB14 — User database and table privileges correct
#
# Exits 0 if no FAIL items; exits 1 if any check fails.
# WARN items are recorded but do not cause a non-zero exit.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE_INPUT="${DOCKER_ENV_FILE:-${DOCKER_COMPOSE_ENV_FILE:-$ROOT_DIR/.env.docker.dev}}"
if [[ "$ENV_FILE_INPUT" = /* ]]; then
  ENV_FILE="$ENV_FILE_INPUT"
else
  ENV_FILE="$ROOT_DIR/${ENV_FILE_INPUT#./}"
fi
FALLBACK_FILE="${DOCKER_ENV_FALLBACK_FILE:-$ROOT_DIR/.env.docker.dev.example}"

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
  SOURCE_FILE="$ENV_FILE"
elif [[ -f "$FALLBACK_FILE" ]]; then
  compose_args+=(--env-file "$FALLBACK_FILE")
  SOURCE_FILE="$FALLBACK_FILE"
else
  SOURCE_FILE=""
fi

declare -a check_ids=()
declare -a check_names=()
declare -a check_statuses=()
declare -a check_details=()

pass_count=0
warn_count=0
fail_count=0

POSTGRES_USER=""
POSTGRES_DB=""
DB_PREFLIGHT_FAIL_ON_CRITICAL="${DB_PREFLIGHT_FAIL_ON_CRITICAL:-true}"
DB_PREFLIGHT_FAIL_ON_HIGH="${DB_PREFLIGHT_FAIL_ON_HIGH:-false}"
DB_PREFLIGHT_CVE_ALLOWLIST_FILE="${DB_PREFLIGHT_CVE_ALLOWLIST_FILE:-$ROOT_DIR/scripts/ops/db-cve-allowlist.txt}"

normalize_bool() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

is_truthy() {
  case "$(normalize_bool "$1")" in
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

is_valid_iso_date() {
  local value="$1"
  [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]
}

ALLOWLIST_MATCH_DETAIL=""

is_cve_allowlisted() {
  local cve_id="$1"
  local today_utc="$2"
  local allowed_id
  local allowed_until
  local allowed_reason

  ALLOWLIST_MATCH_DETAIL=""

  if [[ ! -f "$DB_PREFLIGHT_CVE_ALLOWLIST_FILE" ]]; then
    return 1
  fi

  while IFS='|' read -r allowed_id allowed_until allowed_reason; do
    allowed_id="$(trim_whitespace "${allowed_id:-}")"
    allowed_until="$(trim_whitespace "${allowed_until:-}")"
    allowed_reason="$(trim_whitespace "${allowed_reason:-}")"

    if [[ -z "$allowed_id" || "$allowed_id" == \#* ]]; then
      continue
    fi

    if [[ "$allowed_id" != "$cve_id" ]]; then
      continue
    fi

    if [[ -n "$allowed_until" ]]; then
      if ! is_valid_iso_date "$allowed_until"; then
        continue
      fi

      if [[ "$allowed_until" < "$today_utc" ]]; then
        continue
      fi
    fi

    ALLOWLIST_MATCH_DETAIL="$allowed_id"
    if [[ -n "$allowed_until" ]]; then
      ALLOWLIST_MATCH_DETAIL+=" until $allowed_until"
    fi
    if [[ -n "$allowed_reason" ]]; then
      ALLOWLIST_MATCH_DETAIL+=" ($allowed_reason)"
    fi

    return 0
  done < "$DB_PREFLIGHT_CVE_ALLOWLIST_FILE"

  return 1
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
  printf '\nDatabase Preflight Summary\n'
  printf '%-4s | %-6s | %-42s | %s\n' "ID" "Result" "Check" "Details"
  printf '%-4s-+-%-6s-+-%-42s-+-%s\n' "----" "------" "------------------------------------------" "----------------------------------------"

  local i
  for ((i = 0; i < ${#check_ids[@]}; i += 1)); do
    printf '%-4s | %-6s | %-42s | %s\n' \
      "${check_ids[$i]}" \
      "${check_statuses[$i]}" \
      "${check_names[$i]}" \
      "${check_details[$i]}"
  done

  printf '\nTotals: PASS=%d WARN=%d FAIL=%d\n' "$pass_count" "$warn_count" "$fail_count"
}

run_psql_query() {
  local sql="$1"
  docker compose "${compose_args[@]}" exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$sql"
}

source_environment() {
  if [[ -z "$SOURCE_FILE" ]]; then
    record_check "DB2" "Environment file resolution" "FAIL" "Missing $ENV_FILE and $FALLBACK_FILE"
    return 1
  fi

  bash "$ROOT_DIR/scripts/ops/validate-env.sh" >/dev/null

  set -a
  # shellcheck disable=SC1090
  source "$SOURCE_FILE"
  set +a

  POSTGRES_USER="${POSTGRES_USER:-}"
  POSTGRES_DB="${POSTGRES_DB:-}"

  if [[ -z "$POSTGRES_USER" || -z "$POSTGRES_DB" ]]; then
    record_check "DB2" "Environment file resolution" "FAIL" "POSTGRES_USER or POSTGRES_DB is empty"
    return 1
  fi

  record_check "DB2" "Environment file resolution" "PASS" "Using $(basename "$SOURCE_FILE")"
  return 0
}

check_docker_daemon() {
  if docker info >/dev/null 2>&1; then
    record_check "DB1" "Docker daemon availability" "PASS" "docker info succeeded"
    return 0
  fi

  record_check "DB1" "Docker daemon availability" "FAIL" "docker info failed; start Docker Desktop"
  return 1
}

ensure_postgres_running() {
  if docker compose "${compose_args[@]}" up -d postgres >/dev/null 2>&1; then
    record_check "DB3" "Postgres service startup" "PASS" "postgres container is running"
  else
    record_check "DB3" "Postgres service startup" "FAIL" "Unable to start postgres service"
    return 1
  fi

  local ready=0
  local retry_count=0
  while (( retry_count < 30 )); do
    if docker compose "${compose_args[@]}" exec -T postgres \
      pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      ready=1
      break
    fi
    retry_count=$((retry_count + 1))
    sleep 2
  done

  if (( ready == 1 )); then
    record_check "DB4" "Postgres readiness" "PASS" "pg_isready reported ready"
    return 0
  fi

  record_check "DB4" "Postgres readiness" "FAIL" "postgres did not become ready within 60s"
  return 1
}

check_schema_migration_table() {
  local exists
  exists="$(run_psql_query "SELECT to_regclass('public.schema_migrations') IS NOT NULL;")"
  if [[ "$exists" == "t" ]]; then
    record_check "DB5" "Migration tracking table" "PASS" "schema_migrations exists"
    return 0
  fi

  record_check "DB5" "Migration tracking table" "FAIL" "schema_migrations is missing"
  return 1
}

check_patch_versions() {
  local -a expected_versions=()
  local -a applied_versions=()
  local -a missing_versions=()
  local -a extra_versions=()
  local version

  while IFS= read -r version; do
    [[ -n "$version" ]] && expected_versions+=("$version")
  done < <(
    grep -E '^[[:space:]]*version:[[:space:]]*[0-9]+,' "$ROOT_DIR/packages/persistence/src/schema.ts" \
      | sed -E 's/.*version:[[:space:]]*([0-9]+),/\1/' \
      | sort -n -u
  )

  while IFS= read -r version; do
    [[ -n "$version" ]] && applied_versions+=("$version")
  done < <(run_psql_query "SELECT version FROM schema_migrations ORDER BY version ASC;")

  if (( ${#expected_versions[@]} == 0 )); then
    record_check "DB6" "Patch version discovery" "FAIL" "No expected migration versions found in schema.ts"
    return 1
  fi

  for version in "${expected_versions[@]}"; do
    if ! printf '%s\n' "${applied_versions[@]}" | grep -Fxq "$version"; then
      missing_versions+=("$version")
    fi
  done

  for version in "${applied_versions[@]}"; do
    if ! printf '%s\n' "${expected_versions[@]}" | grep -Fxq "$version"; then
      extra_versions+=("$version")
    fi
  done

  if (( ${#missing_versions[@]} > 0 )); then
    record_check "DB6" "Patch coverage" "FAIL" "Missing migration versions: ${missing_versions[*]}"
    return 1
  fi

  if (( ${#extra_versions[@]} > 0 )); then
    record_check "DB6" "Patch coverage" "FAIL" "Unexpected migration versions in DB: ${extra_versions[*]}"
    return 1
  fi

  record_check "DB6" "Patch coverage" "PASS" "All ${#expected_versions[@]} migration versions are installed"
  return 0
}

check_core_tables() {
  local required_table_sql
  local expected_count
  local actual_count

  required_table_sql="'reconciliation_job','reconciliation_source_file','reconciliation_import_batch','reconciliation_raw_row','reconciliation_canonical_row','reconciliation_match_group','reconciliation_match_result','reconciliation_rule_result','reconciliation_exception','reconciliation_review_observation','reconciliation_job_summary','reconciliation_export','reconciliation_review_decision','reconciliation_audit_event'"
  expected_count=14
  actual_count="$(run_psql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN (${required_table_sql});")"

  if [[ "$actual_count" == "$expected_count" ]]; then
    record_check "DB7" "Core table sweep" "PASS" "Verified ${actual_count}/${expected_count} required tables"
    return 0
  fi

  record_check "DB7" "Core table sweep" "FAIL" "Verified ${actual_count}/${expected_count} required tables"
  return 1
}

check_indexes_and_constraints() {
  local required_index_sql
  local required_fk_sql
  local expected_indexes
  local expected_fks
  local actual_indexes
  local actual_fks

  required_index_sql="'reconciliation_job_state_idx','reconciliation_match_result_job_idx','reconciliation_exception_job_idx','reconciliation_review_decision_job_idx','reconciliation_audit_event_job_idx','reconciliation_job_completed_report_idx','reconciliation_match_result_job_result_bucket_created_idx','reconciliation_exception_job_line_order_idx'"
  required_fk_sql="'reconciliation_match_result_bank_transaction_fk','reconciliation_match_result_qbo_transaction_fk','reconciliation_rule_result_candidate_transaction_fk','reconciliation_exception_canonical_row_fk'"

  expected_indexes=8
  expected_fks=4

  actual_indexes="$(run_psql_query "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN (${required_index_sql});")"
  actual_fks="$(run_psql_query "SELECT COUNT(*) FROM pg_constraint WHERE conname IN (${required_fk_sql});")"

  if [[ "$actual_indexes" != "$expected_indexes" ]]; then
    record_check "DB8" "Index sweep" "FAIL" "Verified ${actual_indexes}/${expected_indexes} required indexes"
    return 1
  fi

  if [[ "$actual_fks" != "$expected_fks" ]]; then
    record_check "DB8" "Index sweep" "FAIL" "Verified ${actual_fks}/${expected_fks} required foreign keys"
    return 1
  fi

  record_check "DB8" "Index sweep" "PASS" "Verified ${actual_indexes} indexes and ${actual_fks} foreign keys"
  return 0
}

check_postgres_security_vulnerabilities() {
  local postgres_version
  local container_id
  local image_ref
  local today_utc
  local trivy_json
  local trivy_output=""
  local critical_count=0
  local high_count=0
  local allowlisted_count=0
  local allowlisted_ids=""
  local allowlisted_details=""
  local detail
  local cve_id
  local severity
  local count_line

  postgres_version="$(run_psql_query "SHOW server_version;" | head -n 1)"
  container_id="$(docker compose "${compose_args[@]}" ps -q postgres | head -n 1)"

  if [[ -z "$container_id" ]]; then
    record_check "DB10" "Postgres vulnerability scan" "FAIL" "Unable to resolve postgres container ID"
    return 1
  fi

  image_ref="$(docker inspect --format '{{.Image}}' "$container_id" 2>/dev/null || true)"
  if [[ -z "$image_ref" ]]; then
    record_check "DB10" "Postgres vulnerability scan" "FAIL" "Unable to resolve postgres image ID"
    return 1
  fi

  if command -v trivy >/dev/null 2>&1; then
    if command -v jq >/dev/null 2>&1; then
      today_utc="$(date -u +%F)"
      trivy_json="$(mktemp)"
      trivy image --scanners vuln --severity HIGH,CRITICAL --format json "$image_ref" >"$trivy_json" 2>/dev/null || true

      while IFS=$'\t' read -r cve_id severity; do
        [[ -z "$cve_id" || -z "$severity" ]] && continue

        if is_cve_allowlisted "$cve_id" "$today_utc"; then
          if ! printf '%s\n' "$allowlisted_ids" | grep -Fxq "$cve_id"; then
            allowlisted_ids+="$cve_id"$'\n'
            allowlisted_count=$((allowlisted_count + 1))
          fi

          if [[ -n "$ALLOWLIST_MATCH_DETAIL" ]] && ! printf '%s\n' "$allowlisted_details" | grep -Fxq "$ALLOWLIST_MATCH_DETAIL"; then
            allowlisted_details+="$ALLOWLIST_MATCH_DETAIL"$'\n'
          fi

          continue
        fi

        case "$severity" in
          CRITICAL)
            critical_count=$((critical_count + 1))
            ;;
          HIGH)
            high_count=$((high_count + 1))
            ;;
        esac
      done < <(
        jq -r '.Results[] as $r | $r.Vulnerabilities[]? | select(.Severity=="CRITICAL" or .Severity=="HIGH") | [.VulnerabilityID, .Severity] | @tsv' "$trivy_json"
      )

      rm -f "$trivy_json"

      detail="PostgreSQL ${postgres_version}: CRITICAL=${critical_count}, HIGH=${high_count}"
      if (( allowlisted_count > 0 )); then
        detail+="; ALLOWLISTED=${allowlisted_count}"
      fi

      if (( critical_count > 0 )); then
        if is_truthy "$DB_PREFLIGHT_FAIL_ON_CRITICAL"; then
          record_check "DB10" "Postgres vulnerability scan" "FAIL" "$detail"
          return 1
        fi

        record_check "DB10" "Postgres vulnerability scan" "WARN" "$detail (gate override)"
        return 0
      fi

      if (( high_count > 0 )); then
        if is_truthy "$DB_PREFLIGHT_FAIL_ON_HIGH"; then
          record_check "DB10" "Postgres vulnerability scan" "FAIL" "$detail"
          return 1
        fi

        record_check "DB10" "Postgres vulnerability scan" "WARN" "$detail"
        return 0
      fi

      if (( allowlisted_count > 0 )); then
        record_check "DB10" "Postgres vulnerability scan" "WARN" "$detail (temporary allowlist active: $(basename "$DB_PREFLIGHT_CVE_ALLOWLIST_FILE"))"
        return 0
      fi

      record_check "DB10" "Postgres vulnerability scan" "PASS" "PostgreSQL ${postgres_version}: No HIGH/CRITICAL vulnerabilities detected"
      return 0
    fi

    trivy_output="$(trivy image --exit-code 0 --severity HIGH,CRITICAL "$image_ref" 2>&1 || true)"

    while IFS= read -r count_line; do
      [[ -z "$count_line" ]] && continue
      critical_count=$((critical_count + ${count_line##* }))
    done < <(printf '%s\n' "$trivy_output" | grep -Eo 'CRITICAL: [0-9]+' || true)

    while IFS= read -r count_line; do
      [[ -z "$count_line" ]] && continue
      high_count=$((high_count + ${count_line##* }))
    done < <(printf '%s\n' "$trivy_output" | grep -Eo 'HIGH: [0-9]+' || true)

    if (( critical_count > 0 )); then
      if is_truthy "$DB_PREFLIGHT_FAIL_ON_CRITICAL"; then
        record_check "DB10" "Postgres vulnerability scan" "FAIL" "PostgreSQL ${postgres_version}: CRITICAL=${critical_count}, HIGH=${high_count}"
        return 1
      fi

      record_check "DB10" "Postgres vulnerability scan" "WARN" "PostgreSQL ${postgres_version}: CRITICAL=${critical_count}, HIGH=${high_count} (gate override)"
      return 0
    fi

    if (( high_count > 0 )); then
      if is_truthy "$DB_PREFLIGHT_FAIL_ON_HIGH"; then
        record_check "DB10" "Postgres vulnerability scan" "FAIL" "PostgreSQL ${postgres_version}: CRITICAL=0, HIGH=${high_count}"
        return 1
      fi

      record_check "DB10" "Postgres vulnerability scan" "WARN" "PostgreSQL ${postgres_version}: CRITICAL=0, HIGH=${high_count}"
      return 0
    fi

    record_check "DB10" "Postgres vulnerability scan" "PASS" "PostgreSQL ${postgres_version}: No HIGH/CRITICAL vulnerabilities detected"
    return 0
  fi

  if docker scout cves "$image_ref" >/dev/null 2>&1; then
    record_check "DB10" "Postgres vulnerability scan" "WARN" "PostgreSQL ${postgres_version}: Trivy missing; docker scout executed without severity gating"
  else
    record_check "DB10" "Postgres vulnerability scan" "WARN" "PostgreSQL ${postgres_version}: Trivy not installed; known vulnerability scan skipped"
  fi

  return 0
}

check_pgaudit_enabled() {
  local extension_enabled

  extension_enabled="$(run_psql_query "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgaudit');")"

  if [[ "$extension_enabled" == "t" ]]; then
    record_check "DB11" "pgAudit extension" "PASS" "pgAudit is enabled"
    return 0
  fi

  record_check "DB11" "pgAudit extension" "FAIL" "pgAudit is not enabled"
  return 1
}

get_expected_dev_stage_users() {
  printf 'rray\n'
}

check_expected_users_exist() {
  local missing_users=()
  local username

  while IFS= read -r username; do
    [[ -z "$username" ]] && continue
    local exists
    exists="$(run_psql_query "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$username' AND rolcanlogin = true);")"
    if [[ "$exists" != "t" ]]; then
      missing_users+=("$username")
    fi
  done < <(get_expected_dev_stage_users)

  if (( ${#missing_users[@]} == 0 )); then
    record_check "DB12" "Expected database users" "PASS" "All expected users exist with LOGIN"
    return 0
  fi

  record_check "DB12" "Expected database users" "FAIL" "Missing: ${missing_users[*]} — run: bash scripts/db/run-users.sh <dev|stage>"
  return 1
}

check_user_role_attributes() {
  local bad_users=()
  local username

  while IFS= read -r username; do
    [[ -z "$username" ]] && continue
    local attrs
    attrs="$(run_psql_query "SELECT rolsuper::text || '|' || rolcreatedb::text || '|' || rolcreaterole::text || '|' || rolcanlogin::text FROM pg_roles WHERE rolname = '$username';")"
    if [[ "$attrs" != "t|t|t|t" ]]; then
      bad_users+=("$username (got: $attrs)")
    fi
  done < <(get_expected_dev_stage_users)

  if (( ${#bad_users[@]} == 0 )); then
    record_check "DB13" "User role attributes" "PASS" "All expected users have SUPERUSER, CREATEDB, CREATEROLE, LOGIN"
    return 0
  fi

  record_check "DB13" "User role attributes" "FAIL" "Attribute mismatch: ${bad_users[*]}"
  return 1
}

check_user_database_privileges() {
  local failures=()
  local username

  while IFS= read -r username; do
    [[ -z "$username" ]] && continue

    local db_connect schema_usage
    db_connect="$(run_psql_query "SELECT has_database_privilege('$username', current_database(), 'CONNECT');")"
    schema_usage="$(run_psql_query "SELECT has_schema_privilege('$username', 'public', 'USAGE');")"

    if [[ "$db_connect" != "t" ]]; then
      failures+=("$username: missing CONNECT on database")
    fi
    if [[ "$schema_usage" != "t" ]]; then
      failures+=("$username: missing USAGE on public schema")
    fi

    local table_exists
    table_exists="$(run_psql_query "SELECT to_regclass('public.reconciliation_job') IS NOT NULL;")"
    if [[ "$table_exists" == "t" ]]; then
      local priv
      for priv in SELECT INSERT UPDATE DELETE; do
        local has_priv
        has_priv="$(run_psql_query "SELECT has_table_privilege('$username', 'public.reconciliation_job', '$priv');")"
        if [[ "$has_priv" != "t" ]]; then
          failures+=("$username: missing $priv on reconciliation_job")
        fi
      done
    fi
  done < <(get_expected_dev_stage_users)

  if (( ${#failures[@]} == 0 )); then
    record_check "DB14" "User database privileges" "PASS" "All expected users have required database and table privileges"
    return 0
  fi

  record_check "DB14" "User database privileges" "FAIL" "${failures[*]}"
  return 1
}

run_transactional_capability_tests() {
  if docker compose "${compose_args[@]}" exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL' >/dev/null
BEGIN;

CREATE SCHEMA preflight_validation;

CREATE TABLE preflight_validation.sample_records (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO preflight_validation.sample_records (name, counter)
VALUES ('alpha', 1), ('beta', 2);

UPDATE preflight_validation.sample_records
SET counter = counter + 10
WHERE name = 'alpha';

CREATE INDEX preflight_validation_sample_records_name_idx
  ON preflight_validation.sample_records (name);

CREATE OR REPLACE FUNCTION preflight_validation.bump_counter(record_name TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_counter INTEGER;
BEGIN
  UPDATE preflight_validation.sample_records
    SET counter = counter + 1
  WHERE name = record_name
  RETURNING counter INTO new_counter;

  RETURN new_counter;
END;
$$;

CREATE OR REPLACE PROCEDURE preflight_validation.set_counter(record_id INTEGER, new_value INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE preflight_validation.sample_records
    SET counter = new_value
  WHERE id = record_id;
END;
$$;

SELECT preflight_validation.bump_counter('alpha');
CALL preflight_validation.set_counter(1, 25);

DO $$
DECLARE
  alpha_counter INTEGER;
  total_rows INTEGER;
BEGIN
  SELECT counter INTO alpha_counter
  FROM preflight_validation.sample_records
  WHERE id = 1;

  SELECT COUNT(*) INTO total_rows
  FROM preflight_validation.sample_records;

  IF alpha_counter <> 25 THEN
    RAISE EXCEPTION 'Expected alpha counter to be 25, got %', alpha_counter;
  END IF;

  IF total_rows <> 2 THEN
    RAISE EXCEPTION 'Expected two rows in sample table, got %', total_rows;
  END IF;
END;
$$;

ROLLBACK;
SQL
  then
    record_check "DB9" "Transactional DDL/DML/procedure sweep" "PASS" "Create/update table, index, function, and procedure tests passed"
    return 0
  fi

  record_check "DB9" "Transactional DDL/DML/procedure sweep" "FAIL" "Capability tests failed"
  return 1
}

main() {
  printf 'Running database preflight checks in %s\n\n' "$ROOT_DIR"

  local can_continue=1
  local postgres_ready=0

  check_docker_daemon || can_continue=0
  source_environment || can_continue=0

  if (( can_continue == 1 )); then
    if ensure_postgres_running; then
      postgres_ready=1
    else
      can_continue=0
    fi
  else
    record_check "DB3" "Postgres service startup" "WARN" "Skipped because prerequisite checks failed"
    record_check "DB4" "Postgres readiness" "WARN" "Skipped because prerequisite checks failed"
  fi

  if (( postgres_ready == 1 )); then
    check_postgres_security_vulnerabilities || true
    check_pgaudit_enabled || true
    check_expected_users_exist || true
    check_user_role_attributes || true
  else
    record_check "DB10" "Postgres vulnerability scan" "WARN" "Skipped because postgres is not ready"
    record_check "DB11" "pgAudit extension" "WARN" "Skipped because postgres is not ready"
    record_check "DB12" "Expected database users" "WARN" "Skipped because postgres is not ready"
    record_check "DB13" "User role attributes" "WARN" "Skipped because postgres is not ready"
  fi

  if (( can_continue == 1 )); then
    check_schema_migration_table || can_continue=0
  else
    record_check "DB5" "Migration tracking table" "WARN" "Skipped because postgres is not ready"
  fi

  if (( can_continue == 1 )); then
    check_patch_versions || can_continue=0
    check_core_tables || can_continue=0
    check_indexes_and_constraints || can_continue=0
    run_transactional_capability_tests || can_continue=0
    check_user_database_privileges || true
  else
    record_check "DB6" "Patch coverage" "WARN" "Skipped because migration table check failed"
    record_check "DB7" "Core table sweep" "WARN" "Skipped because migration table check failed"
    record_check "DB8" "Index sweep" "WARN" "Skipped because migration table check failed"
    record_check "DB9" "Transactional DDL/DML/procedure sweep" "WARN" "Skipped because migration table check failed"
    record_check "DB14" "User database privileges" "WARN" "Skipped because migration table check failed"
  fi

  print_summary

  if (( fail_count > 0 )); then
    printf '\nDatabase preflight failed. Fix FAIL items before deploying DB changes.\n'
    exit 1
  fi

  printf '\nDatabase preflight passed with no FAIL items.\n'
}

main "$@"