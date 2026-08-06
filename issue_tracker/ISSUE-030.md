# ISSUE-030: No accessibility testing anywhere in the repo

**Status:** Open · **Severity:** Follow-up · **Area:** Testing / Accessibility
**Location:** repo-wide
**Source:** Testing-coverage review of `dev`, 2026-08-06.

## Problem
No `axe-core`, `@axe-core/playwright`, or `jest-axe` dependency exists, and no test performs an
accessibility assertion beyond individual `getByRole` selectors.

"Buttons and links are clickable" in an audit sense means: correct role, accessible name,
reachable by keyboard, visible focus, adequate contrast. The suite verifies exactly one keyboard
path (`reconciliation-edge-cases.spec.ts:472`). `RovingTabList.test.tsx` is the right instinct at
the component level but has no application-level counterpart.

For a product being prepared for acquisition this is also a commercial exposure, not just a quality
one: enterprise and public-sector buyers routinely require a VPAT or WCAG 2.1 AA conformance
statement, and there is currently no evidence base from which to produce one.

## Fix
Add `@axe-core/playwright` and run a scan on the main authenticated screens (login, import,
review/summary, exceptions, export, docs hub) as part of the existing e2e job. Start by recording
the current violation count as a baseline and gating against regressions rather than requiring zero
on day one.

Related: ISSUE-026 (same screen list is worth scanning), ISSUE-031.
