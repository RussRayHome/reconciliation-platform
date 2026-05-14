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
cp .env.docker.dev.fallback .env.docker
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
2. Upload both source files (`bankFile`, `qboFile`).
3. Set account identifier (optional), reconciliation frequency, and period label.
4. Submit the run.
5. Review summary, probable matches, and exception report.
6. Download workbook export.

Generated sample files for testing:

```bash
npm run fixtures:generate
```

Samples are written to `docs/sample-files/`.

## 5. Quality gate workflow

Run these before opening or updating a pull request:

```bash
npm run test
npm run test:postgres
npm run test:e2e
npm run lint
npm run typecheck
npm run build
npm run coverage
npm run security:scan
```

### What each command validates

- `test`: unit + integration logic and API behavior.
- `test:postgres`: PostgreSQL lifecycle/persistence integration via Testcontainers.
- `test:e2e`: browser-level upload-to-results workflow.
- `lint`: static quality and style checks.
- `typecheck`: TypeScript type safety across workspaces.
- `build`: production bundle/compile verification.
- `coverage`: combined coverage for unit + integration suites.
- `security:scan`: npm audit with high-severity threshold.

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

| Service    | Role                      | Host port | Environments    |
|------------|---------------------------|-----------|-----------------|
| `web`      | NGINX public gateway      | `4173`    | dev, stage      |
| `api`      | Express API               | internal  | dev, stage      |
| `postgres` | PostgreSQL data store     | `5432`    | dev, stage      |
| `migrate`  | One-shot migration runner | none      | dev, stage      |
| `pgweb`    | Postgres web admin        | `8081`    | dev, stage only |

Access points after deploy:

- Application: `http://127.0.0.1:4173`
- Documentation Hub: `http://127.0.0.1:4173/<environment>/docs` (for example `dev/docs`)
- Developer Dashboard: `http://127.0.0.1:4173/<environment>/developer-dashboard.html` (for example `dev/developer-dashboard.html`)
- Postgres Admin: `http://127.0.0.1:8081`

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
- `ENABLE_DEVELOPER_DIAGNOSTICS=false`
- `VITE_ENABLE_DEVELOPER_DASHBOARD=false`

### Docker env (`.env.docker`)

Common flags:

- `API_DATABASE_URL=postgresql://...@postgres:5432/...`
- `RUN_DB_MIGRATIONS_ON_BOOT=false`
- `ENABLE_DEVELOPER_DIAGNOSTICS=false`
- `RECONCILIATION_RUN_STORE_PATH=/var/lib/reconciliation/latest-reconciliation-run.json`

## 9. Developer diagnostics and dashboard

Developer endpoints are grouped under `/api/developer/*`.

Access policy:

- Enabled by default outside production.
- In production, controlled by `ENABLE_DEVELOPER_DIAGNOSTICS=true|false`.

Web dashboard visibility:

- Enabled in dev mode automatically.
- In non-dev builds, set `VITE_ENABLE_DEVELOPER_DASHBOARD=true`.

## 10. Troubleshooting

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
npm run test:e2e
```

## 11. Pull request quality baseline

Before merge:

1. Run the quality gate workflow from section 5.
2. Run Docker preflight and predeploy checks for deployment-facing changes.
3. Ensure required branch protection checks pass.

See `docs/branch-protection.md` for recommended required checks.

## 12. Complete root script catalog

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
- `docker:build`: runs `docker compose build` for stack images.
- `docker:predeploy`: runs compose startup/shutdown and readiness predeploy checks.
- `docker:db:preflight`: runs DB patch parity, schema integrity, and DB-image vulnerability checks.
- `docker:gate`: runs `docker:preflight` then `docker:predeploy` as a combined gate.
- `docker:migrate`: runs migration workflow script against configured runtime.
- `docker:health`: runs Docker runtime health checks.
- `docker:deploy`: executes the standard deploy runbook script.
- `docker:redeploy`: executes cleanup/restart deploy runbook script.
- `docker:smoke`: runs isolated end-to-end Docker smoke checks, then tears down.
- `docker:up`: runs `docker compose up --build` directly.
- `docker:cleanup`: runs Docker cleanup script for stack artifacts.
- `docker:down`: runs `docker compose down --remove-orphans`.
- `docker:logs`: tails compose logs.

### Build, test, and static quality

- `build`: builds all workspaces that expose a build script.
- `test`: runs unit and integration suites in sequence.
- `test:unit`: runs Vitest unit projects (`unit-core`, `unit-web`).
- `test:integration`: runs Vitest integration project.
- `test:postgres`: runs PostgreSQL integration suite (Testcontainers-backed).
- `test:e2e`: runs Playwright end-to-end browser tests.
- `lint`: runs ESLint across the repository.
- `analyze:static`: runs full static quality chain (`lint`, test-quality, deps, unused exports, complexity).
- `analyze:deps`: runs dependency-cruiser boundary/cycle analysis.
- `analyze:test-quality`: fails tests that do not contain assertion patterns.
- `analyze:unused-exports`: runs `ts-prune` against typecheck project config.
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
- `db:seed:dev`: inserts a baseline representative dataset into the dev database (idempotent).
- `db:seed:stage`: inserts a baseline representative dataset into the stage database (idempotent).

### Governance and data tooling

- `github:protect-main`: applies required GitHub branch-protection checks to `main`.
- `fixtures:generate`: generates sample reconciliation fixture workbooks under `docs/sample-files/`.
- `analyze:reconciliation`: runs reconciliation sensitivity analysis across amount/date/similarity windows.
- `compare:workbooks`: runs workbook comparison CLI (`parity`, `row`, `second-pass`) for reconciliation outputs.

## 13. Related docs

- `docs/architecture.md`
- `docs/api.md`
- `docs/reconciliation-rules.md`
- `docs/local-docker-platform.md`
- `docs/postgresql-persistence-architecture.md`
- `docs/test-strategy.md`
