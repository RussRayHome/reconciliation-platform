import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * ZAP finding #161: `cors()` with no options reflects `*` for every request. Confirms the fix
 * (resolveCorsAllowedOrigins in app.ts) actually scopes it -- a known dev origin gets reflected
 * back, an arbitrary third-party origin does not, and CORS_ALLOWED_ORIGINS overrides the default.
 */
describe('CORS', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reflects the default local dev origin', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not reflect an arbitrary third-party origin', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('honors CORS_ALLOWED_ORIGINS when set', async () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'https://recon.example.com, https://recon-stage.example.com');
    const { createApp } = await import('../src/app');
    const app = createApp();

    const allowed = await request(app)
      .get('/api/health')
      .set('Origin', 'https://recon-stage.example.com')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://recon-stage.example.com');

    const notAllowed = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(notAllowed.headers['access-control-allow-origin']).toBeUndefined();
  });
});
