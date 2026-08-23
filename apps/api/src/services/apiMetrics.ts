import type { NextFunction, Request, Response } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

type ApiMetricsRenderer = {
  contentType: string;
  body: string;
};

/** Read-only depth source a queue producer exposes -- see reconciliationQueue.ts's
 * `getJobCounts`/`getDeadLetterCount` doc comments for why this is read from the producer (the
 * `api` process) rather than the consumer (`worker`, which has no HTTP server to scrape at all). */
type QueueDepthSource = {
  getJobCounts: () => Promise<{ waiting: number; active: number; delayed: number }>;
  getDeadLetterCount: () => Promise<number>;
};

type ApiMetricsService = {
  middleware: (request: Request, response: Response, next: NextFunction) => void;
  render: () => Promise<ApiMetricsRenderer>;
  /** Registers a queue whose depth should be reported under `recon_api_queue_depth`, labeled by
   * `queue_name`. Counts are pulled lazily (Redis round-trips only happen on an actual Prometheus
   * scrape, via the Gauge's own `collect` callback below) rather than polled on a timer. */
  registerQueueDepthSource: (queueName: string, source: QueueDepthSource) => void;
};

const normalizeRoute = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '/unknown';
  }

  if (trimmed === '/') {
    return '/';
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const resolveRouteLabel = (request: Request): string => {
  const routePath = request.route?.path;

  if (typeof routePath === 'string') {
    return normalizeRoute(routePath);
  }

  if (Array.isArray(routePath)) {
    const firstPath = routePath.find((entry): entry is string => typeof entry === 'string');
    if (firstPath) {
      return normalizeRoute(firstPath);
    }
  }

  const basePath = typeof request.baseUrl === 'string' ? request.baseUrl : '';
  if (basePath) {
    return normalizeRoute(basePath);
  }

  // Deliberately NOT request.path here. This app sits behind ADR-0002's deny-by-default auth
  // middleware, reachable from the open internet -- every request to a nonexistent route (a
  // scanner, an attacker, a stale bookmark, a typo) reaches this middleware with no matched
  // request.route and no baseUrl, and the raw path is entirely attacker-controlled. Labeling by
  // it would let anyone inflate this metric's cardinality without bound just by requesting
  // different bogus URLs -- confirmed live: a pre-#162 ZAP scan against four long-removed
  // /api/developer/* routes left five permanent, never-again-incrementing Prometheus series
  // behind, each its own distinct "route" label value. A single fixed sentinel bounds this metric
  // to real registered routes plus one catch-all bucket, regardless of what garbage traffic the
  // API receives.
  return '/unmatched';
};

export const createApiMetrics = (): ApiMetricsService => {
  const registry = new Registry();
  collectDefaultMetrics({
    register: registry,
    prefix: 'recon_api_',
  });

  const requestCount = new Counter({
    name: 'recon_api_http_requests_total',
    help: 'Total number of HTTP requests handled by the API.',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [registry],
  });

  const requestErrors = new Counter({
    name: 'recon_api_http_request_errors_total',
    help: 'Total number of API HTTP requests that returned a 5xx status code.',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [registry],
  });

  const requestDuration = new Histogram({
    name: 'recon_api_http_request_duration_seconds',
    help: 'Latency histogram for API HTTP requests.',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const queueDepthSources = new Map<string, QueueDepthSource>();

  new Gauge({
    name: 'recon_api_queue_depth',
    help: 'BullMQ job counts by queue and state (waiting, active, delayed, dead_letter).',
    labelNames: ['queue_name', 'state'] as const,
    registers: [registry],
    // Pulled lazily, once per actual Prometheus scrape -- not polled on a timer, so an idle
    // /api/metrics endpoint never generates Redis traffic for queues nobody is watching.
    async collect() {
      for (const [queueName, source] of queueDepthSources) {
        const [counts, deadLetterCount] = await Promise.all([
          source.getJobCounts(),
          source.getDeadLetterCount(),
        ]);

        this.set({ queue_name: queueName, state: 'waiting' }, counts.waiting);
        this.set({ queue_name: queueName, state: 'active' }, counts.active);
        this.set({ queue_name: queueName, state: 'delayed' }, counts.delayed);
        this.set({ queue_name: queueName, state: 'dead_letter' }, deadLetterCount);
      }
    },
  });

  return {
    middleware: (request, response, next) => {
      const startedAt = process.hrtime.bigint();

      response.on('finish', () => {
        const finishedAt = process.hrtime.bigint();
        const durationSeconds = Number(finishedAt - startedAt) / 1_000_000_000;
        const method = request.method.toUpperCase();
        const route = resolveRouteLabel(request);
        const statusCode = String(response.statusCode);

        requestCount.inc({ method, route, status_code: statusCode });
        requestDuration.observe({ method, route, status_code: statusCode }, durationSeconds);

        if (response.statusCode >= 500) {
          requestErrors.inc({ method, route, status_code: statusCode });
        }
      });

      next();
    },
    render: async () => ({
      contentType: registry.contentType,
      body: await registry.metrics(),
    }),
    registerQueueDepthSource: (queueName, source) => {
      queueDepthSources.set(queueName, source);
    },
  };
};
