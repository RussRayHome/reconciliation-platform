#!/usr/bin/env bash
# Pre-flight hygiene check for the LOCAL macOS dev environment -- not the deployed Docker stack
# (see scripts/pre-flight/health-check.sh for that). Catches exactly the class of drift that
# silently contaminated a full local CI sweep on 2026-08-25: a manually-started `dev:test`/
# `dev:api:test` process (or a Playwright test-server) left running for hours after its purpose
# was served squats on the same ports playwright.config.ts's `reuseExistingServer: true` webServer
# config will happily reuse -- so a later e2e run silently tests stale code instead of starting
# fresh, and a health-check curl against that same port "confirms" a deploy that was never
# actually hit.
#
# Usage:
#   npm run env:check        # report only, exit 1 if anything unexpected is found
#   npm run env:check:fix    # also kill/remove what it finds
#
# What it checks:
#   1. Ports 4000/4173/5173 -- these should be EMPTY unless something you're actively running right
#      now (an e2e run, `npm run dev`) legitimately owns them. The real Docker dev stack's gateway
#      lives on 4174 (compose.dev.yaml's PUBLIC_WEB_HTTPS_PORT), not 4173 -- a listener on 4173
#      is never the deployed stack, always a local dev-server process.
#   2. Stray `dev:test`/`dev:api:test`/`playwright ... test-server` processes, regardless of what
#      port lsof happens to report (a process can be starting up and not listening yet).
#   3. Exited Docker containers and orphaned testcontainers (the `integration-<port>-postgres`
#      pattern spun up by packages/persistence/tests -- normally reaped automatically by
#      testcontainers-ryuk when its owning process exits, but can leak if that process was killed
#      hard rather than exiting cleanly).
set -uo pipefail

FIX=false
if [[ "${1:-}" == "--fix" ]]; then
  FIX=true
fi

DIRTY=false

echo "== Checking ports 4000/4173/5173 for stray listeners (4174 is the real Docker gateway -- not checked here) =="
STRAY_PORT_PIDS=""
for port in 4000 4173 5173; do
  hit="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$hit" ]]; then
    echo "  port $port held by pid(s): $hit"
    for pid in $hit; do
      ps -p "$pid" -o pid,etime,command 2>/dev/null | tail -n +2
    done
    STRAY_PORT_PIDS="$STRAY_PORT_PIDS $hit"
    DIRTY=true
  fi
done
[[ -z "$STRAY_PORT_PIDS" ]] && echo "  clean"

echo ""
echo "== Checking for stray dev:test / dev:api:test / playwright test-server processes =="
STRAY_PROC_PIDS="$(ps -eo pid,command | grep -E 'npm run dev:test|npm run dev:api:test|playwright.*test-server' | grep -v grep | awk '{print $1}' || true)"
if [[ -n "$STRAY_PROC_PIDS" ]]; then
  ps -eo pid,etime,command | grep -E 'npm run dev:test|npm run dev:api:test|playwright.*test-server' | grep -v grep
  DIRTY=true
else
  echo "  clean"
fi

echo ""
echo "== Checking for orphaned ad-hoc testcontainers (NOT a general docker-container audit) =="
# Deliberately scoped to only the ephemeral `integration-<random-port>-*` containers that
# packages/persistence/tests spins up per test run -- NOT a blanket `docker ps -a --filter
# status=exited` sweep. A named, deliberately-managed stack (reconciliation-platform-stage-*,
# recon-observability-*) is routinely left in Exited state on purpose via `docker compose stop`
# (see the "stop vs down" convention -- stopped-but-present is the intended resting state, not
# drift), and treating any exited container as "dirty" would make --fix delete stacks the operator
# chose to keep. Only ad-hoc, single-use test infra belongs in this check.
#
# `*-migrate-*` (including the testcontainers one) is a one-shot Liquibase job -- its Exited state
# IS its success signal, never flagged. A lingering POSTGRES testcontainer is the real leak (its
# owning vitest process died without letting the ryuk reaper clean up) -- but only if nothing is
# actually still using it, so this cross-checks for a live postgres-integration test process
# before flagging, rather than guessing from the container name alone.
TC_POSTGRES="$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E 'integration-[0-9]+-postgres' || true)"
LIVE_POSTGRES_TEST="$(ps -eo command | grep -E 'vitest.*postgres|RUN_POSTGRES_TESTS' | grep -v grep || true)"
ORPHAN_TC=""
if [[ -n "$TC_POSTGRES" && -z "$LIVE_POSTGRES_TEST" ]]; then
  ORPHAN_TC="$TC_POSTGRES"
  echo "  orphaned testcontainer postgres (no live postgres-integration test process found):"
  echo "$ORPHAN_TC" | sed 's/^/    /'
  DIRTY=true
elif [[ -n "$TC_POSTGRES" ]]; then
  echo "  testcontainer postgres present but a postgres-integration test is currently running -- not flagged:"
  echo "$TC_POSTGRES" | sed 's/^/    /'
else
  echo "  clean"
fi

echo ""
if [[ "$DIRTY" == "false" ]]; then
  echo "Local environment is clean."
  exit 0
fi

if [[ "$FIX" == "false" ]]; then
  echo "Local environment has drift -- rerun with --fix (npm run env:check:fix) to clean it up, or" >&2
  echo "investigate first if any of the above is something you're deliberately running right now." >&2
  exit 1
fi

echo "== --fix: cleaning up =="
for pid in $STRAY_PORT_PIDS $STRAY_PROC_PIDS; do
  if kill "$pid" 2>/dev/null; then
    echo "  killed pid $pid"
  fi
done
if [[ -n "$ORPHAN_TC" ]]; then
  echo "$ORPHAN_TC" | xargs -I{} docker rm -f {} >/dev/null 2>&1
  echo "  removed orphaned testcontainers"
fi
echo "Done."
