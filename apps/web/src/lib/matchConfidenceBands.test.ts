import { describe, expect, it } from 'vitest';

import type { MatchResult } from '@recon/domain';

import { describeConfidence, groupByConfidence } from './matchConfidenceBands';

const match = (confidence: MatchResult['confidence'], id: string = confidence): MatchResult =>
  ({ id, confidence, disposition: 'ProbableMatch', ruleName: 'r', score: 0.78 }) as MatchResult;

describe('matchConfidenceBands', () => {
  // The whole point of the 2026-09-12 decision: `score` is a rule-precedence rank, so any "%" on
  // screen would imply a calibrated likelihood the engine does not compute. If a percentage ever
  // appears in this module's copy, that decision has been quietly reversed.
  it('never describes a band with a percentage', () => {
    for (const confidence of ['Probable', 'Ambiguous', 'DateVariance', 'AmountMismatch'] as const) {
      const band = describeConfidence(confidence);
      expect(band.label).not.toMatch(/%|\d/);
      expect(band.meaning).not.toMatch(/%/);
    }
  });

  it('orders bands strongest first, using the domain ordering', () => {
    const bands = groupByConfidence([
      match('Ambiguous'),
      match('Probable'),
      match('AmountMismatch'),
    ]);

    // matchConfidenceLevels is documented as strongest -> weakest; Probable precedes
    // AmountMismatch precedes Ambiguous there.
    expect(bands.map((b) => b.confidence)).toEqual(['Probable', 'AmountMismatch', 'Ambiguous']);
  });

  // Same rule the rail badges follow: a band heading reading "0" is noise, so the band is absent.
  it('omits bands with nothing in them', () => {
    const bands = groupByConfidence([match('Probable')]);

    expect(bands).toHaveLength(1);
    expect(bands[0]?.matches).toHaveLength(1);
  });

  it('counts every candidate exactly once', () => {
    const bands = groupByConfidence([
      match('Probable', 'a'),
      match('Probable', 'b'),
      match('Ambiguous', 'c'),
    ]);

    expect(bands.reduce((total, band) => total + band.matches.length, 0)).toBe(3);
  });

  // A confidence with no copy must still band rather than vanish -- losing a candidate off the
  // screen is far worse than showing it under a plain label.
  it('falls back to the raw level for a confidence it has no copy for', () => {
    const bands = groupByConfidence([match('Unmatched')]);

    expect(bands).toHaveLength(1);
    expect(bands[0]?.label).toBe('Unmatched');
    expect(bands[0]?.meaning).toBeTruthy();
  });
});
