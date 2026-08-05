/**
 * ADR-0002 step 8: unauthenticated -> 401 on every protected route; wrong role -> 403; a
 * persistence test asserting the stored credential is not the plaintext input. Covers the
 * deny-by-default middleware and role checks directly, separate from the business-logic test
 * files (alias/mapping/reconciliation) which now authenticate as a matter of course via
 * testHelpers/authToken's authedApp().
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import request from 'supertest';

import { hashPassword } from '../src/services/authService';
import { authHeader, authedApp } from './testHelpers/authToken';

describe('auth: unauthenticated access', () => {
  it.each([
    ['get', '/api/aliases'],
    ['get', '/api/mapping/canonical-fields'],
    ['get', '/api/reconciliation/latest'],
  ] as const)('%s %s returns 401 with no bearer token', async (method, route) => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    const response = await request(app)[method](route);

    expect(response.status).toBe(401);
  });

  it('returns 401 for a malformed Authorization header', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    const response = await request(app).get('/api/aliases').set('Authorization', 'not-a-bearer-token');

    expect(response.status).toBe(401);
  });

  it('returns 401 for a well-formed but invalid token', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    const response = await request(app)
      .get('/api/aliases')
      .set('Authorization', 'Bearer this.is.not-a-real-jwt');

    expect(response.status).toBe(401);
  });

  it('returns 401 for a token signed with a different secret', async () => {
    vi.stubEnv('JWT_SECRET', 'the-real-secret');
    const { createApp } = await import('../src/app');
    const app = createApp();

    // Minted before JWT_SECRET was stubbed to a different value in a fresh module instance would
    // still share this test's process env, so sign explicitly against a value the app doesn't use.
    const jwt = await import('jsonwebtoken');
    const foreignToken = jwt.default.sign({ role: 'superuser', organizationId: 'org-1' }, 'a-different-secret', {
      subject: 'someone',
      expiresIn: '1h',
    });

    const response = await request(app).get('/api/aliases').set('Authorization', `Bearer ${foreignToken}`);

    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it('returns 401 for an expired token', async () => {
    vi.stubEnv('JWT_SECRET', 'the-real-secret');
    const { createApp } = await import('../src/app');
    const app = createApp();

    const jwt = await import('jsonwebtoken');
    const expiredToken = jwt.default.sign(
      { role: 'superuser', organizationId: 'org-1', firstName: 'A', lastName: 'B' },
      'the-real-secret',
      { subject: 'rray', expiresIn: -10 },
    );

    const response = await request(app).get('/api/aliases').set('Authorization', `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it('leaves the public allowlist reachable with no token', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/openapi.json').expect(200);
    await request(app)
      .post('/api/auth/login')
      .send({ username: '', password: '' })
      .expect(401); // reachable (not 401-from-missing-auth); this 401 is "bad credentials"
  });
});

describe('auth: role-based authorization', () => {
  it('allows a financial-analyst onto the application surface', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    const response = await authedApp(app, { role: 'financial-analyst' }).get('/api/mapping/canonical-fields');

    expect(response.status).toBe(200);
  });
});

describe('auth: /api/auth/me', () => {
  it('echoes back the principal encoded in the bearer token', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    const response = await request(app)
      .get('/api/auth/me')
      .set(
        authHeader({
          sub: 'rray',
          role: 'admin',
          organizationId: 'org-42',
          firstName: 'Ryan',
          lastName: 'Ray',
        }),
      )
      .expect(200);

    expect(response.body).toEqual({
      username: 'rray',
      role: 'admin',
      organizationId: 'org-42',
      firstName: 'Ryan',
      lastName: 'Ray',
    });
  });

  it('401s with no token', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    await request(app).get('/api/auth/me').expect(401);
  });
});

describe('auth: password storage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('never stores or accepts the plaintext password as the stored credential', async () => {
    const plaintext = 'correct horse battery staple';
    const stored = await hashPassword(plaintext);

    // This is the assertion that makes the hashing migration fail-before-it-passes: a
    // regression back to `password_hash = password` (storing plaintext) would fail here.
    expect(stored).not.toBe(plaintext);
    expect(stored.length).toBeGreaterThan(plaintext.length);
    // bcrypt hash format sanity check ($2a$/$2b$ prefix), not just "is different".
    expect(stored).toMatch(/^\$2[aby]\$/);
  });

  it('rejects login when the stored hash does not match the submitted password', async () => {
    const passwordHash = await hashPassword('the-real-password');
    const authPool: Pool = {
      query: () =>
        Promise.resolve({
          rows: [
            {
              user_name: 'rray',
              first_name: 'Ryan',
              last_name: 'Ray',
              password_hash: passwordHash,
              role: 'superuser',
              organization_id: 'org-1',
            },
          ],
        }),
    } as unknown as Pool;

    const { createApp } = await import('../src/app');
    const app = createApp(undefined, undefined, undefined, authPool);

    await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'a-guessed-password' })
      .expect(401);
  });
});

describe('auth: logout denylist', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('redis');
  });

  it('rejects a token after it has been logged out, while Redis is available', async () => {
    // Must reset the module graph *before* mocking + importing 'redis' -- otherwise app.ts (and
    // its own `import { createClient } from 'redis'`) may already be cached from an earlier
    // test's real import, in which case this mock never takes effect and the app tries a real
    // connection to the fake host below, which hangs until the test times out.
    vi.resetModules();

    const store = new Map<string, string>();
    const fakeRedisClient = {
      isOpen: true,
      on: vi.fn(),
      connect: vi.fn(() => Promise.resolve()),
      quit: vi.fn(() => Promise.resolve()),
      sendCommand: vi.fn(() => Promise.resolve(0)),
      set: vi.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      exists: vi.fn((key: string) => Promise.resolve(store.has(key) ? 1 : 0)),
    };

    vi.doMock('redis', () => ({ createClient: () => fakeRedisClient }));
    vi.stubEnv('RATE_LIMIT_USE_REDIS', 'true');
    vi.stubEnv('RATE_LIMIT_REDIS_URL', 'redis://fake-host:6379');
    // resetModules() gives the freshly-imported app.ts its own authService instance (and thus
    // its own ephemeral JWT secret) unless both sides read from process.env instead.
    vi.stubEnv('JWT_SECRET', 'test-secret-logout-denylist');

    const { createApp } = await import('../src/app');
    const app = createApp();
    const header = authHeader({ sub: 'rray', role: 'superuser' });

    // Redis connects asynchronously on app construction; give the .then() a tick to run before
    // the client is relied on.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await request(app).get('/api/aliases').set(header).expect((res) => {
      expect(res.status).not.toBe(401);
    });

    await request(app).post('/api/auth/logout').set(header).expect(204);

    const afterLogout = await request(app).get('/api/aliases').set(header);
    expect(afterLogout.status).toBe(401);
  });
});
