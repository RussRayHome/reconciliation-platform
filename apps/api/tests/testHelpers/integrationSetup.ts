/**
 * The `tools` container (and any host running these tests with the dev/stage env files loaded)
 * sets RATE_LIMIT_USE_REDIS=true so the live API is tested against the same Redis-backed limiter
 * it runs with in production. That's correct for the API container itself, but every integration
 * test file builds its own in-process app via createApp() -- and without an override, each of
 * those instances would ALSO connect to that same real, shared Redis rate-limit bucket, alongside
 * whatever live traffic (or other test files, run concurrently or moments apart) is hitting it.
 * A full integration run trivially exceeds the default 120 req/min limit purely from its own
 * request volume, turning into flaky, unrelated 429s in tests that never intended to exercise
 * rate limiting at all (e.g. alias-endpoints.test.ts).
 *
 * Default this project to the in-memory limiter, which is process-local and resets per test file.
 * auth-endpoints.test.ts and developer-endpoints.test.ts already override this themselves for the
 * specific tests that need real Redis-backed behavior (a fake unreachable host to test fail-open,
 * and an explicit RATE_LIMIT_USE_REDIS='true' to test the 429 path) -- those overrides run after
 * this setup file and take precedence for their own test bodies.
 */
import { beforeEach, onTestFailed } from 'vitest';
import { clearObservedResponse, describeResponse, takeObservedResponse } from './lastResponse';

process.env.RATE_LIMIT_USE_REDIS = 'false';

/**
 * Issue #192: print the last HTTP response the test observed whenever a test fails, so a
 * non-reproducible status mismatch carries its own diagnosis instead of costing an investigation.
 * console.error survives LOG_LEVEL=silent, which only configures the app's pino logger.
 */
beforeEach(() => {
  clearObservedResponse();

  onTestFailed(() => {
    const observed = takeObservedResponse();
    if (!observed) {
      return;
    }

    const echoed = observed.response.headers['x-correlation-id'] ?? '(absent)';
    console.error(
      `[#192] last response in this test: ${observed.method} ${observed.url} ` +
        `sent=${observed.sentCorrelationId} echoed=${echoed} ` +
        describeResponse(observed.response),
    );
  });
});
