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

### `generate-fixtures.ts`

Purpose:

- Generates sample bank and QBO workbooks for local demos, manual testing, and docs examples.

How to run:

```bash
npm run fixtures:generate
```

Outputs:

- Writes `sample-bank.xlsx` and `sample-qbo.xlsx` into `docs/sample-files/`.

When to use it:

- Refreshing sample files after test-fixture changes.
- Producing deterministic demo inputs for local verification.

Notes:

- This is the preferred way to regenerate sample workbooks. Do not hand-edit the generated files and assume they remain canonical.

### `analyze-reconciliation.ts`

Purpose:

- Runs a local reconciliation analysis pass against a bank workbook and QBO workbook.
- Helps inspect matching behavior under different date windows, similarity thresholds, and hybrid-match settings.

How to run:

```bash
npm run analyze:reconciliation -- --account <accountId> --bank <bank.xlsx> --qbo <qbo.xlsx>
```

Example:

```bash
npm run analyze:reconciliation -- --account 5703 --bank ./data/bank.xlsx --qbo ./data/qbo.xlsx
```

Quick example with repo sample files:

```bash
npm run fixtures:generate
npm run analyze:reconciliation -- --account 5703 --bank ./docs/sample-files/sample-bank.xlsx --qbo ./docs/sample-files/sample-qbo.xlsx
```

Key options:

- `--account`: account identifier used to resolve reconciliation config.
- `--bank`: path to the source bank workbook.
- `--qbo`: path to the source QBO workbook.
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

These Python scripts are lightweight CLI diagnostics for workbook parity analysis. They are parameterized now, but they still assume specific workbook sheet names and column layouts.

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

- Reference/debugging aid only.
- Safe reuse requires replacing hard-coded paths and revalidating the column mapping assumptions.

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

- Reference/debugging aid only.
- Should be treated as investigation history unless deliberately cleaned up and parameterized.

### `docs/archive/second-pass-report.txt`

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

1. Add a shared helper module if more workbook-comparison scripts are added.
2. Rename ad hoc diagnostics to make their temporary status obvious.
3. Add a short owner/intent header to any script expected to remain in the repo.
