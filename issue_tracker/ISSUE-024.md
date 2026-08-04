# ISSUE-024: HIGH severity react-router CVE (CSRF bypass) — needs a v8 migration decision

**Status:** Open · **Severity:** Follow-up · **Area:** Security / Dependencies
**Location:** `apps/web/package.json` (`react-router-dom`)
**Source:** Surfaced by `npm run security:scan` failing on dependabot PR #10, 2026-08-04.

## Problem
`npm audit` reports a HIGH severity finding: `react-router` 7.12.0 - 8.2.0 is vulnerable to an
RSC Mode CSRF bypass that allows action execution before the expected 400 response
([GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2)). `react-router-dom`
was added to `apps/web/package.json` (`^7.18.2`) as part of the login/create-account routing work
(the `feature/integration-all` branch, merged into `dev` 2026-08-04); it depends on the vulnerable
`react-router@7.18.2`.

## Why this isn't a quick fix
`npm audit fix --force`'s suggested remediation is to **downgrade** to
`react-router-dom@7.11.0` (pre-vulnerable) — not actually a fix, just avoiding the range. The real
patched line starts at `react-router@8.3.0`, which is a **major version bump** (react-router v7 →
v8). That can carry breaking API changes and needs real testing against the routes this app
already ships (`/login`, `/forgot-password`, `/signup`, `/support`, plus the full in-app route
table in `apps/web/src/routes/routePaths.ts`), not just a version bump in `package.json`.

## Decision needed
Either upgrade to react-router v8 (migrate + test the affected routes) or accept the downgrade to
7.11.0 and confirm nothing the create-account/login work relies on was added between 7.11.0 and
7.18.2. Until resolved, `npm run security:scan` (and therefore the `security-scan` CI check) will
keep failing on any PR branched from `dev`.
