# Scripts Directory

This directory contains a mix of supported developer utilities and one-off investigation artifacts used during workbook parity analysis.

Treat the scripts in two groups:

- Supported utilities: safe to run from the repository root as part of normal development.
- Ad hoc diagnostics: useful as historical reference, but currently tied to hard-coded local file paths and workbook layouts.

## Prerequisites

- Run commands from the repository root.
- Install workspace dependencies with `npm install`.
- Use Node.js `>=20` for TypeScript-based scripts.
- Install `openpyxl` in your Python environment before running any Python workbook-comparison script.

## Supported Utilities

### `runtime-harness.ts`

Purpose:

- Starts, stops, and inspects the local API + web runtime harness using the expected development ports.
- Avoids the common workspace-root trap where npm workspace commands are run outside the monorepo root.

How to run:

```bash
npm run harness:start
npm run harness:restart
npm run harness:stop
npm run harness:status
npm run runtime:status
```

What it does:

- `harness:start` starts the API on `4000` and the web app on `4173`
- `harness:restart` performs a clean stop-then-start cycle on the fixed harness ports
- `harness:start` writes API logs to `test-results/runtime-api.log`
- `harness:start` refuses to run if either expected port is already occupied
- `harness:stop` terminates listeners on the harness ports
- `harness:status` reports whether the expected harness ports are free or already in use

When to use it:

- Reproducing a clean runtime harness cycle locally.
- Starting both apps with the same port contract used by local runtime diagnostics.
- Quickly clearing stale local harness processes before rerunning the apps.

Notes:

- Run these commands from the repository root.
- The web server uses a fixed-port contract and now fails fast instead of silently hopping to another port.

### `runtime-status.ts`

Purpose:

- Reports whether the active web runtime is Vite or the containerized Nginx path.
- Shows whether the API is running as a local Node process or as a Docker Compose container.

How to run:

```bash
npm run runtime:status
```

### `generate-fixtures.ts`

Purpose:

- Generates sample bank and GL workbooks for local demos, manual testing, and docs examples.

How to run:

```bash
npm run fixtures:generate
```

Outputs:

- Writes `sample-bank.xlsx`, `sample-gl.xlsx` and the all-exceptions pair into `fixtures/` (git-ignored).

When to use it:

- Refreshing sample files after test-fixture changes.
- Producing deterministic demo inputs for local verification.

Notes:

- This is the preferred way to regenerate sample workbooks. Do not hand-edit the generated files and assume they remain canonical.

### `generate-api-docs.ts`

Purpose:

- Generates `generated/api-reference-generated.md` from exported TypeScript classes.
- Enforces documentation coverage for exported classes, constructors, methods, and non-private properties.

How to run:

```bash
npm run docs:api:generate
npm run docs:api:check
```

Notes:

- `docs:api:generate` writes the generated markdown used by the Documentation Hub and Developer Dashboard API docs link.
- `docs:api:check` performs coverage validation without writing files and exits non-zero when documentation is missing.

### `triage-unused-exports.ts`

Purpose:

- Runs `ts-prune` and compares the current findings to a committed baseline file.
- Fails only when new, untriaged unused-export findings are introduced.

How to run:

```bash
npm run analyze:unused-exports
npm run analyze:unused-exports:raw
npm run analyze:unused-exports:baseline:update
```

Notes:

- Baseline file path: `scripts/unused-exports.baseline.txt`.
- Use `analyze:unused-exports:raw` to inspect full `ts-prune` output.
- Use `analyze:unused-exports:baseline:update` only after intentionally accepting the current report.

### `docker-ops.ts`

Purpose:

- Provide a single typed command surface for service-level Docker Compose operations and Docker Desktop lifecycle control on macOS.
- Keep Docker behavior consolidated in one implementation path instead of several thin wrappers.

How to run:

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

Examples:

- `tsx scripts/docker-ops.ts web start`
- `tsx scripts/docker-ops.ts web stop`
- `tsx scripts/docker-ops.ts db start`
- `tsx scripts/docker-ops.ts db stop`
- `tsx scripts/docker-ops.ts docker stop`
- `tsx scripts/docker-ops.ts docker restart`
- `tsx scripts/docker-ops.ts stack start`
- `tsx scripts/docker-ops.ts stack stop`

Notes:

- The helper resolves the repository-local `compose.yaml` automatically, so it does not require you to `cd` into the repo root first.
- If `.env.docker` exists, it is passed to `docker compose` automatically.
- Set `DOCKER_ENV_FILE=./path/to/file` to use a different env file across the typed helpers and shell/PowerShell runbooks. `DOCKER_COMPOSE_ENV_FILE` remains supported as a legacy alias.
- Docker Desktop start/stop automation is implemented for macOS only.
- Starting `web` may also start `api` and `postgres` because of the compose dependency chain.

### `docker-runtime.ts`

Purpose:

- Shared Docker Compose and Docker Desktop helper used by `docker-ops.ts` and `docker-smoke-test.ts`.
- Centralizes Compose file resolution, Docker readiness checks, and macOS Docker Desktop automation.

### `github-branch-protection.ts`

Purpose:

