import { describe, expect, it } from 'vitest';

import { parseSubledgerEntityIdFromFilename } from './subledgerEntityFilename';

describe('parseSubledgerEntityIdFromFilename', () => {
  it('extracts an alphanumeric entity id delimited by an underscore', () => {
    expect(parseSubledgerEntityIdFromFilename('E100_ap-export.csv')).toBe('E100');
  });

  it('extracts an alphanumeric entity id delimited by a hyphen', () => {
    expect(parseSubledgerEntityIdFromFilename('E100-AcmeCorp-Subledger.xlsx')).toBe('E100');
  });

  it('extracts a purely numeric entity id', () => {
    expect(parseSubledgerEntityIdFromFilename('100_ap-export.csv')).toBe('100');
  });

  it('returns null when there is no delimiter after the leading token', () => {
    expect(parseSubledgerEntityIdFromFilename('E100apexport.csv')).toBeNull();
  });

  it('returns null when the delimiter after the leading token is neither - nor _', () => {
    expect(parseSubledgerEntityIdFromFilename('E100.ap-export.csv')).toBeNull();
  });

  it('returns null for a filename with no leading alphanumeric token at all', () => {
    expect(parseSubledgerEntityIdFromFilename('-ap-export.csv')).toBeNull();
  });
});
