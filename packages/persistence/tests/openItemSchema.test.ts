import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import { createPostgresPool, runInTenantScope } from '../src';
import { createDatabaseFromTemplate, postgresHarness } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

/**
 * Schema-only smoke coverage for the Unreconciled Item Roll-Forward PR B tables
 * (reconciliation_open_item / reconciliation_open_item_event / reconciliation_period_rollforward)
 * -- nothing writes to these tables yet (PR C builds the real write path), but the schema itself
 * needs to be provably correct before that lands: the runtime app_user role can actually write to
 * every new table (including the event table's BIGSERIAL sequence -- changeset 0049's own
 * ALTER DEFAULT PRIVILEGES exists precisely because a missed sequence grant like this one wasn't
 * caught until the flow was run end-to-end), the partial unique index enforces at-most-one-OPEN
 * per natural key, and a deleted run SETs NULL on reconciliation_open_item rather than cascading
 * (the entire point of the entity -- it outlives any single run's evidence).
 */
describe('Unreconciled Item Roll-Forward PR B schema', () => {
  let database: TestDatabase | undefined;
  let pool: Pool;
  let runtimePool: Pool;
  let startupError: Error | null = null;
  let defaultOrganizationId: string;

  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_open_item_schema');
      pool = database.pool;
      const harness = postgresHarness();
      runtimePool = createPostgresPool({
        connectionString: `postgresql://app_user:P%40ssw0rd@${harness.host}:${harness.port}/${database.name}`,
      });
      const organizationResult = await pool.query<{ id: string }>(
        "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
      );
      const organizationId = organizationResult.rows[0]?.id;
      if (!organizationId) {
        throw new Error("Expected migrations to seed a 'Default Organization' row.");
      }
      defaultOrganizationId = organizationId;
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`PostgreSQL integration setup failed: ${startupError.message}`);
      throw startupError;
    }
  });

  afterAll(async () => {
    if (runtimePool) {
      await runtimePool.end();
    }
    if (database) {
      await database.drop();
    }
  });

  const insertAccount = async (accountIdentifier: string): Promise<string> => {
    const accountId = randomUUID();
    await runInTenantScope(runtimePool, defaultOrganizationId, (client) =>
      client.query(
        'INSERT INTO reconciliation_account (id, organization_id, account_identifier) VALUES ($1, $2, $3)',
        [accountId, defaultOrganizationId, accountIdentifier],
      ),
    );
    return accountId;
  };

  const insertOpenItem = async (
    accountId: string,
    naturalKey: string,
    overrides: { status?: string } = {},
  ): Promise<string> => {
    const id = randomUUID();
    await runInTenantScope(runtimePool, defaultOrganizationId, (client) =>
      client.query(
        `INSERT INTO reconciliation_open_item
           (id, organization_id, account_id, source_system, category, natural_key,
            natural_key_tier, original_transaction_date, amount, status)
         VALUES ($1, $2, $3, 'gl', 'OutstandingCheck', $4, 1, '2026-01-05', -250.00, $5)`,
        [id, defaultOrganizationId, accountId, naturalKey, overrides.status ?? 'OPEN'],
      ),
    );
    return id;
  };

  it('the runtime app_user role can insert into reconciliation_open_item', async () => {
    if (startupError) throw startupError;

    const accountId = await insertAccount('OPEN-ITEM-SMOKE-1');
    const id = await insertOpenItem(accountId, `check:${accountId}:1001`);

    const row = await pool.query<{ status: string; natural_key_tier: number }>(
      'SELECT status, natural_key_tier FROM reconciliation_open_item WHERE id = $1',
      [id],
    );
    expect(row.rows[0]).toEqual({ status: 'OPEN', natural_key_tier: 1 });
  });

  it('the runtime app_user role can insert into reconciliation_open_item_event, proving the BIGSERIAL sequence grant works', async () => {
    if (startupError) throw startupError;

    const accountId = await insertAccount('OPEN-ITEM-SMOKE-2');
    const openItemId = await insertOpenItem(accountId, `check:${accountId}:1002`);

    const eventResult = await runInTenantScope(runtimePool, defaultOrganizationId, (client) =>
      client.query<{ event_id: string }>(
        `INSERT INTO reconciliation_open_item_event
           (open_item_id, organization_id, event_type, from_status, to_status, actor)
         VALUES ($1, $2, 'OPENED', NULL, 'OPEN', 'system')
         RETURNING event_id`,
        [openItemId, defaultOrganizationId],
      ),
    );

    expect(eventResult.rows[0]?.event_id).toBeDefined();
    expect(Number(eventResult.rows[0]?.event_id)).toBeGreaterThan(0);
  });

  it('rejects a second OPEN item with the same natural key, but allows a CLEARED one to coexist with a new OPEN recurrence', async () => {
    if (startupError) throw startupError;

    const accountId = await insertAccount('OPEN-ITEM-SMOKE-3');
    const naturalKey = `check:${accountId}:2001`;

    await insertOpenItem(accountId, naturalKey);
    await expect(insertOpenItem(accountId, naturalKey)).rejects.toThrow(/duplicate key/i);

    // Clear the first, then a genuine later recurrence of the same check number is allowed.
    await pool.query("UPDATE reconciliation_open_item SET status = 'CLEARED' WHERE natural_key = $1", [
      naturalKey,
    ]);
    await expect(insertOpenItem(accountId, naturalKey)).resolves.toBeDefined();
  });

  it('SETs NULL on opened_in_run_id when the run is deleted -- the item outlives the run, never cascades', async () => {
    if (startupError) throw startupError;

    const accountId = await insertAccount('OPEN-ITEM-SMOKE-4');

    // A minimal reconciliation_run row -- only the columns this test actually exercises.
    const runId = randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_run (id, organization_id, label, frequency, period_year)
       VALUES ($1, $2, 'Smoke Test Run', 'MONTHLY', 2026)`,
      [runId, defaultOrganizationId],
    );

    const openItemId = randomUUID();
    await runInTenantScope(runtimePool, defaultOrganizationId, (client) =>
      client.query(
        `INSERT INTO reconciliation_open_item
           (id, organization_id, account_id, opened_in_run_id, source_system, category,
            natural_key, natural_key_tier, original_transaction_date, amount)
         VALUES ($1, $2, $3, $4, 'gl', 'OutstandingCheck', $5, 1, '2026-01-05', -250.00)`,
        [openItemId, defaultOrganizationId, accountId, runId, `check:${accountId}:3001`],
      ),
    );

    await pool.query('DELETE FROM reconciliation_run WHERE id = $1', [runId]);

    const row = await pool.query<{ opened_in_run_id: string | null }>(
      'SELECT opened_in_run_id FROM reconciliation_open_item WHERE id = $1',
      [openItemId],
    );
    expect(row.rows[0]?.opened_in_run_id).toBeNull();
  });
});
