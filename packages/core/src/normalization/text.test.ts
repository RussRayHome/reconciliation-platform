import { describe, expect, it } from 'vitest';

import type { TextNormalizationConfig } from '@recon/domain';

import { buildComparisonTokens, normalizeText } from './text';

const allOff: TextNormalizationConfig = {
  uppercase: false,
  stripPunctuation: false,
  collapseWhitespace: false,
  removeStopWords: false,
  stopWords: [],
};

describe('normalizeText', () => {
  it('returns empty string for undefined input', () => {
    expect(normalizeText(undefined, allOff)).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(normalizeText('', allOff)).toBe('');
  });

  it('applies uppercase when configured', () => {
    expect(normalizeText('hello world', { ...allOff, uppercase: true })).toBe('HELLO WORLD');
  });

  it('leaves case unchanged when uppercase is false', () => {
    expect(normalizeText('Hello World', allOff)).toBe('Hello World');
  });

  it('strips punctuation from already-uppercased input', () => {
    const result = normalizeText('ACME, INC. #4432', { ...allOff, stripPunctuation: true });
    expect(result).toBe('ACME  INC   4432');
  });

  it('collapses runs of whitespace to a single space and trims edges', () => {
    expect(normalizeText('  hello   world  ', { ...allOff, collapseWhitespace: true })).toBe(
      'hello world',
    );
  });

  it('removes configured stop words (matched case-insensitively)', () => {
    const config: TextNormalizationConfig = {
      ...allOff,
      uppercase: true,
      removeStopWords: true,
      stopWords: ['the', 'and'],
    };
    expect(normalizeText('THE QUICK AND FOX', config)).toBe('QUICK FOX');
  });

  it('preserves non-stop tokens when removeStopWords is true', () => {
    const config: TextNormalizationConfig = {
      ...allOff,
      uppercase: true,
      removeStopWords: true,
      stopWords: ['INC', 'LLC'],
    };
    expect(normalizeText('ACME INC CORP', config)).toBe('ACME CORP');
  });

  it('applies all flags in correct composition order', () => {
    const config: TextNormalizationConfig = {
      uppercase: true,
      stripPunctuation: true,
      collapseWhitespace: true,
      removeStopWords: true,
      stopWords: ['INC', 'LLC'],
    };
    // uppercase → 'ACME, INC. LLC  PAYMENT'
    // stripPunctuation → 'ACME  INC  LLC  PAYMENT'
    // collapseWhitespace → 'ACME INC LLC PAYMENT'
    // removeStopWords → 'ACME PAYMENT'
    expect(normalizeText('Acme, Inc. LLC  Payment', config)).toBe('ACME PAYMENT');
  });

  it('returns trimmed output even when no flags are active', () => {
    expect(normalizeText('  text  ', allOff)).toBe('text');
  });
});

describe('buildComparisonTokens', () => {
  it('returns empty array when all inputs are undefined', () => {
    expect(buildComparisonTokens([undefined, undefined], allOff)).toEqual([]);
  });

  it('returns empty array when all inputs normalize to empty strings', () => {
    expect(buildComparisonTokens(['', '   '], { ...allOff, collapseWhitespace: true })).toEqual([]);
  });

  it('returns sorted unique tokens from a single value', () => {
    expect(buildComparisonTokens(['banana apple cherry'], allOff)).toEqual([
      'apple',
      'banana',
      'cherry',
    ]);
  });

  it('deduplicates tokens that appear in multiple input values', () => {
    expect(buildComparisonTokens(['hello world', 'world foo'], allOff)).toEqual([
      'foo',
      'hello',
      'world',
    ]);
  });

  it('filters out empty string values before tokenizing', () => {
    expect(buildComparisonTokens(['', 'hello', undefined], allOff)).toEqual(['hello']);
  });

  it('applies normalization config to each value before splitting into tokens', () => {
    const config: TextNormalizationConfig = { ...allOff, uppercase: true };
    expect(buildComparisonTokens(['hello', 'world'], config)).toEqual(['HELLO', 'WORLD']);
  });

  it('deduplicates tokens that are equal after normalization', () => {
    const config: TextNormalizationConfig = { ...allOff, uppercase: true };
    expect(buildComparisonTokens(['Acme', 'ACME'], config)).toEqual(['ACME']);
  });
});

// Issue #310: `punctuationPattern` turns every non-alphanumeric into a space, so a hyphen inside a
// word split it in two. A hyphen between letters is a spelling variant of one word; a hyphen next to
// digits separates parts that mean something on their own.
describe('intra-word hyphens (Issue #310)', () => {
  // Matches the shipped defaults (config/default-config.ts) without importing @recon/config, which
  // this file deliberately avoids depending on.
  const config: TextNormalizationConfig = {
    uppercase: true,
    stripPunctuation: true,
    collapseWhitespace: true,
    removeStopWords: true,
    stopWords: ['THE', 'AND', 'INC', 'LLC', 'PAYMENT', 'PURCHASE', 'ACH'],
  };
  const tokens = (value: string): string[] => buildComparisonTokens([value], config);

  it('joins a hyphen between two letters, so WAL-MART matches WALMART', () => {
    expect(tokens('WAL-MART #1234')).toEqual(['1234', 'WALMART']);
    expect(tokens('E-COMMERCE FEE')).toEqual(['ECOMMERCE', 'FEE']);
  });

  it('still splits a hyphen next to digits, so INV-993 keeps its invoice number', () => {
    // Regression guard: joining this into INV993 destroyed the shared 993 token that links bank
    // "WIRE VENDOR ALPHA INV-993" to GL "Invoice 993 payment", and the pair's AmountMismatch
    // exception disappeared. The whole unit suite caught it.
    expect(tokens('WIRE VENDOR ALPHA INV-993')).toContain('993');
    expect(tokens('WIRE VENDOR ALPHA INV-993')).toContain('INV');
    expect(tokens('WIRE VENDOR ALPHA INV-993')).not.toContain('INV993');
  });

  it('leaves dates alone — digits on both sides is not a spelling variant', () => {
    expect(tokens('PAYMENT 2025-03-04')).toEqual(['03', '04', '2025']);
  });

  it('leaves a spaced separator hyphen alone', () => {
    expect(tokens('ACME - INVOICE 4471')).toEqual(['4471', 'ACME', 'INVOICE']);
  });
});