- Applies the baseline required status checks for branch protection through GitHub CLI.
- Safely merges required checks into existing branch protection without replacing other protection settings.

How to run:

```bash
npm run github:protect-main -- --repo <owner>/<repo>
```

Options:

- `--repo owner/repo`: explicit repository target (optional when resolvable from env or git remote)
- `--branch <name>`: target branch (defaults to `main` in the npm wrapper)
- `--dry-run`: preview operations without writing changes

Notes:

- Requires `gh` CLI and authenticated session (`gh auth status`).
- If branch protection does not exist yet, it creates a baseline rule with the required checks.

## Database Scripts

The `scripts/pre-flight/` directory contains Bash entrypoints for database user management, backups, restores, and seed orchestration.
The `scripts/db/` directory now holds SQL assets consumed by those scripts (for example `dev-stage/*.psql` and `production/*.psql`).

### `pre-flight/backup.sh`

Purpose:

- Dump the target environment database to `.backups/recon-<env>-<timestamp>.dump` using `pg_dump -Fc` (custom compressed format).

How to run:

```bash
npm run db:backup          # dev
npm run db:backup:dev      # dev
npm run db:backup:stage    # stage
```

Notes:

- The postgres container must be running.
- Output files are written to `.backups/` (gitignored).
- Take a backup before any destructive schema operation or volume wipe.

### `pre-flight/restore.sh`

Purpose:

- Restore a database from a `pg_dump` backup file using `pg_restore -j 4` (parallel restore).
- Stops dependent services (api, web, pgweb) before restore and restarts them after.
- Re-applies database user grants after restore.

How to run:

```bash
npm run db:restore:dev                                            # most recent dev backup
npm run db:restore:stage                                          # most recent stage backup
bash scripts/pre-flight/restore.sh dev .backups/recon-dev-20260512.dump  # specific file
```

Notes:

- If no dump file is specified, restores from the most recent `.backups/recon-<env>-*.dump`.
- Postgres must be running; the script starts it automatically if needed.

### `db/dev-stage/seed.psql`

Purpose:

- SQL seed file containing a representative baseline dataset for development and testing.
- Contains two reconciliation jobs: one FINALIZED (with matches, exceptions, and an export) and one FAILED.
- Covers all 14 tables in the schema.
- Idempotent: uses `ON CONFLICT DO NOTHING` throughout.

### `pre-flight/run-seed.sh`

Purpose:

- Wrapper that pipes `seed.psql` into the running postgres container for a given environment.

How to run:

```bash
npm run db:seed:dev
npm run db:seed:stage
```

Notes:

- The postgres container must be running.
- Safe to run multiple times.

### `pre-flight/run-users.sh`

Purpose:

- Creates or updates the `rray` database user (dev/stage only) with full superuser privileges.
- Called automatically by `scripts/pre-flight/deploy.sh` — no manual run needed on a standard deploy.

How to run manually:

```bash
npm run db:users:dev
npm run db:users:stage
```

### `pre-flight/run-prod-users.sh`

Purpose:

- Creates production database users (`prod_rray`, `prod_rray_admin`) via direct psql (no Docker).
- Must be run manually by a DBA. Never called by automated pipelines.

## Production-Like Docker Runbooks

The `scripts/pre-flight/` directory contains the Bash runbooks used for deployment pre-checks and deployment orchestration.
The `scripts/in-flight/` directory contains Bash checks intended to run against an already-running stack.
The `scripts/ops/` directory now contains PowerShell entrypoints plus supporting static assets (for example the DB CVE allowlist and ZAP stage targets).

### `pre-flight/deploy.sh` and `ops/deploy.ps1`

Purpose:

- Build images, start PostgreSQL, run the dedicated migration service, create database users, then start the API and NGINX gateway. Also starts pgweb and nginx-ui when defined in the compose config (dev and stage).

### `pre-flight/redeploy.sh` and `ops/redeploy.ps1`

Purpose:

- Perform a clean cleanup followed by a fresh deploy.

### `pre-flight/run-migrations.sh` and `ops/run-migrations.ps1`

Purpose:

- Execute only the dedicated migration container.

### `pre-flight/health-check.sh` and `ops/health-check.ps1`

Purpose:

- Verify `/healthz`, `/api/health`, PostgreSQL readiness, and (when present in the compose config) pgweb/nginx-ui availability for the containerized stack.

### `in-flight/in-flight-url-check.sh`

Purpose:

- Validate environment-prefixed gateway URLs after test execution.
- Checks application, docs, developer dashboard, pgweb (when present), and dashboard server runtime endpoints.

### `pre-flight/cleanup.sh` and `ops/cleanup.ps1`

Purpose:

- Stop the local production-like stack, with optional volume pruning.

### `pre-flight/validate-env.sh` and `ops/validate-env.ps1`

Purpose:

- Validate the Docker environment file before deployment.

### `analyze-reconciliation.ts`

Purpose:

- Runs a local reconciliation analysis pass against a bank workbook and GL workbook.
- Helps inspect matching behavior under different date windows, similarity thresholds, and hybrid-match settings.

How to run:

