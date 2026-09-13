import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import {
  getReplayEstimate,
  listReplayEstimatesForVersion,
  upsertReplayEstimate,
} from '../src/readModelStore';
import { createDatabaseFromTemplate } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

/**
 * The replay estimate behind the 2b approver sheet (ADR-0018, Issue #530).
 *
 * Against a real migrated database rather than a fake pool, because the three things worth proving
 * here are all database behaviour: the (version, period) unique index that makes this a cache
 * rather than an append log, the money column's precision, and the cascade that stops estimates
 * outliving the version they describe.
 */
describe('Replay estimates (against the Liquibase-migrated database)', () => {
  let database: TestDatabase | undefined;
  let pool: Pool;
  let startupError: Error | null = null;
  let organizationId: string;

  const AUTHOR = 'replay.author';

  const createRun = async (label: string): Promise<string> => {
    const runId = randomUUID();
    await pool.query(
      `INSERT INTO reconciliation_run (id, organization_id, label, frequency, period_year)
       VALUES ($1, $2, $3, 'MONTHLY', 2026)`,
      [runId, organizationId, label],
    );
    return runId;
  };

  /**
   * Inserted directly rather than through `createMatchingConfigVersionDraft`, for one reason worth
   * recording: a partial unique index allows at most one DRAFT per organization, and these tests
   * need several versions at once. They are written as SUPERSEDED, which carries no such
   * constraint -- an estimate's foreign key does not care about status, and pretending otherwise
   * would make every test here fight a rule it is not testing.
   */
  let nextVersionNumber = 100;
  const createDraft = async (): Promise<string> => {
    const id = randomUUID();
    nextVersionNumber += 1;
    await pool.query(
      `INSERT INTO reconciliation_matching_config_version
         (id, organization_id, version_number, status, variance_overrides, created_by)
       VALUES ($1, $2, $3, 'SUPERSEDED', $4::jsonb, $5)`,
      [id, organizationId, nextVersionNumber, JSON.stringify({ amountTolerance: 0.05 }), AUTHOR],
    );
    return id;
  };

  const estimate = (versionId: string, runId: string, over: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    organizationId,
    matchingConfigVersionId: versionId,
    replayedRunId: runId,
    exceptionsDelta: -12,
    probableMatchesDelta: 3,
    unresolvedExposureDelta: '-4120.0000',
    engineBuild: 'test-build-1',
    draftOverridesFingerprint: 'fp-1',
    ...over,
  });

  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_replay_estimate_store');
      pool = database.pool;
      const found = await pool.query<{ id: string }>(
        "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
      );
      const id = found.rows[0]?.id;
      if (!id) throw new Error("Expected migrations to seed a 'Default Organization' row.");
      organizationId = id;

      // created_by is a foreign key, so the author has to be a real row.
      await pool.query(
        `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
         VALUES ($1, 'Replay', 'Author', 'hash', 'controller', $2)`,
        [AUTHOR, organizationId],
      );
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`PostgreSQL integration setup failed: ${startupError.message}`);
      throw startupError;
    }
  });

  afterAll(async () => {
    if (database) {
      await database.drop();
    }
  });

  it('records an estimate and reads it back for its (version, period) pair', async () => {
    expect(startupError).toBeNull();
    const versionId = await createDraft();
    const runId = await createRun('August 2026');

    const written = await upsertReplayEstimate(pool, estimate(versionId, runId));
    expect(written.exceptionsDelta).toBe(-12);

    const read = await getReplayEstimate(pool, organizationId, versionId, runId);
    expect(read).not.toBeNull();
    expect(read).toMatchObject({
      matchingConfigVersionId: versionId,
      replayedRunId: runId,
      exceptionsDelta: -12,
      probableMatchesDelta: 3,
      engineBuild: 'test-build-1',
    });
  });

  // The sign convention is the one thing a reader cannot recover from the column names, and
  // getting it backwards would invert the approver sheet while looking entirely plausible:
  // "12 fewer exceptions" must round-trip as -12, not 12.
  it('stores deltas signed, draft minus active', async () => {
    const versionId = await createDraft();
    const runId = await createRun('Signed period');

    await upsertReplayEstimate(
      pool,
      estimate(versionId, runId, { exceptionsDelta: -12, probableMatchesDelta: 3 }),
    );

    const read = await getReplayEstimate(pool, organizationId, versionId, runId);
    expect(read!.exceptionsDelta).toBeLessThan(0);
    expect(read!.probableMatchesDelta).toBeGreaterThan(0);
  });

  // This is money an approver signs against. A JS number cannot hold NUMERIC(20,4) faithfully, so
  // the amount stays a string end to end -- a test that compared Number(...) would pass while the
  // precision it is meant to protect quietly disappeared.
  it('keeps the exposure delta exact, as a string', async () => {
    const versionId = await createDraft();
    const runId = await createRun('Precision period');

    await upsertReplayEstimate(
      pool,
      estimate(versionId, runId, { unresolvedExposureDelta: '-12345678901234.5678' }),
    );

    const read = await getReplayEstimate(pool, organizationId, versionId, runId);
    expect(read!.unresolvedExposureDelta).toBe('-12345678901234.5678');
    expect(typeof read!.unresolvedExposureDelta).toBe('string');
  });

  // Upsert, not append: recomputation is expected (a draft's overrides can change, invalidating
  // the estimate that described them). Accumulating rows would leave a reader date-sorting to work
  // out which one is current.
  it('replaces an earlier estimate for the same period rather than accumulating rows', async () => {
    const versionId = await createDraft();
    const runId = await createRun('Recomputed period');

    const first = await upsertReplayEstimate(pool, estimate(versionId, runId));
    const second = await upsertReplayEstimate(
      pool,
      estimate(versionId, runId, {
        exceptionsDelta: -2,
        draftOverridesFingerprint: 'fp-2',
        engineBuild: 'test-build-2',
      }),
    );

    expect(second.id).toBe(first.id);
    expect(second.exceptionsDelta).toBe(-2);
    expect(second.draftOverridesFingerprint).toBe('fp-2');

    const all = await listReplayEstimatesForVersion(pool, organizationId, versionId);
    expect(all).toHaveLength(1);
  });

  // The approver chooses the period, so one draft legitimately carries several estimates. This is
  // the case the (version, period) key exists for -- a key on version alone would silently
  // overwrite the evidence for whichever period was viewed first.
  it('keeps one estimate per period for the same draft', async () => {
    const versionId = await createDraft();
    const july = await createRun('July 2026');
    const august = await createRun('August 2026 (multi)');

    await upsertReplayEstimate(pool, estimate(versionId, july, { exceptionsDelta: -1 }));
    await upsertReplayEstimate(pool, estimate(versionId, august, { exceptionsDelta: -9 }));

    const all = await listReplayEstimatesForVersion(pool, organizationId, versionId);
    expect(all).toHaveLength(2);
    expect(all.map((row) => row.exceptionsDelta).sort((a, b) => a - b)).toEqual([-9, -1]);
  });

  it('returns null for a period that has not been replayed', async () => {
    const versionId = await createDraft();
    const runId = await createRun('Never replayed');

    expect(await getReplayEstimate(pool, organizationId, versionId, runId)).toBeNull();
  });

  // An estimate describes one version and means nothing without it. Left behind, it would be an
  // orphan keyed to a row that no longer exists -- and the approver sheet's read starts from the
  // version, so nothing would ever surface it again either.
  it('is deleted with the version it describes', async () => {
    const versionId = await createDraft();
    const runId = await createRun('Cascade period');
    await upsertReplayEstimate(pool, estimate(versionId, runId));

    await pool.query('DELETE FROM reconciliation_matching_config_version WHERE id = $1', [
      versionId,
    ]);

    const remaining = await pool.query(
      'SELECT 1 FROM reconciliation_replay_estimate WHERE matching_config_version_id = $1',
      [versionId],
    );
    expect(remaining.rowCount).toBe(0);
  });

  it('is deleted with the period it replayed', async () => {
    const versionId = await createDraft();
    const runId = await createRun('Deleted period');
    await upsertReplayEstimate(pool, estimate(versionId, runId));

    await pool.query('DELETE FROM reconciliation_run WHERE id = $1', [runId]);

    const remaining = await pool.query(
      'SELECT 1 FROM reconciliation_replay_estimate WHERE reconciliation_run_id = $1',
      [runId],
    );
    expect(remaining.rowCount).toBe(0);
  });

  it('does not read another organization’s estimates', async () => {
    const versionId = await createDraft();
    const runId = await createRun('Tenant period');
    await upsertReplayEstimate(pool, estimate(versionId, runId));

    const other = await pool.query<{ id: string }>(
      "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Replay Other Org') RETURNING id",
    );
    const otherOrganizationId = other.rows[0]!.id;

    expect(await getReplayEstimate(pool, otherOrganizationId, versionId, runId)).toBeNull();
    expect(await listReplayEstimatesForVersion(pool, otherOrganizationId, versionId)).toEqual([]);
  });
});
