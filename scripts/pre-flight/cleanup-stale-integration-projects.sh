#!/usr/bin/env bash
# Garbage-collects leftover `reconciliation-platform-integration-*` Docker Compose projects left
# behind by interrupted deploy-cleanup.test.ts runs (Issue #215).
#
# deploy-cleanup.test.ts deliberately mints a fresh, PID-suffixed COMPOSE_PROJECT_NAME every
# invocation, to avoid colliding with a concurrent run of the same test. But a process kill
# mid-test (a CI job cancellation, a local Ctrl+C, a wrapper tool's own timeout) never reaches the
# test's own cleanup step, so that run's containers and networks are orphaned permanently -- the
# next run picks a new PID and never touches them. Over a long session this silently exhausts
# Docker's finite network address pool ("all predefined address pools have been fully
# subnetted"), which is what actually broke deploy-cleanup.test.ts on 2026-08-27 -- not vitest
# worker concurrency, the pool was just full from ~25 accumulated leftover projects.
#
# Only removes projects whose containers have been running longer than STALE_AFTER_SECONDS
# (default 900s / 15 minutes). deploy-cleanup.test.ts's own worst case (build + deploy + one retry
# + cleanup) completes well within that window, so this can never tear down a genuinely
# in-progress concurrent run of the same test -- only ones that were actually abandoned.
set -euo pipefail

STALE_AFTER_SECONDS="${STALE_AFTER_SECONDS:-900}"
now_epoch="$(date +%s)"

container_ids="$(docker ps -a --filter 'label=com.docker.compose.project' --format '{{.ID}}' || true)"

if [[ -z "$container_ids" ]]; then
  echo "No Docker Compose-managed containers found."
  exit 0
fi

project_and_created="$(
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    docker inspect "$id" --format '{{index .Config.Labels "com.docker.compose.project"}}	{{.Created}}' 2>/dev/null || true
  done <<< "$container_ids"
)"

matching="$(printf '%s\n' "$project_and_created" | grep -E '^reconciliation-platform-integration-' || true)"

if [[ -z "$matching" ]]; then
  echo "No reconciliation-platform-integration-* projects found."
  exit 0
fi

parse_epoch() {
  local created="$1"
  # GNU date (CI, Linux) handles RFC3339-with-nanoseconds directly.
  date -d "$created" +%s 2>/dev/null && return
  # BSD date (macOS local dev) needs seconds-precision, no trailing 'Z'/fraction, and an explicit
  # UTC interpretation -- `.Created` is always UTC, but `date -j -f` otherwise reads the stripped
  # string as local time, silently shifting the result by this machine's UTC offset.
  TZ=UTC date -j -f '%Y-%m-%dT%H:%M:%S' "${created%%.*}" +%s 2>/dev/null && return
  echo 0
}

stale_projects="$(
  printf '%s\n' "$matching" | while IFS=$'\t' read -r project created; do
    [[ -z "$project" ]] && continue
    created_epoch="$(parse_epoch "$created")"
    age=$(( now_epoch - created_epoch ))
    if (( age > STALE_AFTER_SECONDS )); then
      printf '%s\n' "$project"
    fi
  done | sort -u
)"

if [[ -z "$stale_projects" ]]; then
  echo "No stale reconciliation-platform-integration-* projects (older than ${STALE_AFTER_SECONDS}s)."
  exit 0
fi

while IFS= read -r project; do
  [[ -z "$project" ]] && continue
  echo "Removing stale project: $project"
  docker compose -p "$project" down --remove-orphans --volumes >/dev/null 2>&1 || true
  # Fallback for anything `compose down` didn't recognize (e.g. a container missing the
  # com.docker.compose.service label docker compose expects) -- guarantees the sweep actually
  # frees the address-pool slot rather than leaving a partial project behind.
  docker ps -aq --filter "label=com.docker.compose.project=${project}" | \
    xargs -r docker rm -f >/dev/null 2>&1 || true
  docker network ls --filter "name=${project}" --format '{{.Name}}' | \
    xargs -r -I{} docker network rm {} >/dev/null 2>&1 || true
done <<< "$stale_projects"

echo "Stale integration project cleanup complete."
