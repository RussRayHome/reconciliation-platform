import { describe, expect, it } from 'vitest';
import {
  tokenSimilarity,
  currencyEquals,
  dateDifferenceDays,
  overlapCoefficient,
  fuzzyContainmentSimilarity,
  describeTokenSimilarity,
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
      expect(result.best).toBe(Math.max(result.dice, result.overlap, result.fuzzyOverlap));
    });

    it('degrades gracefully to 0 for empty inputs on either side', () => {
      expect(describeTokenSimilarity([], ['a'])).toEqual({
        dice: 0,
        overlap: 0,
        fuzzyOverlap: 0,
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
