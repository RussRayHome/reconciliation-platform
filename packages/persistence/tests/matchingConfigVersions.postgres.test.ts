import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import {
  createMatchingConfigVersionDraft,
  listMatchingConfigVersions,
  publishMatchingConfigVersion,
} from '../src/readModelStore';
import { createDatabaseFromTemplate } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

/**
 * Exercises the migration (0039_create_reconciliation_matching_config_version_table.sql) and the
 * matching-config-version persistence functions against a real, Liquibase-migrated Postgres
 * instance -- in particular the two partial unique indexes (at most one ACTIVE, at most one
 * DRAFT per organization) and the publish transaction's atomicity, neither of which a fake-pool
 * unit test can actually prove.
 */
describe('Matching config versions (against the Liquibase-migrated database)', () => {
  let database: TestDatabase | undefined;
  let pool: Pool;
  let startupError: Error | null = null;

  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_matching_config_versions');
      pool = database.pool;
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      throw startupError;
    }
  }, 180000);

  afterAll(async () => {
    if (database) {
      await database.drop();
    }
  });

  const seedOrgAndUser = async (orgName: string, userName: string): Promise<string> => {
    await pool.query(
      'INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), $1) ON CONFLICT DO NOTHING',
      [orgName],
    );
    const org = await pool.query<{ id: string }>(
      'SELECT id FROM reconciliation_organization WHERE name = $1',
      [orgName],
    );
    const organizationId = org.rows[0]!.id;

    await pool.query(
      `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
       VALUES ($1, 'Test', 'User', 'hash', 'admin', $2)
       ON CONFLICT DO NOTHING`,
      [userName, organizationId],
    );

    return organizationId;
  };

  it('creates a draft, publishes it, then supersedes it when a second draft is published', async () => {
    if (startupError) throw startupError;

    const organizationId = await seedOrgAndUser('Publish Flow Co', 'mortega');

    const draft1 = await createMatchingConfigVersionDraft(pool, {
      id: randomUUID(),
      organizationId,
      varianceOverrides: { wireFeeTolerance: 750 },
      createdBy: 'mortega',
    });
    expect(draft1.versionNumber).toBe(1);
    expect(draft1.status).toBe('DRAFT');

    const active1 = await publishMatchingConfigVersion(pool, organizationId, draft1.id, {
      publishedBy: 'mortega',
    });
    expect(active1.status).toBe('ACTIVE');
    expect(active1.publishedBy).toBe('mortega');
    expect(active1.publishedAt).not.toBeNull();
    expect(active1.effectiveAt).not.toBeNull();

    const draft2 = await createMatchingConfigVersionDraft(pool, {
      id: randomUUID(),
      organizationId,
      varianceOverrides: { wireFeeTolerance: 900 },
      createdBy: 'mortega',
    });
    expect(draft2.versionNumber).toBe(2);

    await publishMatchingConfigVersion(pool, organizationId, draft2.id, {
      publishedBy: 'mortega',
    });

    const history = await listMatchingConfigVersions(pool, organizationId);
    expect(history).toHaveLength(2);
    const [newest, oldest] = history;
    expect(newest?.versionNumber).toBe(2);
    expect(newest?.status).toBe('ACTIVE');
    expect(oldest?.versionNumber).toBe(1);
    expect(oldest?.status).toBe('SUPERSEDED');
  });

  it('rejects a second concurrent draft for the same organization', async () => {
    if (startupError) throw startupError;

    const organizationId = await seedOrgAndUser('Concurrent Draft Co', 'bray');

    await createMatchingConfigVersionDraft(pool, {
      id: randomUUID(),
      organizationId,
      varianceOverrides: {},
      createdBy: 'bray',
    });

    await expect(
      createMatchingConfigVersionDraft(pool, {
        id: randomUUID(),
        organizationId,
        varianceOverrides: {},
        createdBy: 'bray',
      }),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  it('throws when publishing an id that is not a DRAFT belonging to the organization', async () => {
    if (startupError) throw startupError;

    const organizationId = await seedOrgAndUser('No Draft Co', 'rray3');

    await expect(
      publishMatchingConfigVersion(pool, organizationId, randomUUID(), { publishedBy: 'rray3' }),
    ).rejects.toThrow('publishMatchingConfigVersion: no matching DRAFT version to publish');
  });
});
