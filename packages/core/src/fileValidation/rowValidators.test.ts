import { describe, expect, it } from 'vitest';

import { validateBankingRows, validateGeneralLedgerRows } from './rowValidators';
import type { RawBankingRow, RawGeneralLedgerRow } from './types';

/** A fully valid banking row -- each test overrides only the field(s) relevant to what it's
 * testing, so every other field stays known-good and can't incidentally trigger another code. */
const validBankRow = (overrides: Partial<RawBankingRow> = {}): RawBankingRow => ({
  transaction_id: 'TXN-1',
  account_id: 'ACC-1',
  posted_date: '2026-07-01',
  amount: '100.00',
  currency_code: 'USD',
  transaction_type: 'DEP',
  description: 'Valid row',
  ...overrides,
});

/** A fully valid, balanced two-line GL entry -- tests override only what they're testing. */
const validGlRows = (overrides: Partial<RawGeneralLedgerRow> = {}): RawGeneralLedgerRow[] => [
  {
    entry_id: 'JE-1',
    line_number: '1',
    transaction_date: '2026-07-01',
    account_code: '1000',
    description: 'Cash',
    debit_amount: '100.00',
    currency_code: 'USD',
    ...overrides,
  },
  {
    entry_id: 'JE-1',
    line_number: '2',
    transaction_date: '2026-07-01',
    account_code: '4000',
    description: 'Revenue',
    credit_amount: '100.00',
    currency_code: 'USD',
  },
];

const codesOf = (issues: { code: string }[]): string[] => issues.map((issue) => issue.code);

