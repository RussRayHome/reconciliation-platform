# Developer Setup

## Prerequisites

- Node.js 20 or later
- npm 10 or later
- VS Code

## Install and Run

```bash
npm install
npm run dev
```

The root `dev` script starts both apps together:

- API on port `4000`
- Web on port `5173`

## Docker Desktop

Docker Desktop is supported for a production-like local stack with an NGINX gateway, an internal API service, and an internal PostgreSQL service.

Prerequisites:

- Docker Desktop running locally
- port `4173` available

Commands:

```bash
cp .env.docker.example .env.docker
npm run docker:deploy
```

Containerized local URLs:

- Reconciliation UI: `http://127.0.0.1:4173`
- API health through the gateway: `http://127.0.0.1:4173/api/health`
- PostgreSQL stays internal to Docker Compose

To stop the stack:

```bash
npm run docker:cleanup
```

To inspect logs:

```bash
npm run docker:logs
```

To rerun schema migrations without restarting the full stack:

```bash
npm run docker:migrate
```

To validate the local deployment:

```bash
npm run docker:validate-env
npm run docker:health
```

To target a non-default Docker env file, set `DOCKER_ENV_FILE=./path/to/file` before running any `docker:*` runbook or `ops:*` helper. `DOCKER_COMPOSE_ENV_FILE` is still accepted as a compatibility alias.

Useful local URLs:

- Reconciliation UI: `http://127.0.0.1:5173`
- Developer dashboard: `http://127.0.0.1:5173/developer-dashboard.html`
- API health: `http://127.0.0.1:4000/api/health`
- Developer status API: `http://127.0.0.1:4000/api/developer/status`

The developer dashboard is intended to stay local by default:

- the web app only shows the dashboard link in dev builds
- the API blocks `/api/developer/*` in production unless explicitly enabled

## Useful Commands

```bash
npm run harness:start
npm run harness:restart
npm run harness:stop
npm run harness:status
npm run runtime:status
npm run ops:web:start
npm run ops:web:stop
npm run ops:db:start
npm run ops:db:stop
npm run ops:docker:stop
npm run ops:docker:restart
npm run ops:startup
npm run ops:shutdown
npm run docker:validate-env
npm run docker:build
npm run docker:migrate
npm run docker:health
npm run docker:deploy
npm run docker:redeploy
npm run docker:smoke
npm run docker:cleanup
npm run docker:up
npm run docker:down
npm run docker:logs
npm run typecheck
npm run lint
npm run test
npm run test:postgres
npm run test:e2e
npm run coverage
npm run build
npm run security:scan
npm run compare:workbooks -- --mode parity --baseline ./baseline.xlsx --candidate ./candidate.xlsx
```

## Local Docker Operations

Use the operations scripts when you want narrower control than `docker:up` and `docker:down`.

```bash
npm run ops:web:start
npm run ops:web:stop
npm run ops:db:start
npm run ops:db:stop
npm run ops:docker:stop
npm run ops:docker:restart
npm run ops:startup
npm run ops:shutdown
```

Behavior:

- `ops:web:start` starts the `web` compose service and its required dependencies
- `ops:web:stop` stops only the `web` compose service
- `ops:db:start` starts only the PostgreSQL compose service
- `ops:db:stop` stops only the PostgreSQL compose service
- `ops:docker:stop` quits Docker Desktop on macOS
- `ops:docker:restart` restarts Docker Desktop on macOS and waits until `docker info` succeeds
- `ops:startup` starts Docker Desktop if needed, then starts `postgres`, `api`, and `web`
- `ops:shutdown` stops `web`, `api`, and `postgres`, then quits Docker Desktop

These commands are implemented through a single typed entrypoint in `scripts/docker-ops.ts`.

For the production-like deployment path, prefer the runbooks in `scripts/ops/` and the topology summary in `docs/local-docker-platform.md`.

Use `docker:up` and `docker:down` only when you want direct raw Compose behavior. The supported operational path is `docker:deploy`, `docker:health`, and `docker:cleanup`.

## Runtime Harness

Use the runtime harness commands when you want a deterministic local API + web startup on the expected ports with a single entrypoint.

```bash
npm run harness:start
```

The harness start command:

- starts the API on port `4000`
- starts the web app on port `4173`
- writes API runtime logs to `test-results/runtime-api.log`
- fails fast if either expected port is already occupied

If a prior harness run or another local process is still holding either port, stop it with:

```bash
npm run harness:stop
```

To force a clean stop-then-start cycle in one command, run:

```bash
npm run harness:restart
```

To inspect whether the expected harness ports are free before starting, run:

```bash
npm run harness:status
```

To see whether the current web runtime is Vite or the containerized Nginx path, run:

```bash
npm run runtime:status
```

These commands should be run from the repository root.

