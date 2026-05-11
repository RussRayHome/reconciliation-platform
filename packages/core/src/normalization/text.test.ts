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
