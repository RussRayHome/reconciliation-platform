import type { Pool } from 'pg';
import type { MatchResult, NormalizedTransaction } from '@recon/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  proposeAliasFromConfirmedMatch,
  type PayeeAliasProposalStore,
} from '../src/services/payeeAliasProposalService';

// Issue #311 (PR B): the decision logic, isolated from Postgres by injecting the store surface.
const pool = {} as Pool;
const organizationId = 'org-1';
const runId = 'run-1';

const tx = (overrides: Partial<NormalizedTransaction> & { id: string }): NormalizedTransaction =>
  ({
    runId,
    rawRowId: `${overrides.id}-raw`,
    sourceFileId: 'file',
    source: 'bank',
    spreadsheetFileName: 't.xlsx',
    worksheetName: 'Sheet1',
    lineNumber: 1,
    normalizedComparisonTokens: [],
    normalizedReferenceTokens: [],
    amount: -42.5,
    dataQualityIssues: [],
    ...overrides,
  }) as NormalizedTransaction;

const match: MatchResult = {
  id: 'm-1',
  disposition: 'ProbableMatch',
  confidence: 'Probable',
  ruleName: 'Amount + Date Match, Weak Description',
  score: 0.6,
  bankTransactionId: 'b-1',
  glTransactionId: 'g-1',
  dateDifferenceDays: 0,
  amountDifference: 0,
  appliedAmountTolerance: 0.01,
  evidence: [],
};

const buildStore = (overrides: Partial<PayeeAliasProposalStore> = {}) => {
  const store: PayeeAliasProposalStore = {
    findPayeeAliasByPattern: vi.fn(() => Promise.resolve(undefined)),
    loadCanonicalTransactionsByIds: vi.fn(() => Promise.resolve([])),
    proposePayeeAlias: vi.fn((_pool, _org, input) => Promise.resolve({
      alias: {
        id: 'alias-1',
        bankPattern: input.bankPattern,
        canonicalPayeeName: input.canonicalPayeeName,
        normalizedTokens: input.normalizedTokens,
        sourceDirection: 'bank_to_gl' as const,
        matchConfidence: 1,
        isActive: false,
      },
      approvalRequest: {
        id: input.approvalRequestId,
        subjectType: 'payeeAlias' as const,
        subjectId: 'alias-1',
        status: 'PENDING' as const,
        submittedBy: input.submittedBy,
        requestedAt: '2026-09-05T00:00:00.000Z',
      },
    })),
    ...overrides,
  };
  return store;
};

const bank = tx({ id: 'b-1', source: 'bank', description: 'SQ *COFFEE SHOP 4471' });
const gl = tx({ id: 'g-1', source: 'gl', description: 'Coffee', payeeName: 'Square' });

describe('proposeAliasFromConfirmedMatch (Issue #311)', () => {
  it('proposes bank description -> GL payee name, tokenized like the alias API does', async () => {
    const store = buildStore();
    const result = await proposeAliasFromConfirmedMatch({
      pool, organizationId, runId, match, submittedBy: 'reviewer', inMemoryTransactions: [bank, gl], store,
    });
    expect(result).toMatchObject({
      outcome: 'proposed', aliasId: 'alias-1', bankPattern: 'SQ *COFFEE SHOP 4471', canonicalPayeeName: 'Square',
    });
    expect(store.proposePayeeAlias).toHaveBeenCalledWith(pool, organizationId, expect.objectContaining({
      bankPattern: 'SQ *COFFEE SHOP 4471',
      canonicalPayeeName: 'Square',
      // buildComparisonTokens returns a sorted, de-duplicated token set.
      normalizedTokens: ['4471', 'COFFEE', 'SHOP', 'SQ'],
      submittedBy: 'reviewer',
    }));
    // In-memory transactions were enough; the durable source was not consulted.
    expect(store.loadCanonicalTransactionsByIds).not.toHaveBeenCalled();
  });

  it('falls back to the persisted canonical rows when this process lacks the transactions', async () => {
    const store = buildStore({
      loadCanonicalTransactionsByIds: vi.fn(() => Promise.resolve([
        { id: 'b-1', source: 'bank', description: 'AMZN Mktp US*2K4', normalizedComparisonTokens: ['AMZN', 'MKTP', 'US', '2K4'] },
        { id: 'g-1', source: 'gl', description: 'Office supplies', payeeName: 'Amazon', normalizedComparisonTokens: ['OFFICE', 'SUPPLIES', 'AMAZON'] },
      ])),
    });
    const result = await proposeAliasFromConfirmedMatch({ pool, organizationId, runId, match, submittedBy: 'reviewer', store });
    expect(result).toMatchObject({ outcome: 'proposed', bankPattern: 'AMZN Mktp US*2K4', canonicalPayeeName: 'Amazon' });
    expect(store.loadCanonicalTransactionsByIds).toHaveBeenCalledWith(pool, organizationId, runId, ['b-1', 'g-1']);
  });

  it('skips when the GL row has no payee or merchant name (a memo is not a payee)', async () => {
    const store = buildStore();
    const memoOnlyGl = tx({ id: 'g-1', source: 'gl', description: 'Coffee' });
    const result = await proposeAliasFromConfirmedMatch({
      pool, organizationId, runId, match, submittedBy: 'reviewer', inMemoryTransactions: [bank, memoOnlyGl], store,
    });
    expect(result).toEqual({ outcome: 'skipped', reason: 'no-gl-payee' });
    expect(store.proposePayeeAlias).not.toHaveBeenCalled();
  });

  it('skips when an identical alias already exists, active or pending', async () => {
    const store = buildStore({
      findPayeeAliasByPattern: vi.fn(() => Promise.resolve({
        id: 'alias-existing', bankPattern: 'SQ *COFFEE SHOP 4471', canonicalPayeeName: 'Square',
        normalizedTokens: ['SQ'], sourceDirection: 'bank_to_gl' as const, matchConfidence: 1, isActive: false,
      })),
    });
    const result = await proposeAliasFromConfirmedMatch({
      pool, organizationId, runId, match, submittedBy: 'reviewer', inMemoryTransactions: [bank, gl], store,
    });
    expect(result).toMatchObject({ outcome: 'skipped', reason: 'already-known', detail: 'alias-existing (inactive)' });
    expect(store.proposePayeeAlias).not.toHaveBeenCalled();
  });

  it('skips when the transactions cannot be found anywhere', async () => {
    const store = buildStore();
    const result = await proposeAliasFromConfirmedMatch({ pool, organizationId, runId, match, submittedBy: 'reviewer', store });
    expect(result).toEqual({ outcome: 'skipped', reason: 'transactions-missing' });
  });

  it('skips a match that lacks a bank or GL transaction id', async () => {
    const store = buildStore();
    const result = await proposeAliasFromConfirmedMatch({
      pool, organizationId, runId, match: { ...match, glTransactionId: undefined }, submittedBy: 'reviewer', store,
    });
    expect(result).toMatchObject({ outcome: 'skipped', reason: 'transactions-missing' });
    expect(store.loadCanonicalTransactionsByIds).not.toHaveBeenCalled();
  });
});
