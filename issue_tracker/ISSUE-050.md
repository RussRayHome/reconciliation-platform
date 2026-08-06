# ISSUE-050: No SOX-grade audit trail for Mapping Profile lifecycle or login/access events

**Status:** Open · **Severity:** Pre-sale · **Area:** Audit / Compliance
**Location:** `apps/api/src/app.ts:1274-1389` (auth routes), `apps/api/src/app.ts:2158-2221`
(mapping routes), `packages/persistence/liquibase/changesets/0009_create_reconciliation_user_table.sql`,
`packages/persistence/liquibase/changesets/0012_create_reconciliation_mapping_profile_tables.sql`
**Source:** SOX compliance requirement, 2026-08-06.

## Problem

Two SOX audit requirements have no supporting evidence today.

**1. Mapping Profile — cradle to retirement.** The lifecycle can't be audited because most of it
doesn't exist as an operation yet:
- *Create*: attribution is forgeable. `saveMappingProfileBodySchema` takes `createdBy` from the
  client-supplied request body (`validation.ts:332`), not `request.auth`, even though
  `organizationId` on the same request is correctly server-derived two lines below
  (`app.ts:2171`) with an ADR-0001 comment explaining why. Already filed as ISSUE-008 and still
  unfixed — this issue's "cradle" stage is blocked on it.
- *Read/access*: there is no read endpoint at all. `grep` across `apps/api/src/app.ts` for
  `/api/mapping` shows only `GET /api/mapping/canonical-fields` (a static list) and
  `POST /api/mapping/profiles` (create). No route returns a saved profile or its version history,
  so there is nothing to log an access event against.
- *Retirement*: both `reconciliation_mapping_profile` and `..._version` have a `status`
  column (`ACTIVE`/`DEPRECATED`), but it is dead schema — referenced only in TS row types and the
  enum list, never written anywhere in `packages/persistence` or `packages/core`. There is no
  `retireMappingProfile`/`deprecateMappingProfile` function. A profile cannot currently be retired,
  so "retirement" has no audit event to produce.

**2. Logins and data access.** No authentication event is logged anywhere:
- `POST /api/auth/login` (`app.ts:1274-1368`) emits zero log lines on success or failure. Contrast
  with the signup handler later in the same file, which does tag its logs
  (`action: 'signup.entity_verification.failed'`, `app.ts:1538`) — the pattern exists, it's just
  absent from login.
- `POST /api/auth/logout` (`app.ts:1370-1389`) only logs on `denylistToken` failure
  (`authService.ts:149-171`); a normal successful logout produces no log line.
- `reconciliation_user` has no `last_login_at` and there is no sessions table.
- The generic `pinoHttp` request log (`app.ts:1102-1122`) captures method/path/status but not
  `request.auth` or the attempted username, and is only persisted to a file if `LOG_FILE` is set
  (`server.ts:83-101`) — otherwise it's stdout only, not a queryable audit store.
- `pgaudit` is installed and its absence is now a hard migration failure (`0027...sql`, per
  ISSUE-047), but `pgaudit.log` — which statement classes to actually record — is never set
  anywhere in the repo, so the extension currently audits nothing. Even configured, pgaudit
  operates at the pooled DB role level: the app sets `app.current_organization_id` per request for
  RLS tenant scoping (`readModelStore.ts:568-569`) but no per-user GUC, so pgaudit would show the
  pooled role running a query, not "user X read this data."

## Fix

**Mapping Profile:**
1. Close ISSUE-008 — derive `createdBy` from `request.auth!.username`, not the request body.
2. Add a `GET /api/mapping/profiles/:id` (and list) route, and log a read/access event
   (organization, actor, profile id, version) whenever a profile or its version history is fetched.
3. Implement retirement: a `retireMappingProfile` function that sets `status = DEPRECATED` with a
   server-derived actor and timestamp, exposed via an endpoint, with the transition itself recorded
   as an audit event — not just a silent status flip.
4. With create, read, and retire all emitting attributable events, the profile's full lifecycle is
   reconstructable from the audit trail, which is the actual SOX ask.

**Logins and access:**
1. Add structured log events (tagged `action`, matching the signup pattern) for login success,
   login failure (with reason, not the password), and logout — each carrying username, org, IP,
   and timestamp.
2. Add `last_login_at` to `reconciliation_user` (minimum) or a dedicated sessions/login-events
   table (better — supports "who accessed the data and when" queries without log-mining).
3. Set `pgaudit.log` to cover the statement classes that matter (at minimum READ/WRITE/ROLE) so the
   already-installed extension actually records something.
4. Decide whether DB-level "who" attribution matters enough to set a per-user session GUC
   alongside the existing `app.current_organization_id` pattern; without it, pgaudit records the
   pooled role, not the acting application user.
5. Ensure `LOG_FILE` (or equivalent structured sink) is set in every environment that needs to
   answer an auditor's question later — stdout-only logging is not evidence.

Related: ISSUE-008 (prerequisite — forgeable `createdBy`), ISSUE-047 (parent SOX/ICFR compliance
narrative this issue supplies engineering evidence for), ISSUE-044 (traceability matrix should
list these as covered capabilities once fixed), ISSUE-039, ISSUE-040 (due-diligence readiness).
