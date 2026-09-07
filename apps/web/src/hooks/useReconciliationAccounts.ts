import { useCallback, useEffect, useState } from 'react';

import type { ReconciliationAccount } from '@recon/domain';

import { listAccountsRequest } from '../lib/api';

export interface ReconciliationAccountsState {
  accounts: ReconciliationAccount[];
  isLoading: boolean;
  /** Set when the registry could not be read at all. Kept distinct from an empty list: "we don't
   * know your accounts" and "you have registered none yet" call for different UI, and conflating
   * them would show a first-run prompt to someone whose network simply failed. */
  error: string | null;
  reload: () => void;
}

/**
 * The organization's registered bank accounts (A-D1, Issue #338).
 *
 * `includeInactive` exists for the management screen, which must still show a deactivated account
 * so it can be reactivated. The upload flow leaves it off: a statement may not be assigned to a
 * deactivated account, so offering one would only produce a rejection at submit.
 */
export const useReconciliationAccounts = (
  options: { includeInactive?: boolean } = {},
): ReconciliationAccountsState => {
  const includeInactive = options.includeInactive ?? false;
  const [accounts, setAccounts] = useState<ReconciliationAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    listAccountsRequest({ includeInactive })
      .then((loaded) => {
        if (cancelled) return;
        setAccounts(loaded);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setAccounts([]);
        setError(loadError instanceof Error ? loadError.message : 'Could not load bank accounts.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeInactive, reloadToken]);

  return { accounts, isLoading, error, reload };
};
