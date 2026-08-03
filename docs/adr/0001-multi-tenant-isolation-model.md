# ADR-0001: Multi-Tenant Isolation Model

**Status:** Accepted — Option B (shared database, RLS via session GUC)
**Date:** 2026-08-03
**Deciders:** Repository owner
**Blocks:** Backlog task "Add row-level security for tenant isolation"

> **Launch blocker.** The owner confirmed on 2026-08-03 that this is sold as a **shared service**.
> That makes the current state — no tenant column on the reconciliation tables, no link from user
> to organization, no policies — a blocker for onboarding a second customer, not merely a
> due-diligence weakness. Until the prerequisite work below lands, every customer's reconciliation
> data would sit co-mingled in one database with nothing separating it.

## Context

The platform is being prepared for sale, so a technical due-diligence reviewer will ask how one
customer's reconciliation data is kept away from another's. Today the honest answer is that
nothing enforces it, at any layer.

The prompt for this ADR assumed the decision was _which_ isolation mechanism to adopt. Inspecting
the schema shows there is a prior question, because the ingredients an isolation mechanism needs
are largely absent:

| Fact                                           | Evidence                                                                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2 of 26 tables carry `organization_id`**     | `reconciliation_mapping_profile`, `reconciliation_source_file` — from `tests/schema/schema-baseline.sql`                                                                                      |
| **The aggregate root has no tenant column**    | `reconciliation_job` columns are id/correlation/account/period/state/versioning only. 12+ tables FK to it (`canonical_row`, `exception`, `match_result`, `review_decision`, `audit_event`, …) |
| **Users are not linked to organizations**      | `reconciliation_user` = `user_name, first_name, last_name, password, last_changed, id, created_at`. No `organization_id`, no join table                                                       |
| **Where the column exists it is not enforced** | `reconciliation_source_file.organization_id` is **nullable**; only `reconciliation_mapping_profile.organization_id` is `NOT NULL`                                                             |
| **No policies exist**                          | Zero `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` across all 25 Liquibase changesets                                                                                                         |
| **No role separation**                         | The app connects as `recon_app`, which is `POSTGRES_USER` — the database owner                                                                                                                |

The consequence: **there is no path from an authenticated principal to a tenant.** Even a perfect
RLS policy has nothing to filter on, because the session cannot say who the current tenant is and
the reconciliation tables do not record which tenant they belong to.

Related: authentication is also unenforced — no route in `apps/api/src/app.ts` sits behind an auth
check. Any tenancy scheme depends on authn landing first, since the tenant is derived from the
authenticated user.

## Decision

**Adopt Option B: a shared database with row-level security driven by a session GUC
(`app.current_organization_id`).**

The deciding question was a product one — single-buyer deployment, or a shared service? The owner
confirmed **shared service** on 2026-08-03. That rules out Option A (deployment-per-tenant), which
would otherwise have been the cheaper and stronger answer, and it rules out Option D (application
filtering alone) as an acceptable end state.

Option C (role-per-tenant) is rejected for this codebase specifically: it defeats the single
shared `pg.Pool`, requiring either a pool per tenant or a reconnect per request, and it makes role
provisioning part of customer onboarding. It buys isolation-by-identity, which is genuinely
stronger than a session variable, but at a cost this architecture is not shaped to absorb. The GUC
risk it avoids is instead closed by setting the tenant at pool checkout (see Consequences).

**This is now on the critical path to launch, not a hardening task.** A shared service cannot
onboard a second customer until the prerequisite data-model work below is complete.

## Options Considered

### Option A: One deployment per customer (isolation by deployment)

Each customer gets their own database and application stack. No tenant column, no policies.

| Dimension        | Assessment                                                     |
| ---------------- | -------------------------------------------------------------- |
| Complexity       | **Low** — nothing to build; already how the Docker stack works |
| Cost             | Higher per-customer infra; trivial engineering cost            |
| Scalability      | Poor above ~dozens of customers (per-tenant ops burden)        |
| Team familiarity | High — this is the current deployment shape                    |

