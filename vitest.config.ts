import { defineConfig } from 'vitest/config';

const baseCoverageExclude = [
  '**/*.config.*',
  '**/dist/**',
  '**/coverage/**',
  'apps/api/src/index.ts',
  'apps/api/src/server.ts',
  'packages/domain/src/types.ts',
  'scripts/**',
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
          name: 'unit-data',
          environment: 'node',
          include: ['packages/persistence/tests/**/*.test.ts'],
          globalSetup: ['packages/persistence/tests/globalSetup.ts'],
          testTimeout: 180000,
          hookTimeout: 180000,
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
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['apps/api/tests/**/*.test.ts'],
          setupFiles: ['apps/api/tests/testHelpers/integrationSetup.ts'],
        },
      },
    ],
  },
});
