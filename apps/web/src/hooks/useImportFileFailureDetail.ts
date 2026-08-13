import { useEffect, useState } from 'react';

import { getImportFileFailureDetailRequest, type ImportFileFailureDetail } from '../lib/api';

/** Fetches Screen 05/07's failure detail for one file, following this codebase's existing
 * fetch-hook convention (useState/useEffect, e.g. useReviewerDecisions) rather than introducing
 * react-query's useQuery for a single one-shot GET. */
export const useImportFileFailureDetail = (runId: string, importFileId: string) => {
  const [detail, setDetail] = useState<ImportFileFailureDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getImportFileFailureDetailRequest(runId, importFileId)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
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

  return { detail, isLoading, error };
};
