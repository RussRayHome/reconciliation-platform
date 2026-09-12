import { useEffect, useMemo, useState } from 'react';

import type { ExceptionItem } from '@recon/domain';

import {
  SAVED_VIEWS_CHANGED_EVENT,
  loadSavedViews,
  matchesFacets,
  matchesQuery,
  toExceptionDisplay,
  type SavedTriageView,
} from '../lib/exceptionTriage';

/**
 * Saved triage views, kept fresh across changes, each annotated with how many of this run's
 * exceptions it matches.
 *
 * Lifted out of `NavRail.tsx` by UI-4 (#403) so Runs home's Saved views panel and the rail share
 * one implementation. They must: a count on the panel that disagreed with the list it opens is
 * worse than showing no count, and two copies of the same filter logic drift the moment one of
 * them is touched. The counts come from the same `matchesFacets`/`matchesQuery` the triage screen
 * filters with, for the same reason.
 */
export function useSavedViewCounts(
  exceptions: ExceptionItem[],
): Array<{ view: SavedTriageView; count: number }> {

  const [savedViews, setSavedViews] = useState<SavedTriageView[]>(() => loadSavedViews());

  useEffect(() => {
    const refreshSavedViews = (): void => {
      setSavedViews(loadSavedViews());
    };

    globalThis.addEventListener?.(SAVED_VIEWS_CHANGED_EVENT, refreshSavedViews);

    return () => {
      globalThis.removeEventListener?.(SAVED_VIEWS_CHANGED_EVENT, refreshSavedViews);
    };
  }, []);

  const displays = useMemo(() => exceptions.map(toExceptionDisplay), [exceptions]);

  return useMemo(
    () =>
      savedViews.map((view) => ({
        view,
        count: displays.filter(
          (display) =>
            matchesFacets(display, view.facets) &&
            matchesQuery(display, view.query.trim().toUpperCase()),
        ).length,
      })),
    [displays, savedViews],
  );
}
