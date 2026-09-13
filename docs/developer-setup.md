# Developer Setup

This guide is the practical runbook for local development, validation, and deployment checks in the reconciliation platform.

## 1. Prerequisites

Install the following before working in the repo:

- Node.js >= 20
- npm
- Docker Desktop
- Git
- Optional: Python + `openpyxl` for workbook comparison diagnostics

Recommended verification:

```bash
node -v
npm -v
docker --version
docker compose version
```

## 2. Install and bootstrap

From the repository root:

```bash
npm install
cp .env.example .env
```

For Docker workflows:

```bash
cp .env.docker.dev.fallback .env.docker.dev
npm run docker:validate-env
```

## 3. Local development workflow

### Start API + web

```bash
npm run dev
```

Default local ports:

- Web (Vite): `http://localhost:5173`
- API (Express): `http://localhost:4000`
- API health: `http://localhost:4000/api/health`

### Start services separately

```bash
npm run dev:api
npm run dev:web
```

### Runtime harness (fixed ports and lifecycle controls)

```bash
npm run harness:start
npm run harness:status
npm run harness:restart
npm run harness:stop
npm run runtime:status
```

Harness defaults:

- API: `4000`
- Web: `4173`

Use the harness when you want predictable local ports and explicit start/stop behavior.

## 4. Run a reconciliation locally

1. Open the web app.
2. Upload both source files (`bankFile`, `glFile`).
3. Set account identifier (optional), reconciliation frequency, and period label.
4. Submit the run.
5. Review summary, probable matches, and exception report.
6. Download workbook export.

Generated sample files for testing:

```bash
npm run fixtures:generate
```

Samples are written to `fixtures/` (git-ignored).

## 5. Quality gate workflow

Run these before opening or updating a pull request:

```bash
npm run test
npm run test:postgres
npm run test:e2e:functional
npm run test:e2e:visual:container
npm run lint
npm run typecheck
npm run build
npm run coverage
npm run security:scan
```

