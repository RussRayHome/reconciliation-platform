import { describe, expect, it } from 'vitest';

import { parseApEntityIdFromFilename } from './apEntityFilename';

describe('parseApEntityIdFromFilename', () => {
  it('extracts an alphanumeric entity id delimited by an underscore', () => {
    expect(parseApEntityIdFromFilename('E100_ap-export.csv')).toBe('E100');
  });

  it('extracts an alphanumeric entity id delimited by a hyphen', () => {
    expect(parseApEntityIdFromFilename('E100-AcmeCorp-Subledger.xlsx')).toBe('E100');
  });

  it('extracts a purely numeric entity id', () => {
    expect(parseApEntityIdFromFilename('100_ap-export.csv')).toBe('100');
  });

  it('returns null when there is no delimiter after the leading token', () => {
    expect(parseApEntityIdFromFilename('E100apexport.csv')).toBeNull();
  });

  it('returns null when the delimiter after the leading token is neither - nor _', () => {
    expect(parseApEntityIdFromFilename('E100.ap-export.csv')).toBeNull();
  });

  it('returns null for a filename with no leading alphanumeric token at all', () => {
    expect(parseApEntityIdFromFilename('-ap-export.csv')).toBeNull();
  });
});
