# Architecture

This document explains how the reconciliation platform is structured, how data flows through it, and where to make changes safely.

## 1. System context

The platform reconciles two accounting data sources:

- bank workbook export
- general ledger (GL) workbook export

It produces:

- summary metrics
- probable match review queue
- categorized exceptions with rule trace
- workbook export for downstream accounting workflows

## 2. Runtime modes

The same codebase supports two main runtime shapes.

### Local development mode

- Web app served by Vite (`apps/web`)
- API served by Node/Express (`apps/api`)
- Optional PostgreSQL depending on env configuration

### Production-like Docker mode

- Public NGINX gateway (`web`)
- Internal Express API (`api`)
- Internal PostgreSQL (`postgres`)
- One-shot migration service (`migrate`) that runs before API startup
- Auxiliary admin services in dev/stage (`pgweb`, `nginx-ui`)

## 3. High-level component architecture

```text
[Web UI: apps/web]
        |
        | HTTP /api/*
        v
[API: apps/api]
        |
        | uses
        v
[Core pipeline: packages/core]
        |
        | persists (when enabled)
        v
[Persistence: packages/persistence -> PostgreSQL]

Shared contracts: packages/domain
Runtime/default configuration: packages/config
Shared fixtures: packages/test-fixtures
```

## 4. Package responsibilities

### `apps/web`

- Upload workflow for source files
- Run metadata capture (account, frequency, period label)
- Rendering for summary, probable matches, grouped artifacts, exceptions, and reviewer decisions
- Workbook export trigger via API
- Optional developer dashboard surface

### `apps/api`

- Multipart upload handling and validation
- Reconciliation workflow orchestration
- Read endpoints for latest/by-id report, summary, exceptions, reviewer decisions
- Reviewer decision validation + persistence
- Developer diagnostics endpoints
- Health and workbook export endpoints

### `packages/core`

- Workbook parse and row lineage capture
- Normalization and text/token processing
- Candidate generation and reconciliation matching
- Exception classification and severity mapping
- Summary/chart generation
- Workbook export assembly

### `packages/persistence`

- PostgreSQL migrations (Liquibase changesets under `packages/persistence/liquibase/changesets/`)
- Lifecycle write model store (`reconciliationLifecycleStore.ts`)
- Query-side store (`readModelStore.ts`) that assembles the run report, summary, exceptions and reviewer decisions from the base tables; there is no projection step, and the module also carries the write paths for payee aliases, matching-config versions, mapping profiles, approvals and replay estimates
- Per-aggregate stores on the same shape (`accountStore.ts`, `openItemStore.ts`, `importRunStore.ts`, `importValidationStore.ts`, `savedViewStore.ts`, `subledgerEntityStore.ts`), all tenant-scoped through `runInTenantScope`
- Connection/pool configuration via environment

### `packages/domain`

- Shared type system (`ReconciliationRunReport`, `SummaryMetrics`, `ExceptionItem`, `ReviewerDecision`, etc.)

### `packages/config`

- Default reconciliation behavior
- Account-specific override examples

## 5. End-to-end data flow

1. **Submission**
   - Web posts multipart form data (`bankFile`, `glFile`) to `POST /api/reconciliation/run`.

2. **Input processing**
   - API validates files and request metadata.
   - Core parser loads workbook rows and source lineage.

3. **Normalization and matching**
   - Core normalizes text/date/amount/reference fields.
   - Matching computes exact/probable/grouped/variance outcomes.

4. **Exception classification**
   - Residual and matched-review outcomes are categorized into accountant-facing exceptions.

5. **Summary and export artifacts**
   - Summary metrics and chart series are produced.
   - Workbook export binary and manifest metadata are produced.

6. **Persistence and read model**
   - If PostgreSQL is enabled, lifecycle and read model records are persisted.
   - API returns a sanitized `ReconciliationRunReport` payload.

7. **Review lifecycle**
   - Reviewer decisions are submitted through `POST /api/reconciliation/:id/reviewer-decisions`.
   - Decisions are validated against target type and allowed outcome combinations.

## 6. Data ownership and storage

## Durable storage

When `RECON_PERSISTENCE_BACKEND=postgres` and DB connectivity are configured:

- lifecycle stages and audit events are durable
- read-model queries power run report, summary, exceptions, and decisions

