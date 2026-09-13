import { useEffect, useState } from 'react';

import {
  getReplayEstimateRequest,
  listReplayPeriodsRequest,
  ReplayUnavailableError,
  type ReplayablePeriodItem,
  type ReplayEstimateItem,
} from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';

/**
 * What a draft rule version would have produced against an already-closed period (ADR-0018, #533).
 *
 * Renders on the 2b approver moment — beneath the version header while a draft is pending — because
 * that is the only place the numbers can change a decision. The change applies next run onward with
 * no retro-matching, so this is the **only** view of its consequences anyone gets before it is live.
 *
 * Three rules this component exists to keep:
 *
 * 1. **It is an estimate, never a forecast.** A dry run against historical data, which carries
 *    different transactions from the next run. The panel names the period it used so the reader can
 *    see it is history rather than a prediction.
 * 2. **Absent is not zero.** "No closed period yet" and "replayed, no measurable difference" are
 *    different statements and read differently. Three zeros standing in for the first would say
 *    "this change does nothing".
 * 3. **Deltas are draft minus active**, signed, with counts and money formatted as what they are.
 */
export function ReplayEstimatePanel({
  versionId,
}: Readonly<{
  /** The DRAFT under review. */
  versionId: string;
}>) {
  const [periods, setPeriods] = useState<ReplayablePeriodItem[] | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<ReplayEstimateItem | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReplayPeriodsRequest(versionId)
      .then((found) => {
        if (cancelled) return;
        setPeriods(found);
        // Default to the most recent close, which the endpoint already orders first.
        setSelectedRunId(found[0]?.runId ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPeriods([]);
        setLoadError(
          error instanceof Error ? error.message : 'Could not load the periods to replay against.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  useEffect(() => {
    if (!selectedRunId) return;
    let cancelled = false;
    setIsComputing(true);
    setUnavailable(null);
    setEstimate(null);
    getReplayEstimateRequest(versionId, selectedRunId)
      .then((found) => {
        if (!cancelled) setEstimate(found);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ReplayUnavailableError) {
          setUnavailable(error.message);
          return;
        }
        setLoadError(error instanceof Error ? error.message : 'Could not replay this period.');
      })
      .finally(() => {
        if (!cancelled) setIsComputing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [versionId, selectedRunId]);

  if (periods === null) {
    return (
      <div className="replay-estimate" aria-busy="true">
        <p className="replay-estimate__status">Looking for a closed period to replay against…</p>
      </div>
    );
  }

  if (periods.length === 0) {
    return (
      <div className="replay-estimate" role="status">
        <h4 className="replay-estimate__title">Replay estimate</h4>
        <p className="replay-estimate__status">
          {loadError ??
            'No closed period yet, so there is nothing to replay this against. The estimate appears once a period has been closed.'}
        </p>
      </div>
    );
  }

  const selected = periods.find((period) => period.runId === selectedRunId);

  return (
    <div className="replay-estimate">
      <div className="replay-estimate__head">
        <h4 className="replay-estimate__title">Replay estimate</h4>
        <label className="replay-estimate__picker">
          <span className="visually-hidden">Period to replay against</span>
          <select
            value={selectedRunId ?? ''}
            onChange={(event) => setSelectedRunId(event.target.value)}
          >
            {periods.map((period) => (
              <option key={period.runId} value={period.runId}>
                {period.label}
                {period.accountIdentifier ? ` · ${period.accountIdentifier}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* The period is named, not implied. This is what stops the panel reading as a prediction
          about the next run, which carries different transactions entirely. */}
      <p className="replay-estimate__basis">
        Against <strong>{selected?.label ?? 'the selected period'}</strong>
        {selected?.closedAt ? `, closed ${formatShortDate(selected.closedAt)}` : ''} — what this
        draft would have produced, not what the next run will.
      </p>

      {loadError ? (
        <p className="replay-estimate__status" role="alert">
          {loadError}
        </p>
      ) : null}

      {isComputing ? (
        <p className="replay-estimate__status" aria-busy="true">
          Replaying this period…
        </p>
      ) : null}

      {unavailable ? (
        <p className="replay-estimate__status" role="status">
          {unavailable}
        </p>
      ) : null}

      {estimate && !isComputing && !unavailable ? <ReplayDeltas estimate={estimate} /> : null}
    </div>
  );
}

const countPhrase = (delta: number, noun: string, nounPlural: string): string => {
  const magnitude = Math.abs(delta);
  const word = magnitude === 1 ? noun : nounPlural;
  if (delta === 0) return `the same ${nounPlural}`;
  return delta < 0 ? `${magnitude} fewer ${word}` : `${magnitude} more ${word}`;
};

function ReplayDeltas({ estimate }: Readonly<{ estimate: ReplayEstimateItem }>) {
  const exposure = Number(estimate.unresolvedExposureDelta);
  const unchanged =
    estimate.exceptionsDelta === 0 && estimate.probableMatchesDelta === 0 && exposure === 0;

  if (unchanged) {
    // Deliberately not three zeros. "Replayed and found nothing" is a real result; "nothing to
    // replay against" is the absence handled above, and the two must not look alike.
    return (
      <p className="replay-estimate__unchanged" role="status">
        No measurable difference against this period.
      </p>
    );
  }

  return (
    <ul className="replay-estimate__deltas">
      <li>
        <span
          className="replay-estimate__delta-value"
          data-direction={direction(estimate.exceptionsDelta)}
        >
          {countPhrase(estimate.exceptionsDelta, 'exception', 'exceptions')}
        </span>
      </li>
      <li>
        <span
          className="replay-estimate__delta-value"
          data-direction={direction(estimate.probableMatchesDelta)}
        >
          {countPhrase(estimate.probableMatchesDelta, 'probable match', 'probable matches')}
        </span>
      </li>
      <li>
        <span className="replay-estimate__delta-value" data-direction={direction(exposure)}>
          {exposure === 0
            ? 'the same exposure'
            : `${formatCurrency(Math.abs(exposure))} ${exposure < 0 ? 'less' : 'more'} exposure`}
        </span>
      </li>
    </ul>
  );
}

/** Fewer/less is the improving direction for all three measures here, so one helper serves. */
const direction = (delta: number): 'down' | 'up' | 'flat' =>
  delta === 0 ? 'flat' : delta < 0 ? 'down' : 'up';
