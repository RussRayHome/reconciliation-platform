import { describe, expect, it } from 'vitest';

import { BankFileStructuralError, BankFilenameAccountParseError, mergeBankFiles } from './bankFileMerge';
import { parseCsvBuffer } from './parsers/csvParser';
import { validateBankingRows } from './rowValidators';
import { BANKING_HEADERS, type RawBankingRow } from './types';

const csv = (text: string): Buffer => Buffer.from(text, 'utf8');

describe('mergeBankFiles', () => {
  it('prefixes non-blank Sequence Numbers with each file\'s account last-4', async () => {
    const fileA = {
      bytes: csv(
        'Date,Description,Sequence Number,Debit,Credit,Balance\n' +
          '2026-02-02,ACME OFFICE SUPPLY,1,125.50,,9874.50\n',
      ),
      fileFormat: 'CSV' as const,
      originalFilename: '4321_bank-export.csv',
    };
    const fileB = {
      bytes: csv(
        'Date,Description,Sequence Number,Debit,Credit,Balance\n' +
          '2026-02-03,PAYROLL ACH,1,3200.00,,6674.50\n',
      ),
      fileFormat: 'CSV' as const,
      originalFilename: '8765_bank-export.csv',
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.headers).toEqual([...BANKING_HEADERS]);
    expect(parsed.rows.map((row) => row['Sequence Number'])).toEqual(['4321-1', '8765-1']);
  });

  it('produces the canonical BANKING_HEADERS column order regardless of optional-column input order', async () => {
    // Required columns (Date, Description, Sequence Number) must stay in their canonical relative
    // order (STRUCT_COLUMN_ORDER, checked pre-merge) -- only the optional columns' order varies
    // here (Balance/Credit/Debit swapped relative to the canonical BANKING_HEADERS sequence).
    const fileA = {
      bytes: csv('Date,Description,Sequence Number,Balance,Credit,Debit\n2026-02-02,DEPOSIT,1,9974.50,100.00,\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '4321_bank.csv',
    };
    const fileB = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-03,FEE,1,5.00,,9969.50\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '8765_bank.csv',
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.headers).toEqual([...BANKING_HEADERS]);
    expect(parsed.rows[0]).toMatchObject({ Description: 'DEPOSIT', Credit: '100.00' });
  });

  it('throws BankFilenameAccountParseError naming the offending file when file A is misnamed', async () => {
    const fileA = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,X,1,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: 'checking-account.csv',
    };
    const fileB = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,Y,1,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '8765_bank.csv',
    };

    await expect(mergeBankFiles([fileA, fileB])).rejects.toThrow(BankFilenameAccountParseError);
    try {
      await mergeBankFiles([fileA, fileB]);
    } catch (error) {
      expect((error as BankFilenameAccountParseError).originalFilename).toBe('checking-account.csv');
    }
  });

  it('throws BankFilenameAccountParseError naming the offending file when file B is misnamed', async () => {
    const fileA = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,X,1,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '4321_bank.csv',
    };
    const fileB = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,Y,1,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: 'savings.xlsx',
    };

    await expect(mergeBankFiles([fileA, fileB])).rejects.toThrow(BankFilenameAccountParseError);
    try {
      await mergeBankFiles([fileA, fileB]);
    } catch (error) {
      expect((error as BankFilenameAccountParseError).originalFilename).toBe('savings.xlsx');
    }
  });

  it('throws BankFileStructuralError naming the file when its first row has no recognizable header', async () => {
    const fileA = {
      bytes: csv('9001,First row is data not a header,100.00\n9002,Second row too,-50.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '4321_bank.csv',
    };
    const fileB = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,Y,1,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '8765_bank.csv',
    };

    await expect(mergeBankFiles([fileA, fileB])).rejects.toThrow(BankFileStructuralError);
    try {
      await mergeBankFiles([fileA, fileB]);
    } catch (error) {
      const structuralError = error as BankFileStructuralError;
      expect(structuralError.originalFilename).toBe('4321_bank.csv');
      expect(structuralError.issues.some((issue) => issue.code === 'STRUCT_HEADER_MISSING')).toBe(true);
    }
  });

  it('throws BankFileStructuralError naming the file when a required column is missing', async () => {
    const fileA = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,X,1,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '4321_bank.csv',
    };
    const fileB = {
      bytes: csv('Date,Sequence Number,Debit,Credit,Balance\n2026-02-02,1,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '8765_bank.csv',
    };

    await expect(mergeBankFiles([fileA, fileB])).rejects.toThrow(BankFileStructuralError);
    try {
      await mergeBankFiles([fileA, fileB]);
    } catch (error) {
      const structuralError = error as BankFileStructuralError;
      expect(structuralError.originalFilename).toBe('8765_bank.csv');
      expect(
        structuralError.issues.some(
          (issue) => issue.code === 'STRUCT_COLUMN_MISSING' && issue.field === 'Description',
        ),
      ).toBe(true);
    }
  });

  it('leaves a blank Sequence Number blank rather than prefixing it', async () => {
    const fileA = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,NO SEQ,,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '4321_bank.csv',
    };
    const fileB = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-03,Y,1,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '8765_bank.csv',
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.rows[0]?.['Sequence Number']).toBe('');
  });

  it('lets BANK_SEQUENCE_DUPLICATE catch a same-last-4 collision through the merged file -- no new detection code needed', async () => {
    const fileA = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,X,1,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '14321_bank.csv',
    };
    const fileB = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,Y,1,2.00,,2.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '24321_bank.csv',
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);
    const outcome = validateBankingRows(parsed.rows as unknown as RawBankingRow[]);

    expect(outcome.issues.some((issue) => issue.code === 'BANK_SEQUENCE_DUPLICATE')).toBe(true);
  });

  it('merges a mixed CSV + XLSX input pair', async () => {
    const XLSX = await import('exceljs');
    const workbook = new XLSX.default.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['Date', 'Description', 'Sequence Number', 'Debit', 'Credit', 'Balance']);
    sheet.addRow(['2026-02-02', 'XLSX ROW', '1', '', '10.00', '10.00']);
    const xlsxBytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const fileA = {
      bytes: csv('Date,Description,Sequence Number,Debit,Credit,Balance\n2026-02-02,CSV ROW,1,1.00,,1.00\n'),
      fileFormat: 'CSV' as const,
      originalFilename: '4321_bank.csv',
    };
    const fileB = {
      bytes: xlsxBytes,
      fileFormat: 'XLSX' as const,
      originalFilename: '8765_bank.xlsx',
    };

    const merged = await mergeBankFiles([fileA, fileB]);
    const parsed = parseCsvBuffer(merged.bytes);

    expect(parsed.rows.map((row) => row['Sequence Number'])).toEqual(['4321-1', '8765-1']);
    expect(parsed.rows[1]).toMatchObject({ Description: 'XLSX ROW', Credit: '10.00' });
  });
});
