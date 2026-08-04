# Dashboard status data

JSON snapshots published nightly by `.github/workflows/dashboard-status.yml`
(`scripts/ci/generate-dashboard-status.ts`). Each file is the full check-suite result for one
environment, in the same shape the Developer Dashboard reads.

- `dev.json` — latest run against the `dev` branch
- `stage.json` — latest run against the `stage` branch

Never edit these by hand; they're overwritten on the next nightly run.
