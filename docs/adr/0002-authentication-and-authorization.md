# ADR-0002: Authentication and Authorization

**Status:** Proposed — three decisions need the owner's call (marked **DECIDE** below)
**Date:** 2026-08-03
**Deciders:** Repository owner
**Blocks:** [ADR-0001](0001-multi-tenant-isolation-model.md) — the tenant GUC is derived from the
authenticated principal, so tenancy cannot land before this

## Context

The platform is sold as a shared service. Today it has a login screen and no security.

### What exists

| Piece            | Where                                                           | State                                                                                                     |
| ---------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Login endpoint   | `apps/api/src/app.ts` `POST /api/auth/login`                    | Returns `{username, firstName, lastName}` — **no token, no session, no cookie**                           |
| Password check   | same handler                                                    | `WHERE user_name = $1 AND password = $2` — **plaintext comparison in SQL**                                |
| Fallback users   | `app.ts` `localLoginUsers`                                      | Hardcoded; **password equals username** (`rray`/`rray`)                                                   |
| User table       | `reconciliation_user`                                           | `user_name, first_name, last_name, password, last_changed, id, created_at` — **no role, no organization** |
| Roles            | `apps/web/src/App.tsx` `usersByUsername`                        | **Hardcoded client-side map**, keyed by username                                                          |
| Permissions      | `App.tsx` `rolePermissionsByRole`                               | 4 roles × 5 booleans — **UI gating only**                                                                 |
| Session          | `localStorage` key `reconciliation-platform:authenticated-user` | **Unsigned JSON blob**                                                                                    |
| Route protection | —                                                               | **None.** Only gate is the `/api/developer` diagnostics flag                                              |

### What follows from it

1. **Every endpoint is anonymous.** Reconciliation runs, alias CRUD, workbook export, and reviewer
   decisions are all reachable without logging in. The login screen is decoration.
2. **Any user can self-promote.** Roles live in client code and the session is unsigned JSON in
   `localStorage`. Editing one key grants `superuser`. Even if the API were gated, it would have
   no server-side role to check against.
3. **Passwords are plaintext at rest and in transit to the DB.** A database read discloses every
   credential. Existing integration tests mock the pool, so adding hashing would not fail a single
   current test.
4. **Shipped fallback credentials are guessable** — username equals password.

Nothing here is a subtle flaw; the authentication layer was scaffolded and never finished. Scoping
it honestly matters more than sequencing it cleverly.

## Decisions Required

### DECIDE 1 — Session mechanism

**Option A: httpOnly cookie session** (server-side store or signed cookie). Revocable, invisible
to JS so `localStorage` tampering is moot, straightforward CSRF story with `SameSite=Lax`.
**Option B: JWT in an `Authorization` header.** Stateless and horizontally scalable, but
revocation needs a denylist, and storing it in `localStorage` re-creates the XSS exposure.

_Recommendation: **A**. This is a single API serving its own SPA, so there is no cross-origin or
third-party consumer to justify JWT's cost, and revocation matters for a finance product._

### DECIDE 2 — Where roles live

**Option A: `reconciliation_user.role` column** with a CHECK constraint over the four existing
roles. Simple, matches the current model exactly.
**Option B: `role` + `permission` tables** with a join. Supports custom roles per customer.

_Recommendation: **A** now, B later if a customer demands custom roles. The four roles are stable
and a join table buys nothing today. Note the current permission matrix is already role→booleans,
which maps cleanly onto a column._

### DECIDE 3 — Password migration for existing users

Existing passwords are plaintext, so they can be hashed in place — but that also means they should
be treated as **compromised**, since anyone with historical DB or backup access has read them.

**Option A: hash in place, force reset on next login.** Safest; assumes every stored credential is
burned.
**Option B: hash in place silently.** Zero user friction, but knowingly retains credentials that
have been stored in the clear.

_Recommendation: **A** for any real customer data; **B** is only defensible if every existing
account is a developer test account — which, given `localLoginUsers`, it may well be._

## Consequences

- Easier: every downstream control becomes possible — tenancy (ADR-0001), audit attribution, and
  segregation-of-duties all need an authenticated principal
- Harder: every route gains a guard, so the default must flip to deny-by-default with an explicit
  public allowlist. A forgotten route becomes a 401 rather than a silent hole
- Revisit when: a customer requires SSO/SAML, which is common in finance procurement and would
  supersede DECIDE 1

## Scope of Work

Sized in dependency order. **Steps 1–2 are one migration, not three** — `reconciliation_user`
needs `password_hash`, `role`, and `organization_id` (the last from ADR-0001), and changing that
table once is much cheaper than three times.

| #   | Work                                                                                                                                                         | Notes                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1   | **Schema:** add `password_hash`, `role`, `organization_id` to `reconciliation_user`; drop `password`                                                         | Single Liquibase changeset. Coordinate with ADR-0001 task      |
| 2   | **Hashing:** argon2id (or bcrypt), hash on registration, verify on login, migrate existing rows per DECIDE 3                                                 | Replaces the `password = $2` SQL comparison                    |
| 3   | **Session issuance:** login sets an httpOnly cookie; add `POST /api/auth/logout` and a `GET /api/auth/me` for session rehydration                            | Per DECIDE 1                                                   |
| 4   | **Auth middleware:** deny-by-default across `/api`, with an explicit public allowlist (`/api/health`, `/api/auth/login`, and whatever the ops tooling needs) | The single highest-value step                                  |
| 5   | **Authorization:** map the existing 5 permission booleans to route-level checks; enforce server-side                                                         | Client keeps its UI gating, but it stops being the control     |
| 6   | **Frontend:** rely on the cookie, fetch role from `/api/auth/me`, delete `usersByUsername`, stop trusting `localStorage` for identity                        | `App.tsx`                                                      |
| 7   | **Remove `localLoginUsers`** or gate it behind an explicit dev-only flag that cannot be set in production                                                    | Currently username == password                                 |
| 8   | **Tests:** unauthenticated → 401 on every protected route; wrong role → 403; a persistence test asserting the stored credential is not the plaintext input   | The last one makes the hashing migration fail-before-it-passes |

**Not in scope, deliberately:** SSO/SAML, MFA, password-reset email flows, rate limiting on login
(the API already has a rate limiter that could be tightened separately), and account lockout.
Each is a reasonable follow-on once the base layer exists.

## Action Items

1. [ ] Owner answers DECIDE 1, 2, 3
2. [ ] Land steps 1–2 as one `reconciliation_user` migration, coordinated with ADR-0001
3. [ ] Steps 3–5 (server-side auth and authz)
4. [ ] Step 6 (frontend), then step 7 (remove fallback credentials)
5. [ ] Step 8 tests throughout, not at the end
6. [ ] Regenerate the pgTap baseline (`npm run test:postgres:update-baseline`) — the schema-drift
       test fails until it reflects the new `reconciliation_user` shape
