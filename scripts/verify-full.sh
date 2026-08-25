#!/usr/bin/env bash
# The complete local mirror of every check that runs in GitHub Actions on a push landing on
# `dev` -- the literal union of docker-validate.yml (PR-blocking) and dashboard-status.yml
# (runs again on push to dev, with its own wider check set: postgres/schema-baseline, coverage,
# complexity, dependency-graph, component/secret scans). Re-derived directly from both workflow
# files' `run:` steps on 2026-08-25, not from a memorized checklist -- see
# scripts/local-env-check.sh's sibling comment and the CI-mirror feedback memory for why that
# distinction matters: a memorized list silently goes stale the moment either workflow changes.
#
# Why this exists: getting a true "would this pass CI" answer previously meant hand-deriving the
# command union from two YAML files every time, which is exactly the kind of manual step that
# gets missed under time pressure -- npm run verify:push alone mirrors ONLY docker-validate.yml's
# fast static-check step, not the full matrix, and neither workflow individually is "everything."
#
# Usage:
#   npm run verify:full
#
# Deliberately NOT included:
#   - Stage-only jobs (docker:deploy:stage, security:scan:zap:*, docker:cleanup:stage) -- these
#     need real stage infrastructure/secrets and aren't meaningfully reproducible on a laptop.
#   - `docker:smoke` is SKIPPED (not failed) if port 5432 is already held by something else --
#     almost always your own already-running dev stack -- rather than either colliding with it
#     (the exact failure this script was built to explain, not repeat) or silently stopping your
#     stack to make room for it (the destructive-command lesson from the same session this script
#     was written in). Run `npm run docker:smoke` by hand once the dev stack is stopped if you
#     need that specific check.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"
OUT_DIR="$(mktemp -d)"
SUMMARY="$OUT_DIR/SUMMARY.txt"
: > "$SUMMARY"
FAILED=false

run_step() {
  local name="$1"; local blocking="$2"; shift 2
  echo "=== $name ===" | tee -a "$SUMMARY"
  local start end
  start=$(date +%s)
  if bash -lc "$*" > "$OUT_DIR/$name.log" 2>&1; then
    end=$(date +%s)
    echo "PASS $name ($((end - start))s)" | tee -a "$SUMMARY"
  else
    end=$(date +%s)
    if [[ "$blocking" == "true" ]]; then
      echo "FAIL $name ($((end - start))s) -- see $OUT_DIR/$name.log" | tee -a "$SUMMARY"
      FAILED=true
    else
      echo "FAIL (non-blocking, matches CI's own || true) $name ($((end - start))s) -- see $OUT_DIR/$name.log" | tee -a "$SUMMARY"
    fi
  fi
}

echo "== Step 0: local environment hygiene =="
if ! npm run env:check; then
  echo "" >&2
  echo "Local environment has drift (see above) -- fix it first (npm run env:check:fix, or" >&2
  echo "investigate manually), then rerun verify:full. A dirty environment can silently" >&2
  echo "contaminate the results below, so this blocks rather than just warning." >&2
  exit 1
fi
echo ""

# --- docker-validate.yml (PR-blocking) ---
run_step 01_typecheck true "npm run typecheck"
run_step 02_lint true "npm run lint"
run_step 03_docs_api_check true "npm run docs:api:check"
run_step 04_docs_openapi_check true "npm run docs:openapi:check"
run_step 05_security_scan_audit true "npm run security:scan"
run_step 06_licenses_check true "npm run licenses:check"
run_step 07_test true "npm run test"

# --- dashboard-status.yml additions not already covered above ---
run_step 08_test_integration_dashboard true "npm run test:integration:dashboard"
run_step 09_coverage true "npm run coverage"
run_step 10_security_scan_components true "npm run security:scan:components"
run_step 11_security_scan_secrets true "npm run security:scan:secrets"
run_step 12_analyze_complexity false "npm run analyze:complexity"
run_step 13_analyze_deps false "npm run analyze:deps"

# --- e2e (both workflows run these; run once, locally, as a fast proxy for the containerized
# sharded version CI actually uses -- same test suite, different runner) ---
run_step 14_test_e2e_functional true "DISABLE_API_RATE_LIMIT=true DATABASE_URL='postgresql://app_user:P%40ssw0rd@localhost:5432/reconciliation_platform' npm run test:e2e:functional"
run_step 15_test_e2e_visual true "npm run test:e2e:visual:container"

# --- docker:smoke, only if it won't collide with an already-running stack ---
if lsof -nP -iTCP:5432 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "=== 16_docker_smoke ===" | tee -a "$SUMMARY"
  echo "SKIPPED -- port 5432 is already in use (your dev stack is probably running). Stop it" | tee -a "$SUMMARY"
  echo "  first (docker compose stop, not down/cleanup) if you need this specific check." | tee -a "$SUMMARY"
else
  run_step 16_docker_smoke true "npm run docker:smoke"
fi

echo ""
echo "== Summary (full log directory: $OUT_DIR) =="
cat "$SUMMARY"

if [[ "$FAILED" == "true" ]]; then
  echo "" >&2
  echo "verify:full FAILED -- see the FAIL lines above and their per-step logs in $OUT_DIR" >&2
  exit 1
fi

echo ""
echo "verify:full passed."
