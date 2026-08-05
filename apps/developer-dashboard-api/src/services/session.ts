import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type pino from 'pino';

/** Claims carried by every issued dashboard session token. */
export interface DashboardSessionClaims {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export const SESSION_COOKIE_NAME = 'dashboard_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export const isProductionRuntime = (): boolean => process.env.NODE_ENV === 'production';

let ephemeralDevSecret: string | null = null;

/**
 * Own signing secret, deliberately separate from the product's JWT_SECRET (apps/api's
 * authService.ts) -- this app has no shared runtime with the product, and a session issued here
 * should never be mistakable for (or verifiable against) a product session.
 */
export const resolveSessionSecret = (logger?: pino.Logger): string => {
  const configured = process.env.DASHBOARD_JWT_SECRET?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  if (isProductionRuntime()) {
    throw new Error('DASHBOARD_JWT_SECRET must be set in production; refusing to start with no session secret.');
  }

  if (!ephemeralDevSecret) {
    ephemeralDevSecret = randomBytes(32).toString('hex');
    logger?.warn(
      { action: 'dashboard.session_secret.ephemeral' },
      'DASHBOARD_JWT_SECRET not set; generated an ephemeral secret for this process. All ' +
        'sessions will invalidate on restart. Set DASHBOARD_JWT_SECRET explicitly outside local dev.',
    );
  }

  return ephemeralDevSecret;
};

export const signSession = (claims: DashboardSessionClaims, secret: string): string =>
  jwt.sign(claims, secret, { expiresIn: SESSION_TTL_SECONDS });

export const verifySession = (token: string, secret: string): DashboardSessionClaims | null => {
  try {
    return jwt.verify(token, secret) as DashboardSessionClaims;
  } catch {
    return null;
  }
};

/** Minimal manual cookie read -- avoids pulling in cookie-parser for a single header. */
export const readCookie = (cookieHeader: string | undefined, name: string): string | null => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
};
