import * as Sentry from '@sentry/node';
import type pino from 'pino';

type CaptureExceptionContext = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

let sentryEnabled = false;
let sentryInitialized = false;

const parseSampleRate = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 0), 1);
};

const resolveSentryEnabled = (): boolean => {
  const enabledFlag = process.env.ENABLE_SENTRY;
  if (enabledFlag === 'true') {
    return true;
  }

  if (enabledFlag === 'false') {
    return false;
  }

  return Boolean(process.env.SENTRY_DSN?.trim());
};

export const initializeApiSentry = (logger?: pino.Logger): void => {
  if (sentryInitialized) {
    return;
  }

  sentryInitialized = true;
  const dsn = process.env.SENTRY_DSN?.trim();
  sentryEnabled = resolveSentryEnabled() && Boolean(dsn);

  if (!sentryEnabled || !dsn) {
    logger?.info({ action: 'api.sentry.disabled' }, 'Sentry is disabled for API runtime');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0),
    profilesSampleRate: parseSampleRate(process.env.SENTRY_PROFILES_SAMPLE_RATE, 0),
    sendDefaultPii: false,
  });

  logger?.info({ action: 'api.sentry.initialized' }, 'Sentry initialized for API runtime');
};

export const captureApiException = (
  error: unknown,
  context: CaptureExceptionContext = {},
): void => {
  if (!sentryEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context.tags ?? {})) {
      scope.setTag(key, value);
    }

    for (const [key, value] of Object.entries(context.extra ?? {})) {
      scope.setExtra(key, value);
    }

    if (error instanceof Error) {
      Sentry.captureException(error);
      return;
    }

    Sentry.captureException(new Error('Non-Error exception captured by API Sentry integration'));
  });
};

export const flushApiSentry = async (timeoutMs = 2000): Promise<void> => {
  if (!sentryEnabled) {
    return;
  }

  await Sentry.flush(timeoutMs).catch(() => undefined);
};
