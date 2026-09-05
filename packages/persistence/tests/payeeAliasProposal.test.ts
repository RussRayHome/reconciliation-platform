import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activatePayeeAlias,
  createPostgresPool,
  findPayeeAliasByPattern,
  listApprovalRequests,
  loadPayeeAliases,
  proposePayeeAlias,
} from '../src';
import { createDatabaseFromTemplate, postgresHarness } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

// Issue #311 (PR B), against real Postgres as app_user: the proposal is one transaction, the
// engine cannot see it until approval, and approval is what makes it visible.
describe('payee alias proposals (Issue #311)', () => {
  let database: TestDatabase;
  let runtimePool: Pool;
  let organizationId: string;
  const reviewer = 'alias-reviewer';

  beforeAll(async () => {
    database = await createDatabaseFromTemplate('recon_alias_proposal');
    const harness = postgresHarness();
    runtimePool = createPostgresPool({
      connectionString: `postgresql://app_user:P%40ssw0rd@${harness.host}:${harness.port}/${database.name}`,
    });
    const result = await database.pool.query<{ id: string }>(
      "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
    );
    organizationId = result.rows[0]!.id;
    // reconciliation_approval_request.submitted_by is an FK to reconciliation_user(user_name): the
    // proposer must be a real user, exactly as the API's authenticated username is.
    await database.pool.query(
      `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
       VALUES ($1, 'Alias', 'Reviewer', 'hash', 'admin', $2)
       ON CONFLICT DO NOTHING`,
      [reviewer, organizationId],
    );
  });

  afterAll(async () => {
    await runtimePool.end();
    await database.drop();
  });

  it('inserts the alias inactive and opens a payeeAlias approval request atomically', async () => {
    const approvalRequestId = randomUUID();
    const { alias, approvalRequest } = await proposePayeeAlias(runtimePool, organizationId, {
      bankPattern: 'SQ *COFFEE SHOP 4471',
      canonicalPayeeName: 'Square',
      normalizedTokens: ['SQ', 'COFFEE', 'SHOP', '4471'],
      submittedBy: reviewer,
      approvalRequestId,
    });
    expect(alias.isActive).toBe(false);
    expect(approvalRequest).toMatchObject({
      id: approvalRequestId, subjectType: 'payeeAlias', subjectId: alias.id, status: 'PENDING',
    });

    // The engine's view excludes it; the dedupe lookup still finds it (case-insensitively).
    const visible = await loadPayeeAliases(runtimePool, organizationId);
    expect(visible.some((row) => row.id === alias.id)).toBe(false);
    const known = await findPayeeAliasByPattern(runtimePool, organizationId, 'sq *coffee shop 4471', 'SQUARE');
    expect(known?.id).toBe(alias.id);

    const pending = await listApprovalRequests(runtimePool, organizationId, {
      subjectType: 'payeeAlias', status: 'PENDING',
    });
    expect(pending.map((row) => row.id)).toContain(approvalRequestId);
  });

  it('rolls back the alias when the approval request cannot be inserted', async () => {
    // Force the second INSERT to fail with a duplicate approval-request id: the alias from the
    // same call must not survive, or we would have created exactly the inert, ungated row the
    // single-transaction design exists to prevent.
    const approvalRequestId = randomUUID();
    await proposePayeeAlias(runtimePool, organizationId, {
      bankPattern: 'TST* TOAST CAFE', canonicalPayeeName: 'Toast', normalizedTokens: ['TST', 'TOAST', 'CAFE'],
      submittedBy: reviewer, approvalRequestId,
    });
    await expect(
      proposePayeeAlias(runtimePool, organizationId, {
        bankPattern: 'PAYPAL *ACME', canonicalPayeeName: 'Acme via PayPal', normalizedTokens: ['PAYPAL', 'ACME'],
        submittedBy: reviewer, approvalRequestId,
      }),
    ).rejects.toThrow();
    const orphan = await findPayeeAliasByPattern(runtimePool, organizationId, 'PAYPAL *ACME', 'Acme via PayPal');
    expect(orphan).toBeUndefined();
  });

  it('activation makes the alias visible to the engine, and is idempotent', async () => {
    const { alias } = await proposePayeeAlias(runtimePool, organizationId, {
      bankPattern: 'DOORDASH*BURRITO', canonicalPayeeName: 'DoorDash', normalizedTokens: ['DOORDASH', 'BURRITO'],
      submittedBy: reviewer, approvalRequestId: randomUUID(),
    });
    expect(await activatePayeeAlias(runtimePool, organizationId, alias.id)).toBe(true);
    expect(await activatePayeeAlias(runtimePool, organizationId, alias.id)).toBe(false);
    const visible = await loadPayeeAliases(runtimePool, organizationId);
    expect(visible.find((row) => row.id === alias.id)?.isActive).toBe(true);
  });

  it('the CHECK constraint admits payeeAlias and still rejects unknown subject types', async () => {
    await expect(
      database.pool.query(
        `INSERT INTO reconciliation_approval_request (id, organization_id, subject_type, subject_id, submitted_by)
         VALUES ($1, $2, 'somethingElse', $3, 'x')`,
        [randomUUID(), organizationId, randomUUID()],
      ),
    ).rejects.toThrow(/subject_type_check/);
  });
});
