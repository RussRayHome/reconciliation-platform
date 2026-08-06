# ISSUE-033: Links to `signup`, `forgot-password` and `support` have never been click-tested

**Status:** Open · **Severity:** Ship with branch · **Area:** Testing / Auth
**Location:** `apps/web/src/App.tsx:450-458`
**Source:** Testing-coverage review of `dev`, 2026-08-06. Directly in the path of
`feature/create-account`.

## Problem
`forgotPassword`, `signup` and `support` are currently `PlaceholderScreen` routes. No test clicks
the links that reach them from the login screen, and no test asserts those routes render at all
(see ISSUE-026).

That is tolerable while they are placeholders. It stops being tolerable on
`feature/create-account`, which replaces the signup placeholder with a real screen: the create-
account flow will be built behind an affordance whose only guarantee today is that it compiles.
Signup is also the highest-risk unauthenticated surface in the product — it accepts input from
anyone on the internet.

## Fix
Before the create-account screen merges, add coverage for the login screen's outbound links (each
resolves and renders the expected screen) and for the signup flow itself: validation states,
submit-disabled logic, error rendering, and successful-registration navigation. The
form-validation block at `reconciliation-edge-cases.spec.ts:95` is the right pattern to copy —
disabled → enabled → disabled-again is already proven in this suite.

Related: ISSUE-026, ISSUE-027, and the unresolved product decisions on signup scope recorded
separately.
