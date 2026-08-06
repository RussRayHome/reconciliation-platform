# ISSUE-031: Visual baselines verify appearance, not behaviour — and carry an OS-fork maintenance cost

**Status:** Open · **Severity:** Follow-up · **Area:** Testing
**Location:** `apps/web/tests/e2e/visual-baseline.spec.ts`, `*.spec.ts-snapshots/`
**Source:** Testing-coverage review of `dev`, 2026-08-06.

## Problem
`visual-baseline.spec.ts` covers 4 scenarios (login + error state, superuser workspace, docs hub +
document, analyst workspace) at 3 widths. It is the broadest UI test in the repo, which makes it
easy to mistake for functional coverage. It is not: a screenshot passes on a button whose
`onClick` throws, on a link with no `href`, and on a form that never submits.

Two secondary costs:

- Snapshots are forked per OS (`*-darwin.png` and `*-linux.png` for every scenario/width), so local
  and CI baselines drift independently and both must be regenerated on any intended change.
- `049034d` had to regenerate the `docs-hub-*` baselines because removing the dashboard hero CTA
  shortened the page — a correct catch, but it shows unrelated layout edits routinely produce
  snapshot churn that reviewers must eyeball.

## Fix
No change to the visual specs themselves is required — the issue is what they are relied upon to
prove. Track functional UI coverage separately (ISSUE-026, ISSUE-027, ISSUE-029) and do not treat a
green visual job as evidence the UI works. If snapshot churn becomes a review burden, consider
pinning generation to the CI container image so only the `-linux` set is authoritative.

Related: ISSUE-026, ISSUE-029, ISSUE-032.
