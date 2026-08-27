import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';

import { createApp } from '../src/app';

const appWithPool = (pool?: Pool) => createApp(undefined, undefined, undefined, pool);

describe('GET /api/health/ready (error-handling-build-plan.md EH8)', () => {
  it('is reachable without a bearer token, same as /api/health', async () => {
    const response = await request(appWithPool(undefined)).get('/api/health/ready');

    expect(response.status).not.toBe(401);
  });

  it('reports ok when no database is configured -- mode (a) is a supported operating mode, not a down dependency', async () => {
    const response = await request(appWithPool(undefined)).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', checks: { database: 'not_configured' } });
  });

  it('reports ok when the database is configured and reachable', async () => {
    const pool = { query: () => Promise.resolve({ rows: [] }) } as unknown as Pool;

    const response = await request(appWithPool(pool)).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('reports 503 when the database is configured but unreachable', async () => {
    const pool = {
      query: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
    } as unknown as Pool;

    const response = await request(appWithPool(pool)).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'error', checks: { database: 'unreachable' } });
  });
});
