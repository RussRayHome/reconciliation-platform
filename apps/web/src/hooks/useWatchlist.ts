import { useCallback, useEffect, useState } from 'react';

const storageKey = (runId: string): string => `reconciliation-platform:watchlist:${runId}`;

const loadStarredIds = (runId: string): string[] => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(runId));

    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

/** Per-run starred exception ids, applied optimistically and persisted to localStorage. */
export function useWatchlist(runId: string | undefined): {
  starredIds: string[];
  toggleStar: (exceptionId: string) => void;
} {
  const [starredIds, setStarredIds] = useState<string[]>(() =>
    runId ? loadStarredIds(runId) : [],
  );

  useEffect(() => {
    setStarredIds(runId ? loadStarredIds(runId) : []);
  }, [runId]);

  const toggleStar = useCallback(
    (exceptionId: string) => {
      if (!runId) {
        return;
      }

      setStarredIds((current) => {
        const next = current.includes(exceptionId)
          ? current.filter((id) => id !== exceptionId)
          : [...current, exceptionId];

        try {
          globalThis.localStorage?.setItem(storageKey(runId), JSON.stringify(next));
        } catch {
          // Persistence is best-effort; in-memory state remains authoritative for the session.
        }

        return next;
      });
    },
    [runId],
  );

  return { starredIds, toggleStar };
}
