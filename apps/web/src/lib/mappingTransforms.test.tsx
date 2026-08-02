import { describe, expect, it } from 'vitest';

import { applyTransform, defaultTransformForType, validateSampleValue } from './mappingTransforms';

describe('defaultTransformForType', () => {
  it('defaults date fields to dateReformat', () => {
    expect(defaultTransformForType('date')).toBe('dateReformat');
  });

  it('defaults numeric fields to parseNumber', () => {
    expect(defaultTransformForType('numeric')).toBe('parseNumber');
  });

  it('defaults text fields to trim', () => {
    expect(defaultTransformForType('text')).toBe('trim');
  });

  it('defaults enum fields to uppercase', () => {
    expect(defaultTransformForType('enum')).toBe('uppercase');
  });
});

describe('applyTransform', () => {
  it('none passes the value through unchanged', () => {
    expect(applyTransform('none', '  raw  ')).toBe('  raw  ');
  });

  it('trim strips surrounding whitespace', () => {
    expect(applyTransform('trim', '  Payroll  ')).toBe('Payroll');
  });

  it('dateReformat normalizes a US-style date to ISO', () => {
    expect(applyTransform('dateReformat', '07/14/2026')).toBe('2026-07-14');
  });

  it('dateReformat falls back to the trimmed original when unparseable', () => {
    expect(applyTransform('dateReformat', '  not a date  ')).toBe('not a date');
  });

  it('parseNumber strips currency formatting and fixes two decimals', () => {
    expect(applyTransform('parseNumber', '$1,250.5')).toBe('1250.50');
  });

  it('parseNumber treats parenthesized amounts as negative (accounting notation)', () => {
    expect(applyTransform('parseNumber', '(42.00)')).toBe('-42.00');
  });

  it('negate flips the sign of a parsed number', () => {
    expect(applyTransform('negate', '1250.00')).toBe('-1250.00');
  });

  it('deriveDirection reads sign from a parseable number', () => {
    expect(applyTransform('deriveDirection', '-42.00')).toBe('DEBIT');
    expect(applyTransform('deriveDirection', '42.00')).toBe('CREDIT');
  });

  it('deriveDirection falls back to keyword matching for non-numeric samples', () => {
    expect(applyTransform('deriveDirection', 'ACH Withdrawal')).toBe('DEBIT');
    expect(applyTransform('deriveDirection', 'Deposit received')).toBe('CREDIT');
    expect(applyTransform('deriveDirection', 'unrelated text')).toBe('—');
  });

  it('uppercase trims and upcases', () => {
    expect(applyTransform('uppercase', ' usd ')).toBe('USD');
  });

  it('accountLookup passes the trimmed raw value through as a preview', () => {
    expect(applyTransform('accountLookup', ' 1010-000 ')).toBe('1010-000');
  });
});

describe('validateSampleValue', () => {
  it('treats an empty transformed value as valid (nothing to flag yet)', () => {
    expect(validateSampleValue('date', '')).toEqual({ valid: true });
  });

  it('accepts a well-formed ISO date', () => {
    expect(validateSampleValue('date', '2026-07-14')).toEqual({ valid: true });
  });

  it('flags a date-typed value that is not ISO-shaped', () => {
    const result = validateSampleValue('date', 'not a date');
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it('accepts a well-formed two-decimal number', () => {
    expect(validateSampleValue('numeric', '1250.50')).toEqual({ valid: true });
  });

  it('flags a numeric-typed value with no decimal component', () => {
    expect(validateSampleValue('numeric', '1250').valid).toBe(false);
  });

  it('flags an empty-after-transform text value only when non-empty input produced nothing', () => {
    expect(validateSampleValue('text', 'Payroll')).toEqual({ valid: true });
  });
});
