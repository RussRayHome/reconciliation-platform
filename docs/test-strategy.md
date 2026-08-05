# Test Strategy

This strategy defines how the platform protects reconciliation correctness, API stability, UI behavior, and deployment safety.

## 1. Objectives

The test and validation stack is designed to:

- keep reconciliation outcomes deterministic and auditable
- prevent API contract regressions
- protect the analyst workflow in the web app
- verify persistence behavior with real PostgreSQL
- catch release risk via lint/typecheck/security/build and Docker preflight gates

## 2. Test layers

## Unit tests

Scope:

- normalization, parsing helpers, and matching utilities
- exception classification and summary logic
- UI component behavior in isolation

Command:

```bash
npm run test:unit
```

## Integration tests

Scope:

- API upload handling and request validation
- reconciliation execution through HTTP routes
- report and exception retrieval behavior

Command:

```bash
npm run test:integration
```

## PostgreSQL integration tests

Scope:

- migration-backed persistence operations
- lifecycle state transition durability
- uniqueness and rollback behavior

Command:

```bash
npm run test:postgres
```

## End-to-end tests

Scope:

- browser upload-to-results workflow
- monthly reconciliation controls and output visibility
- end-user critical path from file submission through report surfaces

Command:

```bash
npm run test:e2e
```

## 3. Command matrix

| Command                    | Purpose                         | Typical use               |
| -------------------------- | ------------------------------- | ------------------------- |
| `npm run test`             | unit + integration aggregate    | default pre-PR validation |
| `npm run test:unit`        | fast deterministic logic checks | iterative development     |
| `npm run test:integration` | API contract behavior           | route/service changes     |
| `npm run test:postgres`    | real DB persistence checks      | schema/store changes      |
| `npm run test:e2e`         | browser regression checks       | UI workflow changes       |
| `npm run lint`             | static quality checks           | every PR                  |
| `npm run typecheck`        | TS type safety checks           | every PR                  |
| `npm run coverage`         | coverage report generation      | release verification      |
| `npm run security:scan`    | dependency vulnerability audit  | release verification      |
| `npm run build`            | production build integrity      | merge/release gate        |

## 4. Suggested validation tiers

## Tier A: fast local confidence

```bash
npm run test
npm run lint
npm run typecheck
```

## Tier B: full application confidence

```bash
npm run test
npm run test:postgres
npm run test:e2e
npm run coverage
npm run build
```

## Tier C: release and deployment confidence

```bash
npm run test
npm run test:postgres
npm run test:e2e
npm run lint
npm run typecheck
npm run coverage
npm run security:scan
npm run build
npm run docker:preflight
npm run docker:db:preflight
npm run docker:predeploy
```

## 5. Fixture strategy

`packages/test-fixtures` is the shared fixture source for:

- unit tests
- integration tests
- e2e tests
- docs sample generation (`npm run fixtures:generate`)

Guidelines:

- update fixtures centrally when business rules evolve
- avoid ad hoc one-off fixture definitions in individual test suites
- keep fixture names scenario-oriented (`timing-difference`, `amount-mismatch`, etc.)

## 6. Coverage scope

Repository coverage gates are enforced in `vitest.config.ts` with minimum thresholds of:

- statements: `80%`
- branches: `80%`
- functions: `80%`
- lines: `80%`

The current suite verifies key reconciliation behavior including:

- beginning-balance exclusion
- duplicate handling split by source
- data-quality blocking and classification
- amount mismatch and date/timing variance outcomes
- stale outstanding check classification
- likely miscoding classification
- reference/check/description variance paths
- ambiguous review candidate handling
- grouped split/combine and grouped deposit residual handling
- summary category counts and exposure alignment
- workbook export generation and API retrieval

## 7. Developer Dashboard as quality dashboard

GitHub Actions runs the full quality-gate suite nightly and publishes one aggregated payload to
the `status-data` branch (see `docs/architecture.md`, "Developer status diagnostics"). The separate
Developer Dashboard app reads and displays it.

It is useful for:

- quick health snapshots
- trend visibility across nightly runs

It is not a replacement for direct command execution when debugging a failing check.

## 8. Non-test quality gates

Operational scripts complement test suites:

- `docker:preflight` for container/build hygiene
- `docker:predeploy` for compose startup/shutdown and health checks
- `docker:db:preflight` for migration/schema/index/constraint and DB vulnerability checks

These gates should run for infrastructure, container, or persistence-impacting changes.

## 9. Adding or changing tests

When introducing new behavior:

1. add/adjust unit tests for deterministic logic
2. add integration tests when API contracts change
3. add e2e assertions when user workflow changes
4. add postgres tests when persistence schema/store behavior changes
5. update `docs/reconciliation-rules.md` or `docs/api.md` when behavior contracts change

## 10. Useful references

- `docs/reconciliation-rules.md`
- `docs/api.md`
- `docs/developer-setup.md`
- `docs/local-docker-platform.md`
- `docs/class-method-reference.md`