**Pros:** Strongest possible isolation, and the easiest to explain in diligence — a cross-tenant
leak is physically impossible, not policy-dependent. Zero migration risk. No change to 26 tables.
**Cons:** Per-customer operational overhead (migrations, upgrades, monitoring × N). Does not
support a shared-instance SaaS offering later without redoing this decision.

### Option B: Shared database, RLS driven by a session GUC

Add `organization_id` throughout, `ENABLE ROW LEVEL SECURITY` on every tenant-scoped table, and
policies matching `current_setting('app.current_organization_id')`. The API sets that GUC on
connection checkout.

| Dimension        | Assessment                                                      |
| ---------------- | --------------------------------------------------------------- |
| Complexity       | **High** — data-model migration across ~24 tables plus backfill |
| Cost             | Low infra; substantial one-time engineering                     |
| Scalability      | Good — one deployment serves many tenants                       |
| Team familiarity | Low — no RLS anywhere in the codebase today                     |

**Pros:** The database becomes the backstop, so a forgotten `WHERE` clause stops being a breach.
Testable in a way application filtering never is: connect as a tenant, `SELECT *` with no `WHERE`,
assert only that tenant's rows return. That five-line test closes an entire class of defect.
**Cons:** Requires the prerequisite work below before a single policy can be written. `pg.Pool`
reuses connections, so a missed `SET LOCAL` leaks the _previous_ request's tenant — this must be
enforced at checkout, not per query. Policies also apply to the migration role unless it is
explicitly `BYPASSRLS`, which can break Liquibase in surprising ways.

### Option C: Shared database, one PostgreSQL role per tenant

Policies keyed to `current_user`; the app connects with a different role per tenant.

| Dimension        | Assessment                                        |
| ---------------- | ------------------------------------------------- |
| Complexity       | **High** — plus role lifecycle management         |
| Cost             | Low infra; high operational burden                |
| Scalability      | Poor — role-per-tenant defeats connection pooling |
| Team familiarity | Low                                               |

**Pros:** Isolation is enforced by identity rather than a session variable, so it cannot be
subverted by forgetting to set a GUC.
**Cons:** A separate pool per tenant, or reconnecting per request — both undermine the existing
single shared `pg.Pool`. Provisioning a role becomes part of customer onboarding. Poor fit for
this codebase.

### Option D: Application-level filtering only (status quo)

Keep filtering in application SQL, as `readModelStore.ts` does in 7 places today.

**Pros:** No work.
**Cons:** Not a control. One missing predicate is a cross-tenant breach with no second line of
defence, and it cannot be demonstrated to a reviewer — you can only assert that every query is
correct, forever. Unacceptable if the product is genuinely multi-customer.

## Trade-off Analysis

The real trade is **operational cost (A) versus one-time engineering cost plus ongoing correctness
risk (B)**.

Option A's weakness is per-customer ops overhead, which only becomes painful at scale the product
may never reach. Option B's weakness is that it is not a policy addition — it is a schema
migration touching essentially every table, and it introduces a subtle new failure mode (pooled
connection carrying a stale tenant GUC) that must be closed at the pool layer.

Crucially, **A and B are not equally reversible**. Starting at A and moving to B later is a
migration you can schedule. Shipping B badly — policies on a partially-tenanted schema — creates
a false sense of safety that is worse than D, because everyone stops checking their `WHERE`
clauses while gaps remain.

Option C is dominated by B for this codebase: same isolation guarantee, worse fit with pooling.

## Consequences

**If Option A:**

- Easier: nothing to build; backlog task #2 closes as "not applicable"; diligence answer becomes
  simple and strong
- Harder: a future shared-instance offering reopens this decision with more data to migrate
- Revisit when: a prospect asks for a shared/hosted deployment

**If Option B:**

- Easier: cross-tenant leakage becomes structurally impossible rather than review-dependent, and
  provably so in tests
- Harder: every new table must remember its policy — add that to the pgTap schema baseline so a
  policy-less tenant table fails the build; the migration role needs `BYPASSRLS`; connection
  checkout gains a mandatory step
