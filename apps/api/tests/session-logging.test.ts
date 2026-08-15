/**
 * Regression test for session-correlated logging: every login mints a session id (JWT `jti`,
 * apps/api/src/services/authService.ts) that must appear on every log line produced for that
 * session from login through logout, via three independent binding mechanisms that don't share
 * code (authMiddleware.ts's `request.log = request.log.child(...)`, app.ts's pino-http
 * `customProps`, and the login/logout audit trail's own explicit binding in `auditLoginEvent`).
 * A regression in any one of them would be easy to miss by inspection alone given how many
 * separate logger sources are involved -- this captures real emitted JSON and asserts on it
 * directly rather than trusting that the wiring still holds.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import request from 'supertest';

type CapturedLine = Record<string, unknown>;

const buildCapturingLogger = (): { logger: pino.Logger; lines: CapturedLine[] } => {
  const lines: CapturedLine[] = [];
  const logger = pino(
    { level: 'debug' },
    { write: (chunk: string) => lines.push(JSON.parse(chunk) as CapturedLine) },
  );
  return { logger, lines };
};

describe('session-correlated logging: jti propagation', () => {
  beforeEach(() => {
    process.env.ALLOW_LOCAL_LOGIN_FALLBACK = 'true';
  });

  afterEach(() => {
    delete process.env.ALLOW_LOCAL_LOGIN_FALLBACK;
  });

  it('binds the login session id onto every log line through logout, except the structural pre-auth exception', async () => {
    const { createApp } = await import('../src/app');
    const { logger, lines } = buildCapturingLogger();
    const app = createApp(undefined, undefined, undefined, undefined, logger);

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'rray' });

    expect(loginResponse.status).toBe(200);
    const token: string = loginResponse.body.token;
    expect(typeof token).toBe('string');

    const jwt = await import('jsonwebtoken');
    const decoded = jwt.default.decode(token) as { jti?: string } | null;
    const sessionId = decoded?.jti;
    expect(typeof sessionId).toBe('string');

    const meResponse = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meResponse.status).toBe(200);

    const logoutResponse = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logoutResponse.status).toBe(204);

    // Scope to lines that are actually part of a request's lifecycle or the auth audit trail --
    // createApp() itself also emits app-startup/config lines (e.g. "Using in-memory API rate
    // limiting", "JWT_SECRET not set; generated an ephemeral secret") that are legitimately
    // request-less and were never expected to carry a session id.
    const AUDIT_ACTIONS = new Set(['auth.login_success', 'auth.login_failure', 'auth.logout']);
    const isRequestScoped = (line: CapturedLine): boolean =>
      'req' in line || 'res' in line || (typeof line.action === 'string' && AUDIT_ACTIONS.has(line.action));

    // Structural exception: pino-http's "request received" line fires before auth middleware has
    // run for every route, including this test's own authenticated ones -- it can never carry
    // jti. Everything else request-scoped, across all three requests, must.
    const isPreAuthReceivedLine = (line: CapturedLine): boolean =>
      typeof line.msg === 'string' && line.msg.startsWith('request received');

    const postLoginLines = lines.filter((line) => isRequestScoped(line) && !isPreAuthReceivedLine(line));
    expect(postLoginLines.length).toBeGreaterThan(0);

    for (const line of postLoginLines) {
      expect(line.jti, `expected jti on log line: ${JSON.stringify(line)}`).toBe(sessionId);
    }

    // Specifically confirm the three independently-wired mechanisms all actually fired at least
    // once, rather than the loop above vacuously passing on a small/empty result set.
    const completedLines = lines.filter(
      (line) => typeof line.msg === 'string' && line.msg.startsWith('request completed'),
    );
    expect(completedLines.length).toBeGreaterThanOrEqual(3); // login, /me, logout

    const loginAuditLine = lines.find((line) => line.action === 'auth.login_success');
    expect(loginAuditLine?.jti).toBe(sessionId);

    const logoutAuditLine = lines.find((line) => line.action === 'auth.logout');
    expect(logoutAuditLine?.jti).toBe(sessionId);
  });

  it('never attaches a session id to a LOGIN_FAILURE event -- no token is minted for one', async () => {
    const { createApp } = await import('../src/app');
    const { logger, lines } = buildCapturingLogger();
    const app = createApp(undefined, undefined, undefined, undefined, logger);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'wrong-password' });

    expect(response.status).toBe(401);
    const failureLine = lines.find((line) => line.action === 'auth.login_failure');
    expect(failureLine).toBeDefined();
    expect(failureLine?.jti).toBeUndefined();
  });
});
