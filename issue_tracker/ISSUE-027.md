# ISSUE-027: `NavRail` is the primary navigation surface and has no tests

**Status:** Open · **Severity:** Follow-up · **Area:** Testing
**Location:** `apps/web/src/components/NavRail.tsx`
**Source:** Testing-coverage review of `dev`, 2026-08-06.

## Problem
`NavRail.tsx` wires 16 `routePaths.*` destinations and is the only way a user reaches most of the
application. There is no `NavRail.test.tsx`, and no test file in the repo references `NavRail` at
all.

The single rail assertion anywhere is an e2e keyboard test
(`apps/web/tests/e2e/reconciliation-edge-cases.spec.ts:472`) that focuses two links, presses Enter
on one, and checks `aria-current`. That leaves **14 of 16 rail destinations with no click-through
verification** — a link can lose its `href`, render with the wrong accessible name, or disappear
from the rail entirely without a single test failing.

This is not hypothetical: ISSUE-015 documents a rail link being dropped and the affected spec being
rewritten around it. See ISSUE-028.

## Fix
A `NavRail.test.tsx` that renders the rail per role and asserts, for every entry, that a link exists
with the expected accessible name and `href`. Cheap, fast, and it fails loudly on exactly the class
of change that currently goes unnoticed.

Related: ISSUE-026, ISSUE-028.
