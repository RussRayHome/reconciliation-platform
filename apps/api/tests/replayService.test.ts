import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listMatchingConfigVersions: vi.fn(),
  listNormalizedTransactionsForRun: vi.fn(),
  executeReconciliationFromNormalized: vi.fn(),
}));

vi.mock('@recon/persistence', () => ({
  listMatchingConfigVersions: mocks.listMatchingConfigVersions,
  listNormalizedTransactionsForRun: mocks.listNormalizedTransactionsForRun,
}));

vi.mock('../src/services/reconciliationService', () => ({
  executeReconciliationFromNormalized: mocks.executeReconciliationFromNormalized,
}));

const { computeReplayEstimate, fingerprintOverrides, ReplayNotPossibleError } = await import(
  '../src/services/replayService'
);

/**
 * The replay estimate's compute step (ADR-0018, Issue #531).
 *
 * The write-nothing guarantee is asserted here rather than against a live database on purpose: it
 * is **structural**, not behavioural. `executeReconciliationFromNormalized` can only persist
 * through `lifecycleStore`, `openItemStore` or `reconciliationRunId`, all of which are optional
 * inputs, and a replay omits all three. Asserting the omission tests the actual mechanism; counting
 * rows afterwards would only observe its consequence, and would pass just as happily if the
 * mechanism were replaced by something that merely happened not to write during that one run.
 */
const version = (over: Record<string, unknown> = {}) => ({
  id: 'draft-1',
  organizationId: 'org-1',
  versionNumber: 12,
  status: 'DRAFT',
  varianceOverrides: { amountTolerance: 0.1 },
  createdBy: 'author',
  createdAt: '2026-01-01T00:00:00.000Z',
  publishedBy: null,
  publishedAt: null,
  effectiveAt: null,
  pendingApprovalOwner: null,
  draftReason: 'Widen the window.',
  rejectionNote: null,
  rejectedBy: null,
  rejectedAt: null,
  ...over,
});

const runResult = (exceptions: number, probableMatches: number, exposure: number) => ({
  exceptions: Array.from({ length: exceptions }, (_, index) => ({ id: `e-${index}` })),
  summary: { probableMatches, unresolvedExposure: exposure },
});

const pool = {} as never;

const callWith = () =>
  computeReplayEstimate({
    pool,
    organizationId: 'org-1',
    draftVersionId: 'draft-1',
    replayedRunId: 'run-1',
  });