Schema changes are Liquibase formatted-SQL changesets under `packages/persistence/liquibase/changesets/`, applied by the one-shot `migrate` compose service before the API starts and locally by `npm run docker:migrate`. The API process never migrates. The committed pgTap baseline (`packages/persistence/tests/schema/schema-baseline.sql`) is the authoritative snapshot of the current schema; the repository keeps no other DDL tree.

## Compatibility snapshot

API still keeps a file-backed latest-run snapshot (`RECONCILIATION_RUN_STORE_PATH`) for restart compatibility and local run continuity in the no-Postgres mode. When Postgres is enabled the snapshot is still written but never read (reads go to the read model, which is authoritative once configured); confining the snapshot to the no-Postgres path is issue #551.

## 7. API architecture notes

- Express app sets `trust proxy` to support gateway forwarding. **Currently `true`
  (`app.ts:1725`), which makes `req.ip` attacker-controlled via `X-Forwarded-For` and
  bypasses the API rate limiter; `express-rate-limit`'s warning for this is suppressed at
  `app.ts:1297`. Tracked as action item 1 in ADR-0004.**
- Correlation IDs are propagated in response headers.
- Diagnostics middleware tracks failed requests and exceptions.
- Developer endpoints are policy-gated by environment.

See `docs/api.md` for full contract details.

## 8. Diagnostics and quality architecture

## Developer status diagnostics

Quality-gate checks (`test:unit`, `test:integration`, `test:e2e`, `test:postgres`, `lint`,
`typecheck`, `coverage`, `security:scan`) run nightly via GitHub Actions
(`.github/workflows/dashboard-status.yml`), never against a live product instance. Each check runs
as its own parallel job; an `aggregate` job combines their results and publishes one JSON payload
to the repo's `status-data` branch (`scripts/ci/aggregate-dashboard-status.ts`).

A fully separate application -- `apps/developer-dashboard-api` (GitHub OAuth login, reads the
published payload) and `apps/developer-dashboard-web` -- reads and displays that payload. It shares
no runtime, login, or execution surface with the product; the product cannot trigger a check run or
see live diagnostics about itself.

## 9. Deployment safety architecture

Deployment-related guardrails are intentionally externalized to scripts:

- `scripts/pre-flight/preflight-build-checks.sh`
- `scripts/pre-flight/predeploy-stack-checks.sh`
- `scripts/pre-flight/db-preflight-checks.sh`
- `scripts/in-flight/in-flight-url-check.sh`
- `scripts/in-flight/in-flight-db-user-check.sh`

This keeps operational risk checks explicit and repeatable outside the request path.

## 10. Change impact guide

When changing these areas, expect these follow-up updates:

- matching/classification logic -> update `docs/reconciliation-rules.md` and tests
- endpoint contracts -> update `docs/api.md` and integration tests; add the route to `apps/api/src/openApiPaths.ts` (the router-derived `docs:openapi:check` fails on any registered route without an entry)
- a new route family -> a router module under `apps/api/src/routes/` with its rules in a service, never new handler bodies in `app.ts` (section 12, C1)
- persistence schema/stores -> a new Liquibase changeset, update `design/persistence/postgresql-persistence-architecture.md` and DB tests; a new status column ships with its transition graph in `packages/persistence/src/stateMachine.ts` and an enumeration test (section 12, C3)
- a response shape the web consumes -> declare it in `packages/domain` and import it on both sides (section 12, C6)
- deployment behavior/scripts -> update `docs/local-docker-platform.md` and preflight checks
- setup workflows -> update `docs/developer-setup.md`

## 11. Signup verification and abuse defence

Self-registration is defended in four layers. See
`design/adr/0004-signup-abuse-controls.md` for the decisions and
`design/create-account/signup-abuse-defense-work-plan.md` for sizing.

| Layer | Control                                                    | Runs                                               | Establishes                                              |
| ----- | ---------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| 1     | Cloudflare Turnstile                                       | signup form + server-side `siteverify`             | The client passed a browser-integrity check              |
| 2     | Email: normalize, disposable blocklist, role list, MX      | in-process, `validation.ts`                        | The address is well-formed, not throwaway, and reachable |
| 3     | Phone: E.164 parse, Twilio Lookup line type, Twilio Verify | `phoneVerificationService.ts`, last in the handler | Someone received a code at a number of a known line type |
| 4     | Rate limiting (app) and edge rate limiting                 | `app.ts` limiter; AWS WAF or Cloudflare            | Bounds attack rate and vendor spend                      |

