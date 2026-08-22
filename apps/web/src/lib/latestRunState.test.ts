import { describe, expect, it } from 'vitest';

import type { ImportRunSummary } from './api';
import { resolveLatestRunPhase } from './latestRunState';

const baseRun = (overrides: Partial<ImportRunSummary> = {}): ImportRunSummary => ({
  id: 'run-1',
  organizationId: 'org-1',
  label: 'Monthly Recon for August 2026',
  accountIdentifier: null,
  frequency: 'MONTHLY',
  periodYear: 2026,
  periodMonth: 8,
  status: 'DRAFT',
  createdAt: '2026-08-21T00:00:00.000Z',
  matchingJobId: null,
  matchingJob: null,
  validationJob: null,
  files: [],
  ...overrides,
});

describe('resolveLatestRunPhase', () => {
  it('returns idle when there is no run at all', () => {
    expect(resolveLatestRunPhase(null)).toEqual({ kind: 'idle' });
  });

  it('returns validation-failed for a VALIDATION_FAILED run', () => {
    const run = baseRun({ status: 'VALIDATION_FAILED' });
    expect(resolveLatestRunPhase(run)).toEqual({ kind: 'validation-failed', run });
  });

  it('returns matching-failed via a FAILED reconciliation_job (legacy/queue path)', () => {
    const run = baseRun({
      status: 'PENDING_APPROVAL',
      matchingJobId: 'job-1',
      matchingJob: {
        id: 'job-1',
        currentState: 'FAILED',
        failureCode: 'MATCH_ENGINE_ERROR',
        failureMessage: 'Matching engine crashed while grouping split payments.',
        completedAt: '2026-08-21T00:05:00.000Z',
      },
    });

    expect(resolveLatestRunPhase(run)).toEqual({
      kind: 'matching-failed',
      run,
      message: 'Matching engine crashed while grouping split payments.',
    });
  });

  it('falls back to failureCode when a FAILED reconciliation_job has no failureMessage', () => {
    const run = baseRun({
      matchingJobId: 'job-1',
      matchingJob: {
        id: 'job-1',
        currentState: 'FAILED',
        failureCode: 'MATCH_ENGINE_ERROR',
        failureMessage: null,
        completedAt: '2026-08-21T00:05:00.000Z',
      },
    });

    expect(resolveLatestRunPhase(run)).toMatchObject({
      kind: 'matching-failed',
      message: 'MATCH_ENGINE_ERROR',
    });
  });

  it('returns matching-failed via a FAILED import_job -- the path that actually fires today, even though run.status still reads PENDING_APPROVAL', () => {
    const run = baseRun({
      status: 'PENDING_APPROVAL',
      matchingJobId: null,
      validationJob: {
        id: 'validation-job-1',
        status: 'FAILED',
        errorSummary: 'Matching engine crashed mid-run.',
        queuedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: '2026-08-21T00:04:00.000Z',
      },
    });

    expect(resolveLatestRunPhase(run)).toEqual({
      kind: 'matching-failed',
      run,
      message: 'Matching engine crashed mid-run.',
    });
  });

  it('returns succeeded when a matching job is linked and neither failure applied', () => {
    const run = baseRun({ status: 'RECONCILING', matchingJobId: 'job-1' });
    expect(resolveLatestRunPhase(run)).toEqual({ kind: 'succeeded', run, matchingJobId: 'job-1' });
  });

  it('returns running for a DRAFT run', () => {
    const run = baseRun({ status: 'DRAFT' });
    expect(resolveLatestRunPhase(run)).toEqual({ kind: 'running', run });
  });

  it('returns running for a VALIDATING run', () => {
    const run = baseRun({ status: 'VALIDATING' });
    expect(resolveLatestRunPhase(run)).toEqual({ kind: 'running', run });
  });

  it('returns running when validationJob is QUEUED', () => {
    const run = baseRun({
      status: 'PENDING_APPROVAL',
      validationJob: {
        id: 'validation-job-1',
        status: 'QUEUED',
        errorSummary: null,
        queuedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: null,
      },
    });
    expect(resolveLatestRunPhase(run)).toEqual({ kind: 'running', run });
  });

  it('returns running when validationJob is RUNNING', () => {
    const run = baseRun({
      status: 'PENDING_APPROVAL',
      validationJob: {
        id: 'validation-job-1',
        status: 'RUNNING',
        errorSummary: null,
        queuedAt: '2026-08-21T00:00:00.000Z',
        finishedAt: null,
      },
    });
    expect(resolveLatestRunPhase(run)).toEqual({ kind: 'running', run });
  });

  it('returns idle for an indeterminate PENDING_APPROVAL run with no job linkage and no failure', () => {
    const run = baseRun({ status: 'PENDING_APPROVAL' });
    expect(resolveLatestRunPhase(run)).toEqual({ kind: 'idle' });
  });

  it('never reads a VALIDATION_FAILED run as succeeded even with a stale matchingJobId from a prior attempt', () => {
    const run = baseRun({ status: 'VALIDATION_FAILED', matchingJobId: 'stale-job-from-earlier-attempt' });
    expect(resolveLatestRunPhase(run)).toEqual({ kind: 'validation-failed', run });
  });

  it('prioritizes matching-failed over succeeded when both a failure and a matchingJobId are present', () => {
    const run = baseRun({
      matchingJobId: 'job-1',
      matchingJob: {
        id: 'job-1',
        currentState: 'FAILED',
        failureCode: 'MATCH_ENGINE_ERROR',
        failureMessage: 'Crashed.',
        completedAt: '2026-08-21T00:05:00.000Z',
      },
    });
    expect(resolveLatestRunPhase(run).kind).toBe('matching-failed');
  });
});
