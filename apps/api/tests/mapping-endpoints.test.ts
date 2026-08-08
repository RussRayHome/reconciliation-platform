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

describe('GET /api/mapping/profiles', () => {
  const createFakeProfileListPool = (names: string[]): Pool => {
    const clientQuery = (text: string, params?: unknown[]) => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes('set_config(')) {
        return Promise.resolve({ rows: [{ set_config: params?.[1] }], rowCount: 1 });
      }
      if (text.includes('SELECT DISTINCT name') && text.includes('reconciliation_mapping_profile')) {
        return Promise.resolve({ rows: names.map((name) => ({ name })) });
      }
      throw new Error(`createFakeProfileListPool: unexpected query: ${text}`);
    };

    return {
      connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
    } as unknown as Pool;
  };

  it('returns distinct saved profile names', async () => {
    const app = createApp(undefined, undefined, undefined, createFakeProfileListPool(['Chase Operating', 'WF Payroll']));
    const response = await authedApp(app).get('/api/mapping/profiles').expect(200);

    expect(response.body).toEqual(['Chase Operating', 'WF Payroll']);
  });

  it('returns an empty array for an organization with no saved profiles', async () => {
    const app = createApp(undefined, undefined, undefined, createFakeProfileListPool([]));
    const response = await authedApp(app).get('/api/mapping/profiles').expect(200);

    expect(response.body).toEqual([]);
  });
});

describe('POST /api/mapping/profiles', () => {
  it('returns 501 when no database is configured', async () => {
    const app = createApp();
    await authedApp(app)
      .post('/api/mapping/profiles')
      .send({ name: 'Test', gl: [], bank: [] })
      .expect(501);
  });

  it('rejects a request with no name', async () => {
    const app = createApp(undefined, undefined, undefined, createFakeMappingPool());
    await authedApp(app)
      .post('/api/mapping/profiles')
      .send({ name: '', gl: [], bank: [] })
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
      })
      .expect(400);
  });

  it('rejects an unknown transform with 400 instead of silently dropping it (ISSUE-010)', async () => {
    const app = createApp(undefined, undefined, undefined, createFakeMappingPool());
    await authedApp(app)
      .post('/api/mapping/profiles')
      .send({
        name: 'Test',
        gl: [{ col: 'Account Code', db: 'accountIdentifier', transform: 'not_a_real_transform' }],
        bank: [],
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

  it('ignores a client-supplied createdBy and attributes the version to the authenticated user (ISSUE-008)', async () => {
    const app = createApp(undefined, undefined, undefined, createFakeMappingPool());
    const response = await authedApp(app)
      .post('/api/mapping/profiles')
      .send({
        name: 'Monthly Bank + GL',
        gl: [{ col: 'Account Code', db: 'accountIdentifier' }],
        bank: [],
        createdBy: 'someone-else',
      })
      .expect(201);

    const body = response.body as { glVersion: { createdBy: string } };
    expect(body.glVersion.createdBy).toBe('test-user');
  });
});

describe('GET /api/mapping/profiles/:name (ISSUE-050.1)', () => {
  const PROFILE_ROW_GL = {
    id: 'profile-gl-1',
    organization_id: 'test-org',
    name: 'Monthly Bank + GL',
    source_type: 'gl',
    status: 'ACTIVE',
    created_at: '2026-08-01T00:00:00.000Z',
  };
  const PROFILE_ROW_BANK = { ...PROFILE_ROW_GL, id: 'profile-bank-1', source_type: 'bank' };
  const VERSION_ROW = {
    id: 'version-1',
    profile_id: 'profile-gl-1',
    version_number: 1,
    column_mapping: { 'Account Code': 'accountIdentifier' },
    transformation_rules: [],
    status: 'ACTIVE',
    created_by: 'rray',
    created_at: '2026-08-01T00:00:00.000Z',
  };

  const createFakeDetailPool = (profileRows: Array<Record<string, unknown>>): Pool => {
    const clientQuery = (text: string, params?: unknown[]) => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes('set_config(')) {
        return Promise.resolve({ rows: [{ set_config: params?.[1] }], rowCount: 1 });
      }
      if (text.includes('FROM reconciliation_mapping_profile') && text.includes('WHERE organization_id = $1 AND name = $2')) {
        return Promise.resolve({ rows: profileRows });
      }
      if (text.includes('FROM reconciliation_mapping_profile_version')) {
        return Promise.resolve({ rows: [VERSION_ROW] });
      }
      throw new Error(`createFakeDetailPool: unexpected query: ${text}`);
    };

    return {
      connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
    } as unknown as Pool;
  };

  it('returns both sides with version histories when both were saved', async () => {
    const app = createApp(
      undefined,
      undefined,
      undefined,
      createFakeDetailPool([PROFILE_ROW_GL, PROFILE_ROW_BANK]),
    );

    const response = await authedApp(app)
      .get('/api/mapping/profiles/Monthly%20Bank%20%2B%20GL')
      .expect(200);

    const body = response.body as {
      name: string;
      gl: { profile: { id: string }; versions: unknown[] } | null;
      bank: { profile: { id: string }; versions: unknown[] } | null;
    };
    expect(body.name).toBe('Monthly Bank + GL');
    expect(body.gl?.profile.id).toBe('profile-gl-1');
    expect(body.gl?.versions).toHaveLength(1);
    expect(body.bank?.profile.id).toBe('profile-bank-1');
  });

  it('returns 404 for a name that does not exist', async () => {
    const app = createApp(undefined, undefined, undefined, createFakeDetailPool([]));
    await authedApp(app).get('/api/mapping/profiles/Nonexistent').expect(404);
  });
});

