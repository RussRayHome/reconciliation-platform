import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { PersistedClient, Persister } from '@tanstack/query-persist-client-core';

import App from './App';
import React from 'react';
import ReactDOM from 'react-dom/client';

const env = import.meta.env as Record<string, unknown>;
const readEnvString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const parseSampleRate = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 0), 1);
};

const createLocalStoragePersister = (storageKey: string): Persister => ({
  persistClient: (client: PersistedClient): void => {
    try {
      globalThis.window.localStorage.setItem(storageKey, JSON.stringify(client));
    } catch {
      // Ignore persistence write errors so runtime behavior stays unaffected.
    }
  },
  restoreClient: (): PersistedClient | undefined => {
    try {
      const cached = globalThis.window.localStorage.getItem(storageKey);
      if (!cached) {
        return undefined;
      }

      return JSON.parse(cached) as PersistedClient;
    } catch {
      return undefined;
    }
  },
  removeClient: (): void => {
    try {
      globalThis.window.localStorage.removeItem(storageKey);
    } catch {
      // Ignore persistence remove errors so runtime behavior stays unaffected.
    }
  },
});

const sentryDsn = readEnvString(env.VITE_SENTRY_DSN)?.trim();
const sentryEnabledFlag = readEnvString(env.VITE_ENABLE_SENTRY);
const sentryEnabled =
  sentryEnabledFlag === 'true' ||
  (sentryEnabledFlag !== 'false' && typeof sentryDsn === 'string' && sentryDsn.length > 0);

if (sentryEnabled && sentryDsn && !Sentry.getClient()) {
  Sentry.init({
    dsn: sentryDsn,
    environment:
      readEnvString(env.VITE_SENTRY_ENVIRONMENT) ?? readEnvString(env.MODE) ?? 'development',
    release: readEnvString(env.VITE_SENTRY_RELEASE),
    tracesSampleRate: parseSampleRate(readEnvString(env.VITE_SENTRY_TRACES_SAMPLE_RATE), 0),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
  });
}

const queryClient = new QueryClient();
const queryPersistenceEnabled = readEnvString(env.VITE_ENABLE_QUERY_PERSISTENCE) !== 'false';
const queryPersister =
  queryPersistenceEnabled && globalThis.window !== undefined
    ? createLocalStoragePersister('reconciliation-platform:react-query-cache')
    : undefined;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {queryPersister ? (
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: 1000 * 60 * 60 * 12,
        }}
      >
        <App />
      </PersistQueryClientProvider>
    ) : (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )}
  </React.StrictMode>,
);
