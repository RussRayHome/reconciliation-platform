import type { Pool } from 'pg';
import { createSampleBankWorkbook, createSampleGlWorkbook } from '@recon/test-fixtures';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { InMemoryRunRepository } from '../src/services/runRepository';
import { authedApp } from './testHelpers/authToken';

// Issue #311 (PR B), API level. The reconciliation itself runs on a NO-pool app (the workflow's
// carry-forward step would otherwise query real tables), then a second app on the SAME in-memory
// repository gets the fake pool -- so the decision hook sees the run's transactions in memory and
// every statement it issues is recorded, including which client connection carried it.
interface Recorded { client: number; text: string; params: unknown[] }

const createRecordingPool = (answer: (text: string, params: unknown[]) => { rows: unknown[]; rowCount: number } | undefined) => {
  const statements: Recorded[] = [];
  let connections = 0;
  const respond = (client: number) => (text: string, params: unknown[] = []) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return Promise.resolve({ rows: [], rowCount: 0 });
    if (text.includes('set_config(')) return Promise.resolve({ rows: [{ set_config: params[1] }], rowCount: 1 });
    if (text === 'SELECT 1') return Promise.resolve({ rows: [], rowCount: 0 });
    statements.push({ client, text, params });
    const result = answer(text, params);
    if (!result) return Promise.reject(new Error(`Unexpected query: ${text.slice(0, 80)}`));
    return Promise.resolve(result);
  };
  const pool = {
    query: respond(0),
    connect: () => {
      connections += 1;
      const id = connections;
      return Promise.resolve({ query: respond(id), release: () => undefined });
    },
  } as unknown as Pool;
  return { pool, statements };
};

const spreadsheetMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('payee alias proposal from a confirmed match (Issue #311)', () => {
  it('inserts the inactive alias and its approval request on one connection, from the real pair', async () => {
    const repository = new InMemoryRunRepository();
    const [bankBuffer, glBuffer] = await Promise.all([createSampleBankWorkbook(), createSampleGlWorkbook()]);
    const runResponse = await authedApp(createApp(repository))
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, { filename: 'bank.xlsx', contentType: spreadsheetMime })
      .attach('glFile', glBuffer, { filename: 'gl.xlsx', contentType: spreadsheetMime })
      .expect(201);
    const run = repository.findById(runResponse.body.id as string);
    expect(run).toBeDefined();
    const target = run!.probableMatches.find((m) => {
      const gl = run!.normalizedTransactions.find((t) => t.id === m.glTransactionId);
      return m.disposition === 'ProbableMatch' && Boolean(gl?.payeeName);
    });
    expect(target, 'sample data should yield a probable match whose GL row names a payee').toBeDefined();
    const bank = run!.normalizedTransactions.find((t) => t.id === target!.bankTransactionId)!;
    const gl = run!.normalizedTransactions.find((t) => t.id === target!.glTransactionId)!;

    const { pool, statements } = createRecordingPool((text) => {
      if (text.includes('lower(bank_pattern)')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO reconciliation_payee_alias')) {
        return { rows: [{ id: 'alias-new', account_identifier: null, bank_pattern: bank.description, canonical_payee_name: gl.payeeName, normalized_tokens: [], source_direction: 'bank_to_gl', match_confidence: '1', is_active: false }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO reconciliation_approval_request')) {
        return { rows: [{ id: 'req-new', subject_type: 'payeeAlias', subject_id: 'alias-new', status: 'PENDING', submitted_by: 'x', decided_by: null, rationale: null, requested_at: new Date().toISOString(), decided_at: null }], rowCount: 1 };
      }
      return undefined;
    });
    const decision = await authedApp(createApp(repository, undefined, undefined, pool as Parameters<typeof createApp>[3]))
      .post(`/api/reconciliation/${run!.id}/reviewer-decisions`)
      .send({ targetType: 'ProbableMatch', targetId: target!.id, outcome: 'ApprovedMatch', reviewerName: 'Controller' })
      .expect(201);
    expect(decision.body.outcome).toBe('ApprovedMatch');

    const aliasInsert = statements.find((s) => s.text.includes('INSERT INTO reconciliation_payee_alias'));
    const requestInsert = statements.find((s) => s.text.includes('INSERT INTO reconciliation_approval_request'));
    expect(aliasInsert, statements.map((s) => s.text.slice(0, 60)).join('\n')).toBeDefined();
    expect(requestInsert).toBeDefined();
    // Same connection => same runInTenantScope transaction.
    expect(aliasInsert!.client).toBe(requestInsert!.client);
    expect(aliasInsert!.client).toBeGreaterThan(0);
    // Proposed inactive; the SQL carries the literal, not a parameter, so assert on the text.
    expect(aliasInsert!.text).toMatch(/is_active\)\s*VALUES \(.*false\)/s);
    expect(aliasInsert!.params.slice(1, 4)).toEqual([null, bank.description, gl.payeeName]);
    expect(requestInsert!.text).toContain("'payeeAlias'");
    expect(requestInsert!.params[2]).toBe('alias-new');
  });

  it('a decision on a match without a pool saves normally and proposes nothing', async () => {
    const repository = new InMemoryRunRepository();
    const [bankBuffer, glBuffer] = await Promise.all([createSampleBankWorkbook(), createSampleGlWorkbook()]);
    const app = createApp(repository);
    const runResponse = await authedApp(app)
      .post('/api/reconciliation/run')
      .attach('bankFile', bankBuffer, { filename: 'bank.xlsx', contentType: spreadsheetMime })
      .attach('glFile', glBuffer, { filename: 'gl.xlsx', contentType: spreadsheetMime })
      .expect(201);
    const target = (runResponse.body.probableMatches as Array<{ id: string; disposition: string }>).find((m) => m.disposition === 'ProbableMatch');
    await authedApp(app)
      .post(`/api/reconciliation/${runResponse.body.id}/reviewer-decisions`)
      .send({ targetType: 'ProbableMatch', targetId: target!.id, outcome: 'ApprovedMatch' })
      .expect(201);
  });
});

