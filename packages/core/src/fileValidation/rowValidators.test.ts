import { describe, expect, it } from 'vitest';

import { validateBankingRows, validateGeneralLedgerRows } from './rowValidators';
import type { RawBankingRow, RawGeneralLedgerRow } from './types';

/** A fully valid banking row -- each test overrides only the field(s) relevant to what it's
 * testing, so every other field stays known-good and can't incidentally trigger another code. */
const validBankRow = (overrides: Partial<RawBankingRow> = {}): RawBankingRow => ({
  Date: '2026-07-01',
  Description: 'Valid row',
  'Sequence Number': '1',
  Credit: '100.00',
  ...overrides,
});

/** A fully valid GL row -- tests override only what they're testing. */
const validGlRow = (overrides: Partial<RawGeneralLedgerRow> = {}): RawGeneralLedgerRow => ({
  Date: '2026-07-01',
  Memo: 'Office rent',
  Amount: '-100.00',
  ...overrides,
});

const codesOf = (issues: { code: string }[]): string[] => issues.map((issue) => issue.code);

describe('validateBankingRows', () => {
  it('produces no issues and one normalized record for a fully valid row', () => {
    const { issues, normalized } = validateBankingRows([validBankRow()]);

    expect(issues).toEqual([]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      sourceSystem: 'BANK',
      recordId: '1',
      signedAmount: 100,
      direction: 'INFLOW',
      magnitude: 100,
      sourceLineNumber: 1,
    });
  });

  it('BANK_DATE_REQUIRED: flags a blank Date', () => {
    const { issues } = validateBankingRows([validBankRow({ Date: '' })]);
    expect(codesOf(issues)).toContain('BANK_DATE_REQUIRED');
  });

  it('BANK_DATE_FORMAT: flags a non-ISO Date', () => {
    const { issues } = validateBankingRows([validBankRow({ Date: '07/01/2026' })]);
    expect(codesOf(issues)).toContain('BANK_DATE_FORMAT');
  });

  it('BANK_DATE_FUTURE: flags a Date after today', () => {
    const { issues } = validateBankingRows([validBankRow({ Date: '2999-01-01' })]);
    expect(codesOf(issues)).toContain('BANK_DATE_FUTURE');
  });

  it('BANK_DESCRIPTION_REQUIRED: flags a blank Description', () => {
    const { issues } = validateBankingRows([validBankRow({ Description: '' })]);
    expect(codesOf(issues)).toContain('BANK_DESCRIPTION_REQUIRED');
  });

  it('BANK_SEQUENCE_REQUIRED: flags a blank Sequence Number', () => {
    const { issues } = validateBankingRows([validBankRow({ 'Sequence Number': '' })]);
    expect(codesOf(issues)).toContain('BANK_SEQUENCE_REQUIRED');
  });

  it('BANK_SEQUENCE_DUPLICATE: flags the later occurrence, keeps both rows normalized', () => {
    const rows = [
      validBankRow({ 'Sequence Number': '7' }),
      validBankRow({ 'Sequence Number': '7' }),
    ];
    const { issues, normalized } = validateBankingRows(rows);

    expect(issues).toEqual([expect.objectContaining({ code: 'BANK_SEQUENCE_DUPLICATE', rowNumber: 2 })]);
    // Nothing is excluded on a content issue any more -- both rows stay normalized, with the
    // duplicate's own issue carried on its record so it still surfaces downstream.
    expect(normalized).toHaveLength(2);
    expect(normalized[0]?.sourceLineNumber).toBe(1);
    expect(normalized[0]?.issues).toEqual([]);
    expect(normalized[1]?.sourceLineNumber).toBe(2);
    expect(normalized[1]?.issues).toEqual([
      expect.objectContaining({ code: 'BANK_SEQUENCE_DUPLICATE', rowNumber: 2 }),
    ]);
  });

  it('BANK_DEBIT_FORMAT: flags an unparseable Debit', () => {
    const { issues } = validateBankingRows([validBankRow({ Credit: undefined, Debit: 'N/A' })]);
    expect(codesOf(issues)).toContain('BANK_DEBIT_FORMAT');
  });

  it('BANK_CREDIT_FORMAT: flags an unparseable Credit', () => {
    const { issues } = validateBankingRows([validBankRow({ Credit: 'N/A' })]);
    expect(codesOf(issues)).toContain('BANK_CREDIT_FORMAT');
  });

  it('BANK_DEBIT_NEGATIVE: flags a negative Debit', () => {
    const { issues } = validateBankingRows([validBankRow({ Credit: undefined, Debit: '-50.00' })]);
    expect(codesOf(issues)).toContain('BANK_DEBIT_NEGATIVE');
  });

  it('BANK_CREDIT_NEGATIVE: flags a negative Credit', () => {
    const { issues } = validateBankingRows([validBankRow({ Credit: '-50.00' })]);
    expect(codesOf(issues)).toContain('BANK_CREDIT_NEGATIVE');
  });

  it('BANK_NO_AMOUNT: flags a row with neither Debit nor Credit', () => {
    const { issues } = validateBankingRows([validBankRow({ Credit: undefined })]);
    expect(codesOf(issues)).toContain('BANK_NO_AMOUNT');
  });

  it('BANK_BOTH_AMOUNTS: flags a row with both Debit and Credit > 0', () => {
    const { issues } = validateBankingRows([validBankRow({ Debit: '25.00', Credit: '100.00' })]);
    expect(codesOf(issues)).toContain('BANK_BOTH_AMOUNTS');
  });

  it('recognizes standard accounting notation for Debit/Credit amounts', () => {
    const { issues, normalized } = validateBankingRows([
      validBankRow({ Credit: undefined, Debit: '$1,200.00' }),
    ]);
    expect(issues).toEqual([]);
    expect(normalized[0]?.signedAmount).toBe(-1200);
  });

  it('derives transactionType from which of Debit/Credit is populated: Credit -> positive/inflow', () => {
    const { normalized } = validateBankingRows([validBankRow({ Credit: '40.00' })]);
    expect(normalized[0]?.signedAmount).toBe(40);
    expect(normalized[0]?.direction).toBe('INFLOW');
  });

  it('derives transactionType from which of Debit/Credit is populated: Debit -> negative/outflow', () => {
    const { normalized } = validateBankingRows([validBankRow({ Credit: undefined, Debit: '40.00' })]);
    expect(normalized[0]?.signedAmount).toBe(-40);
    expect(normalized[0]?.direction).toBe('OUTFLOW');
  });

  it('BANK_BALANCE_FORMAT: flags a non-decimal Balance', () => {
    const { issues } = validateBankingRows([validBankRow({ Balance: 'N/A' })]);
    expect(codesOf(issues)).toContain('BANK_BALANCE_FORMAT');
  });

  it('BANK_BALANCE_CONTINUITY: flags a Balance break, only when every row has one', () => {
    const rows = [
      validBankRow({ 'Sequence Number': '1', Credit: '100.00', Balance: '1000.00' }),
      // 1000 + 50 should be 1050, not 9999 -- a genuine discontinuity.
      validBankRow({ 'Sequence Number': '2', Credit: '50.00', Balance: '9999.00' }),
    ];
    const { issues } = validateBankingRows(rows);
    expect(issues).toEqual([expect.objectContaining({ code: 'BANK_BALANCE_CONTINUITY', rowNumber: 2 })]);
  });

  it('does not run BANK_BALANCE_CONTINUITY at all when any row lacks a Balance', () => {
    const rows = [
      validBankRow({ 'Sequence Number': '1', Balance: '1000.00' }),
      validBankRow({ 'Sequence Number': '2' }), // no Balance
    ];
    const { issues } = validateBankingRows(rows);
    expect(codesOf(issues)).not.toContain('BANK_BALANCE_CONTINUITY');
  });

  it('Check Number and Reference are optional and pass through to the normalized record', () => {
    const { normalized } = validateBankingRows([
      validBankRow({ 'Check Number': '1052', Reference: 'WT-88421' }),
    ]);
    expect(normalized[0]).toMatchObject({ checkNumber: '1052', referenceNumber: 'WT-88421' });
  });
});

