#!/usr/bin/env bash
# Reclaims Docker Desktop space left behind by test runs, before a deploy builds more.
#
# Usage (via npm scripts — preferred):
#   npm run docker:footprint          # report and reclaim
#   npm run docker:footprint -- --dry-run   # report only, change nothing
#
# WHY THIS EXISTS. `deploy-cleanup.test.ts` mints a fresh PID-suffixed COMPOSE_PROJECT_NAME on every
# invocation (see cleanup-stale-integration-projects.sh for the full reasoning). That script already
# garbage-collects the orphaned *projects* — containers and networks — but never the *images* those
# builds produced. Nothing did. On 2026-09-10 that had accumulated to **714 orphaned integration
# images, 57GB of images total with 26GB reclaimable, plus 24.7GB of build cache**, on a machine
# whose Docker create path had degraded to 23 minutes under load.
#
# Disk pressure is not the only cost. A create path that takes minutes instead of seconds makes
# every container-backed suite unreliable, and the failure surfaces as "machine saturation" from
# testcontainers rather than anything naming the real cause.
#
# WHAT IT WILL NEVER TOUCH. The protected list below is matched first and wins over every removal
# rule. These are the user's real environments, not test artifacts:
#
#   reconciliation-platform-dev     the local dev stack
#   reconciliation-platform-stage   Stage (may be stopped for days and must survive)
#   recon-observability             Grafana / Loki / Prometheus / Alloy / cAdvisor
#
# Only images matching `reconciliation-platform-integration-<digits>-*` are removed. That name shape
# is produced exclusively by the per-run test projects, and every one is rebuilt automatically by the
# next test run, so nothing is lost by reclaiming them.
set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Anything whose name matches one of these is never removed, whatever else matches.
PROTECTED='reconciliation-platform-dev|reconciliation-platform-stage|recon-observability'

# Only this shape is reclaimable: a per-run test project, always regenerated on the next run.
TEST_ARTIFACT='reconciliation-platform-integration-[0-9]+'

say() { printf '%s\n' "$*"; }

report_usage() {
  say "Docker disk usage:"
  docker system df 2>/dev/null | sed 's/^/  /' || say "  (docker system df unavailable)"
}

say "== Docker footprint check =="
[[ $DRY_RUN -eq 1 ]] && say "(dry run — nothing will be removed)"
report_usage

