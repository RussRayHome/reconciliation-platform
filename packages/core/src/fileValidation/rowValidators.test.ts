import { describe, expect, it } from 'vitest';

import { isIsoDate } from './primitives';
import { validateBankingRows, validateBillingRows, validateGeneralLedgerRows } from './rowValidators';
import type { RawApBillingRow, RawBankingRow, RawGeneralLedgerRow } from './types';

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

/** A fully valid AP/Billing row -- tests override only what they're testing. */
const validBillingRow = (overrides: Partial<RawApBillingRow> = {}): RawApBillingRow => ({
  'Entity Id': 'E100',
  'Vendor Id': 'V001',
  'Vendor Name': 'Acme Supplies',
  'Doc Type': 'Bill',
  'Doc No': 'B-1001',
  'Doc Date': '2026-07-01',
  'Due Date': '2026-07-31',
  Amount: '500.00',
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

  it('a blank or malformed Date still produces a valid ISO date on the normalized record, not a raw passthrough', () => {
    // Regression: `date` lands in canonical_record.txn_date, a Postgres `DATE NOT NULL` column.
    // Passing a blank or non-ISO string straight through (rather than falling back to a valid
    // date) fails that INSERT outright instead of surfacing as a reviewable issue -- caught by
    // CI e2e, not by this file's other tests, since they only assert on `issues`, not `date`.
    const blank = validateBankingRows([validBankRow({ Date: '' })]).normalized[0];
    const malformed = validateBankingRows([validBankRow({ Date: '07/01/2026' })]).normalized[0];

    expect(blank?.date).not.toBe('');
    expect(isIsoDate(blank?.date ?? '')).toBe(true);
    expect(malformed?.date).not.toBe('07/01/2026');
    expect(isIsoDate(malformed?.date ?? '')).toBe(true);

    // A syntactically valid ISO date that's merely in the future is still a valid DATE value --
    // no fallback needed, the real date is kept.
    const future = validateBankingRows([validBankRow({ Date: '2999-01-01' })]).normalized[0];
    expect(future?.date).toBe('2999-01-01');
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

  it('a blank or malformed Date still produces a valid ISO date on the normalized record, not a raw passthrough', () => {
    // Same regression as the Bank validator's own test -- see its comment.
    const blank = validateGeneralLedgerRows([validGlRow({ Date: '' })]).normalized[0];
    const malformed = validateGeneralLedgerRows([validGlRow({ Date: '07/01/2026' })]).normalized[0];

    expect(blank?.date).not.toBe('');
    expect(isIsoDate(blank?.date ?? '')).toBe(true);
    expect(malformed?.date).not.toBe('07/01/2026');
    expect(isIsoDate(malformed?.date ?? '')).toBe(true);
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

describe('validateBillingRows', () => {
  it('produces no issues and one normalized record for a fully valid row', () => {
    const { issues, normalized } = validateBillingRows([validBillingRow()]);

    expect(issues).toEqual([]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      sourceSystem: 'BILLING',
      recordId: 'B-1001',
      signedAmount: 500,
      direction: 'INFLOW',
      magnitude: 500,
      description: 'Acme Supplies',
      transactionType: 'Bill',
      payeeName: 'Acme Supplies',
      sourceLineNumber: 1,
    });
  });

  it('AP_ENTITY_ID_REQUIRED: flags a blank Entity Id', () => {
    const { issues } = validateBillingRows([validBillingRow({ 'Entity Id': '' })]);
    expect(codesOf(issues)).toContain('AP_ENTITY_ID_REQUIRED');
  });

  it('AP_ENTITY_MISMATCH: flags a row whose Entity Id differs from the first row in the file', () => {
    const { issues } = validateBillingRows([
      validBillingRow({ 'Doc No': 'B-1001' }),
      validBillingRow({ 'Entity Id': 'E200', 'Doc No': 'B-1002' }),
    ]);
    expect(codesOf(issues)).toContain('AP_ENTITY_MISMATCH');
  });

  it('AP_VENDOR_ID_REQUIRED: flags a blank Vendor Id', () => {
    const { issues } = validateBillingRows([validBillingRow({ 'Vendor Id': '' })]);
    expect(codesOf(issues)).toContain('AP_VENDOR_ID_REQUIRED');
  });

  it('AP_DOC_NO_REQUIRED: flags a blank Doc No', () => {
    const { issues } = validateBillingRows([validBillingRow({ 'Doc No': '' })]);
    expect(codesOf(issues)).toContain('AP_DOC_NO_REQUIRED');
  });

  it('AP_DOC_NO_DUPLICATE: flags a Doc No repeated within the same file', () => {
    const { issues } = validateBillingRows([
      validBillingRow({ 'Doc No': 'B-1001' }),
      validBillingRow({ 'Doc No': 'B-1001' }),
    ]);
    expect(codesOf(issues)).toContain('AP_DOC_NO_DUPLICATE');
  });

  it('AP_DOC_DATE_REQUIRED: flags a blank Doc Date', () => {
    const { issues } = validateBillingRows([validBillingRow({ 'Doc Date': '' })]);
    expect(codesOf(issues)).toContain('AP_DOC_DATE_REQUIRED');
  });

  it('AP_DOC_DATE_FORMAT: flags a non-ISO Doc Date', () => {
    const { issues } = validateBillingRows([validBillingRow({ 'Doc Date': '07/01/2026' })]);
    expect(codesOf(issues)).toContain('AP_DOC_DATE_FORMAT');
  });

  it('AP_DOC_DATE_FUTURE: flags a Doc Date after today', () => {
    const { issues } = validateBillingRows([validBillingRow({ 'Doc Date': '2999-01-01' })]);
    expect(codesOf(issues)).toContain('AP_DOC_DATE_FUTURE');
  });

  it('AP_DUE_DATE_MISSING: warns on a blank Due Date, still normalizes the row', () => {
    const { issues, normalized } = validateBillingRows([validBillingRow({ 'Due Date': '' })]);
    expect(issues).toEqual([expect.objectContaining({ code: 'AP_DUE_DATE_MISSING', severity: 'WARNING' })]);
    expect(normalized).toHaveLength(1);
  });

  it('AP_DUE_DATE_FORMAT: flags a non-ISO Due Date', () => {
    const { issues } = validateBillingRows([validBillingRow({ 'Due Date': '07/31/2026' })]);
    expect(codesOf(issues)).toContain('AP_DUE_DATE_FORMAT');
  });

  it('AP_AMOUNT_FORMAT: flags a blank Amount', () => {
    const { issues } = validateBillingRows([validBillingRow({ Amount: '' })]);
    expect(codesOf(issues)).toContain('AP_AMOUNT_FORMAT');
  });

  it('AP_AMOUNT_FORMAT: flags an unparseable Amount', () => {
    const { issues } = validateBillingRows([validBillingRow({ Amount: 'N/A' })]);
    expect(codesOf(issues)).toContain('AP_AMOUNT_FORMAT');
  });

  it('AP_AMOUNT_ZERO: warns on an exact-zero Amount, still normalizes the row', () => {
    const { issues, normalized } = validateBillingRows([validBillingRow({ Amount: '0.00' })]);
    expect(issues).toEqual([expect.objectContaining({ code: 'AP_AMOUNT_ZERO', severity: 'WARNING' })]);
    expect(normalized).toHaveLength(1);
  });

  it('AP_DOC_TYPE_UNRECOGNIZED: warns on a Doc Type outside Bill/Payment/Credit Memo', () => {
    const { issues } = validateBillingRows([validBillingRow({ 'Doc Type': 'Adjustment' })]);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'AP_DOC_TYPE_UNRECOGNIZED', severity: 'WARNING' }),
    ]);
  });

  it('Doc Type is optional -- a blank value does not trigger AP_DOC_TYPE_UNRECOGNIZED', () => {
    const { issues } = validateBillingRows([validBillingRow({ 'Doc Type': '' })]);
    expect(codesOf(issues)).not.toContain('AP_DOC_TYPE_UNRECOGNIZED');
  });

  it('AP_APPLIED_DOC_UNKNOWN: warns when Applied To Doc No matches no Doc No in the file', () => {
    const { issues } = validateBillingRows([
      validBillingRow({ 'Doc No': 'B-1001', 'Applied To Doc No': 'B-9999' }),
    ]);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'AP_APPLIED_DOC_UNKNOWN', severity: 'WARNING' }),
    ]);
  });

  it('a Payment applied to a Bill earlier in the same file resolves with no AP_APPLIED_DOC_UNKNOWN', () => {
    const { issues } = validateBillingRows([
      validBillingRow({ 'Doc Type': 'Bill', 'Doc No': 'B-1001' }),
      validBillingRow({ 'Doc Type': 'Payment', 'Doc No': 'P-2001', 'Applied To Doc No': 'B-1001' }),
    ]);
    expect(codesOf(issues)).not.toContain('AP_APPLIED_DOC_UNKNOWN');
  });

  it('a Payment applied to a Bill later in the same file also resolves -- forward references are valid', () => {
    const { issues } = validateBillingRows([
      validBillingRow({ 'Doc Type': 'Payment', 'Doc No': 'P-2001', 'Applied To Doc No': 'B-1001' }),
      validBillingRow({ 'Doc Type': 'Bill', 'Doc No': 'B-1001' }),
    ]);
    expect(codesOf(issues)).not.toContain('AP_APPLIED_DOC_UNKNOWN');
  });

  it('Vendor Name is optional -- description and payeeName fall back to Vendor Id when blank', () => {
    const { normalized } = validateBillingRows([validBillingRow({ 'Vendor Name': '' })]);
    expect(normalized[0]).toMatchObject({ description: 'V001', payeeName: undefined });
  });

  it('a blank or malformed Doc Date still produces a valid ISO date on the normalized record, not a raw passthrough', () => {
    const blank = validateBillingRows([validBillingRow({ 'Doc Date': '' })]).normalized[0];
    const malformed = validateBillingRows([validBillingRow({ 'Doc Date': '07/01/2026' })]).normalized[0];

    expect(blank?.date).not.toBe('');
    expect(isIsoDate(blank?.date ?? '')).toBe(true);
    expect(malformed?.date).not.toBe('07/01/2026');
    expect(isIsoDate(malformed?.date ?? '')).toBe(true);
  });
});
