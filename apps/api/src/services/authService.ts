import type { UserRole } from '@recon/domain';
import { userRoles } from '@recon/domain';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type pino from 'pino';

/** Claims carried by every issued token. `jti` is what a logout denylist entry is keyed on.
 * firstName/lastName are display-only, not used in any access decision -- carried on the token
 * so /api/auth/me can answer without a DB round trip. */
export interface AuthTokenPayload {
  sub: string;
  role: UserRole;
  organizationId: string;
  firstName: string;
  lastName: string;
  jti: string;
}

/** ADR-0002 DECIDE 1 (JWT). Bounds how long a token stays valid if Redis is unavailable to serve
 * the logout denylist -- see `denylistToken` below. */
export const AUTH_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export const isProductionRuntime = (): boolean => process.env.NODE_ENV === 'production';

let ephemeralDevSecret: string | null = null;

/**
 * Resolves the JWT signing secret. Production must configure `JWT_SECRET` explicitly -- an auth
 * system signing with a guessable or empty secret is worse than no auth system, since it looks
 * secure without being secure. Dev/test generate a random secret once per process so the app
 * still runs unconfigured locally; every existing token invalidates on restart, which is
 * acceptable outside production.
 */
export const resolveJwtSecret = (logger?: pino.Logger): string => {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  if (isProductionRuntime()) {
    throw new Error('JWT_SECRET must be set in production; refusing to start with no auth secret.');
  }

  if (!ephemeralDevSecret) {
    ephemeralDevSecret = randomBytes(32).toString('hex');
    logger?.warn(
      { action: 'auth.jwt_secret.ephemeral' },
      'JWT_SECRET not set; generated an ephemeral secret for this process. All sessions will ' +
        'invalidate on restart. Set JWT_SECRET explicitly outside local dev.',
    );
  }

  return ephemeralDevSecret;
};

export const hashPassword = async (plaintext: string): Promise<string> => bcrypt.hash(plaintext, 12);

export const verifyPassword = async (plaintext: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plaintext, hash);

const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && (userRoles as readonly string[]).includes(value);

export const signAuthToken = (
  claims: Pick<AuthTokenPayload, 'sub' | 'role' | 'organizationId' | 'firstName' | 'lastName'>,
  logger?: pino.Logger,
): { token: string; jti: string; expiresAt: Date } => {
  const jti = randomUUID();
  const secret = resolveJwtSecret(logger);
  const token = jwt.sign(
    {
      role: claims.role,
      organizationId: claims.organizationId,
      firstName: claims.firstName,
      lastName: claims.lastName,
    },
    secret,
    {
      subject: claims.sub,
      jwtid: jti,
      expiresIn: AUTH_TOKEN_TTL_SECONDS,
    },
  );

  return { token, jti, expiresAt: new Date(Date.now() + AUTH_TOKEN_TTL_SECONDS * 1000) };
};

/** Returns `null` for any invalid, expired, or malformed token rather than throwing, so callers
 * always get a uniform "not authenticated" outcome. */
export const verifyAuthToken = (token: string, logger?: pino.Logger): AuthTokenPayload | null => {
  try {
    const secret = resolveJwtSecret(logger);
    const decoded = jwt.verify(token, secret);
    const record = decoded as Record<string, unknown>;

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.jti !== 'string' ||
      !isUserRole(record.role) ||
      typeof record.organizationId !== 'string' ||
      typeof record.firstName !== 'string' ||
      typeof record.lastName !== 'string'
    ) {
      return null;
    }

    return {
      sub: decoded.sub,
      jti: decoded.jti,
      role: record.role as UserRole,
      organizationId: record.organizationId,
      firstName: record.firstName,
      lastName: record.lastName,
    };
  } catch {
    return null;
  }
};

/** Minimal shape of the subset of the `redis` client the denylist needs, so it can share
 * whichever client the rate limiter already connected instead of opening a second one. */
export interface DenylistRedisClient {
  isOpen: boolean;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  exists(key: string): Promise<number>;
}

const denylistKey = (jti: string): string => `recon:auth:denylist:${jti}`;

/**
 * Revokes a token before its natural expiry (logout). If Redis is unavailable this is a real
 * security degradation, not a transparent fallback like the rate limiter's -- so it logs at
 * `error`, not `warn`, and the caller still returns success to the client (the token will still
 * expire naturally within AUTH_TOKEN_TTL_SECONDS; there is no safe way to "fail" a logout).
 */
export const denylistToken = async (
  client: DenylistRedisClient | null,
  jti: string,
  ttlSeconds: number,
  logger?: pino.Logger,
): Promise<void> => {
  if (!client?.isOpen) {
    logger?.error(
      { action: 'auth.denylist.unavailable', jti },
      'Logout could not revoke the token server-side (Redis unavailable); it remains valid until natural expiry.',
    );
    return;
  }

  try {
    await client.set(denylistKey(jti), '1', { EX: Math.max(1, ttlSeconds) });
  } catch (error) {
    logger?.error(
      { action: 'auth.denylist.write_failed', jti, err: error },
      'Failed to write logout denylist entry; the token remains valid until natural expiry.',
    );
  }
};

export const isTokenDenylisted = async (
  client: DenylistRedisClient | null,
  jti: string,
  logger?: pino.Logger,
): Promise<boolean> => {
  if (!client?.isOpen) {
    return false;
  }

  try {
    return (await client.exists(denylistKey(jti))) > 0;
  } catch (error) {
    logger?.warn(
      { action: 'auth.denylist.read_failed', jti, err: error },
      'Failed to check logout denylist; allowing the request through rather than rejecting a possibly-valid session.',
    );
    return false;
  }
};