Ordering is a hard constraint, not a preference: free in-process checks (layers 1 and 2) run before
any paid network call (layer 3), and layer 4 must bind before layer 3 is reachable — a paid lookup
on an unauthenticated endpoint behind a bypassable limiter is a way for an attacker to spend our
money.

**Scope.** These layers raise the unit cost of an abusive account; they do not establish identity.
NIST SP 800-63B forbids email as an out-of-band authenticator and classifies SMS as RESTRICTED, so
neither channel is identity proofing at any assurance level. The control that bounds damage from an
account that passes every layer is consumption metering (ADR-0004 DECIDE 3), not the layers above.

Entity verification (`EntityVerificationProvider`) is retained as optional enrichment only and is
being removed from `isFullyVerified`; Secretary of State filing numbers are public records and
stop no one.

## 12. Architecture conventions (ADR-0020)

A design-pattern evaluation of the codebase on 2026-09-13 (design repo,
`design/adr/design_patterns/design-pattern-evaluation-2026-09-13.md`) found the adopted rules met and a
set of patterns started but not finished: an incomplete service layer behind a 5,538-line `app.ts`, a
state transition table on `reconciliation_job` only, per-store rather than per-use-case transactions, a
half-registry for source-type dispatch, a never-compared `record_version`, and a web shell that
hand-mirrors persistence types. ADR-0020 (`design/adr/0020-application-architecture-conventions.md`)
turns the target shape into conventions for new and touched code; the roadmap beside it
(`design-pattern-roadmap-2026-09-13.md`, tracking issue #547) retires the existing sites one PR at a
time. Existing code that a change does not touch is grandfathered.

The conventions, in short:

| #   | Rule                                                                                                                                                                                                                 | Guard                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| C1  | New route families are `express.Router` modules under `apps/api/src/routes/`; handlers validate, authorize, call one service and map errors. `app.ts` gains no handler bodies.                                       | route-count and line-count ratchet on `app.ts` (#549) |
| C2  | Writes across stores that must succeed together run in one `runInTenantScope`; stores accept a caller-supplied client (the `BlobStorage` precedent). No `try/catch` swallows a write that follows a committed write. | review; #393 retrofits the finalize path              |
| C3  | Every status column has a declared transition graph, asserted `FOR UPDATE` at every write, with an enumeration test.                                                                                                 | enumeration tests; #550 adds the run graph            |
| C4  | One definition per business predicate (`isCleared`, carry-eligible, approvable) in `packages/domain`.                                                                                                                | #374                                                  |
| C5  | Dispatch on a type is a registry entry, never an `if/else` chain (`HEADERS_BY_FILE_TYPE` is the model).                                                                                                              | review; #266                                          |
| C6  | Shapes that cross the API boundary are declared in `packages/domain` and imported by both apps; no `string` where a domain union exists.                                                                             | typecheck; #553                                       |
| C7  | Rows a person edits use an append-only event table or a `record_version` compare; no silent last-writer-wins upsert.                                                                                                 | review; #354 / #421 decide the reviewer-decision case |
| C8  | Matching pre-passes plug into `reconcileMatches` through one typed pre-pass contract, not new positional parameters.                                                                                                 | review                                                |
| C9  | Web: server reads through TanStack Query hooks with a key factory; session and permissions from a context provider; storage keys in one module; domain computation in `lib/` or `packages/domain`.                   | #490, #484 tree                                       |
| C10 | Until #363 lands integer minor units, amount comparisons go through `currencyEquals` or a shared helper; no new `Map`/`Set` keyed on a raw amount.                                                                   | review                                                |
| C11 | Each mechanically checkable rule gets a guard test on the `errorHandlingArchitecture.test.ts` pattern; pinned numbers only go down.                                                                                  | the guards themselves                                 |
| C12 | The change-impact guide above is binding; generated references are authoritative; `docs/class-method-reference.md` is frozen.                                                                                        | `docs:api:check`, `docs:openapi:check`                |

## 13. Related references

- `docs/api.md`
- `generated/openapi.generated.json` (router-derived; the authoritative route inventory)
- `generated/api-reference-generated.md` (generated class and method reference; `docs/class-method-reference.md` is a frozen historical snapshot)
- `docs/reconciliation-rules.md`
- `design/persistence/postgresql-persistence-architecture.md`
- `docs/local-docker-platform.md`
- `docs/test-strategy.md`
- `design/adr/0020-application-architecture-conventions.md` and `design/adr/design_patterns/` (design repo)
- `design/adr/0004-signup-abuse-controls.md`
- `design/create-account/signup-abuse-defense-work-plan.md`
