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
import type { Server as HttpServer } from 'node:http';
import request from 'supertest';
import { beforeEach, onTestFailed } from 'vitest';
import { clearObservedResponse, describeResponse, takeObservedResponse } from './lastResponse';

process.env.RATE_LIMIT_USE_REDIS = 'false';

/**
 * Issues #192 / #319: make supertest's client connect in the SAME address family the server bound.
 *
 * supertest's `request(app)` calls `app.listen(0)` -- Node's default with no host is dual-stack
 * `[::]` -- and then connects to the hardcoded `http://127.0.0.1:<port>`. On macOS (BSD socket
 * semantics) an IPv4-specific `127.0.0.1:<port>` bind from ANOTHER process is permitted while the
 * dual-stack one is live, and a client connecting to `127.0.0.1:<port>` is routed to the
 * IPv4-specific listener. supertest's request then reaches a stranger. A squatter that answers gave
 * #192's wrong-shaped response -- captured 2026-09-05 as a bare 404 with three headers that pino-http
 * proved no Express app ever received. A squatter that accepts and never answers gives #319's 30 s
 * hang. The port coexistence itself is demonstrated by addressFamily.test.ts.
 *
 * Why the CLIENT and not the server: supertest reads `server.address().port` synchronously right
 * after calling `listen(0)`. A bare numeric port binds synchronously, but `listen(port, host)` --
 * even with an IP literal -- goes through dns.lookup and binds asynchronously, so pinning the server
 * to 127.0.0.1 leaves `address()` null at that moment and every request(app) throws
 * "Cannot read properties of null (reading 'port')". Measured: listen(0) -> '::' immediately;
 * listen(0, '127.0.0.1') -> null immediately. The URL supertest builds is the one place where both
 * the family decision and the timing are right. It also covers the 47 direct `request(app)` call
 * sites across 8 files that never touch authedApp, and the three files that listen(0) themselves.
 *
 * Rule: if the server bound IPv6 (which is what dual-stack `[::]` reports), connect to `[::1]`;
 * an IPv4-bound server keeps `127.0.0.1`. Families always agree, so an IPv4-specific squatter can no
 * longer receive the connect. Residual: an IPv6-specific squatter on `[::1]` beside our `[::]` would
 * be the mirror case -- far rarer (Docker and most tooling bind 127.0.0.1 / 0.0.0.0) -- and
 * withCorrelationIdCheck stays in place as the detector for it. Guarded so re-running this setup
 * file in the same worker wraps once.
 */
type ServerAddressFn = (this: unknown, app: HttpServer, path: string) => string;
type PatchableTest = { prototype: { serverAddress: ServerAddressFn; __familyMatched?: true } };
const SupertestTest = (request as unknown as { Test: PatchableTest }).Test;
if (!SupertestTest.prototype.__familyMatched) {
  const originalServerAddress = SupertestTest.prototype.serverAddress;
  SupertestTest.prototype.serverAddress = function familyMatchedServerAddress(app, path) {
    const url = originalServerAddress.call(this, app, path); // performs the listen(0) if needed
    const bound = typeof app.address === 'function' ? app.address() : null;
    if (bound !== null && typeof bound === 'object' && bound.family === 'IPv6') {
      return url.replace('://127.0.0.1:', '://[::1]:');
    }
    return url;
  };
  SupertestTest.prototype.__familyMatched = true;
}

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