describe('POST /api/mapping/profiles/:name/retire (ISSUE-050.1)', () => {
  const createFakeRetirePool = (updatedRows: Array<Record<string, unknown>>): Pool => {
    const query = (text: string) => {
      if (text.includes('identity_verification_status') && text.includes('entity_verification_status')) {
        return Promise.resolve({
          rows: [{ identity_verification_status: 'verified', entity_verification_status: 'verified' }],
        });
      }
      throw new Error(`createFakeRetirePool: unexpected pool.query: ${text}`);
    };

    const clientQuery = (text: string, params?: unknown[]) => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes('set_config(')) {
        return Promise.resolve({ rows: [{ set_config: params?.[1] }], rowCount: 1 });
      }
      if (text.includes('UPDATE reconciliation_mapping_profile')) {
        return Promise.resolve({ rows: updatedRows });
      }
      throw new Error(`createFakeRetirePool: unexpected client.query: ${text}`);
    };

    return {
      query,
      connect: () => Promise.resolve({ query: clientQuery, release: () => undefined }),
    } as unknown as Pool;
  };

  it('retires both sides and returns the updated rows', async () => {
    const app = createApp(
      undefined,
      undefined,
      undefined,
      createFakeRetirePool([
        {
          id: 'profile-gl-1',
          organization_id: 'test-org',
          name: 'Monthly Bank + GL',
          source_type: 'gl',
          status: 'DEPRECATED',
          created_at: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'profile-bank-1',
          organization_id: 'test-org',
          name: 'Monthly Bank + GL',
          source_type: 'bank',
          status: 'DEPRECATED',
          created_at: '2026-08-01T00:00:00.000Z',
        },
      ]),
    );

    const response = await authedApp(app)
      .post('/api/mapping/profiles/Monthly%20Bank%20%2B%20GL/retire')
      .expect(200);

    const body = response.body as Array<{ status: string; sourceType: string }>;
    expect(body).toHaveLength(2);
    expect(body.every((row) => row.status === 'DEPRECATED')).toBe(true);
  });

  it('returns 404 when nothing ACTIVE matched the name', async () => {
    const app = createApp(undefined, undefined, undefined, createFakeRetirePool([]));
    await authedApp(app).post('/api/mapping/profiles/Nonexistent/retire').expect(404);
  });
});
