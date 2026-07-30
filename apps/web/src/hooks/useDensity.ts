import { useCallback, useEffect, useState } from 'react';

export type Density = 'comfortable' | 'compact';

const storageKey = (username: string): string =>
  `reconciliation-platform:density:${username || 'anonymous'}`;

const loadDensity = (username: string): Density => {
  try {
    return globalThis.localStorage?.getItem(storageKey(username)) === 'compact'
      ? 'compact'
      : 'comfortable';
  } catch {
    return 'comfortable';
  }
};

/** Per-user display density preference, persisted to localStorage. */
export function useDensity(username: string): {
  density: Density;
  setDensity: (density: Density) => void;
} {
  const [density, setDensityState] = useState<Density>(() => loadDensity(username));

  useEffect(() => {
    setDensityState(loadDensity(username));
  }, [username]);

  const setDensity = useCallback(
    (next: Density) => {
      setDensityState(next);

      try {
        globalThis.localStorage?.setItem(storageKey(username), next);
      } catch {
        // Persistence is best-effort; in-memory state remains authoritative for the session.
      }
    },
    [username],
  );

  return { density, setDensity };
}
