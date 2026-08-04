# ISSUE-022: Real JWT_SECRET values committed to tracked fallback env files

**Status:** Open · **Severity:** Blocker · **Area:** Auth / Secrets
**Location:** `.env.docker.dev.fallback`, `.env.docker.stage.fallback`
**Source:** 2026-08-04

## Problem
Both `.env.docker.dev.fallback` and `.env.docker.stage.fallback` are tracked in git (unlike
`.env.docker.dev`/`.env.docker.stage`, which are gitignored) and are meant to hold non-secret
placeholder values — e.g. `POSTGRES_PASSWORD=change-dev-password`. A `JWT_SECRET` line was added to
each with a real, fixed, generated-looking 32-byte hex value:

- `.env.docker.dev.fallback`: `JWT_SECRET=59c808645e07a6114b55f1d8c581af00a9cf978e6d3d776aa42365ac140fdb0e`
- `.env.docker.stage.fallback`: `JWT_SECRET=17a38f289482766981876abba2eb2e3087416d514fa301f75ab972d9ad38fb5c`

`authService.ts` (resolveJwtSecret, ~line 36-50) already has safe behavior for the unset case: no
`JWT_SECRET` → an ephemeral per-process secret is generated and a warning is logged; production
still hard-requires an explicit `JWT_SECRET` (throws if unset). The fallback files didn't need a
committed value at all — the ephemeral-secret path exists precisely so dev/stage fallback doesn't
need one.

Once these fallback files reach a public/shared remote, anyone with read access has a fixed signing
key for any deployment still running off the fallback file, and can forge auth tokens (including
`developer`/`superuser` role claims) against it. This directly undercuts the auth work this branch
is meant to harden, and is worth catching before the platform goes to a buyer/auditor.

## Fix
Remove the `JWT_SECRET` line from both fallback files (or replace with an obvious placeholder like
`change-dev-jwt-secret`) so they fall back to the app's built-in ephemeral-secret generation. Add a
secret-scan check (e.g. gitleaks/trufflehog in CI, or extend the existing `WARN-4` secret-scan
preflight check) that specifically flags high-entropy values in tracked `.fallback` files, since the
existing scan treats this whole file class as expected-safe (`WARN-4: Secret scan hits — all use env
interpolation, not real secrets`) and would not catch a real value pasted into it.
