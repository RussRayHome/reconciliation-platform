import { beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

interface AliasRow {
  id: string;
  account_identifier: string | null;
  bank_pattern: string;
  canonical_payee_name: string;
  normalized_tokens: string[];
  source_direction: string;
  match_confidence: number;
  is_active: boolean;
}

const aliasColumns = [
  'bank_pattern',
  'canonical_payee_name',
  'normalized_tokens',
  'source_direction',
  'match_confidence',
] as const;

/**
 * Stateful fake backing `reconciliation_payee_alias`. The alias helpers in
 * `@recon/persistence` build their UPDATE statement dynamically from whichever fields were
 * supplied, so this matches on SQL text and reads the SET clause rather than assuming a fixed
 * parameter order. Holding real state lets a single test drive create -> list -> update -> delete
 * end to end, which is where alias regressions actually surface.
 */
const createFakeAliasPool = (seed: AliasRow[] = []) => {
  const rows: AliasRow[] = seed.map((row) => ({ ...row }));
  let nextId = seed.length + 1;

  const query = (
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: AliasRow[]; rowCount: number }> => {
    if (text.includes('SELECT') && text.includes('FROM reconciliation_payee_alias')) {
      const accountIdentifier = params[0] as string | null;
      const visible = rows.filter(
        (row) =>
          row.is_active &&
          (row.account_identifier === null || row.account_identifier === accountIdentifier),
      );
      return Promise.resolve({ rows: visible, rowCount: visible.length });
    }

    if (text.includes('INSERT INTO reconciliation_payee_alias')) {
      const [
        accountIdentifier,
        bankPattern,
        canonicalPayeeName,
        normalizedTokens,
        sourceDirection,
        matchConfidence,
      ] = params as [string | null, string, string, string[], string, number];
      const created: AliasRow = {
        id: `alias-${nextId++}`,
        account_identifier: accountIdentifier,
        bank_pattern: bankPattern,
        canonical_payee_name: canonicalPayeeName,
        normalized_tokens: normalizedTokens,
        source_direction: sourceDirection,
        match_confidence: matchConfidence,
        is_active: true,
      };
      rows.push(created);
      return Promise.resolve({ rows: [created], rowCount: 1 });
    }

    if (text.includes('SET is_active = FALSE')) {
      const target = rows.find((row) => row.id === params[0] && row.is_active);
      if (!target) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      target.is_active = false;
      return Promise.resolve({ rows: [target], rowCount: 1 });
    }

    if (text.includes('UPDATE reconciliation_payee_alias')) {
      // Params are [...set values, id]; the id is always bound last.
      const id = params[params.length - 1] as string;
      const target = rows.find((row) => row.id === id);
      if (!target) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }

      const assigned = aliasColumns.filter((column) => text.includes(`${column} = $`));
      assigned.forEach((column, index) => {
        Object.assign(target, { [column]: params[index] });
      });
      return Promise.resolve({ rows: [target], rowCount: 1 });
    }

    throw new Error(`Unexpected alias query: ${text}`);
  };

  return { query } as unknown as Pool;
};

const appWithPool = (pool: Pool) =>
  createApp(undefined, undefined, undefined, pool as Parameters<typeof createApp>[3]);

const seededAlias: AliasRow = {
  id: 'alias-1',
  account_identifier: null,
  bank_pattern: 'SQ *COFFEE',
  canonical_payee_name: 'Square Coffee',
  normalized_tokens: ['square', 'coffee'],
  source_direction: 'bank_to_gl',
  match_confidence: 1,
  is_active: true,
};

