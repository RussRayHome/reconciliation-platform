import { defineConfig } from 'vitest/config';

const baseCoverageExclude = [
  '**/*.config.*',
  '**/dist/**',
  '**/coverage/**',
  'apps/api/src/index.ts',
  'apps/api/src/server.ts',
  'packages/domain/src/types.ts',
  'scripts/**',
  // Pure `export * from './x'` barrel files -- zero instrumentable statements, so v8 reports a
  // mathematically-undefined 0/0 as "0%". That reads as untested logic on the Developer
  // Dashboard's coverage-by-file panel when there's actually no code here to cover; the re-exports
  // themselves are smoke-tested by each package's own index.test.ts instead.
  'packages/config/src/index.ts',
  'packages/core/src/index.ts',
  'packages/domain/src/index.ts',
  'packages/persistence/src/index.ts',
  'packages/test-fixtures/src/index.ts',
  'packages/ui/src/index.ts',
];

// Set by the Developer Dashboard when it has to drop the Testcontainers persistence suites (no
// host Docker CLI from inside the tools container). The sources those suites solely cover have to
// leave the denominator with them, or the dashboard reports ~0% for well-covered code. This is an
// env var rather than the `--coverage.exclude` CLI flag because that flag REPLACES this array
// rather than merging, which would quietly re-include dist/, scripts/, server.ts, and types.ts.
const extraCoverageExclude = (process.env.COVERAGE_EXTRA_EXCLUDES ?? '')
  .split(',')
  .map((pattern) => pattern.trim())
  .filter((pattern) => pattern.length > 0);

// package.json's "coverage" script runs with --no-file-parallelism. Without it, V8 coverage
// collected in each forked worker process never makes it back into the merged report -- every
// file shows structurally correct totals (source-map-derived line/branch/function counts) but
// `covered` is always exactly 0, regardless of real test coverage. Confirmed directly: the same
// run against the same files reports real, plausible percentages with file parallelism off and
// uniformly 0% with it on default (forks-pool). This makes `npm run coverage` slower than a
// normal parallel test run, but a wrong 0% number is worse than a slow correct one, especially
// since the Developer Dashboard reports this figure as fact.
export default defineConfig({
  test: {
    coverage: {
      all: true,
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // Without this, Vitest silently skips writing coverage-summary.json whenever any test
      // fails anywhere in the run — which is exactly when the Developer Dashboard most needs
      // to show coverage data, not hide it.
      reportOnFailure: true,
      include: [
        'apps/api/src/**/*.{ts,tsx}',
        'apps/web/src/**/*.{ts,tsx}',
        'packages/*/src/**/*.{ts,tsx}',
      ],
      exclude: [...baseCoverageExclude, ...extraCoverageExclude],
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 75,
        lines: 75,
      },
    },
    projects: [
      {
        test: {
          name: 'unit-core',
          environment: 'node',
          include: ['packages/**/src/**/*.test.ts', 'packages/**/src/**/*.test.tsx'],
        },
      },
      {
        test: {
          // Same files as `postgres-integration` in vitest.postgres.config.ts, under a second name.
          // Kept apart deliberately: this project is a member of the multi-project run `coverage`
          // drives, while that config is a standalone entrypoint for `test:postgres` so the suite
          // can run without pulling in unit-core/unit-web/integration. Issue #286 proposed
          // collapsing them; documented instead, because both project names appear in CI job output
          // and in the coverage project list.
          name: 'unit-data',
          environment: 'node',
          include: ['packages/persistence/tests/**/*.test.ts'],
          globalSetup: ['packages/persistence/tests/globalSetup.ts'],
          testTimeout: 180000,
          hookTimeout: 180000,
          // Issue #286. These files drive `liquibase update` against per-file databases, but roles
          // are cluster-wide, so two running concurrently race on pg_authid/pg_shdepend and Postgres
          // kills the loser with "tuple concurrently updated". vitest.postgres.config.ts sets this
          // for the same reason. Until now this project was safe ONLY because the `coverage` script
          // happens to pass --no-file-parallelism on the command line -- `vitest --project
          // unit-data` on its own would hit the race. Safety now travels with the project instead
          // of depending on a caller remembering a flag.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'unit-web',
          environment: 'jsdom',
          // Both extensions: a `.tsx`-only glob silently excluded hook tests written as plain
          // `.ts`, so they sat in the repo never running and never reported as missing.
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          setupFiles: ['apps/web/src/test/setup.ts'],
          // 10s rather than the 5s default (Issue #284). App.test.tsx runs 120 tests in ~54s on
          // its own, so its heavier interaction tests sit close to 5s before any contention; under
          // vitest's file-level parallelism one of them tips over, while the same test passes under
          // `coverage`'s --no-file-parallelism. Doubling the budget absorbs that without masking a
          // genuine hang -- `unit-data` already carries a per-project timeout for the same reason.
          testTimeout: 10000,
        },
      },
      {
        test: {
          // Issue #209: testTimeout above the 5000ms default, for the same reason the infra project
          // below raised its own. These files run full Express apps in parallel worker processes, and
          // under combined load the timing-sensitive ones inflate past the cap while still being
          // correct -- they pass 100% of the time in isolation, across the whole history of #209.
          //
          // Measured 2026-09-05 on a loaded machine (5 of 6 full-suite runs flaked that day):
          //   auth-endpoints / session-logging / cors  ->  5035 / 5256 / 5645 ms   (FAIL at 5000)
          //   sentry-middleware                         ->  4788 ms                (212 ms from failing)
          //   the same 3 files idle, all 21 tests       ->  8 s total, ~0.4 s each
          //   openapi.test.ts, concurrently             ->  19.3 s  (the heaviest single test; a
          //                                                 contention SOURCE for its siblings)
          // A 12x inflation under load, from tests that are not hanging -- just slow. 30000 gives
          // ~5x headroom over the worst observed and matches infra's value. A genuinely hung test
          // now takes 30 s to report instead of 5 s; the CI `test` job's 30-minute budget absorbs
          // that comfortably. This does not touch #192's separate correlation-id short-circuit
          // class, which is rare, happens even serially, and is still uncaptured.
          name: 'integration',
          environment: 'node',
          include: ['apps/api/tests/**/*.test.ts'],
          setupFiles: ['apps/api/tests/testHelpers/integrationSetup.ts'],
          testTimeout: 30000,
        },
      },
      {
        test: {
          // Drift review finding #03: infra/ was a standalone npm project outside the root
          // workspaces array, so its 18 CDK template assertions only ran via a manual
          // `cd infra && npm test` -- no CI job, git hook, or npm script reached them. Its own
          // vitest.config.ts is kept (used by `npm run -w @recon/infra test` directly), but this
          // project entry is what makes `npm run test:unit` -- and therefore CI -- exercise the
          // same tests. Pure CDK template synthesis, no AWS credentials or network access needed.
          //
          // testTimeout above the 5000ms default: `Template.fromStack()` synthesizes a real CDK
          // app, heavier than a typical unit assertion, and one test timed out at the default the
          // moment this ran alongside unit-core/unit-web's ~84 other files instead of alone --
          // same combined-load contention pattern as #209, just newly exposed by this wiring.
          name: 'infra',
          environment: 'node',
          include: ['infra/test/**/*.test.ts'],
          testTimeout: 30000,
        },
      },
    ],
  },
});