describe('validateGeneralLedgerRows', () => {
  it('produces no issues and one normalized record for a fully valid row', () => {
    const { issues, normalized } = validateGeneralLedgerRows([validGlRow()]);

    expect(issues).toEqual([]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      sourceSystem: 'GL',
      recordId: '1',
      signedAmount: -100,
      direction: 'OUTFLOW',
      magnitude: 100,
      sourceLineNumber: 1,
    });
  });

  it('GL_TXN_DATE_REQUIRED: flags a blank Date', () => {
    const { issues } = validateGeneralLedgerRows([validGlRow({ Date: '' })]);
    expect(codesOf(issues)).toContain('GL_TXN_DATE_REQUIRED');
  });

  it('GL_TXN_DATE_FORMAT: flags a non-ISO Date', () => {
    const { issues } = validateGeneralLedgerRows([validGlRow({ Date: '07/01/2026' })]);
    expect(codesOf(issues)).toContain('GL_TXN_DATE_FORMAT');
  });

  it('GL_TXN_DATE_FUTURE: flags a Date after today', () => {
    const { issues } = validateGeneralLedgerRows([validGlRow({ Date: '2999-01-01' })]);
    expect(codesOf(issues)).toContain('GL_TXN_DATE_FUTURE');
  });

  it('GL_DESCRIPTION_REQUIRED: flags a blank Memo', () => {
    const { issues } = validateGeneralLedgerRows([validGlRow({ Memo: '' })]);
    expect(codesOf(issues)).toContain('GL_DESCRIPTION_REQUIRED');
  });

  it('GL_AMOUNT_FORMAT: flags a blank Amount', () => {
    const { issues } = validateGeneralLedgerRows([validGlRow({ Amount: '' })]);
    expect(codesOf(issues)).toContain('GL_AMOUNT_FORMAT');
  });

  it('GL_AMOUNT_FORMAT: flags an unparseable Amount', () => {
    const { issues } = validateGeneralLedgerRows([validGlRow({ Amount: 'N/A' })]);
    expect(codesOf(issues)).toContain('GL_AMOUNT_FORMAT');
  });

  it('GL_AMOUNT_ZERO: warns on an exact-zero Amount, still normalizes the row', () => {
    const { issues, normalized } = validateGeneralLedgerRows([validGlRow({ Amount: '0.00' })]);
    expect(issues).toEqual([expect.objectContaining({ code: 'GL_AMOUNT_ZERO', severity: 'WARNING' })]);
    expect(normalized).toHaveLength(1);
  });

  it('recognizes standard accounting notation for Amount', () => {
    const { issues, normalized } = validateGeneralLedgerRows([validGlRow({ Amount: '(1,200.00)' })]);
    expect(issues).toEqual([]);
    expect(normalized[0]?.signedAmount).toBe(-1200);
  });

  it('a positive Amount normalizes as INFLOW, matching Bank\'s Credit-positive convention', () => {
    const { normalized } = validateGeneralLedgerRows([validGlRow({ Amount: '300.00' })]);
    expect(normalized[0]?.signedAmount).toBe(300);
    expect(normalized[0]?.direction).toBe('INFLOW');
  });

  it('Num and Name are optional and map to referenceNumber/payeeName', () => {
    const { normalized } = validateGeneralLedgerRows([validGlRow({ Num: '1052', Name: 'Landlord LLC' })]);
    expect(normalized[0]).toMatchObject({ referenceNumber: '1052', payeeName: 'Landlord LLC' });
  });
});
