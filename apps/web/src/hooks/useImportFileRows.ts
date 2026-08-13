import { useEffect, useState } from 'react';

import { getImportFileRowsRequest, type ImportRowGridResult } from '../lib/api';

/** Fetches Screen 06's row grid for one file, same useState/useEffect convention as
 * useImportFileFailureDetail. */
export const useImportFileRows = (runId: string, importFileId: string) => {
  const [grid, setGrid] = useState<ImportRowGridResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getImportFileRowsRequest(runId, importFileId)
      .then((result) => {
        if (!cancelled) {
          setGrid(result);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Request failed.');
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
  }, [runId, importFileId]);

  return { grid, isLoading, error };
};
