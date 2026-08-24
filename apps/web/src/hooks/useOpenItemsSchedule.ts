import { useEffect, useState } from 'react';

import { listOpenItemsScheduleRequest, type OpenItemScheduleRow } from '../lib/api';

/** Unreconciled Item Roll-Forward PR F.4. Fetches the open-items schedule for an optional
 * account/status filter, refetching whenever either changes -- same useState/useEffect
 * fetch-hook convention as useImportFileFailureDetail/usePriorPeriodRollforward. */
export const useOpenItemsSchedule = (filters: { accountId?: string; status?: string }) => {
  const [items, setItems] = useState<OpenItemScheduleRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { accountId, status } = filters;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    listOpenItemsScheduleRequest({ accountId, status })
      .then((result) => {
        if (!cancelled) {
          setItems(result);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Unable to load the open-items schedule.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountId, status]);

  return { items, isLoading, error };
};
