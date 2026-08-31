# T0.1 · Recorded baseline

Senior-plan task **T0.1 · Record baseline** (`design/ap-recon/AP-Reconciliation-Build-Plan.txt:116-119`):
run `npm test`, `npm run typecheck`, `npm run coverage`; record pass/fail, counts and timings.

This is the "before" state for AP-M0 and for the Step 2 changes that follow it. Anything compared
against these numbers must be compared **like for like** — see *Scoping* below, because the scripts
do not cover the same projects and the totals are not interchangeable.

## Run conditions

| | |
|---|---|
| Date | 2026-08-31, 15:50:12 → 15:59:27 (9m 15s wall) |
| Repo / branch | `reconciliation-platform` · `feat/ap-m0-instruments` |
| Commit | `317825f` (= `dev` at time of capture) |
| Working tree | 1 modified: `docs/transaction-csv-spec.md` (documentation only) |
| Host | 16 cores; load avg **2.99** at start, **4.06** at end |
| Concurrency | Steps run **strictly sequentially**, nothing else invoked. The Docker dev stack was up but idle (~0.5% CPU, ~360 MB). |

`npm test` was **not** run as a single command. It is `test:unit && test:integration &&
test:integration:isolated`, so a `test:unit` failure short-circuits the rest and yields no
integration numbers. Each step was invoked separately to get a complete baseline.

Each step redirected to a file and its exit code read from `$?` — **not** piped to `tail`. Piping
returns the *pipeline's* status, which reports 0 even when the suite is red. An earlier capture was
misread this way.

## Results

| Step | Exit | Files | Tests | Pass | Fail | Duration |
|---|---|---|---|---|---|---|
| `npm run typecheck` | **0** | — | — | — | — | — |
| `npm run test:unit` | **1** | 91 | 1297 | 1296 | **1** | — |
| `npm run test:integration` | **0** | 48 | 582 | 582 | 0 | 15.55s |
| `npm run test:integration:isolated` | **0** | 2 | 5 | 5 | 0 | 74.06s |
| `npm run coverage` | **0** | 151 | 2051 | 2051 | 0 | 388.25s |

### Coverage totals

| % Stmts | % Branch | % Funcs | % Lines |
|---|---|---|---|
| **90.40** | **82.77** | **88.72** | **90.72** |

## The one failure

```
FAIL |unit-web| apps/web/src/App.test.tsx > App > swaps Review panels via the rail and exports from Close
Error: Test timed out in 5000ms.
```

**It is a parallelism-sensitive marginal test, not a defect in the code under test.** Evidence:

| How it was run | Result |
|---|---|
| `test:unit`, full 91-file suite, parallel, machine under load | fails — *plus 2 others* in the same and one adjacent file |
| `test:unit`, full 91-file suite, parallel, machine idle | **fails** (this one only) |
| `App.test.tsx` + `CreateMappingScreen.test.tsx` alone | 120/120 pass, 53.9s |
| `coverage`, which runs `--no-file-parallelism` | **passes** — 2051/2051 |

The file needs ~54s for its 120 tests even running alone, so individual tests sit close to the
5000ms default. Vitest's file-level parallelism is enough to push this one over; serial execution
is not. Machine load makes it worse (3 failures vs 1) but is not the cause.

**Not yet fixed.** The proportionate remedies are a raised `testTimeout` scoped to `unit-web` (or to
this file), or reduced file parallelism for that project. Deferred deliberately so the baseline
records the tree as it actually is.

## Scoping — the totals are not comparable across scripts

The scripts cover **different vitest projects**. Neither is a superset of the other.

| Script | Projects |
|---|---|
| `test:unit` | `unit-core`, `unit-web`, `infra` |
| `test:integration` | `integration`, **excluding** `deploy-cleanup.test.ts` and `nginx-config.test.ts` |
| `test:integration:isolated` | exactly those two files, at `--maxWorkers=1` |
| `coverage` | `unit-core`, `unit-web`, **`unit-data`**, `integration` — `--no-file-parallelism` |

`unit-data` (the `packages/persistence` suite, 15 files / 193 tests) appears **only** in `coverage`.
`infra` appears only in `test:unit`. A test-count difference between two runs is therefore expected
whenever the project set differs, and is not by itself a regression.

## Environment note — testcontainers hang under load

`coverage` pulls in `unit-data`, whose `globalSetup.ts` uses **testcontainers** to start a
PostgreSQL container. Testcontainers first starts a `ryuk` reaper sidecar.

On a saturated machine (load **16.01** on 16 cores) this **hangs indefinitely**: ryuk is created but
never started, testcontainers blocks waiting for it, and the run sits at 0% CPU with no timeout to
recover. Observed once, at 15:24. The orphaned container was removed manually; `docker start` on it
succeeded instantly, so the Docker daemon was healthy — the failure is a testcontainers startup race,
not a Docker fault.

On an idle machine the same path completes normally (`unit-data` alone: 193/193 in 421s; within
`coverage` above: clean).

**Practical rule: do not run `coverage` concurrently with other test invocations.** If it stalls with
no output, check for a `testcontainers-ryuk-*` container stuck in `Created`, remove it, and retry.

## Also recorded

- **`generator.test.ts` contains 19 tests, not 18.** The senior plan's G1 DoD says "confirm 18 tests
  pass" (`.txt` 91, 98, 320). Verified by run: 19 passed, 2.34s. The DoD figure is stale.
- **G1 is already committed** — `c765aa3 feat(test-fixtures): add deterministic generator core (G1)`.
  All ten files under `packages/test-fixtures/src/generator/` are tracked. The senior plan's
  "DONE, UNCOMMITTED" and the AP & AR plan's "landed but uncommitted" are stale.
- `recon-test-data` @ `a70eb21`, for the paired half of this work: **24 files, 330/330 pass**, 5.21s.
