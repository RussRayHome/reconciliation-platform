# ISSUE-022: Real JWT_SECRET values committed to tracked fallback env files

**Status:** Fixed 2026-08-06 · **Severity:** Blocker · **Area:** Auth / Secrets
**Location:** `.env.docker.dev.fallback`, `.env.docker.stage.fallback`
**Source:** 2026-08-04

## Problem
Both `.env.docker.dev.fallback` and `.env.docker.stage.fallback` are tracked in git (unlike
`.env.docker.dev`/`.env.docker.stage`, which are gitignored) and are meant to hold non-secret
placeholder values — e.g. `POSTGRES_PASSWORD=change-dev-password`. A `JWT_SECRET` line was added to
each with a real, fixed, generated-looking 32-byte hex value:

- `.env.docker.dev.fallback`: `JWT_SECRET=` (redacted — a 64-character hex value; see git history
  prior to the 2026-08-06 fix commit if the exact value is ever needed for incident review)
- `.env.docker.stage.fallback`: `JWT_SECRET=` (redacted, same shape)

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

## Resolution (2026-08-06)
Both `.fallback` files now carry an obvious placeholder (`change-dev-jwt-secret` /
`change-stage-jwt-secret`) in place of the real value, and the two occurrences in this document are
redacted. The secret-scan gap called out above is closed: `scripts/security-scan-secrets.mjs`
(gitleaks + trufflehog, full git history) runs nightly as the `secrets` job in
`dashboard-status.yml`, and is exactly what caught this pair still being live in the working tree.

Not done here, and deliberately left to ISSUE-049: rewriting git history to remove the leaked
values from prior commits, and the decision of whether that rewrite is worth doing before the repo
is ever shared with an external party.
