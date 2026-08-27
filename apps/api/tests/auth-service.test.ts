import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type pino from 'pino';

import { resolveJwtSecret, signAuthToken, verifyAuthToken } from '../src/services/authService';

const TEST_CLAIMS = {
  sub: 'user-1',
  role: 'admin' as const,
  organizationId: 'org-1',
  firstName: 'Test',
  lastName: 'User',
};

const buildMockLogger = (): { logger: pino.Logger; debug: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } => {
  const debug = vi.fn();
  const warn = vi.fn();
  return { logger: { debug, warn } as unknown as pino.Logger, debug, warn };
};

describe('resolveJwtSecret', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws in production when JWT_SECRET is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    expect(() => resolveJwtSecret()).toThrow(/JWT_SECRET must be set in production/);
  });

  it('returns the configured secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-real-configured-secret';

    expect(resolveJwtSecret()).toBe('a-real-configured-secret');
  });
});

describe('verifyAuthToken', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-for-verify-auth-token-tests';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns the decoded payload for a valid token', () => {
    const { token } = signAuthToken(TEST_CLAIMS);

    const result = verifyAuthToken(token);

    expect(result).toMatchObject({
      sub: TEST_CLAIMS.sub,
      role: TEST_CLAIMS.role,
      organizationId: TEST_CLAIMS.organizationId,
    });
  });

  it('returns null and logs at debug level for an expired token, without rethrowing', () => {
    const { token } = signAuthToken(TEST_CLAIMS);
    const { logger, debug, warn } = buildMockLogger();

    vi.useFakeTimers();
    vi.advanceTimersByTime(9 * 60 * 60 * 1000); // past AUTH_TOKEN_TTL_SECONDS (8h)
    const result = verifyAuthToken(token, logger);
    vi.useRealTimers();

    expect(result).toBeNull();
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.token.expired' }),
      expect.any(String),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns null and logs at warn level for a token signed with the wrong secret', () => {
    const { token } = signAuthToken(TEST_CLAIMS);
    const { logger, debug, warn } = buildMockLogger();

    process.env.JWT_SECRET = 'a-different-secret-than-the-one-used-to-sign';
    const result = verifyAuthToken(token, logger);

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.token.invalid' }),
      expect.any(String),
    );
    expect(debug).not.toHaveBeenCalled();
  });

  it('returns null and logs at warn level for a malformed token', () => {
    const { logger, warn } = buildMockLogger();

    const result = verifyAuthToken('not-a-real-jwt', logger);

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.token.invalid' }),
      expect.any(String),
    );
  });

  // ISSUE-004: this used to be a bare `catch { return null }`, which also swallowed
  // resolveJwtSecret's production "JWT_SECRET must be set" throw -- the API booted green and
  // every request 401'd with zero log lines explaining why. A non-JWT-shaped failure must now
  // propagate instead of silently becoming "not authenticated".
  it('rethrows a non-JWT error instead of swallowing it (the original ISSUE-004 defect)', () => {
    const { token } = signAuthToken(TEST_CLAIMS);
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    expect(() => verifyAuthToken(token)).toThrow(/JWT_SECRET must be set in production/);
  });
});
