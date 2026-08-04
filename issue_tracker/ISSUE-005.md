# ISSUE-005: Changeset 0032 is uncommitted — as committed, the branch breaks every login

**Status:** Open · **Severity:** Blocker · **Area:** Database / Auth
**Location:** `packages/persistence/liquibase/changesets/0032_exclude_reconciliation_user_from_rls.sql` (untracked)
**Source:** Silent-failure review, 2026-08-03. **Verified untracked.**

## Problem
Changeset 0030 enables RLS on `reconciliation_user`, while the login query at `app.ts:1417` runs on a
bare `pool.query` outside any tenant scope. Once `DATABASE_URL` points at the runtime role, the GUC is
unset at that moment by definition — the lookup is what *establishes* tenancy — so the policy evaluates
`organization_id = NULL` for every row and returns nothing. Every login then fails with
`"The user or password does not match."`

That message is actively misleading: operators will chase password hashing and the bcrypt migration in
0026, not RLS.

## Fix
Commit 0032 with the branch. Consider adding distinguishable log lines on the login path
(`auth.login.user_not_found` vs `auth.login.bad_password`) at `debug`, so a total-lookup-failure mode
is separable in logs without leaking it to the client.
