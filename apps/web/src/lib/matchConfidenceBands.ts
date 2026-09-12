import type { MatchConfidence, MatchResult } from '@recon/domain';
import { matchConfidenceLevels } from '@recon/domain';

/**
 * How a candidate pairing is described to a reviewer (UI-10, #449).
 *
 * **Bands come from `confidence`, not from a score threshold** — decided 2026-09-12 after checking
 * the engine. The handoff specified bands at 78% and 95% over a percentage; `MatchResult.score` is
 * a 0–1 rule-precedence rank whose non-exact values top out at 0.87, so a ≥95% band would be
 * permanently empty, and thresholding at 0.78 would silently change which pairs a reviewer sees
 * (dropping the 0.72 Probable rule, adding DateVariance and AmountMismatch pairs).
 *
 * So no percentage is displayed anywhere. A number that looks like a probability and is not is
 * worse than no number — and `confidence` is a real field the engine assigns deliberately.
 *
 * One module because the acceptance criterion is that this model "reads identically on 7a, 7b and
 * 11b". Three screens describing the same pairing differently is the failure it guards against.
 */
export interface MatchConfidenceBand {
  confidence: MatchConfidence;
  /** Short label for a band heading or a pill. */
  label: string;
  /** What the engine actually concluded, in one line the reviewer can act on. */
  meaning: string;
}

const BAND_COPY: Partial<Record<MatchConfidence, Omit<MatchConfidenceBand, 'confidence'>>> = {
  Probable: {
    label: 'Probable',
    meaning: 'Amount and date agree; the description or reference does not fully. Confirm or reject.',
  },
  Ambiguous: {
    label: 'Ambiguous',
    meaning: 'More than one counterpart fits. The engine will not choose between them — you pick.',
  },
  DateVariance: {
    label: 'Date variance',
    meaning: 'Amount and text agree; the dates sit outside the primary window.',
  },
  AmountMismatch: {
    label: 'Amount mismatch',
    meaning: 'The pairing is otherwise sound but the amounts differ. Check for a fee or FX move.',
  },
  TimingDifference: {
    label: 'Timing difference',
    meaning: 'Recorded in different periods. Usually explained by when the item cleared.',
  },
};

const FALLBACK = (confidence: MatchConfidence): Omit<MatchConfidenceBand, 'confidence'> => ({
  label: confidence,
  meaning: 'Reviewed by rule; confirm or reject.',
});

export const describeConfidence = (confidence: MatchConfidence): MatchConfidenceBand => ({
  confidence,
  ...(BAND_COPY[confidence] ?? FALLBACK(confidence)),
});

/**
 * Groups candidates into bands, strongest first.
 *
 * Ordered by `matchConfidenceLevels`, which the domain documents as "ordered from strongest to
 * weakest" — rather than a list hard-coded here, so a new confidence level orders itself correctly
 * instead of silently landing last.
 *
 * Empty bands are omitted: the rail's absent-not-zero rule applies to a band heading reading "0"
 * for the same reason it applies to a badge.
 */
export const groupByConfidence = (
  matches: readonly MatchResult[],
): Array<MatchConfidenceBand & { matches: MatchResult[] }> => {
  const byConfidence = new Map<MatchConfidence, MatchResult[]>();
  for (const match of matches) {
    const bucket = byConfidence.get(match.confidence);
    if (bucket) {
      bucket.push(match);
    } else {
      byConfidence.set(match.confidence, [match]);
    }
  }

  return matchConfidenceLevels
    .filter((confidence) => byConfidence.has(confidence))
    .map((confidence) => ({
      ...describeConfidence(confidence),
      matches: byConfidence.get(confidence) ?? [],
    }));
};
