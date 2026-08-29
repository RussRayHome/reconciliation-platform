# ISSUE-021: JWT revocation strategy undecided

**Status:** Open · **Severity:** Carried over · **Area:** Auth / Design
**Location:** `design/adr/0002-authentication-and-authorization.md` — DECIDE 1
**Source:** 2026-08-03

## Problem
ADR-0002 DECIDE 1 selected **Option B (JWT)**, overriding the recommendation of httpOnly cookie
sessions. The ADR records that this reopens the revocation question the recommendation flagged: a
stateless JWT needs either a short expiry with refresh tokens, or a denylist, for logout and
compromise to take effect before natural expiry.

The ADR marks this "not yet decided — track separately".

A Redis denylist exists (`authService.ts`), but see ISSUE-007: it fails open silently when Redis is
unavailable, which is the failure mode that makes the denylist approach fragile without monitoring.

## Decision needed
Short expiry + refresh tokens, Redis denylist, or both. Record the outcome in ADR-0002.
