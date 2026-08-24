import { useEffect, useState } from 'react';

import {
  getReconciliationRunRollforwardRequest,
  listReconciliationRunsRequest,
  type ReconciliationRunRollforwardSnapshot,
} from '../lib/api';

export interface PriorPeriodRollforward {
  periodLabel: string;
  snapshots: ReconciliationRunRollforwardSnapshot[];
}

/** The prior calendar period for `frequency`, given the current run's own period -- MONTHLY
 * rolls back one month (with year rollover), ANNUAL rolls back one year. Exported for testing. */
export const computePriorPeriod = (
  periodYear: number,
  periodMonth: number | null | undefined,
  frequency: 'MONTHLY' | 'ANNUAL',
): { periodYear: number; periodMonth: number | undefined } => {
  if (frequency === 'ANNUAL' || !periodMonth) {
    return { periodYear: periodYear - 1, periodMonth: undefined };
  }

  return periodMonth === 1
    ? { periodYear: periodYear - 1, periodMonth: 12 }
    : { periodYear, periodMonth: periodMonth - 1 };
};

/**
 * Unreconciled Item Roll-Forward PR F.3: fills the Verdict module's "Prior-period comparison"
 * slot, which has been a static "Unavailable" placeholder since before PR F's prior-runs/
 * rollforward endpoints (F.1/F.2) existed.
 *
 * Three distinct end states, all valid and all shown differently by the caller:
 *   - `status: 'none'` -- the prior period genuinely has no closed run (nothing to compare against
 *     yet, e.g. this is the account's first-ever period, or the prior run was never closed).
 *   - `status: 'loaded'` -- a real snapshot exists.
 *   - `status: 'error'` -- the lookup itself failed (network/server error), distinct from `'none'`
 *     so the UI can say "couldn't load" rather than implying nothing exists.
 *
 * Deliberately the useState/useEffect fetch-hook convention already used throughout this app
 * (useImportFileFailureDetail, useReviewerDecisions) rather than react-query's useQuery, matching
 * this codebase's existing split between the two (react-query reserved for mutations).
 */
export const usePriorPeriodRollforward = (input: {
  accountIdentifier: string | undefined;
  periodYear: number | undefined;
  periodMonth: number | null | undefined;
  frequency: 'MONTHLY' | 'ANNUAL' | undefined;
}): {
  status: 'idle' | 'loading' | 'none' | 'loaded' | 'error';
  data: PriorPeriodRollforward | null;
} => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'none' | 'loaded' | 'error'>('idle');
  const [data, setData] = useState<PriorPeriodRollforward | null>(null);

  const { accountIdentifier, periodYear, periodMonth, frequency } = input;

  useEffect(() => {
    if (!accountIdentifier || periodYear === undefined || !frequency) {
      setStatus('idle');
      setData(null);
      return undefined;
    }

    let cancelled = false;
    setStatus('loading');
    setData(null);

    const prior = computePriorPeriod(periodYear, periodMonth, frequency);

    listReconciliationRunsRequest({
      accountId: accountIdentifier,
      periodYear: prior.periodYear,
      periodMonth: prior.periodMonth,
    })
      .then((runs) => {
        if (cancelled) return undefined;
        // Newest first already (listRuns' own ORDER BY); the exact period filter above should
        // only ever match one run per account, but take the first defensively.
        const priorRun = runs[0];
        if (!priorRun) {
          setStatus('none');
          return undefined;
        }

        return getReconciliationRunRollforwardRequest(priorRun.id).then((result) => {
          if (cancelled) return;
          if (result.snapshots.length === 0) {
            // The prior run exists but was never closed -- no frozen snapshot to compare.
            setStatus('none');
            return;
          }
          setStatus('loaded');
          setData({ periodLabel: priorRun.label, snapshots: result.snapshots });
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountIdentifier, periodYear, periodMonth, frequency]);

  return { status, data };
};
