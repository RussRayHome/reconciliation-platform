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
 * Drop-in replacement for `request(app)` that pre-attaches a valid bearer token to every
 * verb. Existing tests written before ADR-0002's deny-by-default guard landed were testing
 * business logic, not auth -- this keeps them doing that without hand-editing every call site.
 * Defaults to 'superuser' so it clears both the application-access and developer-dashboard
 * authz gates; pass an override (or use `request(app)` / `mintTestAuthToken` directly) for tests
 * that specifically exercise unauthenticated or wrong-role behavior.
 */
export const authedApp = (app: Express, overrides?: Parameters<typeof mintTestAuthToken>[0]) => {
  const header = authHeader({ role: 'superuser', ...overrides });

  return {
    get: (url: string) => request(app).get(url).set(header),
    post: (url: string) => request(app).post(url).set(header),
    put: (url: string) => request(app).put(url).set(header),
    delete: (url: string) => request(app).delete(url).set(header),
    patch: (url: string) => request(app).patch(url).set(header),
  };
};
