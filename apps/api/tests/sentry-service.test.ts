import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentryState = vi.hoisted(() => ({
  init: vi.fn(),
  withScope: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
  setTag: vi.fn(),
  setExtra: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  init: sentryState.init,
  withScope: sentryState.withScope,
  captureException: sentryState.captureException,
  flush: sentryState.flush,
}));

describe('api sentry service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };

    sentryState.init.mockReset();
    sentryState.withScope.mockReset();
    sentryState.captureException.mockReset();
    sentryState.flush.mockReset();
    sentryState.setTag.mockReset();
    sentryState.setExtra.mockReset();

    sentryState.flush.mockResolvedValue(true);
    sentryState.withScope.mockImplementation(
      (
        callback: (scope: {
          setTag: (key: string, value: string) => void;
          setExtra: (key: string, value: unknown) => void;
        }) => void,
      ) => {
        callback({
          setTag: sentryState.setTag,
          setExtra: sentryState.setExtra,
        });
      },
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not initialize sentry when disabled by environment flag', async () => {
    process.env.ENABLE_SENTRY = 'false';
    process.env.SENTRY_DSN = 'https://example@sentry.io/123';
    const logger = { info: vi.fn() };

    const module = await import('../src/services/sentry');
    module.initializeApiSentry(logger as never);

    expect(sentryState.init).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { action: 'api.sentry.disabled' },
      'Sentry is disabled for API runtime',
    );
  });

  it('initializes sentry once and clamps configured sample rates', async () => {
    process.env.ENABLE_SENTRY = 'true';
    process.env.SENTRY_DSN = 'https://example@sentry.io/123';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '5';
    process.env.SENTRY_PROFILES_SAMPLE_RATE = '-3';

    const module = await import('../src/services/sentry');
    module.initializeApiSentry();
    module.initializeApiSentry();

    expect(sentryState.init).toHaveBeenCalledTimes(1);
    expect(sentryState.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://example@sentry.io/123',
        tracesSampleRate: 1,
        profilesSampleRate: 0,
      }),
    );
  });

  it('captures Error exceptions with tags and extra context', async () => {
    process.env.ENABLE_SENTRY = 'true';
    process.env.SENTRY_DSN = 'https://example@sentry.io/123';

    const module = await import('../src/services/sentry');
    module.initializeApiSentry();

    const error = new Error('boom');
    module.captureApiException(error, {
      tags: { scope: 'unit-test' },
      extra: { requestId: 'req-1' },
    });

    expect(sentryState.withScope).toHaveBeenCalledTimes(1);
    expect(sentryState.setTag).toHaveBeenCalledWith('scope', 'unit-test');
    expect(sentryState.setExtra).toHaveBeenCalledWith('requestId', 'req-1');
    expect(sentryState.captureException).toHaveBeenCalledWith(error);
  });

  it('wraps non-error exceptions before capture', async () => {
    process.env.ENABLE_SENTRY = 'true';
    process.env.SENTRY_DSN = 'https://example@sentry.io/123';

    const module = await import('../src/services/sentry');
    module.initializeApiSentry();
    module.captureApiException('plain-text-error');

    const [captured] = sentryState.captureException.mock.calls[0] as [Error];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toContain('Non-Error exception captured by API Sentry integration');
  });

  it('flushes only when sentry is enabled and swallows flush errors', async () => {
    process.env.ENABLE_SENTRY = 'false';
    const disabledModule = await import('../src/services/sentry');
    disabledModule.initializeApiSentry();
    await disabledModule.flushApiSentry(50);
    expect(sentryState.flush).not.toHaveBeenCalled();

    vi.resetModules();
    sentryState.flush.mockReset();
    sentryState.flush.mockRejectedValue(new Error('flush failed'));

    process.env.ENABLE_SENTRY = 'true';
    process.env.SENTRY_DSN = 'https://example@sentry.io/123';

    const enabledModule = await import('../src/services/sentry');
    enabledModule.initializeApiSentry();
    await expect(enabledModule.flushApiSentry(75)).resolves.toBeUndefined();
    expect(sentryState.flush).toHaveBeenCalledWith(75);
  });
});
