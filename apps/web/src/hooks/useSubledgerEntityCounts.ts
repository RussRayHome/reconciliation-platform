import { useEffect, useState } from 'react';

import { listSubledgerEntitiesRequest } from '../lib/api';

export interface SubledgerEntityCounts {
  /** Null means "not known" -- still loading, or the registry could not be read. Distinct from 0,
   * which means "none registered": under the rail's absent-not-zero rule both render no badge,
   * but only one of them is a fact about the organization. */
  ap: number | null;
  ar: number | null;
}

/**
 * Active AP and AR entity counts for the nav rail's badges (UI-1 item 4, #400).
 *
 * **Fetched once at mount, not per navigation.** The rail renders on every in-app screen, so a
 * per-render fetch would put two requests behind every click for what is an informational count on
 * a registry. Mount-scoped was the product owner's call over leaving the badges absent.
 *
 * Active-only on purpose, and for the same reason `useReconciliationAccounts` defaults that way: a
 * deactivated entity stops being offered for new assignments, and the registry screen leads with
 * its own active count ("N active · M deactivated"). The rail must not disagree with the screen it
 * opens.
 *
 * A failure is swallowed into `null` rather than surfaced. This is decoration on a navigation
 * element -- there is nothing the user would do with a "could not load entity counts" error in the
 * rail, and the registry screen reports its own load failure properly when they go there.
 */
export const useSubledgerEntityCounts = (): SubledgerEntityCounts => {
  const [counts, setCounts] = useState<SubledgerEntityCounts>({ ap: null, ar: null });

  useEffect(() => {
    let cancelled = false;

    // allSettled, not all: one registry failing must not blank the other's badge.
    void Promise.allSettled([
      listSubledgerEntitiesRequest('ap', { activeOnly: true }),
      listSubledgerEntitiesRequest('ar', { activeOnly: true }),
    ]).then(([ap, ar]) => {
      if (cancelled) return;
      setCounts({
        ap: ap.status === 'fulfilled' ? ap.value.length : null,
        ar: ar.status === 'fulfilled' ? ar.value.length : null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return counts;
};
