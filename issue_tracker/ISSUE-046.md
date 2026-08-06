# ISSUE-046: Pino log redaction is not configured — PII and account data may be logged

**Status:** Open · **Severity:** Pre-sale · **Area:** Due diligence / Privacy
**Location:** `apps/api` (Pino/pino-http setup)
**Source:** Due-diligence readiness review, 2026-08-06.

## Problem
No `redact` configuration appears anywhere in `apps/api/src` or `packages/`. Pino supports redaction
paths natively and none are set, so whatever is passed into a log call is serialised in full.

This matters more here than in a typical application because of what flows through the system: bank
account identifiers, counterparty names, transaction narratives, and — on the auth paths —
authorization headers and tokens. `pino-http` in particular will serialise request objects, and
headers are the classic accidental disclosure.

Two distinct exposures follow. Operationally, logs usually have broader access than the database and
are shipped to third-party aggregators, so unredacted financial data widens the blast radius of any
log-access compromise. For compliance, it puts personal data in a store that the retention and
deletion mechanisms of ISSUE-041 almost certainly do not cover.

This is one of the cheapest items on the readiness list to close.

## Fix
Configure Pino `redact` paths for authorization headers, cookies, tokens, and any field carrying
account identifiers or transaction detail, then audit existing log call sites for objects logged
wholesale. A test asserting that a known-sensitive field never appears in serialised output keeps it
from regressing.

Related: ISSUE-041, ISSUE-040, ISSUE-022.