describe('approving a payeeAlias request (Issue #311)', () => {
  const pendingRow = {
    id: 'req-1', subject_type: 'payeeAlias', subject_id: 'alias-1', status: 'PENDING', submitted_by: 'reviewer',
    decided_by: null, rationale: null, requested_at: '2026-09-05T00:00:00.000Z', decided_at: null,
  };
  const answerDecision = (activatedRows: number) => (text: string) => {
    if (text.includes('FROM reconciliation_approval_request') && text.includes('WHERE subject_type = $1')) return { rows: [pendingRow], rowCount: 1 };
    if (text.includes('UPDATE reconciliation_payee_alias') && text.includes('is_active = TRUE')) return { rows: [], rowCount: activatedRows };
    if (text.includes('FOR UPDATE')) return { rows: [{ status: 'PENDING' }], rowCount: 1 };
    if (text.includes('UPDATE reconciliation_approval_request')) return { rows: [{ ...pendingRow, status: 'APPROVED', decided_by: 'approver', decided_at: new Date().toISOString() }], rowCount: 1 };
    if (text.includes('INSERT INTO reconciliation_approval_request_history')) return { rows: [], rowCount: 1 };
    return undefined;
  };

  it('activates the proposed alias, then records the decision', async () => {
    const { pool, statements } = createRecordingPool(answerDecision(1));
    const response = await authedApp(createApp(undefined, undefined, undefined, pool as Parameters<typeof createApp>[3]))
      .post('/api/approvals/payeeAlias/req-1/decision')
      .send({ status: 'APPROVED', rationale: 'Confirmed against the vendor master.' })
      .expect(200);
    expect(response.body).toMatchObject({ id: 'req-1', subjectType: 'payeeAlias', status: 'APPROVED' });
    const activate = statements.findIndex((s) => s.text.includes('is_active = TRUE'));
    const record = statements.findIndex((s) => s.text.includes('UPDATE reconciliation_approval_request'));
    expect(activate).toBeGreaterThanOrEqual(0);
    expect(record).toBeGreaterThan(activate);
    expect(statements[activate]!.params).toEqual([expect.any(String), 'alias-1']);
  });

  it('refuses with 409 when there is nothing left to activate, and records no decision', async () => {
    const { pool, statements } = createRecordingPool(answerDecision(0));
    await authedApp(createApp(undefined, undefined, undefined, pool as Parameters<typeof createApp>[3]))
      .post('/api/approvals/payeeAlias/req-1/decision')
      .send({ status: 'APPROVED' })
      .expect(409);
    expect(statements.some((s) => s.text.includes('UPDATE reconciliation_approval_request'))).toBe(false);
  });
});

describe('approvals inbox presents a payeeAlias proposal (Issue #311)', () => {
  it('titles the row as bank pattern -> canonical payee, with a distinguishing meta line', async () => {
    const { pool } = createRecordingPool((text) => {
      if (text.includes('FROM reconciliation_approval_request') && text.includes('WHERE subject_type = $1')) {
        return {
          rows: [{
            id: 'req-1', subject_type: 'payeeAlias', subject_id: 'alias-1', status: 'PENDING', submitted_by: 'reviewer',
            decided_by: null, rationale: null, requested_at: '2026-09-05T00:00:00.000Z', decided_at: null,
          }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM reconciliation_payee_alias') && text.includes('AND id = $2')) {
        return {
          rows: [{
            id: 'alias-1', account_identifier: null, bank_pattern: 'SQ *COFFEE SHOP 4471', canonical_payee_name: 'Square',
            normalized_tokens: ['4471', 'COFFEE', 'SHOP', 'SQ'], source_direction: 'bank_to_gl', match_confidence: '1', is_active: false,
          }],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const response = await authedApp(createApp(undefined, undefined, undefined, pool as Parameters<typeof createApp>[3]))
      .get('/api/approvals?type=payeeAlias&tab=pending')
      .expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: 'req-1',
      type: 'payeeAlias',
      title: '"SQ *COFFEE SHOP 4471" \u2192 Square',
      meta: 'Payee alias learned from a confirmed match',
      submitter: 'reviewer',
      state: 'PENDING',
    });
  });
});