# 1. Orphaned test-project images. Filtered through the protected list even though the two patterns
#    cannot overlap today: the guard costs nothing and survives someone renaming a real project.
# Collected into a real array, appended one id at a time.
#
# Two portability traps avoided deliberately. `mapfile` is bash 4+ and macOS ships bash 3.2, so it
# is not available. And an unquoted `$VAR` that relies on word splitting works in bash but NOT in
# zsh, which does not word-split by default -- under zsh the whole string arrives as a single
# argument and `docker rmi` fails on a nonsense id. The array expands correctly in both, so this
# script does not silently depend on which shell invokes it.
TEST_IMAGE_IDS=()
while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  TEST_IMAGE_IDS+=("$id")
done < <(
  docker images --format '{{.ID}} {{.Repository}}' 2>/dev/null \
    | grep -E "$TEST_ARTIFACT" \
    | grep -vE "$PROTECTED" \
    | awk '{print $1}' | sort -u
)
say ""
say "Orphaned integration-test images: ${#TEST_IMAGE_IDS[@]}"
if [[ ${#TEST_IMAGE_IDS[@]} -gt 0 && $DRY_RUN -eq 0 ]]; then
  docker rmi -f "${TEST_IMAGE_IDS[@]}" >/dev/null 2>&1 || true
  say "  removed"
fi

# 2. Orphaned test projects (containers + networks). Delegated rather than reimplemented — that
#    script owns the staleness window and the reasoning behind it.
say ""
say "Stale integration projects:"
if [[ $DRY_RUN -eq 0 ]]; then
  bash "$ROOT_DIR/scripts/pre-flight/cleanup-stale-integration-projects.sh" 2>&1 | sed 's/^/  /' || true
else
  say "  (skipped in dry run)"
fi

# 3. Dangling images and build cache. Both are unreferenced by definition, so no protected-name
#    check applies.
#
# The build cache is capped by SIZE, not by age. It used to be `--filter until=168h`, which was
# wrong in a way that looked right: this repo's cache is rebuilt by every deploy and every test run,
# so essentially none of it is ever 7 days old. On 2026-09-10 that filter reclaimed **0 bytes from
# 389 entries totalling 27.57GB, 20.91GB of it reclaimable**, while the script printed "Pruned
# dangling images and build cache older than 7 days" -- a success line that was not conditioned on
# anything having happened. Same failure shape as a migration reporting success while applying no
# changesets: the message described the attempt, not the result.
#
# `--max-used-space` keeps the most-recently-used cache up to the cap and evicts the rest, which is
# what "keep the cache that makes the next build fast, drop the rest" actually means. Both prunes
# now report the bytes they really reclaimed, so a no-op reads as a no-op.
# 22 GiB. NOT arbitrary, and deliberately not as small as it could be.
#
# Measured 2026-09-10 via `docker system df`: 24.09GB of build cache, of which **10.48GB is
# reclaimable** -- so the genuinely ACTIVE set is only ~13.6GB and the rest is evictable tail.
# That distinction is the whole point. A first attempt capped at 10 GiB, below the active set, so
# it did not trim tail at all: it evicted live layers, and the next integration run rebuilt 3.3GB
# at 400% VM CPU. That is not a smaller footprint, it is the same disk reclaimed over and over in
# exchange for a slower build every time.
#
# 22 GiB sits above the active set and below unbounded growth (the cache was heading past 27.9GB).
# Normal runs evict only cold tail; genuine accumulation is still trimmed.
#
# Re-measure before changing this, and read the RECLAIMABLE column, not SIZE -- SIZE alone is what
# makes 10 GiB look reasonable next to a 24GB total.
BUILD_CACHE_CAP_BYTES="${DOCKER_BUILD_CACHE_CAP_BYTES:-23622320128}" # 22 GiB

# Extracts what a prune actually freed. A prune that removed nothing prints no such line at all,
# which must read as "0B" rather than as blank -- blank is how the old message hid a no-op.
#
# THE TWO COMMANDS DO NOT AGREE ON THE FORMAT, and getting this wrong reproduces the original bug
# with the sign flipped. `docker image prune` prints "Total reclaimed space: 0B"; `docker builder
# prune` is buildx and prints a tab-separated "Total:\t0B". A parser matching only the first
# reported 0B for a run that had just reclaimed 10.1GB of build cache -- the before/after
# `docker system df` blocks were the only thing that revealed it. Match both, and keep those two
# blocks bracketing this so the figure below can always be cross-checked against them.
reclaimed_from() {
  printf '%s\n' "$1" | awk '
    /^Total( reclaimed space)?:/ {
      sub(/^Total( reclaimed space)?:[[:space:]]*/, "")
      print
      found = 1
    }
    END { if (!found) print "0B" }
  '
}

say ""
if [[ $DRY_RUN -eq 0 ]]; then
  image_prune_output="$(docker image prune -f 2>&1 || true)"
  say "Dangling images reclaimed: $(reclaimed_from "$image_prune_output")"

  # --max-used-space is buildx-era. Fall back to the age filter where it is unsupported rather
  # than failing the deploy over a cleanup step.
  if docker builder prune --help 2>&1 | grep -Fq -- '--max-used-space'; then
    cache_prune_output="$(docker builder prune -f --max-used-space "$BUILD_CACHE_CAP_BYTES" 2>&1 || true)"
    say "Build cache reclaimed:     $(reclaimed_from "$cache_prune_output") (cache capped at $((BUILD_CACHE_CAP_BYTES / 1024 / 1024 / 1024))GiB)"
  else
    cache_prune_output="$(docker builder prune -f --filter 'until=168h' 2>&1 || true)"
    say "Build cache reclaimed:     $(reclaimed_from "$cache_prune_output") (age-filtered; --max-used-space unavailable)"
  fi
else
  say "Would prune dangling images, and cap build cache at $((BUILD_CACHE_CAP_BYTES / 1024 / 1024 / 1024))GiB."
fi

say ""
report_usage
say ""
say "Protected and untouched: dev stack, stage, observability."