describe('alias endpoints', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createFakeAliasPool([seededAlias]);
  });

  describe('GET /api/aliases', () => {
    it('returns an empty array when no aliases exist', async () => {
      const response = await authedApp(appWithPool(createFakeAliasPool())).get('/api/aliases');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('maps stored rows onto the camelCase API shape', async () => {
      const response = await authedApp(appWithPool(pool)).get('/api/aliases');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        {
          id: 'alias-1',
          bankPattern: 'SQ *COFFEE',
          canonicalPayeeName: 'Square Coffee',
          normalizedTokens: ['square', 'coffee'],
          sourceDirection: 'bank_to_gl',
          matchConfidence: 1,
          isActive: true,
        },
      ]);
    });

    it('includes global aliases alongside ones scoped to the requested account', async () => {
      const scopedPool = createFakeAliasPool([
        seededAlias,
        { ...seededAlias, id: 'alias-2', account_identifier: 'ACCT-1' },
        { ...seededAlias, id: 'alias-3', account_identifier: 'ACCT-2' },
      ]);

      const response = await authedApp(appWithPool(scopedPool)).get(
        '/api/aliases?accountIdentifier=ACCT-1',
      );

      expect(response.status).toBe(200);
      expect((response.body as Array<{ id: string }>).map((alias) => alias.id)).toEqual([
        'alias-1',
        'alias-2',
      ]);
    });

    it('omits aliases that have been soft-deleted', async () => {
      const inactivePool = createFakeAliasPool([{ ...seededAlias, is_active: false }]);

      const response = await authedApp(appWithPool(inactivePool)).get('/api/aliases');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('POST /api/aliases', () => {
    it('creates an alias and returns 201 with the persisted record', async () => {
      const response = await authedApp(appWithPool(pool))
        .post('/api/aliases')
        .send({
          bankPattern: 'AMZN MKTP',
          canonicalPayeeName: 'Amazon',
          normalizedTokens: ['amazon'],
          accountIdentifier: 'ACCT-1',
          sourceDirection: 'bidirectional',
          matchConfidence: 0.8,
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: 'alias-2',
        accountIdentifier: 'ACCT-1',
        bankPattern: 'AMZN MKTP',
        canonicalPayeeName: 'Amazon',
        normalizedTokens: ['amazon'],
        sourceDirection: 'bidirectional',
        matchConfidence: 0.8,
        isActive: true,
      });
    });

    it('applies defaults for the optional fields', async () => {
      const response = await authedApp(appWithPool(pool))
        .post('/api/aliases')
        .send({ bankPattern: 'AMZN MKTP', canonicalPayeeName: 'Amazon' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        normalizedTokens: [],
        sourceDirection: 'bank_to_gl',
        matchConfidence: 1,
      });
    });

    it('rejects a body with no bankPattern', async () => {
      const response = await authedApp(appWithPool(pool))
        .post('/api/aliases')
        .send({ canonicalPayeeName: 'Amazon' });

      expect(response.status).toBe(400);
      expect((response.body as { message: string }).message).toContain('bankPattern is required.');
    });

    it('rejects a body with no canonicalPayeeName', async () => {
      const response = await authedApp(appWithPool(pool))
        .post('/api/aliases')
        .send({ bankPattern: 'AMZN MKTP' });

      expect(response.status).toBe(400);
      expect((response.body as { message: string }).message).toContain(
        'canonicalPayeeName is required.',
      );
    });

    it('rejects an empty body', async () => {
      const response = await authedApp(appWithPool(pool)).post('/api/aliases').send({});

      expect(response.status).toBe(400);
    });

    // `sourceDirection` and `matchConfidence` use zod `.catch()`, so a bad value silently falls
    // back to the default instead of returning 400. Pinning that here so the coercion is a
    // deliberate contract rather than an accident nobody notices until a client sends garbage.
    it('coerces an out-of-range matchConfidence to the default rather than rejecting it', async () => {
      const response = await authedApp(appWithPool(pool)).post('/api/aliases').send({
        bankPattern: 'AMZN MKTP',
        canonicalPayeeName: 'Amazon',
        matchConfidence: 42,
      });

      expect(response.status).toBe(201);
      expect((response.body as { matchConfidence: number }).matchConfidence).toBe(1);
    });

    it('coerces an unknown sourceDirection to bank_to_gl rather than rejecting it', async () => {
      const response = await authedApp(appWithPool(pool)).post('/api/aliases').send({
        bankPattern: 'AMZN MKTP',
        canonicalPayeeName: 'Amazon',
        sourceDirection: 'sideways',
      });

      expect(response.status).toBe(201);
      expect((response.body as { sourceDirection: string }).sourceDirection).toBe('bank_to_gl');
    });

    it('drops non-string entries from normalizedTokens', async () => {
      const response = await authedApp(appWithPool(pool))
        .post('/api/aliases')
        .send({
          bankPattern: 'AMZN MKTP',
          canonicalPayeeName: 'Amazon',
          normalizedTokens: ['amazon', 7, null, 'mktp'],
        });

      expect(response.status).toBe(201);
      expect((response.body as { normalizedTokens: string[] }).normalizedTokens).toEqual([
        'amazon',
        'mktp',
      ]);
    });
  });

  describe('PUT /api/aliases/:id', () => {
    it('updates only the supplied fields and returns the new record', async () => {
      const response = await authedApp(appWithPool(pool))
        .put('/api/aliases/alias-1')
        .send({ canonicalPayeeName: 'Square Coffee Co.' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: 'alias-1',
        canonicalPayeeName: 'Square Coffee Co.',
        bankPattern: 'SQ *COFFEE',
      });
    });

    it('returns 404 for an unknown alias id', async () => {
      const response = await authedApp(appWithPool(pool))
        .put('/api/aliases/does-not-exist')
        .send({ canonicalPayeeName: 'Square Coffee Co.' });

      expect(response.status).toBe(404);
      expect((response.body as { message: string }).message).toBe('Alias not found.');
    });

    // updatePayeeAlias returns undefined when there is nothing to SET, and the route cannot tell
    // that apart from a missing row — so an empty body 404s on an alias that plainly exists.
    // Documenting the current behavior; the message is misleading and worth revisiting.
    it('returns 404 for an empty update body even though the alias exists', async () => {
      const response = await authedApp(appWithPool(pool)).put('/api/aliases/alias-1').send({});

      expect(response.status).toBe(404);
    });

    it('persists the update so a subsequent read reflects it', async () => {
      const app = appWithPool(pool);

      await authedApp(app).put('/api/aliases/alias-1').send({ bankPattern: 'SQ *COFFEE SHOP' });
      const response = await authedApp(app).get('/api/aliases');

      expect(response.body).toEqual([
        expect.objectContaining({ id: 'alias-1', bankPattern: 'SQ *COFFEE SHOP' }),
      ]);
    });
  });

  describe('DELETE /api/aliases/:id', () => {
    it('soft-deletes the alias and returns 204 with no body', async () => {
      const response = await authedApp(appWithPool(pool)).delete('/api/aliases/alias-1');

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
    });

    it('returns 404 for an unknown alias id', async () => {
      const response = await authedApp(appWithPool(pool)).delete('/api/aliases/does-not-exist');

      expect(response.status).toBe(404);
      expect((response.body as { message: string }).message).toBe('Alias not found.');
    });

    it('removes the alias from subsequent reads', async () => {
      const app = appWithPool(pool);

      await authedApp(app).delete('/api/aliases/alias-1');
      const response = await authedApp(app).get('/api/aliases');

      expect(response.body).toEqual([]);
    });

    it('returns 404 when the same alias is deleted twice', async () => {
      const app = appWithPool(pool);

      await authedApp(app).delete('/api/aliases/alias-1');
      const response = await authedApp(app).delete('/api/aliases/alias-1');

      expect(response.status).toBe(404);
    });
  });

  describe('without a database pool', () => {
    it.each([
      ['get', '/api/aliases'],
      ['post', '/api/aliases'],
      ['put', '/api/aliases/alias-1'],
      ['delete', '/api/aliases/alias-1'],
    ] as const)('%s %s returns 501', async (method, route) => {
      const app = createApp();

      const response = await authedApp(app)[method](route).send({});

      expect(response.status).toBe(501);
      expect((response.body as { message: string }).message).toBe(
        'Alias management requires a database connection.',
      );
    });
  });
});
