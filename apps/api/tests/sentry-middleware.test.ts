import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import request from 'supertest';

const sentryIntegrationState = vi.hoisted(() => ({
  initializeApiSentry: vi.fn(),
  captureApiException: vi.fn(),
  flushApiSentry: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../src/services/sentry', () => ({
  initializeApiSentry: sentryIntegrationState.initializeApiSentry,
  captureApiException: sentryIntegrationState.captureApiException,
  flushApiSentry: sentryIntegrationState.flushApiSentry,
}));

describe('api sentry middleware integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('captures unhandled request errors through the sentry wrapper, without leaking the raw message to the client', async () => {
    // error-handling-build-plan.md EH3: this test previously asserted the bug it now guards
    // against -- the client response used to echo this driver-internal string verbatim
    // ('database unavailable' has no error code and matches none of the classifier's specific
    // signatures, so it correctly falls to the generic RCN-INT-001 fallback). Sentry still
    // receives the real error for diagnosis; only the HTTP response is now authored.
    const authPool = {
      query: vi.fn(() => Promise.reject(new Error('database unavailable'))),
    };

    const { createApp } = await import('../src/app');
    const app = createApp(undefined, undefined, undefined, authPool as never);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'rray' })
      .expect(500);

    const body = response.body as {
      message: string;
      code: string;
      reference: string;
      retryable: boolean;
    };
    expect(body.message).not.toBe('database unavailable');
    expect(body.code).toBe('RCN-INT-001');
    expect(body.reference.length).toBeGreaterThan(0);
    expect(body.retryable).toBe(false);
    expect(sentryIntegrationState.captureApiException).toHaveBeenCalledTimes(1);

    const [capturedError, context] = sentryIntegrationState.captureApiException.mock.calls[0] as [
      Error,
      {
        tags: { scope: string; statusCode: string; errorCode: string };
        extra: { method: string; path: string; reference: string };
      },
    ];

    // Sentry still sees the real, undisclosed error -- only the client-facing response changed.
    expect(capturedError.message).toBe('database unavailable');
    expect(context.tags.scope).toBe('http-request');
    expect(context.tags.statusCode).toBe('500');
    expect(context.tags.errorCode).toBe('RCN-INT-001');
    expect(context.extra.method).toBe('POST');
    expect(context.extra.path).toBe('/api/auth/login');
    expect(context.extra.reference.length).toBeGreaterThan(0);
  });

  it('flushes sentry via app closeResources', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    await expect(app.locals.closeResources()).resolves.toBeUndefined();
    expect(sentryIntegrationState.initializeApiSentry).toHaveBeenCalledTimes(1);
    expect(sentryIntegrationState.flushApiSentry).toHaveBeenCalledTimes(1);
  });
});
