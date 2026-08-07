import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createApp } from '../src/app';
import { authedApp } from './testHelpers/authToken';

/**
 * The save route runs its GL-side and Bank-side persistence concurrently
 * (`Promise.all`), so a strict call-order mock would be flaky — this fake pool instead pattern
 * matches on SQL text, which is safe regardless of interleaving.
 */
const createFakeMappingPool = (): Pool => {
  const query = (text: string, params?: unknown[]): Promise<{ rows: unknown[] }> => {
    // requireFullyVerified (authMiddleware.ts) and /api/auth/me both read verification status
    // live from the DB before this route's own logic ever runs -- answered as fully verified so
    // these tests exercise mapping-creation behavior, not the verification gate itself (which has
    // its own dedicated tests).
    if (text.includes('identity_verification_status') && text.includes('entity_verification_status')) {
      return Promise.resolve({
        rows: [{ identity_verification_status: 'verified', entity_verification_status: 'verified' }],
      });
    }
    if (text.includes('SELECT id FROM reconciliation_organization')) {
      return Promise.resolve({ rows: [{ id: 'org-1' }] });
    }
    if (
      text.includes('FROM reconciliation_mapping_profile') &&
      text.includes('WHERE organization_id')
    ) {
      return Promise.resolve({ rows: [] });
    }
    if (text.includes('INSERT INTO reconciliation_mapping_profile ')) {
      const [id, organizationId, name, sourceType] = params as string[];
      return Promise.resolve({
        rows: [
          {
            id,
            organization_id: organizationId,
            name,
            source_type: sourceType,
            status: 'ACTIVE',
            created_at: '2026-08-01T00:00:00.000Z',
          },
        ],
      });
    }
    if (text.includes('FROM reconciliation_mapping_profile_version')) {
      return Promise.resolve({ rows: [] });
    }
    if (text.includes('INSERT INTO reconciliation_mapping_profile_version')) {
      const [id, profileId, versionNumber, columnMapping, transformationRules, createdBy] =
        params as [string, string, number, string, string, string];
      return Promise.resolve({
        rows: [
          {
            id,
            profile_id: profileId,
            version_number: versionNumber,
            column_mapping: JSON.parse(columnMapping) as Record<string, string>,
            transformation_rules: JSON.parse(transformationRules) as unknown[],
            status: 'ACTIVE',
            created_by: createdBy,
            created_at: '2026-08-01T00:00:00.000Z',
          },
        ],
      });
    }
    throw new Error(`createFakeMappingPool: unexpected query: ${text}`);
  };

  // The save route's persistence calls now go through runInTenantScope
  // (packages/persistence/src/postgres.ts), which checks out a client and runs
  // BEGIN / SET LOCAL app.current_organization_id / ... / COMMIT rather than calling
  // pool.query directly -- so the fake has to answer pool.connect() too.
  const clientQuery = (text: string, params: unknown[] = []) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (text.includes('set_config(')) {
      return Promise.resolve({ rows: [{ set_config: params[1] }], rowCount: 1 });
    }
    return query(text, params as unknown[] | undefined);
  };

  return {
    query,
    connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
  } as unknown as Pool;
};

describe('GET /api/mapping/canonical-fields', () => {
  it('returns the canonical field list without requiring a database connection', async () => {
    const app = createApp();
    const response = await authedApp(app).get('/api/mapping/canonical-fields').expect(200);
    const fields = response.body as Array<{ id: string; required: boolean }>;

    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some((field) => field.id === 'transactionDate' && field.required)).toBe(true);
  });
});

describe('POST /api/mapping/profiles', () => {
  it('returns 501 when no database is configured', async () => {
    const app = createApp();
    await authedApp(app)
      .post('/api/mapping/profiles')
      .send({ name: 'Test', gl: [], bank: [], createdBy: 'rray' })
      .expect(501);
  });

  it('rejects a request with no name', async () => {
    const app = createApp(undefined, undefined, undefined, createFakeMappingPool());
    await authedApp(app)
      .post('/api/mapping/profiles')
      .send({ name: '', gl: [], bank: [], createdBy: 'rray' })
      .expect(400);
  });

  it('rejects a pair mapped to a field outside the BusinessField vocabulary', async () => {
    const app = createApp(undefined, undefined, undefined, createFakeMappingPool());
    await authedApp(app)
      .post('/api/mapping/profiles')
      .send({
        name: 'Test',
        gl: [{ col: 'Account Code', db: 'not_a_real_field' }],
        bank: [],
        createdBy: 'rray',
      })
      .expect(400);
  });

  it('creates a profile and version for both sides on a valid request', async () => {
    const app = createApp(undefined, undefined, undefined, createFakeMappingPool());
    const response = await authedApp(app)
      .post('/api/mapping/profiles')
      .send({
        name: 'Monthly Bank + GL',
        gl: [{ col: 'Account Code', db: 'accountIdentifier', transform: 'trim' }],
        bank: [{ col: 'Description', db: 'description' }],
        createdBy: 'rray',
      })
      .expect(201);

    const body = response.body as {
      glProfile: { sourceType: string; name: string };
      glVersion: { columnMapping: Record<string, string> };
      bankProfile: { sourceType: string };
      bankVersion: { columnMapping: Record<string, string> };
    };

    expect(body.glProfile.sourceType).toBe('gl');
    expect(body.glProfile.name).toBe('Monthly Bank + GL');
    expect(body.glVersion.columnMapping).toEqual({ 'Account Code': 'accountIdentifier' });
    expect(body.bankProfile.sourceType).toBe('bank');
    expect(body.bankVersion.columnMapping).toEqual({ Description: 'description' });
  });
});