The plain `npm run test:e2e` still runs both Playwright projects together, but the `visual`
project now refuses to run outside its canonical container (see "The `visual` project requires
Docker" below) -- for local pre-PR checks, run `test:e2e:functional` and
`test:e2e:visual:container` as two separate commands instead of the aggregate.

### What each command validates

- `test`: unit + integration logic and API behavior.
- `test:postgres`: PostgreSQL lifecycle/persistence integration via Testcontainers.
- `test:e2e:functional`: browser-level behavioural/workflow checks, runs directly on the host.
- `test:e2e:visual:container`: pixel-comparison regression checks, runs inside the pinned
  `docker/e2e-visual.Dockerfile` container -- see below for why.
- `lint`: static quality and style checks.
- `typecheck`: TypeScript type safety across workspaces.
- `build`: production bundle/compile verification.
- `coverage`: combined coverage for unit + integration suites. Requires Docker -- see
  "`coverage` requires Docker, and what to do when it isn't available" below.
- `security:scan`: npm audit with high-severity threshold.

### The `visual` project requires Docker

`apps/web/tests/e2e/visual/visual-baseline.spec.ts` only runs inside the canonical container
(`docker/e2e-visual.Dockerfile`, pinned to `mcr.microsoft.com/playwright:v1.62.1-noble`, matching
CI's `ubuntu-24.04` runner). Running it directly on the host fails fast with an explanatory error
(`containerGuard.ts`) instead of silently comparing against or overwriting baselines with your own
OS's font rendering -- macOS and Linux Chromium produce measurably different pixels for the same
page, which is what caused the two-baseline-set problem this container exists to fix.

```bash
npm run test:e2e:visual:container                    # run the visual lane
npm run test:e2e:visual:container:update-snapshots    # regenerate baselines (deliberate only --
                                                       # review the resulting PNG diff before committing)
```

Don't have Docker locally, or want the regeneration to run on the same CI-grade environment PRs
are checked against? Dispatch the **Regenerate Visual Baselines** workflow
(`.github/workflows/regenerate-visual-baselines.yml`) from the Actions tab, picking your PR branch
as the ref to run from. It runs the same container-based `update-snapshots` command and pushes any
changed baseline PNGs straight back to that branch as their own commit -- still reviewed as an
image diff like any other baseline update, just without needing Docker on your own machine. It
refuses to run against `dev` directly.

The `functional` project is unaffected and always runs directly on the host.

### `coverage` requires Docker, and what to do when it isn't available

`npm run coverage` includes the `unit-data` project, whose `globalSetup` starts PostgreSQL through
Testcontainers. That needs a working Docker daemon.

When Docker is unavailable, wedged, or the machine is too loaded to start a container, use the
Docker-free variant:

```bash
npm run coverage:docker-fallback    # same run, minus the unit-data project
```

It passes all four coverage thresholds and finishes faster, at a small cost in reported coverage:

| metric     | `coverage` | `coverage:docker-fallback` | threshold |
| ---------- | ---------- | -------------------------- | --------- |
| statements | 90.46%     | 88.13%                     | 75%       |
| branches   | 82.86%     | 79.89%                     | 75%       |
| functions  | 88.82%     | 85.83%                     | 75%       |
| lines      | 90.78%     | 88.42%                     | 75%       |

(measured 2026-09-06; 326 s versus 217 s. `packages/persistence/src` stays in the denominator
either way -- the `integration` project still covers it to 72%, which is why dropping `unit-data`
costs ~3 points rather than ~13.)

Use the fallback for a quick local signal. It is **not** a substitute for `coverage` in release
verification, because it does not exercise the schema/migration suite at all.

If the Testcontainers bring-up stalls rather than failing, it is bounded (issue #285): after
`RECON_TESTCONTAINERS_TIMEOUT_MS`, default 300 s, `globalSetup` aborts with recovery instructions
instead of hanging silently. The usual cause is machine saturation, not Docker; check for a
`testcontainers-ryuk-*` container stuck in `Created` and `docker rm -f` it. Do not run `coverage`
concurrently with another test invocation.

## 6. Docker deployment runbook

Use this path for production-like local verification.

### Standard deploy sequence

```bash
npm run docker:validate-env
npm run docker:preflight
npm run docker:deploy          # builds images, runs migrations, creates db users, starts all services
npm run docker:db:preflight
npm run docker:health
npm run docker:predeploy
```

`docker:deploy` automates user creation — no manual `db:users:dev` step is needed on a fresh deploy.

### First-time setup with seed data

After a fresh deploy, optionally seed a representative baseline dataset:

```bash
npm run db:seed:dev
```

### Helpful supporting commands

```bash
npm run docker:migrate
npm run docker:redeploy
npm run docker:logs
npm run docker:cleanup
```

### Service topology

| Service    | Role                      | Host port                                 | Environments    |
| ---------- | ------------------------- | ----------------------------------------- | --------------- |
| `web`      | NGINX public gateway      | `4174` dev (HTTPS) / `4273`\|`4274` stage | dev, stage      |
| `api`      | Express API               | internal                                  | dev, stage      |
| `postgres` | PostgreSQL data store     | `5432`                                    | dev, stage      |
| `migrate`  | One-shot migration runner | none                                      | dev, stage      |
| `pgweb`    | Postgres web admin        | `8081`                                    | dev, stage only |
| `nginx-ui` | NGINX admin UI            | `8082` / `8182`                           | dev, stage only |

The full test and quality gate suite (unit, integration, E2E, lint, typecheck, coverage, security
scans) runs nightly via GitHub Actions (`.github/workflows/dashboard-status.yml`), not against this
local stack -- see the separate Developer Dashboard (`apps/developer-dashboard-api`/
`apps/developer-dashboard-web`) for results.

Access points after deploy:

- Application: `https://127.0.0.1:4174` (dev) / `https://127.0.0.1:4274` or `http://127.0.0.1:4273` (stage)
- Documentation Hub: `https://127.0.0.1:4174/<environment>/docs` (for example `dev/docs`)
- Postgres Admin (gateway route): `https://127.0.0.1:4174/<environment>/pgweb` (for example `dev/pgweb`)
- Postgres Admin (direct port): `http://127.0.0.1:8081`
- NGINX UI (direct port): `http://127.0.0.1:8082`

## 7. Preflight checks

### Build preflight (`npm run docker:preflight`)

Runs checks for:

- Docker daemon availability
- `.dockerignore` coverage
- Dockerfile linting
- secret-pattern scan
- host port conflicts
- env file presence
- image build + image size check
- non-root runtime user check
- dev dependency leak check
- Trivy vulnerability scan

### Compose predeploy (`npm run docker:predeploy`)

Runs checks for:

- compose config validity
- stack startup readiness
- `/api/health` endpoint reachability via gateway
- inter-service connectivity probe
- auxiliary admin service health checks (`pgweb` and `nginx-ui` in dev/stage)
- graceful shutdown behavior
- cleanup integrity

### Database preflight (`npm run docker:db:preflight`)

Runs checks for:

- Docker + env resolution
- Postgres startup and readiness
- migration table existence
- schema patch coverage parity
- required tables, indexes, and constraints
- write/read smoke verification
- Trivy scan of DB image with optional allowlist handling

Temporary CVE exceptions can be managed in:

- `scripts/ops/db-cve-allowlist.txt`

## 8. Persistence and environment modes

### Local env (`.env`)

Common flags:

- `RECON_PERSISTENCE_BACKEND=postgres`
- `DATABASE_URL=postgresql://...`

### Docker env (`.env.docker`)

Common flags:

- `API_DATABASE_URL=postgresql://...@postgres:5432/...`
- `ENABLE_PGAUDIT=true` (dev/stage), `false` (production/default)
- `RECONCILIATION_RUN_STORE_PATH=/var/lib/reconciliation/latest-reconciliation-run.json`

Migrations are not an API setting: the `migrate` compose service applies the Liquibase changesets before the API starts (`npm run docker:migrate` runs the same step by hand).

## 9. Troubleshooting

### Port conflict failures

Symptoms:

- preflight reports listeners on `4000`, `4173`, `5432`, or `5173`

Fix:

```bash
npm run harness:stop
npm run docker:cleanup
lsof -i :4000 -i :4173 -i :5432 -i :5173
```

### Docker deploy does not become healthy

Check:

```bash
npm run docker:logs
npm run docker:health
```

Then re-run:

```bash
npm run docker:redeploy
```

### PostgreSQL migration failures

Check DB preflight output and schema parity:

```bash
npm run docker:db:preflight
```

If needed, clean and redeploy:

```bash
npm run docker:cleanup
npm run docker:deploy
```

### E2E test environment issues

Ensure Playwright browsers are installed and stack is stable:

```bash
npx playwright install
npm run test:e2e:functional
```

(The `visual` project needs Docker, not a local browser install -- see "The `visual` project
requires Docker" above.)

If E2E tests pass but complete in 3–4 ms (all skipped), the Playwright browser version does not
match the installed binary -- reinstall with `npx playwright install --with-deps chromium`.

## 10. Pull request quality baseline

Before merge:

1. Run the quality gate workflow from section 5.
2. Run Docker preflight and predeploy checks for deployment-facing changes.
3. Ensure required branch protection checks pass.

See `design/github_design/branch-protection.md` for recommended required checks.

## 11. Complete root script catalog

Source of truth: `package.json` scripts at the repository root.

### Development and runtime

- `dev`: starts API and web dev servers together using `concurrently`.
- `dev:api`: starts the API workspace dev server (`tsx watch`).
- `dev:web`: starts the web workspace Vite dev server.
- `dev:api:test`: starts API in non-watch runtime mode for harness/testing flows.
- `dev:web:test`: starts web in test runtime mode on `127.0.0.1:4173`.
- `ops:web:start`: starts only the compose `web` service via helper script.
- `ops:web:stop`: stops only the compose `web` service via helper script.
- `ops:db:start`: starts only the compose `postgres` service via helper script.
- `ops:db:stop`: stops only the compose `postgres` service via helper script.
- `ops:docker:stop`: stops Docker Desktop (macOS helper behavior).
- `ops:docker:restart`: restarts Docker Desktop and prints compose status.
- `ops:startup`: starts the compose stack path (`postgres`, `migrate`, `api`, `web`).
- `ops:shutdown`: stops stack services and shuts down Docker Desktop.
- `harness:start`: starts fixed-port local API/web harness for predictable local runs.
- `harness:restart`: restarts the fixed-port runtime harness.
- `harness:stop`: stops runtime harness processes on harness ports.
- `harness:status`: prints fixed-port harness listener status.
- `runtime:status`: prints current API/web runtime mode and port listeners.

### Docker and deployment operations

- `docker:validate-env`: validates Docker env files and required variable presence.
- `docker:preflight`: runs build-time Docker safety checks before stack startup.
- `docker:build`: runs `docker compose build` for stack images using env-file fallback (`.env.docker.dev` -> `.env.docker.dev.fallback`).
- `docker:predeploy`: runs compose startup/shutdown and readiness predeploy checks.
- `docker:db:preflight`: runs DB patch parity, schema integrity, and DB-image vulnerability checks.
- `docker:gate`: runs `docker:preflight` then `docker:predeploy` as a combined gate.
- `docker:migrate`: runs migration workflow script against configured runtime.
- `docker:health`: runs Docker runtime health checks.
- `docker:deploy`: executes the standard deploy runbook script.
- `docker:redeploy`: executes cleanup/restart deploy runbook script.
- `docker:smoke`: runs isolated end-to-end Docker smoke checks, then tears down.
- `docker:up`: runs `docker compose up --build` using env-file fallback (`.env.docker.dev` -> `.env.docker.dev.fallback`).
- `docker:cleanup`: runs Docker cleanup script for stack artifacts.
- `docker:down`: runs `docker compose down --remove-orphans` using env-file fallback (`.env.docker.dev` -> `.env.docker.dev.fallback`).
- `docker:logs`: tails compose logs using env-file fallback (`.env.docker.dev` -> `.env.docker.dev.fallback`).

### Build, test, and static quality

- `build`: builds all workspaces that expose a build script.
- `test`: runs unit and integration suites in sequence.
- `test:unit`: runs Vitest unit projects (`unit-core`, `unit-web`).
- `test:integration`: runs Vitest integration project.
- `test:postgres`: runs PostgreSQL integration suite (Testcontainers-backed).
- `test:e2e`: runs Playwright end-to-end browser tests (both projects — `functional` and `visual`); the `visual` half only succeeds inside the canonical container (see `test:e2e:visual:container` below).
- `test:e2e:functional`: runs only the `functional` Playwright project (behavioural, no screenshots).
- `test:e2e:visual`: runs only the `visual` Playwright project directly — fails fast outside the canonical container; not meant to be run directly, use `test:e2e:visual:container` instead.
- `test:e2e:visual:update-snapshots`: same, with `--update-snapshots` — also container-only.
- `test:e2e:visual:container`: builds and runs the `visual` project inside `docker/e2e-visual.Dockerfile` — the supported way to run visual regression checks.
- `test:e2e:visual:container:update-snapshots`: regenerates `visual` project baselines inside the container — a deliberate act, never run as a side effect of a normal test pass.
- `lint`: runs ESLint across the repository.
- `analyze:static`: runs full static quality chain (`lint`, test-quality, deps, unused exports, complexity).
- `analyze:deps`: runs dependency-cruiser boundary/cycle analysis.
- `analyze:test-quality`: fails tests that do not contain assertion patterns.
- `analyze:unused-exports`: runs the unused-export triage gate (ts-prune output compared against `scripts/unused-exports.baseline.txt`; fails only on untriaged findings).
- `analyze:unused-exports:raw`: runs raw `ts-prune` against typecheck project config.
- `analyze:unused-exports:baseline:update`: refreshes the triage baseline after intentional export-surface changes.
- `analyze:complexity`: runs `escomplex` analysis with configured thresholds.
- `format`: runs Prettier write formatting across the repository.
- `typecheck`: runs TypeScript typecheck (`tsc -p tsconfig.typecheck.json`).
- `coverage`: runs Vitest coverage across unit and integration projects.
- `security:scan`: runs `npm audit` with high-severity threshold.

### Database management

- `db:users:dev`: creates or updates the `rray` database user in the dev environment (automated by `docker:deploy`).
- `db:users:stage`: creates or updates the `rray` database user in the stage environment (automated by `docker:deploy:stage`).
- `db:users:prod-rray`: creates the restricted production app user (manual DBA operation only).
- `db:users:prod-rray-admin`: creates the production DBA admin user (manual DBA operation only).
- `db:backup`: dumps the dev database to `.backups/recon-dev-<timestamp>.dump`.
- `db:backup:dev`: same as `db:backup`.
- `db:backup:stage`: dumps the stage database.
- `db:restore:dev`: restores the dev database from the most recent backup (or a specified dump file).
- `db:restore:stage`: restores the stage database from the most recent backup.
- `db:seed:dev`: inserts the generated baseline dataset into the dev database. Re-runnable — it
  removes what a previous run inserted before reinserting, and asserts the schema version it was
  generated against first. Requires `create-users.psql` to have run.
- `db:seed:stage`: the same, against the stage database.
- `db:seed:generate`: regenerates `scripts/db/dev-stage/seed.psql` from the shared test fixtures by
  running them through the real pipeline and persistence layer. Needs a migrated scratch database.

### Governance and data tooling

- `github:protect-main`: applies required GitHub branch-protection checks to `main`.
- `fixtures:generate`: generates sample reconciliation fixture workbooks under `fixtures/` (git-ignored).
- `analyze:reconciliation`: runs reconciliation sensitivity analysis across amount/date/similarity windows.
- `compare:workbooks`: runs workbook comparison CLI (`parity`, `row`, `second-pass`) for reconciliation outputs.

## 12. Related docs

- `docs/architecture.md`
- `docs/api.md`
- `docs/reconciliation-rules.md`
- `docs/local-docker-platform.md`
- `design/persistence/postgresql-persistence-architecture.md`
- `docs/test-strategy.md`
