import { describe, expect, it } from 'vitest';

import { parseBankAccountLast4FromFilename } from './bankAccountFilename';

describe('parseBankAccountLast4FromFilename', () => {
  it('extracts the last 4 digits when the leading token is exactly 4 digits', () => {
    expect(parseBankAccountLast4FromFilename('4321_bank-export.csv')).toBe('4321');
  });

  it('extracts the last 4 digits when the leading token is a longer account number', () => {
    expect(parseBankAccountLast4FromFilename('123214321-Chase-Activity.xlsx')).toBe('4321');
  });

  it('accepts a hyphen delimiter', () => {
    expect(parseBankAccountLast4FromFilename('4321-Chase-Activity.xlsx')).toBe('4321');
  });

  it('accepts an underscore delimiter', () => {
    expect(parseBankAccountLast4FromFilename('4321_Chase_Activity.xlsx')).toBe('4321');
  });

  it('returns null when there is no delimiter after the leading digits', () => {
    expect(parseBankAccountLast4FromFilename('4321bank.csv')).toBeNull();
  });

  it('returns null when the digits are not at the start of the filename', () => {
    expect(parseBankAccountLast4FromFilename('bank_4321.csv')).toBeNull();
  });

  it('returns null when the leading digit run is shorter than 4 digits', () => {
    expect(parseBankAccountLast4FromFilename('42_bank.csv')).toBeNull();
  });

  it('returns null for a filename with no leading digits at all', () => {
    expect(parseBankAccountLast4FromFilename('checking-account.csv')).toBeNull();
  });
});
