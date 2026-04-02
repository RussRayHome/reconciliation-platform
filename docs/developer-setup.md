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

Useful local URLs:

- Reconciliation UI: `http://127.0.0.1:5173`
- Developer dashboard: `http://127.0.0.1:5173/developer-dashboard.html`
- API health: `http://127.0.0.1:4000/api/health`
- Developer status API: `http://127.0.0.1:4000/api/developer/status`

## Useful Commands

```bash
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run coverage
npm run build
npm run security:scan
```

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
- `DEV_STATUS_CACHE_TTL_MS`: cache TTL for the developer status endpoint in milliseconds
- `DEV_STATUS_HISTORY_LIMIT`: number of recent developer-status snapshots to retain in memory
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

## Golden-Standard Comparison Scripts

The workbook comparison helpers in `scripts/workbook-parity.py` and `scripts/compare-attached-workbooks.py` are available for manual parity checks.

They currently use hard-coded workbook paths and should be updated for your local files before running them.

## Class and Method Documentation

When changing reconciliation logic, update `docs/class-method-reference.md` in the same pull request.

Documentation requirements for each newly exported class method or function:

- list inputs
- list outputs
- include method state object before execution
- include method state object after execution
