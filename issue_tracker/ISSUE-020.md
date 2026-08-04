# ISSUE-020: Recheck database CVE exceptions — due 2026-11-01

**Status:** Open · **Severity:** Carried over · **Area:** Security / Dependencies
**Location:** `docs/security-exceptions.md`
**Source:** Assessed 2026-08-03, 90-day window

## Problem
23 HIGH-severity CVEs from `npm run security:scan:component:database` were accepted with a hard expiry
of **2026-11-01**. All are `path: base-image` — OS packages and vendored binaries in the upstream
PostgreSQL container, none in this repo's code, SQL or schema.

Both remediation routes were exhausted: `postgres:16` already resolves to `16.14` (what
`Dockerfile.postgres` pins), and a `--no-cache` rebuild produced identical counts.

**The 14 `stdlib` rows show a `fixedVersion` but it is not actionable** — that is the Go standard
library in a vendored binary, not an apt package.

## On recheck
```
docker pull postgres:16
npm run security:scan:component:database
```
Drop rows whose CVE is gone; bump and rebuild if an upstream fix shipped; only re-accept what still has
no remediation route, resetting the window to 90 days.

**Open question worth chasing:** scanning `postgres:16.14` for Go build IDs found **no Go binary** in
the base layers. If it can be identified and is unused, removing it clears 14 of 23 outright.

## Related gap
`policy.failOnCriticalOrHigh: true` and the scanner does not read the register, so the scan still
fails. Wiring a CVE allowlist keyed by expiry into `scripts/security-component-scan.mjs` is what makes
the register operational.
