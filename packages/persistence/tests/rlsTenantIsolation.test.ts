import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import { createPostgresPool, runInTenantScope, runInTenantScopeAsUser } from '../src/postgres';
import { createDatabaseFromTemplate, postgresHarness } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

/**
 * ADR-0001 step 8. Every other test in this suite connects as recon_app (superuser, so RLS
 * never applies to it at all -- see leastPrivilegeRole.test.ts's own comment on this). These
 * tests connect as app_user (renamed from recon_app_runtime by changeset 0031) through
 * runInTenantScope, exactly as the API does in
 * production, and prove the policies from changeset 0030 actually stop a connection scoped to
 * one tenant from reading or writing another tenant's rows -- not just that the GRANT/ENABLE
 * statements ran without error.
 */
describe('RLS tenant isolation (leak tests)', () => {
  let database: TestDatabase | undefined;
  let adminPool: Pool;
  let runtimePool: Pool;
  let startupError: Error | null = null;

  let orgAId: string;
  let orgBId: string;
  let jobAId: string;
  let jobBId: string;

  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_rls_isolation');
      adminPool = database.pool;
      const harness = postgresHarness();
      const runtimeConnectionString = `postgresql://app_user:P%40ssw0rd@${harness.host}:${harness.port}/${database.name}`;
      runtimePool = createPostgresPool({ connectionString: runtimeConnectionString });

      // Fixture setup runs as recon_app (superuser, bypasses RLS unconditionally) so it can
      // freely seed rows for both tenants regardless of any GUC.
      const orgA = await adminPool.query<{ id: string }>(
        "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'RLS Test Org A') RETURNING id",
      );
      const orgB = await adminPool.query<{ id: string }>(
        "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'RLS Test Org B') RETURNING id",
      );
      orgAId = orgA.rows[0]!.id;
      orgBId = orgB.rows[0]!.id;

      const jobA = await adminPool.query<{ id: string }>(
        `INSERT INTO reconciliation_job (id, correlation_id, organization_id, current_state, rulepack_version, started_at)
         VALUES (gen_random_uuid(), 'corr-org-a', $1, 'CREATED', 'v1', NOW()) RETURNING id`,
        [orgAId],
      );
      const jobB = await adminPool.query<{ id: string }>(
        `INSERT INTO reconciliation_job (id, correlation_id, organization_id, current_state, rulepack_version, started_at)
         VALUES (gen_random_uuid(), 'corr-org-b', $1, 'CREATED', 'v1', NOW()) RETURNING id`,
        [orgBId],
      );
      jobAId = jobA.rows[0]!.id;
      jobBId = jobB.rows[0]!.id;
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      throw startupError;
    }
  }, 180000);

  afterAll(async () => {
    await runtimePool?.end();
    if (database) {
      await database.drop();
    }
  });

  it('SELECT with no WHERE clause returns only the scoped tenant\'s rows', async () => {
    if (startupError) throw startupError;

    const rows = await runInTenantScope(runtimePool, orgAId, async (client) => {
      const result = await client.query<{ id: string }>('SELECT id FROM reconciliation_job');
      return result.rows;
    });

    const ids = rows.map((row) => row.id);
    expect(ids).toContain(jobAId);
    expect(ids).not.toContain(jobBId);
  });

  it('a connection scoped to tenant B never sees tenant A\'s row either', async () => {
    if (startupError) throw startupError;

    const rows = await runInTenantScope(runtimePool, orgBId, async (client) => {
      const result = await client.query<{ id: string }>('SELECT id FROM reconciliation_job');
      return result.rows;
    });

    const ids = rows.map((row) => row.id);
    expect(ids).toContain(jobBId);
    expect(ids).not.toContain(jobAId);
  });

  it('a cross-tenant UPDATE affects zero rows and leaves the other tenant\'s row unchanged', async () => {
    if (startupError) throw startupError;

    const updateResult = await runInTenantScope(runtimePool, orgAId, async (client) => {
      return client.query(
        "UPDATE reconciliation_job SET current_state = 'FAILED' WHERE id = $1",
        [jobBId],
      );
    });
    expect(updateResult.rowCount ?? 0).toBe(0);

    const stillCreated = await adminPool.query<{ current_state: string }>(
      'SELECT current_state FROM reconciliation_job WHERE id = $1',
      [jobBId],
    );
    expect(stillCreated.rows[0]?.current_state).toBe('CREATED');
  });

  it('a cross-tenant DELETE affects zero rows and leaves the other tenant\'s row intact', async () => {
    if (startupError) throw startupError;

    const deleteResult = await runInTenantScope(runtimePool, orgAId, async (client) => {
      return client.query('DELETE FROM reconciliation_job WHERE id = $1', [jobBId]);
    });
    expect(deleteResult.rowCount ?? 0).toBe(0);

    const stillExists = await adminPool.query<{ id: string }>(
      'SELECT id FROM reconciliation_job WHERE id = $1',
      [jobBId],
    );
    expect(stillExists.rows).toHaveLength(1);
  });

  it('an INSERT claiming a different tenant than the connection GUC is rejected', async () => {
    if (startupError) throw startupError;

    // WITH CHECK (implied equal to USING when a policy gives no separate clause) validates new
    // row values on INSERT, not just visibility of existing rows -- a connection scoped to org A
    // cannot even create a row that claims to belong to org B.
    await expect(
      runInTenantScope(runtimePool, orgAId, async (client) => {
        await client.query(
          `INSERT INTO reconciliation_job (id, correlation_id, organization_id, current_state, rulepack_version, started_at)
           VALUES (gen_random_uuid(), 'corr-cross-tenant-insert', $1, 'CREATED', 'v1', NOW())`,
          [orgBId],
        );
      }),
    ).rejects.toThrow(/new row violates row-level security policy/);
  });

  it('scopes a descendant table (reconciliation_payee_alias) the same way as the aggregate root', async () => {
    if (startupError) throw startupError;

    const aliasA = await adminPool.query<{ id: string }>(
      `INSERT INTO reconciliation_payee_alias (organization_id, bank_pattern, canonical_payee_name, normalized_tokens, source_direction)
       VALUES ($1, 'SQ *ORG-A', 'Org A Payee', ARRAY['org', 'a'], 'bank_to_gl') RETURNING id`,
      [orgAId],
    );
    const aliasB = await adminPool.query<{ id: string }>(
      `INSERT INTO reconciliation_payee_alias (organization_id, bank_pattern, canonical_payee_name, normalized_tokens, source_direction)
       VALUES ($1, 'SQ *ORG-B', 'Org B Payee', ARRAY['org', 'b'], 'bank_to_gl') RETURNING id`,
      [orgBId],
    );

    const rows = await runInTenantScope(runtimePool, orgAId, async (client) => {
      const result = await client.query<{ id: string }>('SELECT id FROM reconciliation_payee_alias');
      return result.rows;
    });

    const ids = rows.map((row) => row.id);
    expect(ids).toContain(aliasA.rows[0]!.id);
    expect(ids).not.toContain(aliasB.rows[0]!.id);
  });

  // ISSUE-050.2: proves app.current_user_name against a real connection, not just the SQL text
  // sent (already covered at the unit level in ../src/postgres.test.ts) -- this is the same
  // `runtimePool`/app_user role every other test in this file uses, so it also confirms the new
  // GUC doesn't somehow interfere with the tenant one already proven above.
  it('runInTenantScopeAsUser sets app.current_user_name for the transaction, on top of the tenant GUC', async () => {
    if (startupError) throw startupError;

    const settings = await runInTenantScopeAsUser(runtimePool, orgAId, 'rray', async (client) => {
      const result = await client.query<{ org: string; user: string }>(
        `SELECT current_setting('app.current_organization_id', true) AS org,
                current_setting('app.current_user_name', true) AS user`,
      );
      return result.rows[0];
    });

    expect(settings?.org).toBe(orgAId);
    expect(settings?.user).toBe('rray');
  });

  it('leaves app.current_user_name unset when using plain runInTenantScope', async () => {
    if (startupError) throw startupError;

    const userSetting = await runInTenantScope(runtimePool, orgAId, async (client) => {
      const result = await client.query<{ user: string }>(
        "SELECT current_setting('app.current_user_name', true) AS user",
      );
      return result.rows[0]?.user;
    });

    expect(userSetting).toBe('');
  });
});
