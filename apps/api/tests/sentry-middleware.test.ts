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

  it('captures unhandled request errors through the sentry wrapper', async () => {
    const authPool = {
      query: vi.fn(() => Promise.reject(new Error('database unavailable'))),
    };

    const { createApp } = await import('../src/app');
    const app = createApp(undefined, undefined, undefined, authPool as never);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'rray', password: 'rray' })
      .expect(500);

    expect((response.body as { message: string }).message).toBe('database unavailable');
    expect(sentryIntegrationState.captureApiException).toHaveBeenCalledTimes(1);

    const [capturedError, context] = sentryIntegrationState.captureApiException.mock.calls[0] as [
      Error,
      {
        tags: { scope: string; statusCode: string };
        extra: { method: string; path: string; correlationId: string };
      },
    ];

    expect(capturedError.message).toBe('database unavailable');
    expect(context.tags.scope).toBe('http-request');
    expect(context.tags.statusCode).toBe('500');
    expect(context.extra.method).toBe('POST');
    expect(context.extra.path).toBe('/api/auth/login');
    expect(context.extra.correlationId.length).toBeGreaterThan(0);
  });

  it('flushes sentry via app closeResources', async () => {
    const { createApp } = await import('../src/app');
    const app = createApp();

    await expect(app.locals.closeResources()).resolves.toBeUndefined();
    expect(sentryIntegrationState.initializeApiSentry).toHaveBeenCalledTimes(1);
    expect(sentryIntegrationState.flushApiSentry).toHaveBeenCalledTimes(1);
  });
});
