import type { ReconciliationFrequency } from '@recon/domain';

type RuntimeFailedRequest = {
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  correlationId: string;
};

type RuntimeException = {
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  correlationId: string;
  errorName: string;
  message: string;
  stackPreview?: string[];
};

type RuntimeReconciliationRun = {
  timestamp: string;
  status: 'Succeeded' | 'Failed';
  correlationId: string;
  runId?: string;
  accountIdentifier?: string;
  reconciliationFrequency?: ReconciliationFrequency;
  periodLabel?: string;
  durationMs: number;
  exceptionCount?: number;
  failureReason?: string;
};

const MAX_FAILED_REQUESTS = 200;
const MAX_EXCEPTIONS = 200;
const MAX_RECONCILIATION_RUNS = 100;
const RECENT_WINDOW_MS = 10 * 60 * 1000;

const failedRequests: RuntimeFailedRequest[] = [];
const exceptions: RuntimeException[] = [];
const reconciliationRuns: RuntimeReconciliationRun[] = [];
let lastRequestAt: string | null = null;
let startedAt = new Date().toISOString();

const pushBounded = <T>(items: T[], entry: T, maxSize: number): void => {
  items.unshift(entry);
  if (items.length > maxSize) {
    items.length = maxSize;
  }
};

const withinWindow = (timestamp: string, windowMs: number): boolean => {
  const value = new Date(timestamp).valueOf();
  return Number.isFinite(value) && Date.now() - value <= windowMs;
};

const toStackPreview = (stack?: string): string[] | undefined => {
  if (!stack) {
    return undefined;
  }

  const lines = stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  return lines.length > 0 ? lines : undefined;
};

export const noteRequestSeen = (): void => {
  lastRequestAt = new Date().toISOString();
};

export const markServerStarted = (timestamp = new Date().toISOString()): void => {
  startedAt = timestamp;
};

export const recordFailedRequest = (entry: RuntimeFailedRequest): void => {
  pushBounded(failedRequests, entry, MAX_FAILED_REQUESTS);
};

export const recordException = (
  entry: Omit<RuntimeException, 'stackPreview'> & { stack?: string },
): void => {
  pushBounded(
    exceptions,
    {
      ...entry,
      stackPreview: toStackPreview(entry.stack),
    },
    MAX_EXCEPTIONS,
  );
};

export const recordReconciliationRun = (entry: RuntimeReconciliationRun): void => {
  pushBounded(reconciliationRuns, entry, MAX_RECONCILIATION_RUNS);
};

export const getRuntimeSummary = () => {
  const recentFailedRequestCount = failedRequests.filter((item) =>
    withinWindow(item.timestamp, RECENT_WINDOW_MS),
  ).length;
  const recentExceptionCount = exceptions.filter((item) =>
    withinWindow(item.timestamp, RECENT_WINDOW_MS),
  ).length;

  return {
    apiStatus: 'reachable' as const,
    startedAt,
    uptimeMs: Date.now() - new Date(startedAt).valueOf(),
    lastRequestAt,
    recentWindowMs: RECENT_WINDOW_MS,
    failedRequestsLastWindow: recentFailedRequestCount,
    exceptionsLastWindow: recentExceptionCount,
    lastReconciliationRun: reconciliationRuns[0] ?? null,
  };
};

export const listFailedRequests = (limit = 10): RuntimeFailedRequest[] =>
  failedRequests.slice(0, Math.max(1, Math.min(limit, 100)));

export const listExceptions = (limit = 10): RuntimeException[] =>
  exceptions.slice(0, Math.max(1, Math.min(limit, 100)));

export const listReconciliationRuns = (limit = 10): RuntimeReconciliationRun[] =>
  reconciliationRuns.slice(0, Math.max(1, Math.min(limit, 50)));