beforeEach(() => {
  mocks.listMatchingConfigVersions.mockReset();
  mocks.listNormalizedTransactionsForRun.mockReset();
  mocks.executeReconciliationFromNormalized.mockReset();

  mocks.listMatchingConfigVersions.mockResolvedValue([
    version(),
    version({ id: 'active-1', status: 'ACTIVE', varianceOverrides: { amountTolerance: 0.01 } }),
  ]);
  mocks.listNormalizedTransactionsForRun.mockResolvedValue([{ id: 't-1' }, { id: 't-2' }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeReplayEstimate', () => {
  // The acceptance criterion this issue exists for.
  it('never hands the engine anything it could write through', async () => {
    mocks.executeReconciliationFromNormalized.mockResolvedValue(runResult(5, 2, 1000));

    await callWith();

    expect(mocks.executeReconciliationFromNormalized).toHaveBeenCalledTimes(2);
    for (const [input] of mocks.executeReconciliationFromNormalized.mock.calls) {
      expect(input.lifecycleStore).toBeUndefined();
      expect(input.openItemStore).toBeUndefined();
      expect(input.reconciliationRunId).toBeUndefined();
      // rawRows exists only to be persisted by lifecycleStore.persistParsedRows, which cannot run
      // without that store -- so an empty array here is honest rather than a stub.
      expect(input.rawRows).toEqual([]);
    }
  });

  // ADR-0018 decision 1. Diffing a fresh replay against the closed run's STORED results would
  // conflate the proposed rule with every engine change shipped since that period ran.
  it('executes both sides in this build rather than reading the stored run', async () => {
    mocks.executeReconciliationFromNormalized
      .mockResolvedValueOnce(runResult(20, 1, 9000))
      .mockResolvedValueOnce(runResult(8, 4, 4880));

    await callWith();

    const [activeCall, draftCall] = mocks.executeReconciliationFromNormalized.mock.calls;
    expect(activeCall![0].varianceOverrides).toEqual({ amountTolerance: 0.01 });
    expect(draftCall![0].varianceOverrides).toEqual({ amountTolerance: 0.1 });
    // Same rows both times: the rule is the only thing that differs.
    expect(activeCall![0].normalizedTransactions).toBe(draftCall![0].normalizedTransactions);
  });

  it('reports deltas as draft minus active', async () => {
    mocks.executeReconciliationFromNormalized
      .mockResolvedValueOnce(runResult(20, 1, 9000))
      .mockResolvedValueOnce(runResult(8, 4, 4880));

    const result = await callWith();

    // "12 fewer exceptions, 3 more probable matches, $4,120 less exposure" -- the product owner's
    // own example, and the direction that must never invert.
    expect(result.exceptionsDelta).toBe(-12);
    expect(result.probableMatchesDelta).toBe(3);
    expect(result.unresolvedExposureDelta).toBe('-4120.0000');
  });

  // An honest zero, and distinguishable from the no-data case below.
  it('reports zeros when the draft changes nothing', async () => {
    mocks.executeReconciliationFromNormalized.mockResolvedValue(runResult(7, 2, 500));

    const result = await callWith();

    expect(result.exceptionsDelta).toBe(0);
    expect(result.probableMatchesDelta).toBe(0);
    expect(result.unresolvedExposureDelta).toBe('0.0000');
  });

  // Not zeros: a period with nothing retained cannot be replayed at all, and three zeros would
  // read as "this change does nothing".
  it('refuses a period with no retained rows rather than reporting zeros', async () => {
    mocks.listNormalizedTransactionsForRun.mockResolvedValue([]);

    await expect(callWith()).rejects.toBeInstanceOf(ReplayNotPossibleError);
    expect(mocks.executeReconciliationFromNormalized).not.toHaveBeenCalled();
  });

  it('refuses a version that does not belong to the organization', async () => {
    mocks.listMatchingConfigVersions.mockResolvedValue([]);

    await expect(callWith()).rejects.toMatchObject({ reason: 'no-draft' });
  });

  // An organization with no ACTIVE version runs engine defaults, which is the correct baseline to
  // compare against -- an empty override set rather than a refusal.
  it('compares against engine defaults when no version is active', async () => {
    mocks.listMatchingConfigVersions.mockResolvedValue([version()]);
    mocks.executeReconciliationFromNormalized.mockResolvedValue(runResult(3, 1, 100));

    await callWith();

    const [activeCall] = mocks.executeReconciliationFromNormalized.mock.calls;
    expect(activeCall![0].varianceOverrides).toEqual({});
  });

  it('fingerprints the draft overrides it computed from', async () => {
    mocks.executeReconciliationFromNormalized.mockResolvedValue(runResult(1, 1, 1));

    const result = await callWith();

    expect(result.draftOverridesFingerprint).toBe(fingerprintOverrides({ amountTolerance: 0.1 }));
  });
});

describe('fingerprintOverrides', () => {
  // Key order is an artefact of how an object was built, not a change to the rule. Without sorting,
  // an estimate would read as stale purely because the overrides were reconstructed.
  it('does not depend on key order', () => {
    expect(fingerprintOverrides({ a: 1, b: 2 })).toBe(fingerprintOverrides({ b: 2, a: 1 }));
  });

  it('changes when a value changes', () => {
    expect(fingerprintOverrides({ a: 1 })).not.toBe(fingerprintOverrides({ a: 2 }));
  });

  it('distinguishes an empty override set from a populated one', () => {
    expect(fingerprintOverrides({})).not.toBe(fingerprintOverrides({ a: 1 }));
  });
});
