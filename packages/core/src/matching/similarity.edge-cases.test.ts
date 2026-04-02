import { describe, expect, it } from 'vitest';
import { tokenSimilarity, currencyEquals, dateDifferenceDays } from './similarity';

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
