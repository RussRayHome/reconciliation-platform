# ISSUE-004: `verifyAuthToken` bare catch defeats the production JWT_SECRET guard

**Status:** Open · **Severity:** Blocker · **Area:** Auth
**Location:** `apps/api/src/services/authService.ts:128`
**Source:** Silent-failure review, 2026-08-03

## Problem
The `try` block spans `resolveJwtSecret(logger)` as well as `jwt.verify`. `resolveJwtSecret` throws in
production when `JWT_SECRET` is unset — its own message says "refusing to start with no auth secret" —
but nothing refuses to start, because `createApp` never calls it. The throw lands on the first request
instead and is swallowed here, returning `401 "Invalid or expired session."`

Deploy without `JWT_SECRET` and the API boots green (`/api/health` is public), then 401s every user
and 500s every login, with **zero log lines** explaining why. The `logger` parameter is accepted and
never used on any failure path.

Also indistinguishable from normal expiry: `JsonWebTokenError: invalid signature` (forged token or
botched secret rotation), `NotBeforeError`, malformed base64, algorithm-confusion attempts.

## Fix
Split the catch by error type — debug for expiry, warn for verification failure, rethrow anything
else. Call `resolveJwtSecret(httpLogger)` once inside `createApp`, next to the existing
`ALLOW_LOCAL_LOGIN_FALLBACK` startup check at `app.ts:1093`, so the guard fires where it claims to.
