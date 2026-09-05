import { randomUUID } from 'node:crypto';
import type { UserRole } from '@recon/domain';
import request from 'supertest';
import { signAuthToken } from '../../src/services/authService';
import { describeResponse, recordObservedResponse } from './lastResponse';

/** Accepts a bare Express app (supertest's default ephemeral-per-call server) or a real listening
 * `Server` from `startTestServer` (./testServer.ts) -- see that file for why the latter exists. */
type RequestTarget = Parameters<typeof request>[0];

/**
 * Mints a valid bearer token for tests, using the app's own `signAuthToken` rather than
 * hand-rolling a JWT -- this stays correct automatically if the token shape ever changes, and
 * signs with whatever secret `createApp`'s own middleware will verify against (JWT_SECRET if
 * set, otherwise the ephemeral per-process secret authService.ts generates in test/dev).
 */
export const mintTestAuthToken = (
  overrides: Partial<{
    sub: string;
    role: UserRole;
    organizationId: string;
    firstName: string;
    lastName: string;
  }> = {},
): string =>
  signAuthToken({
    sub: overrides.sub ?? 'test-user',
    role: overrides.role ?? 'financial-analyst',
    organizationId: overrides.organizationId ?? 'test-org',
    firstName: overrides.firstName ?? 'Test',
    lastName: overrides.lastName ?? 'User',
  }).token;

/** Shorthand for the header object supertest/fetch expect. */
export const authHeader = (
  overrides?: Parameters<typeof mintTestAuthToken>[0],
): { Authorization: string } => ({
  Authorization: `Bearer ${mintTestAuthToken(overrides)}`,
});

/**
 * Attaches a unique x-correlation-id to a request and asserts the response echoes the same one
 * back. app.ts:1698 mints/forwards this id and app.ts:1731 sets it on every response.
 *
 * What this proves, precisely -- the original comment here overstated it:
 *
 * - An ABSENT header means the response never reached app.ts:1731, i.e. it short-circuited in a
 *   middleware ABOVE that line (the rate limiter -> 429; express.json rejecting a malformed body
 *   -> 400) or was emitted by Node's HTTP parser before Express ran at all (-> 400, empty body,
 *   zero headers). This is NOT transport mis-attribution and must not be reported as such.
 *
 * - A DIFFERENT header value means the response carries another request's id and genuinely does
 *   not belong to this request.
 *
 * - A MATCHING header does not rule out a response from the wrong app instance: app.ts:1698's
 *   genReqId echoes the request's own header, so any instance serving this request echoes the
 *   right id. This check cannot detect that case; the body captured below is what distinguishes it.
 *
 * Issue #192 background: two isolated, non-reproducible failures in
 * reconciliation-runs-rollforward-endpoints.test.ts, both returning exactly 400 -- one on a route
 * where a pool-less app has no reachable path to a 400 at all. Ephemeral-port/TIME_WAIT reuse and
 * socket pooling were both tested and refuted (supertest never pools: superagent sets
 * `agent: false`), so the body and header count below are the remaining discriminators.
 *
 * RESOLVED 2026-09-05: the mechanism was none of the three short-circuits below. It was
 * address-family misdelivery -- supertest binds dual-stack `[::]` and connects to `127.0.0.1`; on
 * macOS an IPv4-specific listener from another process may share the port and receives the
 * request. Captured as a bare 404 with three headers that pino-http proved no Express app ever
 * saw. integrationSetup.ts now makes supertest connect in the server's own family ([::1] to a
 * dual-stack server), which removes the path. This check stays as the detector: if it ever fires
 * again with a ~3-header response, that family match has regressed.
 */
const withCorrelationIdCheck = (method: string, test: request.Test): request.Test => {
  const correlationId = randomUUID();
  return test.set('x-correlation-id', correlationId).expect((response) => {
    recordObservedResponse({
      method,
      url: test.url,
      sentCorrelationId: correlationId,
      response,
    });

    const echoed = response.headers['x-correlation-id'];

    if (echoed === correlationId) {
      return;
    }

    if (echoed === undefined) {
      throw new Error(
        'No x-correlation-id on the response, so it never reached the middleware at app.ts:1731. ' +
          'Either a short-circuit above that line -- rate limiter (429, JSON body), express.json ' +
          "rejecting a malformed body (400, JSON body), Node's HTTP parser rejecting the request " +
          'bytes (400, EMPTY body, zero headers) -- or, the case actually observed on 2026-09-05, a ' +
          'response from a DIFFERENT listener that shared the port (a bare 404 with ~3 headers). ' +
          'integrationSetup.ts matches the client to the server address family to prevent that; ' +
          `a ~3-header response here means that match regressed. ${describeResponse(response)}. See Issue #192.`,
      );
    }

    throw new Error(
      `Response correlation-id mismatch: sent ${correlationId}, ` +
        `received ${String(echoed)}. The response carries a different ` +
        "request's id, so it does not belong to this request. If the body " +
        'below is a validation message, it names the request this response ' +
        `DID belong to. ${describeResponse(response)}. See Issue #192.`,
    );
  });
};

/**
 * Drop-in replacement for `request(app)` that pre-attaches a valid bearer token to every
 * verb. Existing tests written before ADR-0002's deny-by-default guard landed were testing
 * business logic, not auth -- this keeps them doing that without hand-editing every call site.
 * Defaults to 'superuser' so it clears both the application-access and developer-dashboard
 * authz gates; pass an override (or use `request(app)` / `mintTestAuthToken` directly) for tests
 * that specifically exercise unauthenticated or wrong-role behavior.
 *
 * Every call also carries the correlation-id echo check above -- ambient, no per-test changes
 * needed, since every test in the suite already goes through one of these five verbs.
 */
export const authedApp = (
  app: RequestTarget,
  overrides?: Parameters<typeof mintTestAuthToken>[0],
) => {
  const header = authHeader({ role: 'superuser', ...overrides });

  return {
    get: (url: string) => withCorrelationIdCheck('GET', request(app).get(url).set(header)),
    post: (url: string) => withCorrelationIdCheck('POST', request(app).post(url).set(header)),
    put: (url: string) => withCorrelationIdCheck('PUT', request(app).put(url).set(header)),
    delete: (url: string) =>
      withCorrelationIdCheck('DELETE', request(app).delete(url).set(header)),
    patch: (url: string) => withCorrelationIdCheck('PATCH', request(app).patch(url).set(header)),
  };
};
