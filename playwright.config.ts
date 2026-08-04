import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';
const apiURL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:4000';

export default defineConfig({
  testDir: './apps/web/tests/e2e',
  timeout: 60_000,
  outputDir: './test-results/e2e',
  // Retry only in CI: guards against ordinary environment flakiness without
  // masking a real regression, which fails the same way on every retry.
  retries: process.env.CI ? 2 : 0,
  // Full-page screenshots on long doc pages (~9800px tall) can exceed the 5s
  // default `toHaveScreenshot` timeout under CPU contention from other workers
  // running concurrently — confirmed by a byte-identical actual/expected pair on
  // every failure, so the capture itself is correct, it's just slow to converge.
  // Give it real headroom rather than fail on a resource-contention timing race.
  expect: {
    timeout: 20_000,
  },
  // Single worker: visual-baseline.spec.ts is already forced serial within itself
  // (see its own test.describe.configure) because its three viewport variants
  // submit the identical reconciliation and race on shared backend run state if
  // run concurrently. It also starves for CPU — and its tall full-page screenshots
  // become flaky — when the functional specs run in sibling workers at the same
  // time. A Playwright project split with a dependency ordering was tried first
  // but caused unrelated hangs; a single worker is simpler and reliably stable.
  workers: 1,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // baseURL is plain http in the default (non-Docker) local dev path, and only https against
    // the Docker `tools` container's self-signed dev cert (PLAYWRIGHT_BASE_URL=https://web:8443)
    // -- harmless to leave on unconditionally either way.
    ignoreHTTPSErrors: true,
  },
  webServer: [
    {
      command: 'npm run dev:api:test',
      url: `${apiURL}/api/health`,
      reuseExistingServer: true,
      cwd: './',
    },
    {
      command: 'npm run dev:web:test',
      url: baseURL,
      reuseExistingServer: true,
      cwd: './',
      // Same self-signed-cert reasoning as `use.ignoreHTTPSErrors` above, but this is a separate
      // setting: Playwright's own readiness probe against `url` doesn't inherit `use`.
      ignoreHTTPSErrors: true,
    },
  ],
});