```bash
npm run analyze:reconciliation -- --account <accountId> --bank <bank.xlsx> --gl <gl.xlsx>
```

Example:

```bash
npm run analyze:reconciliation -- --account 5703 --bank ./data/bank.xlsx --gl ./data/gl.xlsx
```

Quick example with repo sample files:

```bash
npm run fixtures:generate
npm run analyze:reconciliation -- --account 5703 --bank ./fixtures/sample-bank.xlsx --gl ./fixtures/sample-gl.xlsx
```

Key options:

- `--account`: account identifier used to resolve reconciliation config.
- `--bank`: path to the source bank workbook.
- `--gl`: path to the source GL workbook.
- `--windows`: comma-separated list of candidate day windows.
- `--thresholds`: comma-separated list of similarity thresholds from `0` to `1`.
- `--similarity-days`: maximum day distance used by similarity analysis.
- `--hybrid-thresholds`: thresholds for hybrid match heuristics.
- `--hybrid-occurrences`: occurrence-count settings for hybrid evaluation.

When to use it:

- Investigating why expected matches are not being found.
- Comparing how match rates change under different heuristic settings.
- Exploring account-specific reconciliation behavior without changing API code.

Notes:

- This is the reusable investigation utility in the directory. Prefer this script over creating temporary one-off analysis files.

## Workbook Diagnostics

These Python scripts are lightweight CLI diagnostics for workbook parity analysis. They now share a common helper module and can also be run through the unified CLI.

### `workbook-compare.py`

Purpose:

- Unified entrypoint for workbook parity, row-level comparison, and second-pass diagnostics.

How to run:

```bash
npm run compare:workbooks -- --mode parity --baseline ./path/to/baseline.xlsx --candidate ./path/to/candidate.xlsx
npm run compare:workbooks -- --mode row --baseline ./path/to/baseline.xlsx --candidate ./path/to/candidate.xlsx
npm run compare:workbooks -- --mode second-pass --baseline ./path/to/baseline.xlsx --candidate ./path/to/candidate.xlsx
```

### `workbook_compare_tools.py`

Purpose:

- Shared workbook parsing, normalization, and comparison helpers used by the unified CLI and compatibility wrappers.

### `workbook-parity.py`

Purpose:

- Compares two workbooks at a summary and error-report level.
- Reports sheet presence, summary deltas, category-count differences, and exposure differences.

How to run:

```bash
python3 scripts/workbook-parity.py --baseline ./path/to/baseline.xlsx --candidate ./path/to/candidate.xlsx
```

Current limitations:

- Assumes specific sheet names such as `Summary` and `Error Report`.
- Assumes a particular workbook layout and header structure.

Use status:

- Reusable for manual parity checks when the compared workbooks follow the expected layout.
- Validate the expected sheet layout before relying on the results.
- Backed by the shared `workbook_compare_tools.py` helper.

### `compare-attached-workbooks.py`

Purpose:

- Performs a deeper row-level comparison between two `Error Report` sheets.
- Compares key coverage, category mismatch pairs, example mismatches, and category exposure deltas.

How to run:

```bash
python3 scripts/compare-attached-workbooks.py --baseline ./path/to/baseline.xlsx --candidate ./path/to/candidate.xlsx
```

Current limitations:

- Encodes workbook-specific column positions for both compared files.
- Intended for a known baseline-versus-app workbook pair, not arbitrary inputs.

Use status:

- Compatibility wrapper around the unified workbook comparison logic.
- Safe reuse still requires revalidating the column mapping assumptions.

### `second-pass-diagnostics.py`

Purpose:

- Runs another targeted parity comparison against a different workbook pair.
- Focuses on summary diffs, category deltas, exposure deltas, and row-key mismatch analysis.

How to run:

```bash
python3 scripts/second-pass-diagnostics.py --baseline ./path/to/baseline.xlsx --candidate ./path/to/candidate.xlsx
```

Current limitations:

- Bakes in workbook-specific `Error Report` column locations.
- Produces console diagnostics only.

Use status:

- Compatibility wrapper around the shared second-pass comparison logic.
- Still tailored to the known Error Report layouts.

### `design/exceptions/second-pass-report.txt`

Purpose:

- Captures sample output from `second-pass-diagnostics.py`.

What it is for:

- Historical evidence of a specific debugging pass.
- Useful when comparing current behavior against a prior manual analysis.

What it is not:

- Not executable.
- Not authoritative product documentation.

## Maintenance Guidance

- Keep reusable scripts parameterized and runnable from the repository root.
- Avoid committing new scripts that depend on user-specific absolute paths.
- If a diagnostic script becomes part of the regular developer workflow, promote it by:
  - adding CLI arguments instead of hard-coded inputs,
  - documenting the expected workbook format,
  - wiring it into `package.json` when appropriate,
  - and adding at least a smoke test or usage example.

## Recommended Cleanup Path

If this directory is being hardened for long-term team use, the next sensible changes are:

1. Rename ad hoc diagnostics to make their temporary status obvious.
2. Add a short owner/intent header to any script expected to remain in the repo.
3. Add a small automated smoke test around `workbook-compare.py` if it becomes part of the regular workflow.
