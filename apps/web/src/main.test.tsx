// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act } from 'react';

const sentryState = vi.hoisted(() => ({
  init: vi.fn(),
  getClient: vi.fn(() => null),
}));

const providerState = vi.hoisted(() => ({
  queryProviderCalls: 0,
  persistProviderCalls: 0,
}));

vi.mock('@sentry/react', () => ({
  init: sentryState.init,
  getClient: sentryState.getClient,
}));

vi.mock('@tanstack/react-query', async () => {
  const React = await import('react');

  class QueryClient {}

  const QueryClientProvider = ({ children }: { children: React.ReactNode }) => {
    providerState.queryProviderCalls += 1;
    return React.createElement('div', { 'data-provider': 'query' }, children);
  };

  return {
    QueryClient,
    QueryClientProvider,
  };
});

vi.mock('@tanstack/react-query-persist-client', async () => {
  const React = await import('react');

  const PersistQueryClientProvider = ({ children }: { children: React.ReactNode }) => {
    providerState.persistProviderCalls += 1;
    return React.createElement('div', { 'data-provider': 'persist' }, children);
  };

  return {
    PersistQueryClientProvider,
  };
});

vi.mock('./App', () => ({
  default: () => null,
}));

describe('web bootstrap main entrypoint', () => {
  const importMain = async (): Promise<void> => {
    await act(async () => {
      await import('./main');
    });
  };

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();

    document.body.innerHTML = '<div id="root"></div>';
    providerState.queryProviderCalls = 0;
    providerState.persistProviderCalls = 0;

    sentryState.init.mockReset();
    sentryState.getClient.mockReset();
    sentryState.getClient.mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('initializes sentry when enabled and a DSN is configured', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://example@sentry.io/123');
    vi.stubEnv('VITE_ENABLE_SENTRY', 'true');

    await importMain();

    expect(sentryState.init).toHaveBeenCalledTimes(1);
  });

  it('skips sentry initialization when explicitly disabled', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://example@sentry.io/123');
    vi.stubEnv('VITE_ENABLE_SENTRY', 'false');

    await importMain();

    expect(sentryState.init).not.toHaveBeenCalled();
  });

  it('uses persisted query provider by default', async () => {
    await importMain();

    expect(providerState.persistProviderCalls).toBeGreaterThan(0);
    expect(providerState.queryProviderCalls).toBe(0);
  });

  it('falls back to standard query provider when persistence is disabled', async () => {
    vi.stubEnv('VITE_ENABLE_QUERY_PERSISTENCE', 'false');

    await importMain();

    expect(providerState.persistProviderCalls).toBe(0);
    expect(providerState.queryProviderCalls).toBeGreaterThan(0);
  });
});
