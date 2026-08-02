import type { ReconciliationRun, ReviewerDecision, SummaryMetrics } from '@recon/domain';
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import { FileBackedRunRepository, InMemoryRunRepository } from '../src/services/runRepository';
import path from 'node:path';
import { tmpdir } from 'node:os';

const createSummary = (): SummaryMetrics => ({
  totalRecordsReviewed: 0,
  bankRecords: 0,
  glRecords: 0,
  exactMatches: 0,
  probableMatches: 0,
  unmatchedItems: 0,
  duplicates: 0,
  bankDuplicates: 0,
  glDuplicates: 0,
  dateVariances: 0,
  timingDifferences: 0,
  dataQualityIssues: 0,
  amountMismatches: 0,
  missingFromBank: 0,
  missingFromGL: 0,
  unmatchedBankNetAmount: 0,
  unmatchedGlNetAmount: 0,
  cleanMatchedAmount: 0,
  unresolvedExposure: 0,
  countsByCategory: {},
  amountByCategory: {},
  charts: [],
});

const createRun = (overrides: Partial<ReconciliationRun> = {}): ReconciliationRun => ({
  id: 'run-1',
  correlationId: 'corr-1',
  status: 'Completed',
  startedAt: '2026-06-28T00:00:00.000Z',
  completedAt: '2026-06-28T00:01:00.000Z',
  sourceFiles: [],
  rawRows: [],
  normalizedTransactions: [],
  matchResults: [],
  groupedMatchResults: [],
  probableMatches: [],
  exceptions: [],
  summary: createSummary(),
  reviewerObservations: [],
  reviewerDecisions: [],
  auditEvents: [],
  ...overrides,
});

const createDecision = (overrides: Partial<ReviewerDecision> = {}): ReviewerDecision => ({
  id: 'decision-1',
  runId: 'run-1',
  targetType: 'ExceptionItem',
  targetId: 'exception-1',
  outcome: 'ConfirmedException',
  createdAt: '2026-06-28T00:02:00.000Z',
  updatedAt: '2026-06-28T00:02:00.000Z',
  ...overrides,
});

describe('runRepository', () => {
  it('throws when saving a reviewer decision for an unknown run', () => {
    const repository = new InMemoryRunRepository();
    const decision = createDecision({ runId: 'missing-run' });

    expect(() => repository.saveReviewerDecision('missing-run', decision)).toThrow(
      'Reconciliation run not found: missing-run',
    );
  });

  it('replaces an existing reviewer decision while preserving id and createdAt', () => {
    const repository = new InMemoryRunRepository();
    const existingDecision = createDecision();

    repository.save(
      createRun({
        reviewerDecisions: [existingDecision],
      }),
    );

    const replacement = createDecision({
      id: 'decision-new',
      outcome: 'ReclassifiedException',
      finalCategory: 'MissingFromGL',
      notes: 'Reclassified after follow-up review.',
      updatedAt: '2026-06-28T00:03:00.000Z',
    });

    const savedDecision = repository.saveReviewerDecision('run-1', replacement);
    const decisions = repository.listReviewerDecisions('run-1');

    expect(savedDecision.id).toBe(existingDecision.id);
    expect(savedDecision.createdAt).toBe(existingDecision.createdAt);
    expect(savedDecision.updatedAt).toBe(replacement.updatedAt);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.outcome).toBe('ReclassifiedException');
    expect(decisions[0]?.finalCategory).toBe('MissingFromGL');
  });

  it('hydrates safely when a file-backed snapshot exists without a latest run', () => {
    const snapshotDirectory = mkdtempSync(path.join(tmpdir(), 'run-repository-empty-snapshot-'));

    try {
      const snapshotPath = path.join(snapshotDirectory, 'latest-run.json');
      writeFileSync(snapshotPath, JSON.stringify({ version: 2, latestRun: null }), 'utf8');

      const repository = new FileBackedRunRepository(snapshotPath);

      expect(repository.findLatest()).toBeUndefined();
      expect(repository.findById('run-1')).toBeUndefined();
    } finally {
      rmSync(snapshotDirectory, { recursive: true, force: true });
    }
  });

  it('ignores corrupt snapshot files and falls back to a clean in-memory state', () => {
    const snapshotDirectory = mkdtempSync(path.join(tmpdir(), 'run-repository-corrupt-snapshot-'));

    try {
      const snapshotPath = path.join(snapshotDirectory, 'latest-run.json');
      writeFileSync(snapshotPath, '{ this is not json', 'utf8');

      const repository = new FileBackedRunRepository(snapshotPath);

      expect(repository.findLatest()).toBeUndefined();
      expect(repository.listReviewerDecisions('missing-run')).toEqual([]);
    } finally {
      rmSync(snapshotDirectory, { recursive: true, force: true });
    }
  });
});
