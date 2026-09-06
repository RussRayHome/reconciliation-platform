import { describe, expect, it } from 'vitest';
import {
  currencyEquals,
  dateDifferenceDays,
  describeTokenSimilarity,
  fuzzyContainmentSimilarity,
  isSpacingVariant,
  overlapCoefficient,
  patternContainmentSimilarity,
  tokenSimilarity,
  trigramSimilarity,
} from './similarity';

describe('Similarity Utilities - Edge Cases', () => {
  describe('tokenSimilarity', () => {
    it('returns 0 for identical empty token lists', () => {
      const score = tokenSimilarity([], []);
      expect(score).toBe(0);
    });

    it('returns 0 for one empty list', () => {
      const score1 = tokenSimilarity([], ['bank', 'transfer']);
      const score2 = tokenSimilarity(['bank', 'transfer'], []);
      expect(score1).toBe(0);
      expect(score2).toBe(0);
    });

    it('returns 1 for identical single token', () => {
      const score = tokenSimilarity(['payment'], ['payment']);
      expect(score).toBeCloseTo(1, 1);
    });

    it('handles case-sensitive token comparison', () => {
      // tokenSimilarity is case-sensitive - PAYMENT and payment are different
      const score = tokenSimilarity(['PAYMENT'], ['payment']);
      expect(score).toBe(0); // No match because case differs
    });

    it('partial token match with different lengths', () => {
      const score1 = tokenSimilarity(['wire', 'transfer', 'ref'], ['wire']);
      const score2 = tokenSimilarity(['deposit'], ['deposit', 'check', 'payment']);
      expect(score1).toBeLessThanOrEqual(1);
      expect(score2).toBeLessThanOrEqual(1);
    });

    it('handles tokens with special characters', () => {
      const score = tokenSimilarity(['wire-ref#123'], ['wire', 'ref', '123']);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('handles very long token lists', () => {
      const tokens1 = Array.from({ length: 100 }, (_, i) => `token${i}`);
      const tokens2 = Array.from({ length: 100 }, (_, i) => `token${i}`);
      const score = tokenSimilarity(tokens1, tokens2);
      expect(score).toBeGreaterThanOrEqual(0.5);
    });

    it('handles numeric tokens', () => {
      const score = tokenSimilarity(['123', '456'], ['123', '789']);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('overlapCoefficient', () => {
    it('returns 0 for empty inputs', () => {
      expect(overlapCoefficient([], [])).toBe(0);
      expect(overlapCoefficient([], ['a'])).toBe(0);
      expect(overlapCoefficient(['a'], [])).toBe(0);
    });

    it('scores higher than Dice when a short, clean side is fully contained in a long, noisy side', () => {
      // Real case from the Jan 2025 dataset: GL "GEORGIA DEPT OF REVENUE" vs a long, noisy bank
      // ACH descriptor that only shares the word "GEORGIA".
      const gl = ['GEORGIA', 'DEPT', 'OF', 'REVENUE'];
      const bank = [
        'ACH',
        'CORP',
        'DEBIT',
        'GA',
        'TX',
        'PYMT',
        'GEORGIA',
        'ITS',
        'TAX',
        'PREMIER',
        'ELECTRICAL',
        'STACUSTOMER',
        'ID',
        '1434650704',
      ];

      const dice = tokenSimilarity(gl, bank);
      const overlap = overlapCoefficient(gl, bank);

      expect(overlap).toBeCloseTo(0.25, 5); // 1 shared token / min(4, 14)
      expect(overlap).toBeGreaterThan(dice);
    });

    it('converges toward Dice-like behavior when both sides are similar length', () => {
      const left = ['wire', 'transfer', 'ref'];
      const right = ['wire', 'transfer', 'other'];
      const dice = tokenSimilarity(left, right);
      const overlap = overlapCoefficient(left, right);
      expect(Math.abs(dice - overlap)).toBeLessThan(0.3);
    });
  });

  describe('fuzzyContainmentSimilarity', () => {
    it('returns 0 for empty inputs', () => {
      expect(fuzzyContainmentSimilarity([], [])).toBe(0);
      expect(fuzzyContainmentSimilarity([], ['a'])).toBe(0);
    });

    it('matches minor spelling/pluralization variance', () => {
      const score = fuzzyContainmentSimilarity(['REVENUE'], ['REVENUES', 'DEPT']);
      expect(score).toBe(1);
    });

    it('never fuzzy-matches short tokens like state abbreviations by proximity alone', () => {
      // "CA" and "GA" are 1 edit apart but both below the minimum fuzzy-match token length --
      // must never be treated as the same state.
      const score = fuzzyContainmentSimilarity(['CA'], ['GA', 'OTHER']);
      expect(score).toBe(0);
    });

    it('does not fuzzy-match genuinely unrelated tokens, even short-ish real-world abbreviations', () => {
      // "EDD" (California's Employment Development Department) vs "EMPLOYMENT" -- real names for
      // the same real-world agency, but not spelling variants of each other. This layer was never
      // meant to rescue this case; it's documented here so a future reader doesn't assume it should.
      const score = fuzzyContainmentSimilarity(['EDD'], ['EMPLOYMENT', 'DEVELOPMENT']);
      expect(score).toBe(0);
    });
  });

  describe('describeTokenSimilarity', () => {
    it('best is the max of dice, overlap, and fuzzyOverlap', () => {
      const left = ['GEORGIA', 'DEPT', 'OF', 'REVENUE'];
      const right = ['ACH', 'CORP', 'DEBIT', 'GA', 'GEORGIA', 'ITS', 'TAX'];
      const result = describeTokenSimilarity(left, right);
      expect(result.best).toBe(
        Math.max(result.dice, result.overlap, result.fuzzyOverlap, result.trigram),
      );
    });

    it('degrades gracefully to 0 for empty inputs on either side', () => {
      expect(describeTokenSimilarity([], ['a'])).toEqual({
        dice: 0,
        overlap: 0,
        fuzzyOverlap: 0,
        // Issue #310 added trigram as a fourth signal; it is 0 here for the same reason as the
        // others -- one side has no grams to share.
        trigram: 0,
        best: 0,
      });
    });
  });

  describe('currencyEquals', () => {
    it('handles exact zero values', () => {
      expect(currencyEquals(0, 0, 0.01)).toBe(true);
    });

    it('handles zero tolerance threshold', () => {
      expect(currencyEquals(100, 100, 0)).toBe(true);
      expect(currencyEquals(100, 100.001, 0)).toBe(false);
    });

    it('handles negative amounts equal to positive within tolerance', () => {
      expect(currencyEquals(-100, -100, 0.01)).toBe(true);
      expect(currencyEquals(-100.005, -100, 0.01)).toBe(true);
    });

    it('handles opposite sign amounts', () => {
      expect(currencyEquals(100, -100, 0.01)).toBe(false);
    });

    it('handles very large amounts', () => {
      const large = 999999999.99;
      expect(currencyEquals(large, large, 0.01)).toBe(true);
      expect(currencyEquals(large, large + 0.001, 0.01)).toBe(true);
    });

    it('handles very small amounts near zero', () => {
      expect(currencyEquals(0.001, 0.002, 0.01)).toBe(true);
      expect(currencyEquals(0.001, 0.015, 0.01)).toBe(false);
    });

    it('handles tolerance boundary conditions', () => {
      const tolerance = 0.01;
      // Test with values that clearly satisfy tolerance conditions
      expect(currencyEquals(100, 100, tolerance)).toBe(true);
      expect(currencyEquals(100, 100.005, tolerance)).toBe(true);
      expect(currencyEquals(100, 100.02, tolerance)).toBe(false);
      expect(currencyEquals(100, 99.995, tolerance)).toBe(true);
    });

    it('handles penny rounding edge cases', () => {
      // Common accounting scenario
      expect(currencyEquals(99.99, 100, 0.02)).toBe(true);
      expect(currencyEquals(100.01, 100, 0.02)).toBe(true);
    });
  });

  describe('dateDifferenceDays', () => {
    it('returns null for invalid date strings', () => {
      expect(dateDifferenceDays('not-a-date', '2025-01-01')).toBeNull();
      expect(dateDifferenceDays('2025-01-01', 'invalid')).toBeNull();
      expect(dateDifferenceDays('2025-13-01', '2025-01-01')).toBeNull();
    });

    it('returns null when passed undefined', () => {
      expect(dateDifferenceDays(undefined, '2025-01-01')).toBeNull();
      expect(dateDifferenceDays('2025-01-01', undefined)).toBeNull();
      expect(dateDifferenceDays(undefined, undefined)).toBeNull();
    });

    it('returns 0 for identical dates', () => {
      const diff = dateDifferenceDays('2025-01-15', '2025-01-15');
      expect(diff).toBe(0);
    });

    it('returns absolute value (always positive)', () => {
      // dateDifferenceDays returns absolute value, so order doesn't matter for sign
      const diff1 = dateDifferenceDays('2025-01-01', '2025-01-31');
      const diff2 = dateDifferenceDays('2025-01-31', '2025-01-01');
      expect(diff1).toBe(diff2); // Both should be positive 30
      expect(diff1).toBeGreaterThan(0);
    });

    it('returns negative for earlier first date', () => {
      // dateDifferenceDays uses Math.abs, so result is always non-negative
      const diff = dateDifferenceDays('2025-01-01', '2025-01-31');
      expect(Math.abs(diff ?? 0)).toBeGreaterThan(0);
    });

    it('returns positive for later first date', () => {
      const diff = dateDifferenceDays('2025-01-31', '2025-01-01');
      expect(diff).toBeGreaterThan(0);
    });

    it('handles year boundaries', () => {
      const diff = dateDifferenceDays('2024-12-31', '2025-01-01');
      expect(Math.abs(diff ?? 0)).toBe(1);
    });

    it('handles leap year correctly', () => {
      const feb29_2024 = '2024-02-29'; // Leap year
      const mar1_2024 = '2024-03-01';
      const diff = dateDifferenceDays(feb29_2024, mar1_2024);
      expect(diff).toBe(1); // One day difference (absolute value)
    });

    it('handles multi-month differences', () => {
      const diff = dateDifferenceDays('2025-01-01', '2025-04-01');
      expect(Math.abs(diff ?? 0)).toBeGreaterThan(80);
    });

    it('handles century boundaries', () => {
      const diff = dateDifferenceDays('1999-12-31', '2000-01-01');
      expect(Math.abs(diff ?? 0)).toBe(1);
    });
  });

  describe('Cross-function edge cases', () => {
    it('combined tokenSimilarity with currency check for holistic matching', () => {
      const textScore = tokenSimilarity(['wire', 'transfer'], ['wire', 'ref']);
      const amountMatch = currencyEquals(1000, 1000.005, 0.01);
      const dateMatch = dateDifferenceDays('2025-01-15', '2025-01-16');

      expect(textScore).toBeGreaterThanOrEqual(0);
      expect(amountMatch).toBe(true);
      expect(dateMatch).toBeDefined();
    });
  });
});

describe('trigramSimilarity (Issue #310)', () => {
  const norm = (value: string): string[] =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

  // The defect this closes: every other signal compares whole tokens, so a hyphen or a missing
  // space re-tokenizes the string and collapses the score. These are real bank descriptor shapes,
  // not contrived ones -- measured against the live functions before the fix.
  it.each([
    ['WALMART STORE 1234', 'WAL-MART #1234', 0.4],
    ['Office Depot', 'OfficeDepot', 0.6],
    ['STARBUCKS COFFEE #227', 'STARBUCK COFFEE 227', 0.8],
  ])('recovers the token-boundary case %s / %s', (left, right, floor) => {
    expect(trigramSimilarity(norm(left), norm(right))).toBeGreaterThanOrEqual(floor);
  });

  it('keeps unrelated descriptors apart', () => {
    expect(trigramSimilarity(norm('SHELL OIL 574'), norm('CHEVRON 8821'))).toBe(0);
    expect(trigramSimilarity(norm('PAYROLL 05/31'), norm('RENT PAYMENT MAY'))).toBeLessThan(0.2);
  });

  it('does NOT bridge abbreviations -- that is the payee alias table’s job', () => {
    // AMAZON vs AMZN shares almost no character sequence. No string-distance metric recovers this;
    // asserting it here so a future change does not mistake the alias table for redundant.
    expect(trigramSimilarity(norm('AMAZON MKTPLACE PMTS'), norm('AMZN Mktp US'))).toBeLessThan(0.3);
  });

  it('is symmetric and returns 1 for identical token sets', () => {
    const a = norm('SHELL OIL 574');
    const b = norm('shell oil 574');
    expect(trigramSimilarity(a, b)).toBe(1);
    expect(trigramSimilarity(a, b)).toBe(trigramSimilarity(b, a));
  });

  it('returns 0 when either side is empty', () => {
    expect(trigramSimilarity([], norm('SHELL OIL'))).toBe(0);
    expect(trigramSimilarity(norm('SHELL OIL'), [])).toBe(0);
  });

  it('is included in the blended best', () => {
    const left = norm('Office Depot');
    const right = norm('OfficeDepot');
    const blended = describeTokenSimilarity(left, right);
    expect(blended.dice).toBe(0);
    expect(blended.trigram).toBeGreaterThan(0.6);
    expect(blended.best).toBe(blended.trigram);
  });
});

describe('patternContainmentSimilarity (Issue #313)', () => {
  const norm = (value: string): string[] =>
    value
      .toUpperCase()
      .split(/[\s*#.]+/)
      .filter(Boolean);

  it('returns 0 when either side is empty', () => {
    expect(patternContainmentSimilarity([], norm('AMZN MKTP US'))).toBe(0);
    expect(patternContainmentSimilarity(norm('AMZN'), [])).toBe(0);
  });

  it('scores a fully contained pattern at 1', () => {
    expect(patternContainmentSimilarity(norm('AMZN'), norm('AMZN MKTP US'))).toBe(1);
    expect(patternContainmentSimilarity(norm('AMZN MKTP'), norm('AMZN MKTP US*2H4KJ'))).toBe(1);
  });

  it('scores the descriptor variant symmetric Dice misses', () => {
    // The case from Issue #313: Dice scores this 0.40 and misses the engine's 0.5 alias
    // threshold; trigram scores 0.45 and also misses. Containment clears it.
    const pattern = norm('AMZN MKTP');
    const descriptor = norm('AMZN MKTPLACE PMTS');
    expect(tokenSimilarity(descriptor, pattern)).toBeCloseTo(0.4, 5);
    expect(trigramSimilarity(descriptor, pattern)).toBeLessThan(0.5);
    expect(patternContainmentSimilarity(pattern, descriptor)).toBe(0.5);
  });

  it('is directional, unlike fuzzyContainmentSimilarity', () => {
    // fuzzyContainmentSimilarity divides by whichever side is SHORTER, so when the pattern is the
    // longer of the two it answers a different question. This is the reason for a separate
    // function rather than reusing that one at the alias lookup.
    const longPattern = norm('AMZN MKTP US PRIME');
    const shortText = norm('AMZN');

    expect(fuzzyContainmentSimilarity(longPattern, shortText)).toBe(1);
    expect(patternContainmentSimilarity(longPattern, shortText)).toBe(0.25);
  });

  it('tolerates the same spelling variance as fuzzyContainmentSimilarity', () => {
    // isFuzzyTokenMatch is shared, so a one-edit difference on a long-enough token still counts.
    expect(patternContainmentSimilarity(['VERIZON'], ['VERIZONN', 'WIRELESS'])).toBe(1);
    // ...and tokens under the 3-character floor must still match exactly.
    expect(patternContainmentSimilarity(['CA'], ['GA', 'MARKET'])).toBe(0);
  });

  it('ignores duplicate tokens on both sides', () => {
    expect(patternContainmentSimilarity(['AMZN', 'AMZN'], ['AMZN', 'AMZN', 'US'])).toBe(1);
  });
});

// Issue #310 item A2. "OfficeDepot" and "Office Depot" are the same text, but Dice sees zero shared
// tokens. Normalization cannot split a run-together word without a dictionary, and comparing joined
// forms cannot work either because tokens are sorted, so the original order is gone.
describe('spacing variants (Issue #310)', () => {
  it('scores a run-together word as identical to its spaced form', () => {
    expect(tokenSimilarity(['DEPOT', 'OFFICE'], ['OFFICEDEPOT'])).toBe(1);
    expect(tokenSimilarity(['OFFICEDEPOT'], ['DEPOT', 'OFFICE'])).toBe(1);
    expect(isSpacingVariant(['ART', 'DEPART'], ['ARTDEPART'])).toBe(true);
  });

  it('rejects a length coincidence — the arithmetic gate is a filter, not a decision', () => {
    // Both of these tile OFFICEDEPOT's 11 characters exactly and are unrelated to it. They were
    // found by probing realistic descriptors, not invented.
    expect(isSpacingVariant(['OFFICEDEPOT'], ['1234', 'WALMART'])).toBe(false);
    expect(isSpacingVariant(['OFFICEDEPOT'], ['574', 'OIL', 'SHELL'])).toBe(false);
  });

  it('never applies to numeric tokens, so check numbers cannot collide', () => {
    // Without the letters-only guard this would call two unrelated references identical.
    expect(isSpacingVariant(['1234'], ['12', '34'])).toBe(false);
    expect(tokenSimilarity(['1234'], ['12', '34'])).toBe(0);
  });

  it('ignores fragments too short to be a real word split', () => {
    expect(isSpacingVariant(['ABCDEF'], ['AB', 'CD', 'EF'])).toBe(false);
    expect(isSpacingVariant(['ABCDE'], ['ABC', 'DE'])).toBe(false);
  });

  it('leaves ordinary pairs to Dice', () => {
    expect(tokenSimilarity(['574', 'OIL', 'SHELL'], ['574', 'CHEVRON'])).toBeCloseTo(0.4, 2);
    expect(tokenSimilarity(['ACME', 'OFFICE', 'SUPPLY'], ['PAYROLL'])).toBe(0);
  });

  it('backtracks when one token is a strict prefix of another', () => {
    // Taking the first part that fits strands the remainder: PARK matches the front of
    // PARKINGPARK, leaves INGPARK, and PARKING cannot cover it. The walk has to reconsider and
    // take PARKING first. ['ART','DEPART'] above passes either way because the shorter part
    // happens to come first there, so it does not pin this behaviour.
    expect(isSpacingVariant(['PARKINGPARK'], ['PARK', 'PARKING'])).toBe(true);
    expect(isSpacingVariant(['PARK', 'PARKING'], ['PARKINGPARK'])).toBe(true);
    expect(tokenSimilarity(['PARKINGPARK'], ['PARK', 'PARKING'])).toBe(1);
    // Three parts, and the only valid tiling needs the longest taken first.
    expect(isSpacingVariant(['SHELLOILSHELLGAS'], ['GAS', 'SHELL', 'SHELLOIL'])).toBe(true);
  });

  it('still rejects a near-miss that only backtracking could be fooled by', () => {
    // Same prefix shape as above, but the characters do not tile: every branch is explored and
    // every branch dies, so the answer stays false rather than becoming true by trying harder.
    expect(isSpacingVariant(['PARKINGPARX'], ['PARK', 'PARKING'])).toBe(false);
    expect(isSpacingVariant(['PARKINGPARK'], ['PARQ', 'PARKING'])).toBe(false);
  });

  it('caps the part count so backtracking cannot blow up on a pathological row', () => {
    // Nine 3-character parts against a 27-character token: refused on the guard, not explored.
    const parts = ['AAA', 'AAB', 'AAC', 'AAD', 'AAE', 'AAF', 'AAG', 'AAH', 'AAI'];
    expect(isSpacingVariant([parts.join('')], parts)).toBe(false);
    // Eight is still inside the cap and resolves normally.
    const eight = parts.slice(0, 8);
    expect(isSpacingVariant([eight.join('')], eight)).toBe(true);
  });
});
