import { randomUUID } from 'node:crypto';
import type { UserRole } from '@recon/domain';
import request from 'supertest';
import type { Express } from 'express';
import { signAuthToken } from '../../src/services/authService';

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
 * back. app.ts:1701 mints/forwards this id and app.ts:1731 sets it on every response -- if a
 * response ever carries a DIFFERENT id than the request that's asserting against it, that proves
 * the assertion read a response that didn't belong to its request (transport-layer
 * mis-attribution, e.g. ephemeral-port/socket reuse under concurrent supertest instances) rather
 * than a flaky assertion or shared-state bug. See Issue #192: two isolated, non-reproducible
 * failures in reconciliation-runs-rollforward-endpoints.test.ts both matched a temporally
 * adjacent sibling test's expected status exactly -- the signature of mis-attribution, not state
 * corruption -- but nothing previously made that provable rather than merely likely.
 */
const withCorrelationIdCheck = (test: request.Test): request.Test => {
  const correlationId = randomUUID();
  return test.set('x-correlation-id', correlationId).expect((response) => {
    const echoed = response.headers['x-correlation-id'];
    if (echoed !== correlationId) {
      throw new Error(
        `Response correlation-id mismatch: sent ${correlationId}, received ${echoed}. ` +
          'This response does not belong to this request -- see Issue #192.',
      );
    }
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
export const authedApp = (app: Express, overrides?: Parameters<typeof mintTestAuthToken>[0]) => {
  const header = authHeader({ role: 'superuser', ...overrides });

  return {
    get: (url: string) => withCorrelationIdCheck(request(app).get(url).set(header)),
    post: (url: string) => withCorrelationIdCheck(request(app).post(url).set(header)),
    put: (url: string) => withCorrelationIdCheck(request(app).put(url).set(header)),
    delete: (url: string) => withCorrelationIdCheck(request(app).delete(url).set(header)),
    patch: (url: string) => withCorrelationIdCheck(request(app).patch(url).set(header)),
  };
};
