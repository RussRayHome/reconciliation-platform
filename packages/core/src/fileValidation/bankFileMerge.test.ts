import { describe, expect, it } from 'vitest';

import {
  BankFileCountError,
  BankFileStructuralError,
  mergeBankFiles,
  type RawBankFileInput,
} from './bankFileMerge';
import { parseCsvBuffer } from './parsers/csvParser';
import { validateBankingRows } from './rowValidators';
import { MERGED_BANKING_HEADERS, type RawBankingRow } from './types';

const csv = (text: string): Buffer => Buffer.from(text, 'utf8');

/** Stand-ins for `reconciliation_account.id`. Fixed rather than random so a failure message names
 * the account that was wrong, and shaped like real UUIDs because the merge stamps them verbatim. */
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_C = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_D = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_E = '55555555-5555-4555-8555-555555555555';

const bankFile = (
  accountId: string,
  label: string,
  sequence: string,
  amount: string,
): RawBankFileInput => ({
  bytes: csv(
    `Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,Row ${label},${sequence},${amount},,${amount}\n`,
  ),
  fileFormat: 'CSV',
  originalFilename: `${label}_bank.csv`,
  accountId,
});

describe('mergeBankFiles', () => {
  it('stamps the assigned account id onto every row and prefixes Sequence Numbers with it', async () => {
    const fileA: RawBankFileInput = {
      bytes: csv(
        'Date,Description,Sequence Number,Debit,Credit,Balance\n' +
          '2026-02-02,ACME OFFICE SUPPLY,1,125.50,,9874.50\n',
      ),
      fileFormat: 'CSV',
      originalFilename: '4321_bank-export.csv',
      accountId: ACCOUNT_A,
    };
    const fileB: RawBankFileInput = {
      bytes: csv(
        'Date,Description,Sequence Number,Debit,Credit,Balance\n' +
          '2026-02-03,PAYROLL ACH,1,3200.00,,6674.50\n',
      ),
      fileFormat: 'CSV',
      originalFilename: '8765_bank-export.csv',
      accountId: ACCOUNT_B,
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.headers).toEqual([...MERGED_BANKING_HEADERS]);
    expect(parsed.rows.map((row) => row['Interface ID'])).toEqual([ACCOUNT_A, ACCOUNT_B]);
    expect(parsed.rows.map((row) => row['Sequence Number'])).toEqual([
      `${ACCOUNT_A}-1`,
      `${ACCOUNT_B}-1`,
    ]);
  });

  it('ignores the filename entirely -- a bank file may be named anything (A-D1)', async () => {
    // The previous contract rejected both of these outright: a name that did not start with an
    // account number could not be merged at all, because the name was the account. The assignment
    // is explicit now, so the name is inert.
    const fileA: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,X,1,1.00,,1.00\n'),
      fileFormat: 'CSV',
      originalFilename: 'checking-account.csv',
      accountId: ACCOUNT_A,
    };
    const fileB: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,Y,1,1.00,,1.00\n'),
      fileFormat: 'CSV',
      originalFilename: 'savings.csv',
      accountId: ACCOUNT_B,
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.rows.map((row) => row['Interface ID'])).toEqual([ACCOUNT_A, ACCOUNT_B]);
  });

  it('gives a filename that disagrees with the assignment no authority over the stamped account', async () => {
    // The API rejects this pairing for confirmation before it ever reaches the merge. If it is
    // confirmed and does reach here, the assignment wins -- never the name.
    const file: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,X,1,1.00,,1.00\n'),
      fileFormat: 'CSV',
      originalFilename: '9999_bank.csv',
      accountId: ACCOUNT_A,
    };

    const merged = await mergeBankFiles([file]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.rows[0]?.['Interface ID']).toBe(ACCOUNT_A);
  });

  it('produces the canonical merged column order regardless of optional-column input order', async () => {
    // Required columns (Date, Description, Sequence Number) must stay in their canonical relative
    // order (STRUCT_COLUMN_ORDER, checked pre-merge) -- only the optional columns' order varies
    // here (Balance/Credit/Debit swapped relative to the canonical sequence).
    const fileA: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Balance,Credit,Debit\n2026-02-02,DEPOSIT,1,9974.50,100.00,\n'),
      fileFormat: 'CSV',
      originalFilename: '4321_bank.csv',
      accountId: ACCOUNT_A,
    };
    const fileB: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-03,FEE,1,5.00,,9969.50\n'),
      fileFormat: 'CSV',
      originalFilename: '8765_bank.csv',
      accountId: ACCOUNT_B,
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.headers).toEqual([...MERGED_BANKING_HEADERS]);
    expect(parsed.rows[0]).toMatchObject({ Description: 'DEPOSIT', Credit: '100.00' });
  });

  it('throws BankFileStructuralError naming the file when its first row has no recognizable header', async () => {
    const fileA: RawBankFileInput = {
      bytes: csv('9001,First row is data not a header,100.00\n9002,Second row too,-50.00\n'),
      fileFormat: 'CSV',
      originalFilename: '4321_bank.csv',
      accountId: ACCOUNT_A,
    };
    const fileB: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,Y,1,1.00,,1.00\n'),
      fileFormat: 'CSV',
      originalFilename: '8765_bank.csv',
      accountId: ACCOUNT_B,
    };

    const error = await mergeBankFiles([fileA, fileB]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BankFileStructuralError);
    const structuralError = error as BankFileStructuralError;
    expect(structuralError.originalFilename).toBe('4321_bank.csv');
    expect(structuralError.issues.some((issue) => issue.code === 'STRUCT_HEADER_MISSING')).toBe(true);
  });

  it('throws BankFileStructuralError naming the file when a required column is missing', async () => {
    const fileA: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,X,1,1.00,,1.00\n'),
      fileFormat: 'CSV',
      originalFilename: '4321_bank.csv',
      accountId: ACCOUNT_A,
    };
    const fileB: RawBankFileInput = {
      bytes: csv('Date,Sequence Number,Debit,Credit,Balance\n2026-02-02,1,1.00,,1.00\n'),
      fileFormat: 'CSV',
      originalFilename: '8765_bank.csv',
      accountId: ACCOUNT_B,
    };

    const error = await mergeBankFiles([fileA, fileB]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BankFileStructuralError);
    const structuralError = error as BankFileStructuralError;
    expect(structuralError.originalFilename).toBe('8765_bank.csv');
    expect(
      structuralError.issues.some(
        (issue) => issue.code === 'STRUCT_COLUMN_MISSING' && issue.field === 'Description',
      ),
    ).toBe(true);
  });

  it('leaves a blank Sequence Number blank rather than prefixing it', async () => {
    const fileA: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,NO SEQ,,1.00,,1.00\n'),
      fileFormat: 'CSV',
      originalFilename: '4321_bank.csv',
      accountId: ACCOUNT_A,
    };
    const fileB: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-03,Y,1,1.00,,1.00\n'),
      fileFormat: 'CSV',
      originalFilename: '8765_bank.csv',
      accountId: ACCOUNT_B,
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.rows[0]?.['Sequence Number']).toBe('');
    // A blank sequence still carries its account -- Interface ID is stamped on every row, not only
    // on the ones that happen to have a sequence number to prefix.
    expect(parsed.rows[0]?.['Interface ID']).toBe(ACCOUNT_A);
  });

  it('no longer collides two accounts that share their last four digits (A-D1 regression)', async () => {
    // Under the old last-four prefix these two produced '4321-1' twice and BANK_SEQUENCE_DUPLICATE
    // fired against two genuinely distinct rows. A-D1 states accounts may legitimately share a
    // last four, so the prefix is the account id and the collision cannot occur.
    const fileA: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,X,1,1.00,,1.00\n'),
      fileFormat: 'CSV',
      originalFilename: '14321_bank.csv',
      accountId: ACCOUNT_A,
    };
    const fileB: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,Y,1,2.00,,2.00\n'),
      fileFormat: 'CSV',
      originalFilename: '24321_bank.csv',
      accountId: ACCOUNT_B,
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);
    const outcome = validateBankingRows(parsed.rows as unknown as RawBankingRow[]);

    expect(outcome.issues.some((issue) => issue.code === 'BANK_SEQUENCE_DUPLICATE')).toBe(false);
  });

  it('still catches a duplicate Sequence Number within one account', async () => {
    const file: RawBankFileInput = {
      bytes: csv(
        'Date,Description,Sequence Number,Debit,Credit,Balance\n' +
          '2026-02-02,X,1,1.00,,1.00\n' +
          '2026-02-03,Y,1,2.00,,3.00\n',
      ),
      fileFormat: 'CSV',
      originalFilename: '4321_bank.csv',
      accountId: ACCOUNT_A,
    };

    const merged = await mergeBankFiles([file]);
    const parsed = parseCsvBuffer(merged.bytes);
    const outcome = validateBankingRows(parsed.rows as unknown as RawBankingRow[]);

    expect(outcome.issues.some((issue) => issue.code === 'BANK_SEQUENCE_DUPLICATE')).toBe(true);
  });

  it('carries the account id through to NormalizedRecord.account', async () => {
    const merged = await mergeBankFiles([
      bankFile(ACCOUNT_A, 'a', '1', '10.00'),
      bankFile(ACCOUNT_B, 'b', '1', '20.00'),
    ]);
    const parsed = parseCsvBuffer(merged.bytes);
    const outcome = validateBankingRows(parsed.rows as unknown as RawBankingRow[]);

    expect(outcome.normalized.map((record) => record.account)).toEqual([ACCOUNT_A, ACCOUNT_B]);
  });

  it('merges a mixed CSV + XLSX input pair', async () => {
    const XLSX = await import('exceljs');
    const workbook = new XLSX.default.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['Date', 'Description', 'Sequence Number', 'Debit', 'Credit', 'Balance']);
    sheet.addRow(['2026-02-02', 'XLSX ROW', '1', '', '10.00', '10.00']);
    const xlsxBytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const fileA: RawBankFileInput = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,CSV ROW,1,1.00,,1.00\n'),
      fileFormat: 'CSV',
      originalFilename: '4321_bank.csv',
      accountId: ACCOUNT_A,
    };
    const fileB: RawBankFileInput = {
      bytes: xlsxBytes,
      fileFormat: 'XLSX',
      originalFilename: '8765_bank.xlsx',
      accountId: ACCOUNT_B,
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.rows.map((row) => row['Sequence Number'])).toEqual([
      `${ACCOUNT_A}-1`,
      `${ACCOUNT_B}-1`,
    ]);
    expect(parsed.rows[1]).toMatchObject({ Description: 'XLSX ROW', Credit: '10.00' });
  });

  it('merges a single bank file (the #153 minimum of 1)', async () => {
    const merged = await mergeBankFiles([bankFile(ACCOUNT_A, 'a', '1', '50.00')]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.rows.map((row) => row['Sequence Number'])).toEqual([`${ACCOUNT_A}-1`]);
  });

  it('merges three bank files', async () => {
    const merged = await mergeBankFiles([
      bankFile(ACCOUNT_A, 'a', '1', '10.00'),
      bankFile(ACCOUNT_B, 'b', '1', '20.00'),
      bankFile(ACCOUNT_C, 'c', '1', '30.00'),
    ]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.rows.map((row) => row['Interface ID'])).toEqual([
      ACCOUNT_A,
      ACCOUNT_B,
      ACCOUNT_C,
    ]);
  });

  it('merges the #153 maximum of 4 bank files, concatenated in input order', async () => {
    const merged = await mergeBankFiles([
      bankFile(ACCOUNT_A, 'a', '1', '10.00'),
      bankFile(ACCOUNT_B, 'b', '1', '20.00'),
      bankFile(ACCOUNT_C, 'c', '1', '30.00'),
      bankFile(ACCOUNT_D, 'd', '1', '40.00'),
    ]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.rows.map((row) => row['Interface ID'])).toEqual([
      ACCOUNT_A,
      ACCOUNT_B,
      ACCOUNT_C,
      ACCOUNT_D,
    ]);
  });

  it('throws BankFileCountError for zero files', async () => {
    await expect(mergeBankFiles([])).rejects.toThrow(BankFileCountError);
  });

  it('throws BankFileCountError for more than 4 files', async () => {
    const files = [
      bankFile(ACCOUNT_A, 'a', '1', '10.00'),
      bankFile(ACCOUNT_B, 'b', '1', '20.00'),
      bankFile(ACCOUNT_C, 'c', '1', '30.00'),
      bankFile(ACCOUNT_D, 'd', '1', '40.00'),
      bankFile(ACCOUNT_E, 'e', '1', '50.00'),
    ];

    const error = await mergeBankFiles(files).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BankFileCountError);
    expect((error as BankFileCountError).fileCount).toBe(5);
  });
});