- Revisit when: performance of RLS predicates on the largest tables (`canonical_row`, `raw_row`)
  is measured under real volume

## Prerequisite work (Options B and C only)

None of this is optional, and none of it is policy authoring:

1. Link principals to tenants — `reconciliation_user.organization_id`, or a membership table if a
   user may belong to several.
2. Put `organization_id NOT NULL` on `reconciliation_job`, the aggregate root. Everything with a
   `job_id` inherits tenancy from it, so this single column covers most of the 24 tables — either
   by denormalizing the column down, or by writing policies that join to `job`. Denormalizing is
   faster to query and simpler to police; joining avoids the backfill.
3. Make `reconciliation_source_file.organization_id` `NOT NULL` and backfill it.
4. Decide the backfill value for existing rows — there is currently no organization to attribute
   them to.
5. Land authentication first. The GUC is set from the authenticated principal; without authn there
   is nothing to derive it from.

## Action Items

Ordered. Steps 1–3 are the prerequisite data model; no policy can be written before they land.

1. [x] **Server-side authentication.** Landed 2026-08-03 (ADR-0002): JWT-based auth,
       deny-by-default middleware, role authorization. Every request that reaches a route handler
       now carries `request.auth.{username,role,organizationId}` — the GUC has something to read.
       Still open: nothing sets `app.current_organization_id` yet (step 6 below).
2. [x] **Link principals to tenants.** Decided 2026-08-03: single org per user — a `NOT NULL` FK
       `reconciliation_user.organization_id` column, not a membership table. No consultant/support
       use case needing multi-org access today.
3. [x] **Tenant the data model.** Landed 2026-08-03 (changeset `0028`): `organization_id NOT NULL`
       on `reconciliation_job` (the aggregate root), backfilled to the same default organization
       `reconciliation_user`/`reconciliation_mapping_profile` already use.
       `reconciliation_source_file.organization_id` is now `NOT NULL`. Denormalize-down (not
       join-to-job) chosen, matching the ADR's own recommendation, onto all ~20 descendant tables
       (direct `job_id` FK, or chained through `reconciliation_source_file` /
       `reconciliation_mapping_profile` / `reconciliation_import_approval`). Excluded on purpose:
       `reconciliation_template_definition` and `reconciliation_validation_rule_version` are global
       catalogs with no account/job association in their schema, not per-customer data. The
       persistence layer (`reconciliationLifecycleStore.ts`, `readModelStore.ts`) and the API layer
       (`app.ts`, `reconciliationQueue.ts`) were updated in the same pass to populate the column on
       every write — `organization_id` is a schema constraint AND actually gets set correctly by
       every code path, not just addable-in-theory.
4. [ ] **Least-privilege roles** — backlog task #1. Policies are written against roles, so this
       lands before them. Grant `BYPASSRLS` to the Liquibase/migration role.
5. [ ] **Enable RLS and write policies** on every tenant-scoped table.
6. [ ] **Set the tenant at pool checkout** in `packages/persistence/src/postgres.ts` — not per
       query. A missed `SET LOCAL` on a pooled connection serves the previous request's tenant.
7. [ ] **Make a policy-less table fail the build.** Extend `tests/testHelpers/schemaBaseline.ts` to
       assert RLS is enabled on every tenant-scoped table, so the schema-drift test catches a new
       table that forgot its policy.
8. [ ] **Add the leak tests.** Connect as tenant A, `SELECT *` with no `WHERE`, assert zero
       tenant-B rows; and a cross-tenant `UPDATE`/`DELETE` affecting zero rows.

## Notes

Sequencing against the existing backlog: task #1 (least-privilege roles) lands before policies —
it is independently valuable and policies are written against roles. Task #3 (pgaudit) is
independent of this decision and can proceed in parallel.

Scope warning: backlog task #2 was originally written as "add RLS policies." Given the findings
here, roughly 80% of that work is the data model and authentication that must precede any policy.
Estimate accordingly.
