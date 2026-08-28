import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';
const apiURL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:4000';

// Only Stage is a live, rate-limited Dockerized deployment this suite can target -- native/CI
// runs (no PLAYWRIGHT_ENVIRONMENT_PATH_SEGMENT) hit an in-process/native server, and CI already
// disables rate limiting for those via its own DISABLE_API_RATE_LIMIT step-level env var, so they
// don't need this and shouldn't get it: changing their worker count risks reopening the CI
// shard-math fragility already fixed once (P6a). Deliberately checks for 'stage' specifically,
// not "any segment configured" -- a hypothetical future dev-targeted run isn't known to have the
// same contention problem and shouldn't inherit this cap without its own evidence.
const isStageTargeted = process.env.PLAYWRIGHT_ENVIRONMENT_PATH_SEGMENT === 'stage';

// R2 V4: new evidence, not a guess -- confirmed via a real PR #249 CI failure (3/4
// e2e-functional shards, `.click('Submit run')` timing out at 60s waiting for the button to
// become enabled). Submit run now blocks whenever the org's durable "latest run" is queued or
// running (the double-submit fix); CI's default uncapped parallelism (up to ~half the runner's
// CPU count, per the visual project's own comment) runs many spec files as concurrent workers
// against ONE shared org (all functional tests share one `dev-api-test` server/database, and
// every seeded test login belongs to the same "Default Organization" -- confirmed in
// scripts/db/dev-stage/create-users.psql). One worker's in-flight submission durably blocks a
// completely unrelated sibling worker's unrelated submission. Unlike the rate-limit contention
// `workers: 2` fixes above, this mechanism has no safe number greater than 1 -- two concurrent
// submissions against one shared org race exactly the same way, just half as often. Scoped to
// CI specifically (evidence is CI-specific); a solo local dev's own default run isn't known to
// hit this and shouldn't inherit the slowdown without its own evidence, per this file's existing
// philosophy for isStageTargeted above.
const isCi = Boolean(process.env.CI);

const resolveFunctionalWorkers = (): number | undefined => {
  if (isStageTargeted) {
    return 2;
  }
  if (isCi) {
    return 1;
  }
  return undefined;
};

const functionalWorkers = resolveFunctionalWorkers();

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
      // No expect override -- runs with Playwright's default 5s expect timeout, now that it no
      // longer shares a config with the visual project's constraints. Workers default to
      // Playwright's own parallelism (native/CI) unless targeting Stage -- see isStageTargeted
      // above: 4 concurrent workers logging in/uploading against Stage's live, Redis-backed rate
      // limiter (120 req/60s) produced real 429s and a downstream 401, confirmed to disappear
      // when run single-worker. Capped to 2, matching the visual project's own precedent for
      // tuning worker count down from a real, confirmed-not-flaky contention failure rather than
      // guessing at a number.
      //
      // CI gets workers: 1, not 2 -- see isCi's own comment above for why 2 isn't safe against
      // this particular contention mechanism the way it is against Stage's rate limiter.
      ...(functionalWorkers === undefined ? {} : { workers: functionalWorkers }),
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
      // resource contention, not flaky pixel diffs. workers: 2 verified stable in P5.
      workers: 2,
      // P6 added several region-scoped captures per test (Review/Summary alone went from 1
      // screenshot to 6) without changing worker count -- under workers: 2, the resulting extra
      // per-test wall-clock was enough to make an unrelated test (docs-hub-and-document, whose
      // own page.waitForLoadState('networkidle') has nothing to do with any P6 change) exceed the
      // global 60s test timeout under contention. Confirmed not a real bug: that same test passed
      // cleanly in isolation (35s) with no sibling load. Scoped a longer timeout to this project
      // rather than raising workers back down or dropping parallelism -- functional's tests are
      // fast enough that 60s should still mean something there if one genuinely hangs.
      timeout: 90_000,
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
