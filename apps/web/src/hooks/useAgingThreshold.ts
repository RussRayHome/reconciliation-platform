import { useCallback, useEffect, useState } from 'react';

import type { ReconciliationFrequency } from '../lib/agingBuckets';

export interface AgingThresholdSetting {
  thresholdDays: number;
  frequency: ReconciliationFrequency;
}

/** Matches the Monthly-account default `staleOutstandingCheckDays` used elsewhere in the app
 * (see packages/core/src/reporting/chartData.test.ts's "default 45-day Monthly stale threshold"). */
const DEFAULT_SETTING: AgingThresholdSetting = { thresholdDays: 45, frequency: 'Monthly' };

const storageKey = (username: string): string =>
  `reconciliation-platform:aging-threshold:${username || 'anonymous'}`;

const isValidFrequency = (value: unknown): value is ReconciliationFrequency =>
  value === 'Monthly' || value === 'Annual';

const loadSetting = (username: string): AgingThresholdSetting => {
  try {
    const stored = globalThis.localStorage?.getItem(storageKey(username));
    if (!stored) {
      return DEFAULT_SETTING;
    }

    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'thresholdDays' in parsed &&
      'frequency' in parsed &&
      typeof (parsed as { thresholdDays: unknown }).thresholdDays === 'number' &&
      isValidFrequency((parsed as { frequency: unknown }).frequency)
    ) {
      return parsed as AgingThresholdSetting;
    }

    return DEFAULT_SETTING;
  } catch {
    return DEFAULT_SETTING;
  }
};

/** Per-user Open Items Schedule aging threshold + band cadence, persisted to localStorage --
 * mirrors useDensity.ts's shape exactly. A display lens only: never rewrites a stored figure,
 * just which band an already-computed age falls into. */
export function useAgingThreshold(username: string): {
  setting: AgingThresholdSetting;
  setSetting: (next: AgingThresholdSetting) => void;
} {
  const [setting, setSettingState] = useState<AgingThresholdSetting>(() => loadSetting(username));

  useEffect(() => {
    setSettingState(loadSetting(username));
  }, [username]);

  const setSetting = useCallback(
    (next: AgingThresholdSetting) => {
      setSettingState(next);

      try {
        globalThis.localStorage?.setItem(storageKey(username), JSON.stringify(next));
      } catch {
        // Persistence is best-effort; in-memory state remains authoritative for the session.
      }
    },
    [username],
  );

  return { setting, setSetting };
}
