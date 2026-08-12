import { describe, expect, it } from 'vitest';

import { checkColumnOrder, checkHeaderPresent } from './structuralGates';

const REQUIRED = ['a', 'b', 'c'] as const;
const ALL_KNOWN = ['a', 'b', 'c', 'optional'] as const;

describe('checkHeaderPresent', () => {
  it('STRUCT_HEADER_MISSING: flags a completely empty file (no header row at all)', () => {
    const issues = checkHeaderPresent([], ALL_KNOWN);
    expect(issues).toEqual([expect.objectContaining({ code: 'STRUCT_HEADER_MISSING', severity: 'ERROR' })]);
  });

  it('STRUCT_HEADER_MISSING: flags a first row that reads as data, not a header', () => {
    const issues = checkHeaderPresent(['TXN-1', '100.00', 'USD'], ALL_KNOWN);
    expect(issues).toEqual([expect.objectContaining({ code: 'STRUCT_HEADER_MISSING', severity: 'ERROR' })]);
  });

  it('passes when at least one known column is present', () => {
    expect(checkHeaderPresent(['a', 'unexpected'], ALL_KNOWN)).toEqual([]);
  });

  it('passes when only an optional (non-required) known column is present', () => {
    expect(checkHeaderPresent(['optional', 'unexpected'], ALL_KNOWN)).toEqual([]);
  });

  it('passes when every known column is present', () => {
    expect(checkHeaderPresent([...ALL_KNOWN], ALL_KNOWN)).toEqual([]);
  });
});

describe('checkColumnOrder', () => {
  it('produces no issues for an exact match of required columns', () => {
    expect(checkColumnOrder([...REQUIRED], REQUIRED, ALL_KNOWN)).toEqual([]);
  });

  it('STRUCT_COLUMN_MISSING: flags each required column that is absent', () => {
    const issues = checkColumnOrder(['a', 'c'], REQUIRED, ALL_KNOWN);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'STRUCT_COLUMN_MISSING', field: 'b', severity: 'ERROR' }),
    ]);
  });

  it('does NOT flag an optional column that is entirely absent -- spec §1: "missing/misordered required columns are an error"', () => {
    const issues = checkColumnOrder([...REQUIRED], REQUIRED, ALL_KNOWN);
    expect(issues.some((issue) => issue.field === 'optional')).toBe(false);
  });

  it('does NOT flag a present optional column as STRUCT_COLUMN_UNKNOWN', () => {
    const issues = checkColumnOrder(['a', 'b', 'optional', 'c'], REQUIRED, ALL_KNOWN);
    expect(issues.some((issue) => issue.code === 'STRUCT_COLUMN_UNKNOWN')).toBe(false);
  });

  it('STRUCT_COLUMN_ORDER: flags required columns present but out of the required relative order', () => {
    const issues = checkColumnOrder(['b', 'a', 'c'], REQUIRED, ALL_KNOWN);
    expect(issues.filter((issue) => issue.code === 'STRUCT_COLUMN_ORDER')).not.toHaveLength(0);
    expect(issues.every((issue) => issue.severity === 'ERROR')).toBe(true);
  });

  it('STRUCT_COLUMN_UNKNOWN: warns on an extra, genuinely unrecognized column without blocking', () => {
    const issues = checkColumnOrder(['a', 'b', 'c', 'mystery'], REQUIRED, ALL_KNOWN);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'STRUCT_COLUMN_UNKNOWN', field: 'mystery', severity: 'WARNING' }),
    ]);
  });

  it('an unrecognized column inserted between two correctly-ordered required columns does not itself trigger STRUCT_COLUMN_ORDER', () => {
    const issues = checkColumnOrder(['a', 'mystery', 'b', 'c'], REQUIRED, ALL_KNOWN);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'STRUCT_COLUMN_UNKNOWN', field: 'mystery' }),
    ]);
  });

  it('a single missing required column does not cascade into order errors for every later column', () => {
    const issues = checkColumnOrder(['a', 'c'], REQUIRED, ALL_KNOWN);
    expect(issues).toEqual([expect.objectContaining({ code: 'STRUCT_COLUMN_MISSING', field: 'b' })]);
    expect(issues.some((issue) => issue.code === 'STRUCT_COLUMN_ORDER')).toBe(false);
  });

  it('combines missing, order, and unknown findings in one pass', () => {
    // Missing 'a'; 'c' before 'b' (out of order); 'mystery' unknown.
    const issues = checkColumnOrder(['c', 'b', 'mystery'], REQUIRED, ALL_KNOWN);
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain('STRUCT_COLUMN_MISSING');
    expect(codes).toContain('STRUCT_COLUMN_ORDER');
    expect(codes).toContain('STRUCT_COLUMN_UNKNOWN');
  });
});
