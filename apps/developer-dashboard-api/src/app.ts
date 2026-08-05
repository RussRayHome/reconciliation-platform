import { randomBytes } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import type pino from 'pino';

import {
  buildAuthorizeUrl,
  exchangeCodeForAccessToken,
  fetchGitHubUser,
  isAllowedGitHubUser,
  resolveGitHubOAuthConfig,
} from './services/githubOAuth';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  isProductionRuntime,
  readCookie,
  resolveSessionSecret,
  signSession,
  verifySession,
} from './services/session';
import { fetchLatestStatus, resolveStatusStoreConfig } from './services/statusStore';

const STATE_COOKIE_NAME = 'dashboard_oauth_state';

/** Read-through cache for the published status JSON -- this app has no execution/git access of
 *  its own, so every load would otherwise hit the GitHub Contents API directly. A short TTL keeps
 *  a browser tab left open from hammering it while still surfacing a new nightly run promptly. */
const STATUS_CACHE_TTL_MS = 60_000;
let statusCache: { fetchedAt: number; payload: unknown } | null = null;

const cookieFlags = (maxAgeSeconds: number): string => {
  const secure = isProductionRuntime() ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
};

export const createApp = (logger: pino.Logger) => {
  const app = express();
  app.use(pinoHttp({ logger }));

  const webOrigin = process.env.DASHBOARD_WEB_ORIGIN?.trim();
  if (!webOrigin) {
    throw new Error('DASHBOARD_WEB_ORIGIN must be set (the web app\'s own origin, for CORS + the post-login redirect).');
  }
  app.use(cors({ origin: webOrigin, credentials: true }));

  const sessionSecret = resolveSessionSecret(logger);

  app.get('/api/auth/github/login', (_request: Request, response: Response) => {
    const config = resolveGitHubOAuthConfig();
    const state = randomBytes(16).toString('hex');
    response.setHeader('Set-Cookie', `${STATE_COOKIE_NAME}=${state}; ${cookieFlags(600)}`);
    response.redirect(buildAuthorizeUrl(config, state));
  });

  app.get('/api/auth/github/callback', async (request: Request, response: Response) => {
    const code = typeof request.query.code === 'string' ? request.query.code : null;
    const state = typeof request.query.state === 'string' ? request.query.state : null;
    const expectedState = readCookie(request.headers.cookie, STATE_COOKIE_NAME);

    if (!code || !state || !expectedState || state !== expectedState) {
      response.status(400).json({ error: 'Invalid or expired OAuth state.' });
      return;
    }

    try {
      const config = resolveGitHubOAuthConfig();
      const accessToken = await exchangeCodeForAccessToken(config, code);
      const user = await fetchGitHubUser(accessToken);

      if (!isAllowedGitHubUser(user.login)) {
        request.log.warn({ action: 'dashboard.auth.denied', login: user.login }, 'GitHub login not on allowlist');
        response.status(403).json({ error: `GitHub user "${user.login}" is not authorized for this dashboard.` });
        return;
      }

      const token = signSession({ login: user.login, name: user.name, avatarUrl: user.avatarUrl }, sessionSecret);
      response.setHeader('Set-Cookie', [
        `${STATE_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`,
        `${SESSION_COOKIE_NAME}=${token}; ${cookieFlags(SESSION_TTL_SECONDS)}`,
      ]);
      response.redirect(webOrigin);
    } catch (error) {
      request.log.error({ action: 'dashboard.auth.callback_failed', err: error }, 'GitHub OAuth callback failed');
      response.status(502).json({ error: 'GitHub sign-in failed. Please try again.' });
    }
  });

  app.post('/api/auth/logout', (_request: Request, response: Response) => {
    response.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
    response.status(204).end();
  });

  const requireAuth = (request: Request, response: Response, next: NextFunction): void => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    const claims = token ? verifySession(token, sessionSecret) : null;

    if (!claims) {
      response.status(401).json({ error: 'Not signed in.' });
      return;
    }

    response.locals.session = claims;
    next();
  };

  app.get('/api/auth/me', requireAuth, (_request: Request, response: Response) => {
    response.json(response.locals.session);
  });

  app.get('/api/status', requireAuth, async (request: Request, response: Response) => {
    try {
      const now = Date.now();
      if (statusCache && now - statusCache.fetchedAt < STATUS_CACHE_TTL_MS) {
        response.json(statusCache.payload);
        return;
      }

      const config = resolveStatusStoreConfig();
      const payload = await fetchLatestStatus(config);
      statusCache = { fetchedAt: now, payload };
      response.json(payload);
    } catch (error) {
      request.log.error({ action: 'dashboard.status.fetch_failed', err: error }, 'Failed to read published status');
      response.status(502).json({ error: error instanceof Error ? error.message : 'Failed to read published status.' });
    }
  });

  app.get('/api/health', (_request: Request, response: Response) => {
    response.json({ ok: true });
  });

  return app;
};
