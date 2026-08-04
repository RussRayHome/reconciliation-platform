# ISSUE-007: Token revocation fails open with no log when Redis is unavailable

**Status:** Open · **Severity:** Ship with branch · **Area:** Auth
**Location:** `apps/api/src/services/authService.ts:178`
**Source:** Silent-failure review, 2026-08-03

## Problem
`isTokenDenylisted` returns `false` silently when the Redis client is unavailable. Its sibling
`denylistToken` (`:155`) logs at `error` on the same condition — correctly. So if Redis is never
connected, every logout is a no-op *and* every denylist check silently passes, for up to
`AUTH_TOKEN_TTL_SECONDS` (8 hours). A revoked session keeps working and nothing records that
revocation is not functioning.

The `catch` at `:184` does warn and documents the fail-open tradeoff explicitly — that is defensible.
The `!client?.isOpen` early return is the same decision made silently.

## Fix
Log at `error` on the unavailable path, matching `denylistToken`, so "logout does not actually revoke"
is visible in production.