describe('validateBankingRows', () => {
  it('produces no issues and one normalized record for a fully valid row', () => {
    const { issues, normalized } = validateBankingRows([validBankRow()]);

    expect(issues).toEqual([]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      sourceSystem: 'BANK',
      recordId: 'TXN-1',
      signedAmount: 100,
      direction: 'INFLOW',
      magnitude: 100,
      sourceLineNumber: 1,
    });
  });

  it('BANK_ID_REQUIRED: flags a blank transaction_id', () => {
    const { issues } = validateBankingRows([validBankRow({ transaction_id: '' })]);
    expect(codesOf(issues)).toContain('BANK_ID_REQUIRED');
  });

  it('BANK_ID_DUPLICATE: flags the later occurrence, keeps the first normalized', () => {
    const rows = [validBankRow({ transaction_id: 'TXN-DUP' }), validBankRow({ transaction_id: 'TXN-DUP' })];
    const { issues, normalized } = validateBankingRows(rows);

    expect(issues).toEqual([
      expect.objectContaining({ code: 'BANK_ID_DUPLICATE', rowNumber: 2 }),
    ]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.sourceLineNumber).toBe(1);
  });

  it('BANK_ACCOUNT_REQUIRED: flags a blank account_id', () => {
    const { issues } = validateBankingRows([validBankRow({ account_id: '' })]);
    expect(codesOf(issues)).toContain('BANK_ACCOUNT_REQUIRED');
  });

  it('BANK_POSTED_DATE_REQUIRED: flags a blank posted_date', () => {
    const { issues } = validateBankingRows([validBankRow({ posted_date: '' })]);
    expect(codesOf(issues)).toContain('BANK_POSTED_DATE_REQUIRED');
  });

  it('BANK_POSTED_DATE_FORMAT: flags a non-ISO posted_date', () => {
    const { issues } = validateBankingRows([validBankRow({ posted_date: '07/01/2026' })]);
    expect(codesOf(issues)).toContain('BANK_POSTED_DATE_FORMAT');
  });

  it('BANK_POSTED_DATE_FUTURE: flags a posted_date after today', () => {
    const { issues } = validateBankingRows([validBankRow({ posted_date: '2999-01-01' })]);
    expect(codesOf(issues)).toContain('BANK_POSTED_DATE_FUTURE');
  });

  it('BANK_TXN_DATE_FORMAT: flags a non-ISO transaction_date', () => {
    const { issues } = validateBankingRows([validBankRow({ transaction_date: '07/01/2026' })]);
    expect(codesOf(issues)).toContain('BANK_TXN_DATE_FORMAT');
  });

  it('BANK_TXN_DATE_AFTER_POSTED: warns when transaction_date is later than posted_date', () => {
    const { issues } = validateBankingRows([
      validBankRow({ posted_date: '2026-07-01', transaction_date: '2026-07-05' }),
    ]);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'BANK_TXN_DATE_AFTER_POSTED', severity: 'WARNING' }),
    ]);
  });

  it('BANK_AMOUNT_FORMAT: flags a currency-symbol/thousands-separator amount', () => {
    const { issues } = validateBankingRows([validBankRow({ amount: '$1,200.00' })]);
    expect(codesOf(issues)).toContain('BANK_AMOUNT_FORMAT');
  });

  it('BANK_AMOUNT_ZERO: warns on an exact-zero amount', () => {
    const { issues } = validateBankingRows([validBankRow({ amount: '0.00', transaction_type: 'OTHER' })]);
    expect(issues).toEqual([expect.objectContaining({ code: 'BANK_AMOUNT_ZERO', severity: 'WARNING' })]);
  });

  it('BANK_CURRENCY_REQUIRED: flags a blank currency_code', () => {
    const { issues } = validateBankingRows([validBankRow({ currency_code: '' })]);
    expect(codesOf(issues)).toContain('BANK_CURRENCY_REQUIRED');
  });

  it('BANK_CURRENCY_FORMAT: flags a non-ISO-4217 currency_code', () => {
    const { issues } = validateBankingRows([validBankRow({ currency_code: 'US' })]);
    expect(codesOf(issues)).toContain('BANK_CURRENCY_FORMAT');
  });

  it('BANK_TYPE_REQUIRED: flags a blank transaction_type', () => {
    const { issues } = validateBankingRows([validBankRow({ transaction_type: '' })]);
    expect(codesOf(issues)).toContain('BANK_TYPE_REQUIRED');
  });

  it('BANK_TYPE_INVALID: flags a transaction_type outside the enum', () => {
    const { issues } = validateBankingRows([validBankRow({ transaction_type: 'WITHDRAWAL' })]);
    expect(codesOf(issues)).toContain('BANK_TYPE_INVALID');
  });

  it('BANK_TYPE_SIGN: flags an inflow type with a negative amount', () => {
    const { issues } = validateBankingRows([validBankRow({ transaction_type: 'DEP', amount: '-40.00' })]);
    expect(codesOf(issues)).toContain('BANK_TYPE_SIGN');
  });

  it('BANK_TYPE_SIGN: flags an outflow type with a positive amount', () => {
    const { issues } = validateBankingRows([validBankRow({ transaction_type: 'FEE', amount: '25.00' })]);
    expect(codesOf(issues)).toContain('BANK_TYPE_SIGN');
  });

  it('BANK_DESCRIPTION_REQUIRED: flags a blank description', () => {
    const { issues } = validateBankingRows([validBankRow({ description: '' })]);
    expect(codesOf(issues)).toContain('BANK_DESCRIPTION_REQUIRED');
  });

  it('BANK_CHECK_NUMBER_MISSING: warns when type is CHECK with no check_number', () => {
    const { issues } = validateBankingRows([
      validBankRow({ transaction_type: 'CHECK', amount: '-500.00', check_number: '' }),
    ]);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'BANK_CHECK_NUMBER_MISSING', severity: 'WARNING' }),
    ]);
  });

  it('BANK_BALANCE_FORMAT: flags a non-decimal running_balance', () => {
    const { issues } = validateBankingRows([validBankRow({ running_balance: 'N/A' })]);
    expect(codesOf(issues)).toContain('BANK_BALANCE_FORMAT');
  });

  it('BANK_MULTI_CURRENCY: flags a file mixing currencies across rows', () => {
    const rows = [
      validBankRow({ transaction_id: 'TXN-1', currency_code: 'USD' }),
      validBankRow({ transaction_id: 'TXN-2', currency_code: 'EUR' }),
    ];
    const { issues } = validateBankingRows(rows);
    expect(codesOf(issues)).toContain('BANK_MULTI_CURRENCY');
  });

  it('BANK_BALANCE_CONTINUITY: flags a running_balance break, only when every row has one', () => {
    const rows = [
      validBankRow({ transaction_id: 'TXN-1', amount: '100.00', running_balance: '1000.00' }),
      // 1000 + 50 should be 1050, not 9999 -- a genuine discontinuity.
      validBankRow({ transaction_id: 'TXN-2', amount: '50.00', running_balance: '9999.00' }),
    ];
    const { issues } = validateBankingRows(rows);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'BANK_BALANCE_CONTINUITY', rowNumber: 2 }),
    ]);
  });

  it('does not run BANK_BALANCE_CONTINUITY at all when any row lacks a running_balance', () => {
    const rows = [
      validBankRow({ transaction_id: 'TXN-1', running_balance: '1000.00' }),
      validBankRow({ transaction_id: 'TXN-2' }), // no running_balance
    ];
    const { issues } = validateBankingRows(rows);
    expect(codesOf(issues)).not.toContain('BANK_BALANCE_CONTINUITY');
  });

  it('honors flipSign: a positive bank amount normalizes to a negative signedAmount', () => {
    const { normalized } = validateBankingRows([validBankRow({ amount: '100.00' })], {
      flipSign: true,
    });
    expect(normalized[0]?.signedAmount).toBe(-100);
    expect(normalized[0]?.direction).toBe('OUTFLOW');
  });
});

