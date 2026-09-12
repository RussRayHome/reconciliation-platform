import { useEffect, useState } from 'react';

import { listReconciliationRunsRequest, type ReconciliationRunListItem } from '../lib/api';

export interface RecentRunsState {
  runs: ReconciliationRunListItem[];
  isLoading: boolean;
  /** Set only when the list could not be read at all. Kept distinct from an empty list, which is
   * a real answer for an organization that has not run anything yet. */
  error: string | null;
}

/**
 * The organization's runs for Runs home's "Recent runs" table (UI-4, #403).
 *
 * Fetched once at mount, like `useSubledgerEntityCounts` and for the same reason: this renders on
 * the landing route, and a refetch per navigation would put a query behind every visit for a table
 * that changes only when a run finishes.
 *
 * No filters. The endpoint takes account and period filters for the Verdict module's prior-period
 * lookup; Runs home wants the whole history, newest first, which is what the store already orders
 * by.
 */
export const useRecentRuns = (): RecentRunsState => {
  const [state, setState] = useState<RecentRunsState>({
    runs: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    listReconciliationRunsRequest({})
      .then((runs) => {
        if (!cancelled) setState({ runs, isLoading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          runs: [],
          isLoading: false,
          error: error instanceof Error ? error.message : 'Could not load recent runs.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};
