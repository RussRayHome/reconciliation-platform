#!/usr/bin/env bash
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

contains_user() {
  local target="$1"
  shift
  local user
  for user in "$@"; do
    if [[ "$user" == "$target" ]]; then
      return 0
    fi
  done
  return 1
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

set -a
# shellcheck disable=SC1090
source "$SOURCE_FILE"
set +a

POSTGRES_USER="${POSTGRES_USER:-}"
POSTGRES_DB="${POSTGRES_DB:-}"

if [[ -z "$POSTGRES_USER" || -z "$POSTGRES_DB" ]]; then
  echo "POSTGRES_USER or POSTGRES_DB is missing in $(basename "$SOURCE_FILE")." >&2
  exit 1
fi

expected_users=()
if [[ -n "${EXPECTED_DB_USERS:-}" ]]; then
  expected_user_input="${EXPECTED_DB_USERS//,/ }"
  read -r -a raw_users <<< "$expected_user_input"
  for user in "${raw_users[@]}"; do
    [[ -z "$user" ]] && continue
    if ! contains_user "$user" "${expected_users[@]}"; then
      expected_users+=("$user")
    fi
  done
else
  expected_users+=("$POSTGRES_USER")
  if ! contains_user "rray" "${expected_users[@]}"; then
    expected_users+=("rray")
  fi
fi

if [[ ${#expected_users[@]} -eq 0 ]]; then
  echo "No expected users were resolved. Set EXPECTED_DB_USERS or POSTGRES_USER." >&2
  exit 1
fi

if ! docker compose "${compose_args[@]}" exec -T postgres \
  pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
  echo "PostgreSQL is not ready for role verification." >&2
  exit 1
fi

missing_users=()
non_login_users=()

for expected_user in "${expected_users[@]}"; do
  expected_user_sql_escaped="${expected_user//\'/\'\'}"
  status="$(docker compose "${compose_args[@]}" exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At \
    -c "SELECT COALESCE((SELECT CASE WHEN rolcanlogin THEN 'login' ELSE 'no-login' END FROM pg_roles WHERE rolname='${expected_user_sql_escaped}'), 'missing');")"

  if [[ "$status" == "missing" ]]; then
    missing_users+=("$expected_user")
  elif [[ "$status" == "no-login" ]]; then
    non_login_users+=("$expected_user")
  fi
done

if [[ ${#missing_users[@]} -gt 0 || ${#non_login_users[@]} -gt 0 ]]; then
  if [[ ${#missing_users[@]} -gt 0 ]]; then
    echo "In-flight DB user check failed: missing users: ${missing_users[*]}" >&2
  fi
  if [[ ${#non_login_users[@]} -gt 0 ]]; then
    echo "In-flight DB user check failed: users without LOGIN: ${non_login_users[*]}" >&2
  fi
  echo "Hint: run npm run db:users:dev (or npm run db:users:stage) and re-run this check." >&2
  exit 1
fi

echo "In-flight DB user check passed for users: ${expected_users[*]}"