describe('validateGeneralLedgerRows', () => {
  it('produces no issues and two normalized records for a fully valid balanced entry', () => {
    const { issues, normalized } = validateGeneralLedgerRows(validGlRows());

    expect(issues).toEqual([]);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toMatchObject({
      sourceSystem: 'GL',
      recordId: 'JE-1:1',
      signedAmount: 100,
      direction: 'INFLOW',
      sourceLineNumber: 1,
    });
    expect(normalized[1]).toMatchObject({ signedAmount: -100, direction: 'OUTFLOW' });
  });

  it('GL_ENTRY_ID_REQUIRED: flags a blank entry_id', () => {
    const rows = validGlRows({ entry_id: '' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_ENTRY_ID_REQUIRED');
  });

  it('GL_LINE_NO_REQUIRED: flags a blank line_number', () => {
    const rows = validGlRows({ line_number: '' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_LINE_NO_REQUIRED');
  });

  it('GL_LINE_NO_FORMAT: flags a non-positive-integer line_number', () => {
    const rows = validGlRows({ line_number: '0' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_LINE_NO_FORMAT');
  });

  it('GL_TXN_DATE_REQUIRED: flags a blank transaction_date', () => {
    const rows = validGlRows({ transaction_date: '' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_TXN_DATE_REQUIRED');
  });

  it('GL_TXN_DATE_FORMAT: flags a non-ISO transaction_date', () => {
    const rows = validGlRows({ transaction_date: '07/01/2026' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_TXN_DATE_FORMAT');
  });

  it('GL_TXN_DATE_FUTURE: flags a transaction_date after today', () => {
    const rows = validGlRows({ transaction_date: '2999-01-01' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_TXN_DATE_FUTURE');
  });

  it('GL_POSTING_DATE_FORMAT: flags a non-ISO posting_date', () => {
    const rows = validGlRows({ posting_date: '07/01/2026' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_POSTING_DATE_FORMAT');
  });

  it('GL_POSTING_BEFORE_TXN: warns when posting_date is earlier than transaction_date', () => {
    const rows = validGlRows({ transaction_date: '2026-07-05', posting_date: '2026-07-01' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'GL_POSTING_BEFORE_TXN', severity: 'WARNING' }),
    ]);
  });

  it('GL_ACCOUNT_REQUIRED: flags a blank account_code', () => {
    const rows = validGlRows({ account_code: '' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_ACCOUNT_REQUIRED');
  });

  it('GL_DESCRIPTION_REQUIRED: flags a blank description', () => {
    const rows = validGlRows({ description: '' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_DESCRIPTION_REQUIRED');
  });

  it('GL_CURRENCY_REQUIRED: flags a blank currency_code', () => {
    const rows = validGlRows({ currency_code: '' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_CURRENCY_REQUIRED');
  });

  it('GL_CURRENCY_FORMAT: flags a non-ISO-4217 currency_code', () => {
    const rows = validGlRows({ currency_code: 'US' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_CURRENCY_FORMAT');
  });

  it('GL_DEBIT_FORMAT: flags a non-decimal debit_amount', () => {
    const rows = validGlRows({ debit_amount: '$100.00' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_DEBIT_FORMAT');
  });

  it('GL_CREDIT_FORMAT: flags a non-decimal credit_amount', () => {
    const rows = validGlRows();
    rows[1]!.credit_amount = '$100.00';
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_CREDIT_FORMAT');
  });

  it('GL_DEBIT_NEGATIVE: flags a negative debit_amount', () => {
    const rows = validGlRows({ debit_amount: '-100.00' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_DEBIT_NEGATIVE');
  });

  it('GL_CREDIT_NEGATIVE: flags a negative credit_amount', () => {
    const rows = validGlRows();
    rows[1]!.credit_amount = '-100.00';
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_CREDIT_NEGATIVE');
  });

  it('GL_NO_AMOUNT: flags a line with neither debit nor credit', () => {
    const rows = validGlRows({ debit_amount: undefined });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_NO_AMOUNT');
  });

  it('GL_BOTH_AMOUNTS: flags a line with both debit and credit > 0', () => {
    const rows = validGlRows({ debit_amount: '100.00', credit_amount: '50.00' });
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_BOTH_AMOUNTS');
  });

  it('GL_LINE_NO_DUPLICATE: flags a repeated line_number within one entry', () => {
    const rows = validGlRows();
    rows[1]!.line_number = '1';
    const { issues } = validateGeneralLedgerRows(rows);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'GL_LINE_NO_DUPLICATE', entryId: 'JE-1' }),
      ]),
    );
  });

  it('GL_UNBALANCED: flags an entry whose debits and credits differ beyond tolerance', () => {
    const rows = validGlRows();
    rows[1]!.credit_amount = '99.00';
    const { issues } = validateGeneralLedgerRows(rows);
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'GL_UNBALANCED', entryId: 'JE-1' })]),
    );
  });

  it('tolerates floating-point summation noise within the default 0.005 tolerance', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754 -- two decimal-clean debit lines summing to
    // a credit total with a ~5.5e-17 floating-point artifact must not trip GL_UNBALANCED. This is
    // what the tolerance is actually for: two individually valid amounts can't differ by less
    // than 0.01 (the smallest step at 2 decimal places), so a hand-picked "close but not equal"
    // pair can't exercise it the way real summation drift does.
    const rows: RawGeneralLedgerRow[] = [
      { entry_id: 'JE-FP', line_number: '1', transaction_date: '2026-07-01', account_code: '1000', description: 'Line A', debit_amount: '0.10', currency_code: 'USD' },
      { entry_id: 'JE-FP', line_number: '2', transaction_date: '2026-07-01', account_code: '1000', description: 'Line B', debit_amount: '0.20', currency_code: 'USD' },
      { entry_id: 'JE-FP', line_number: '3', transaction_date: '2026-07-01', account_code: '4000', description: 'Line C', credit_amount: '0.30', currency_code: 'USD' },
    ];
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).not.toContain('GL_UNBALANCED');
  });

  it('GL_MULTI_CURRENCY: flags a file mixing currencies across lines', () => {
    const rows = validGlRows();
    rows[1]!.currency_code = 'EUR';
    const { issues } = validateGeneralLedgerRows(rows);
    expect(codesOf(issues)).toContain('GL_MULTI_CURRENCY');
  });

  it('honors flipSign: a debit-positive entry normalizes to credit-positive', () => {
    const { normalized } = validateGeneralLedgerRows(validGlRows(), { flipSign: true });
    expect(normalized[0]?.signedAmount).toBe(-100);
    expect(normalized[1]?.signedAmount).toBe(100);
  });
});
