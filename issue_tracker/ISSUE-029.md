# ISSUE-029: No test asserts a page loaded without runtime errors

**Status:** Open · **Severity:** Follow-up · **Area:** Testing
**Location:** `playwright.config.ts`, `apps/web/tests/e2e/`
**Source:** Testing-coverage review of `dev`, 2026-08-06.

## Problem
Nothing in `apps/web/tests/e2e/` or `playwright.config.ts` registers a `page.on('pageerror')` or
`page.on('console')` listener. No test fails because the browser threw.

Consequences:

- A route that renders its heading but throws in an effect passes.
- A button whose click handler throws passes, provided the assertion only checks that the button is
  visible or enabled.
- React key/prop warnings and hydration mismatches accumulate with no gate.

`1a1d4da` ("Fix ExceptionFacets crash on details toggle (null currentTarget)") is exactly this
shape of bug — a runtime throw on interaction, which a console gate catches generically and a
per-feature assertion only catches if someone thought to write it.

## Fix
Register a `pageerror`/console-error listener in a shared fixture or `playwright.config.ts` so it
applies to every spec by default, failing the test on uncaught exceptions and `console.error`.
Expect an initial allowlist of known-noisy messages; keep it short and comment each entry.

Related: ISSUE-026 (route sweep is much stronger combined with this gate).
