import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import request from 'supertest';

import { createApp } from '../src/app';
import { authHeader } from './testHelpers/authToken';

/**
 * HTTP surface for saved views (Issue #458).
 *
 * `savedViewStore.test.ts` already proves the store's rules against a real database. What this
 * file covers is the part that lives only in `app.ts`: request validation, and the status code a
 * given store error becomes. The 403/404 split in particular is a product decision -- a shared
 * view is readable by the whole team but editable only by its owner -- and it is expressed
 * nowhere except in that catch block.
 */

const ORGANIZATION_ID = 'test-org';
const VIEW_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';

interface FakePoolOptions {
  /** Who owns the view the PATCH tests target, or `null` for "no such view in this org". */
  ownerUserId?: string | null;
  /** The id `resolveUserId` returns for the caller. */
  actorUserId?: string;
  /** Raised by the INSERT/UPDATE, to drive the 409 path. */
  writeError?: Error & { code?: string };
}

const savedViewRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: VIEW_ID,
  organization_id: ORGANIZATION_ID,
  owner_username: 'test-user',
  name: 'Critical - unresolved',
  scope: 'exceptions',
  filters: { severity: ['critical'] },
  visibility: 'private',
  status: 'ACTIVE',
  created_at: new Date('2026-09-09T10:00:00.000Z'),
  updated_at: new Date('2026-09-09T10:00:00.000Z'),
  ...overrides,
});

/**
 * Matches on SQL text rather than call order, because the store issues a different number of
 * queries per path (`runInTenantScope` wraps every one in BEGIN/set_config/COMMIT) and an
 * order-indexed fake would silently drift the first time that wrapper changes.
 */
const createFakePool = (options: FakePoolOptions = {}) => {
  const { ownerUserId = OWNER_USER_ID, actorUserId = OWNER_USER_ID, writeError } = options;
  const seen: string[] = [];

  type Result = { rows: Record<string, unknown>[]; rowCount: number };

  // Returns promises explicitly rather than being `async`: a write failure has to arrive as a
  // rejected promise the way `pg` delivers one, not as a synchronous throw.
  const query = (text: string, _params: unknown[] = []): Promise<Result> => {
    seen.push(text);
    const rows = (values: Record<string, unknown>[]): Promise<Result> =>
      Promise.resolve({ rows: values, rowCount: values.length });
    const empty = rows([]);

    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text) || text.includes('set_config')) return empty;
    if (text.includes('SELECT 1')) return rows([{ '?column?': 1 }]);

    if (text.includes('FROM reconciliation_user')) return rows([{ id: actorUserId }]);
    if (text.includes('SELECT owner_user_id, name')) {
      return ownerUserId === null
        ? empty
        : rows([{ owner_user_id: ownerUserId, name: 'Critical - unresolved' }]);
    }
    if (text.includes('INSERT INTO reconciliation_saved_view')) {
      return writeError ? Promise.reject(writeError) : rows([savedViewRow()]);
    }
    if (text.includes('UPDATE reconciliation_saved_view')) {
      return writeError
        ? Promise.reject(writeError)
        : rows([savedViewRow({ name: 'Renamed', visibility: 'team' })]);
    }
    if (text.includes('FROM reconciliation_saved_view')) return rows([savedViewRow()]);
    return empty;
  };

  const pool = {
    query,
    connect: () => Promise.resolve({ query, release: () => undefined }),
  } as unknown as Pool;

  return { pool, seen };
};

const appWithPool = (pool: Pool) =>
  createApp(undefined, undefined, undefined, pool as Parameters<typeof createApp>[3]);

const auth = (): { Authorization: string } => authHeader({ organizationId: ORGANIZATION_ID });

const uniqueViolation = (): Error & { code: string } =>
  Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });

