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
  projects: [
    {
      name: 'functional',
      testDir: './apps/web/tests/e2e/functional',
      // No workers/expect override -- runs at the runner's default parallelism with
      // Playwright's default 5s expect timeout, now that it no longer shares a
      // config with the visual project's constraints.
    },
    {
      name: 'visual',
      testDir: './apps/web/tests/e2e/visual',
      // Playwright's default snapshotPathTemplate includes {-projectName} and {-platform}. Drops
      // both: {-projectName} would rename every baseline the moment a project is named "visual"
      // (unrelated to this file's own purpose); {-platform} is dropped deliberately here -- now
      // that the visual project only ever runs inside the canonical container
      // (docker/e2e-visual.Dockerfile, enforced by containerGuard.ts), there is exactly one
      // platform, so a platform suffix would be redundant noise, not a real second baseline set.
      snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}',
      // Was forced single-worker because its three viewport variants submitted the identical
      // reconciliation and raced on shared backend run state (visual-baseline.spec.ts's
      // mockReconciliationRun intercepts that request now, so there's no live backend state left
      // to race on -- see P5 in the UI-testing breakout plan). Uncapped (Playwright's runner
      // default, half the container's CPU count -- 8 on this container's 16) was tried first and
      // caused real 60s test timeouts on navigation/network-idle waits under the resulting
      // resource contention, not flaky pixel diffs. workers: 2 was verified stable.
      workers: 2,
      // Full-page screenshots on long doc pages (~9800px tall) can exceed the 5s
      // default `toHaveScreenshot` timeout under CPU contention from sibling workers
      // running concurrently — confirmed by a byte-identical actual/expected pair on
      // every failure, so the capture itself is correct, it's just slow to converge.
      // Scoped here, not globally: a 20s timeout masking a genuinely slow assertion
      // is a real risk in the functional lane, which has no such contention to hide.
      expect: {
        timeout: 20_000,
      },
    },
  ],
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
