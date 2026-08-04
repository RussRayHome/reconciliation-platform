# ISSUE-013: `/api/health/` with a trailing slash returns 401

**Status:** Open · **Severity:** Follow-up · **Area:** Auth / Operations
**Location:** `apps/api/src/services/authMiddleware.ts:52`
**Source:** Silent-failure review, 2026-08-03

## Problem
Express runs with strict routing disabled by default, so `app.get('/api/health')` also serves
`/api/health/`. But `request.path` is then `'/api/health/'`, which is not in `PUBLIC_ROUTES`, so the
request 401s. A Kubernetes liveness probe or load balancer configured with a trailing slash gets a 401
and restart-loops the container, while the endpoint looks fine when tested by hand.

Fails closed, which is the right direction — but invisible until it takes down a deploy.

## Fix
Normalize the path (strip trailing slashes, preserving `/`) before the `PUBLIC_ROUTES` lookup.
