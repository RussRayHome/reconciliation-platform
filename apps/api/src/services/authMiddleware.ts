import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RolePermissions, UserRole } from '@recon/domain';
import { rolePermissionsByRole } from '@recon/domain';
import type { Pool } from 'pg';
import type pino from 'pino';
import type { DenylistRedisClient } from './authService';
import { isTokenDenylisted, verifyAuthToken } from './authService';

/** The authenticated principal for a request, attached by `createAuthMiddleware`. */
export interface AuthenticatedPrincipal {
  username: string;
  role: UserRole;
  organizationId: string;
  firstName: string;
  lastName: string;
  jti: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthenticatedPrincipal;
    }
  }
}

/**
 * ADR-0002 step 4: deny-by-default across /api, with an explicit public allowlist. Every route
 * added after this list must be reachable without auth or it 401s -- a forgotten route becomes a
 * visible failure instead of a silent hole. Keep this list short and justify every entry:
 *   /api/health         - infra/orchestration health probes, run before any session exists
 *   /api/metrics        - operational scrape endpoint (Prometheus-style), not customer data
 *   /api/openapi.json   - API shape description, not data
 *   /api/auth/login     - cannot require a token to obtain a token
 *   /api/auth/signup    - cannot require a token to sign up for one
 */
const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  '/api/health',
  '/api/metrics',
  '/api/openapi.json',
  '/api/auth/login',
  '/api/auth/signup',
]);

/**
 * Verifies the bearer token on every non-public request and attaches `request.auth`. Does not
 * enforce role; see `requireApplicationAccess` for that.
 */
export const createAuthMiddleware = (
  logger: pino.Logger,
  getDenylistClient: () => DenylistRedisClient | null,
): RequestHandler => {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (PUBLIC_ROUTES.has(request.path)) {
      next();
      return;
    }

    const header = request.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : null;

    if (!token) {
      response.status(401).json({ message: 'Authentication required.' });
      return;
    }

    const payload = verifyAuthToken(token, logger);
    if (!payload) {
      response.status(401).json({ message: 'Invalid or expired session.' });
      return;
    }

    isTokenDenylisted(getDenylistClient(), payload.jti, logger)
      .then((denylisted) => {
        if (denylisted) {
          response.status(401).json({ message: 'Session has been signed out.' });
          return;
        }

        request.auth = {
          username: payload.sub,
          role: payload.role,
          organizationId: payload.organizationId,
          firstName: payload.firstName,
          lastName: payload.lastName,
          jti: payload.jti,
        };
        next();
      })
      .catch(next);
  };
};

const requireRolePermission =
  (permission: keyof RolePermissions): RequestHandler =>
  (request, response, next) => {
    if (!request.auth || !rolePermissionsByRole[request.auth.role][permission]) {
      response.status(403).json({ message: 'Your role does not have access to this resource.' });
      return;
    }

    next();
  };

/** Gates the reconciliation/aliases/mapping surface -- everything `canAccessApplication` covers. */
export const requireApplicationAccess = requireRolePermission('canAccessApplication');

/**
 * Gates mapping *creation* specifically (not the whole /api/mapping surface -- read routes like
 * canonical-fields stay reachable). Always reads live from the database rather than trusting
 * anything on the JWT: identity/entity verification status can flip from 'pending' to 'verified'
 * (or 'failed') well after the token was issued, so a cached claim would go stale mid-session.
 * `pool === null` is local-fallback mode (no DB-backed reconciliation_user row exists for those
 * users at all) -- treated as verified so local dev isn't blocked by a gate it structurally can't
 * satisfy.
 */
export const createRequireFullyVerified = (pool: Pool | undefined): RequestHandler => {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.auth) {
      response.status(401).json({ message: 'Authentication required.' });
      return;
    }

    if (!pool) {
      next();
      return;
    }

    pool
      .query<{ identity_verification_status: string; entity_verification_status: string }>(
        `
          SELECT u.identity_verification_status, o.entity_verification_status
          FROM reconciliation_user u
          JOIN reconciliation_organization o ON o.id = u.organization_id
          WHERE u.user_name = $1
          LIMIT 1
        `,
        [request.auth.username],
      )
      .then((result) => {
        const row = result.rows[0];
        const verified =
          row?.identity_verification_status === 'verified' &&
          row?.entity_verification_status === 'verified';

        if (!verified) {
          response.status(403).json({
            message:
              'Your account must complete entity and identity verification before creating mappings.',
          });
          return;
        }

        next();
      })
      .catch(next);
  };
};