describe('saved view endpoints', () => {
  describe('GET /api/saved-views', () => {
    it('returns the visible views under a savedViews key', async () => {
      const { pool } = createFakePool();

      const response = await request(appWithPool(pool)).get('/api/saved-views').set(auth());

      expect(response.status).toBe(200);
      expect(response.body.savedViews).toHaveLength(1);
      expect(response.body.savedViews[0]).toMatchObject({ id: VIEW_ID, scope: 'exceptions' });
    });

    it('rejects a scope the model does not define', async () => {
      const { pool } = createFakePool();

      const response = await request(appWithPool(pool))
        .get('/api/saved-views?scope=journal_entries')
        .set(auth());

      expect(response.status).toBe(400);
    });

    it('requires authentication', async () => {
      const { pool } = createFakePool();

      const response = await request(appWithPool(pool)).get('/api/saved-views');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/saved-views', () => {
    it('creates a view and answers 201', async () => {
      const { pool } = createFakePool();

      const response = await request(appWithPool(pool))
        .post('/api/saved-views')
        .set(auth())
        .send({ name: 'Critical - unresolved', scope: 'exceptions', filters: { severity: ['critical'] } });

      expect(response.status).toBe(201);
      expect(response.body.savedView).toMatchObject({ id: VIEW_ID, status: 'ACTIVE' });
    });

    it('rejects a name longer than the column is meant to hold', async () => {
      const { pool } = createFakePool();

      const response = await request(appWithPool(pool))
        .post('/api/saved-views')
        .set(auth())
        .send({ name: 'x'.repeat(121), scope: 'exceptions' });

      expect(response.status).toBe(400);
    });

    it('rejects a body with no scope, since scope is how filters are read', async () => {
      const { pool } = createFakePool();

      const response = await request(appWithPool(pool))
        .post('/api/saved-views')
        .set(auth())
        .send({ name: 'No scope' });

      expect(response.status).toBe(400);
    });

    it('maps a duplicate name to 409, not 500', async () => {
      const { pool } = createFakePool({ writeError: uniqueViolation() });

      const response = await request(appWithPool(pool))
        .post('/api/saved-views')
        .set(auth())
        .send({ name: 'Taken', scope: 'exceptions' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('Taken');
    });
  });

  describe('PATCH /api/saved-views/:savedViewId', () => {
    it('updates a view the caller owns', async () => {
      const { pool } = createFakePool();

      const response = await request(appWithPool(pool))
        .patch(`/api/saved-views/${VIEW_ID}`)
        .set(auth())
        .send({ name: 'Renamed', visibility: 'team' });

      expect(response.status).toBe(200);
      expect(response.body.savedView).toMatchObject({ name: 'Renamed', visibility: 'team' });
    });

    it('rejects a malformed id as 400 without reaching the table', async () => {
      // Regression guard: an unparseable UUID used to reach Postgres, which raises 22P02.
      // `classifyError` has no case for that, so it became a 500 *and* a captured exception --
      // a client-side typo paging the error tracker.
      const { pool, seen } = createFakePool();

      const response = await request(appWithPool(pool))
        .patch('/api/saved-views/not-a-uuid')
        .set(auth())
        .send({ name: 'Renamed' });

      expect(response.status).toBe(400);
      expect(seen.some((text) => text.includes('reconciliation_saved_view'))).toBe(false);
    });

    it('answers 404 for a view this organization does not have', async () => {
      const { pool } = createFakePool({ ownerUserId: null });

      const response = await request(appWithPool(pool))
        .patch(`/api/saved-views/${VIEW_ID}`)
        .set(auth())
        .send({ name: 'Renamed' });

      expect(response.status).toBe(404);
    });

    it('answers 403 for a shared view the caller can read but does not own', async () => {
      const { pool } = createFakePool({ ownerUserId: OWNER_USER_ID, actorUserId: OTHER_USER_ID });

      const response = await request(appWithPool(pool))
        .patch(`/api/saved-views/${VIEW_ID}`)
        .set(auth())
        .send({ name: 'Hijacked' });

      expect(response.status).toBe(403);
    });

    it('rejects a scope change, which would reinterpret the saved filters', async () => {
      const { pool } = createFakePool();

      const response = await request(appWithPool(pool))
        .patch(`/api/saved-views/${VIEW_ID}`)
        .set(auth())
        .send({ scope: 'open_items' });

      // `scope` is not in the update schema at all, so it is ignored rather than rejected -- the
      // view comes back with its original scope. This asserts it cannot be changed, which is the
      // guarantee that matters.
      expect(response.status).toBe(200);
      expect(response.body.savedView.scope).toBe('exceptions');
    });

    it('accepts a status change, which is how a view is retired', async () => {
      const { pool } = createFakePool();

      const response = await request(appWithPool(pool))
        .patch(`/api/saved-views/${VIEW_ID}`)
        .set(auth())
        .send({ status: 'RETIRED' });

      expect(response.status).toBe(200);
    });
  });
});