If you open the parent workspace instead of the repository folder directly, the bundled VS Code tasks `harness:start`, `harness:restart`, `harness:stop`, and `harness:status` already target the nested `reconciliation-platform` root for you.

## Quality Workflow

For a full local quality pass, use the same checks surfaced by the developer dashboard:

```bash
npm run test
npm run test:e2e
npm run lint
npm run typecheck
npm run coverage
npm run security:scan
```

The developer dashboard runs and summarizes these checks:

- Unit tests
- Integration tests
- E2E tests
- Static analysis (lint)
- Static analysis (typecheck)
- Coverage
- Security vulnerabilities

`GET /api/developer/status` caches results for `DEV_STATUS_CACHE_TTL_MS` milliseconds. Add `?force=1` to bypass the cache and rerun the checks immediately.

## VS Code Support

The repository includes:

- recommended extensions in `.vscode/extensions.json`
- format and lint settings in `.vscode/settings.json`
- runnable tasks in `.vscode/tasks.json`
- launch configurations in `.vscode/launch.json`

## Environment Variables

Copy values from `.env.example` as needed.

- `PORT`: API port
- `VITE_API_BASE_URL`: backend base URL for the web app
- `LOG_LEVEL`: Pino log level
- `DEBUG_RECONCILIATION`: optional debug switch for future deeper tracing
- `MAX_UPLOAD_MB`: upload cap for source files
- `RECON_PERSISTENCE_BACKEND`: set to `postgres` to force-enable PostgreSQL persistence
- `DATABASE_URL`: PostgreSQL connection string for lifecycle persistence
- `PG_POOL_MAX`: PostgreSQL pool max connections
- `PG_IDLE_TIMEOUT_MS`: PostgreSQL idle timeout in milliseconds
- `PG_STATEMENT_TIMEOUT_MS`: PostgreSQL statement timeout in milliseconds
- `DEV_STATUS_CACHE_TTL_MS`: cache TTL for the developer status endpoint in milliseconds
- `DEV_STATUS_HISTORY_LIMIT`: number of recent developer-status snapshots to retain in memory
- `ENABLE_DEVELOPER_DIAGNOSTICS`: set to `true` to expose `/api/developer/*` outside the default local/dev behavior; set to `false` to force-disable it
- `VITE_ENABLE_DEVELOPER_DASHBOARD`: set to `true` to show the dashboard link in a non-dev frontend build
- `JAVA_HOME`: JDK home for Python- or JVM-backed tooling on macOS
- `JAVA_BIN`: explicit `java` executable path when a library cannot resolve `PATH`

## Java / Python Interop on macOS

If Java was installed with Homebrew, make sure `JAVA_HOME` points to the JDK root and **not** the `bin` folder.

Recommended shell setup:

```bash
export JAVA_HOME=$(/usr/libexec/java_home)
export PATH="$JAVA_HOME/bin:$PATH"
```

The workspace also includes local `.env` and VS Code settings that point Python tooling at the detected Brew JDK for this machine.

## Generating Sample Workbooks

```bash
npm run fixtures:generate
```

This writes sample `.xlsx` inputs under `docs/sample-files` for local experimentation.

## Running a Reconciliation Locally

The current web flow expects:

- `Bank workbook`
- `QBO workbook`
- optional `Account identifier`
- `Reconciliation frequency` set to `Monthly` or `Annual`
- `Monthly reconciliation month` for monthly runs or `Annual reconciliation year` for annual runs
- editable `Reconciliation label`

After submission, the UI renders summary metrics, charts, probable match review, exception reporting, and workbook download links.

When PostgreSQL persistence is enabled, the API also records reconciliation lifecycle state, source-file registrations, imported rows, normalized rows, match artifacts, exceptions, summary metrics, exports, and reviewer decisions in PostgreSQL.

## Golden-Standard Comparison Scripts

The workbook comparison helpers in `scripts/workbook-parity.py` and `scripts/compare-attached-workbooks.py` are available for manual parity checks.

The preferred entrypoint is now the unified CLI:

```bash
npm run compare:workbooks -- --mode parity --baseline ./path/to/baseline.xlsx --candidate ./path/to/candidate.xlsx
npm run compare:workbooks -- --mode row --baseline ./path/to/baseline.xlsx --candidate ./path/to/candidate.xlsx
npm run compare:workbooks -- --mode second-pass --baseline ./path/to/baseline.xlsx --candidate ./path/to/candidate.xlsx
```

They currently use hard-coded workbook paths and should be updated for your local files before running them.

## Class and Method Documentation

When changing reconciliation logic, update `docs/class-method-reference.md` in the same pull request.

Documentation requirements for each newly exported class method or function:

- list inputs
- list outputs
- include method state object before execution
- include method state object after execution
