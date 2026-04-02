import {
  ambiguousBankRows,
  ambiguousQboRows,
  amountMismatchBankRows,
  amountMismatchQboRows,
  createSampleBankWorkbook,
  createSampleQboWorkbook,
  createWorkbookFromRows,
  nonStandardHeaderBankRows,
  nonStandardHeaderQboRows,
  referenceMismatchBankRows,
  referenceMismatchQboRows,
  timingDifferenceBankRows,
  timingDifferenceQboRows,
} from '@recon/test-fixtures';
import { describe, expect, it } from 'vitest';

import ExcelJS from 'exceljs';
import { defaultReconciliationConfig } from '@recon/config';
import { parseWorkbook } from './parsers/excelParser';
import { randomUUID } from 'node:crypto';
import { runReconciliation } from './reconcile';

const buildRun = async () => {
  const [bankBuffer, qboBuffer] = await Promise.all([
    createSampleBankWorkbook(),
    createSampleQboWorkbook(),
  ]);

  const [bankParsed, qboParsed] = await Promise.all([
    parseWorkbook({
      source: 'bank',
      fileName: 'bank.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: bankBuffer.length,
      buffer: bankBuffer,
      config: defaultReconciliationConfig.bank,
    }),
    parseWorkbook({
      source: 'qbo',
      fileName: 'qbo.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: qboBuffer.length,
      buffer: qboBuffer,
      config: defaultReconciliationConfig.qbo,
    }),
  ]);

  return runReconciliation({
    runId: randomUUID(),
    correlationId: 'test-correlation',
    sourceFiles: [bankParsed.sourceFile, qboParsed.sourceFile],
    rawRows: [...bankParsed.rawRows, ...qboParsed.rawRows],
    config: defaultReconciliationConfig,
    accountIdentifier: 'OPERATING-001',
    periodLabel: 'January 2025',
  });
};

const buildRunFromRows = async (
  bankRows: Array<Array<string | number>>,
  qboRows: Array<Array<string | number>>,
) => {
  const [bankBuffer, qboBuffer] = await Promise.all([
    createWorkbookFromRows(bankRows),
    createWorkbookFromRows(qboRows),
  ]);

  const [bankParsed, qboParsed] = await Promise.all([
    parseWorkbook({
      source: 'bank',
      fileName: 'bank-edge.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: bankBuffer.length,
      buffer: bankBuffer,
      config: defaultReconciliationConfig.bank,
    }),
    parseWorkbook({
      source: 'qbo',
      fileName: 'qbo-edge.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: qboBuffer.length,
      buffer: qboBuffer,
      config: defaultReconciliationConfig.qbo,
    }),
  ]);

  return runReconciliation({
    runId: randomUUID(),
    correlationId: 'edge-case-correlation',
    sourceFiles: [bankParsed.sourceFile, qboParsed.sourceFile],
    rawRows: [...bankParsed.rawRows, ...qboParsed.rawRows],
    config: defaultReconciliationConfig,
    accountIdentifier: 'OPERATING-001',
    periodLabel: 'Edge Case Period',
  });
};

describe('runReconciliation', () => {
  it('excludes QBO beginning balance rows and creates workbook tabs', async () => {
    const output = await buildRun();

    expect(output.normalizedTransactions.some((item) => item.exclusionReason?.includes('Beginning balance'))).toBe(true);
    expect(output.outputWorkbook.tabNames).toEqual(
      expect.arrayContaining([
        'Summary',
        'Mapping and Assumptions',
        'Error Report',
        'Probable Matches Review',
        'Reviewer Observations',
      ]),
    );
    expect(output.outputWorkbook.binary.byteLength).toBeGreaterThan(1000);
  });

  it('classifies duplicates, missing items, and data quality issues from fixture rows', async () => {
    const output = await buildRun();

    expect(output.exceptions.map((item) => item.category)).toEqual(
      expect.arrayContaining(['DuplicateTransaction', 'InvalidOrMissingData']),
    );
    expect(output.summary.exactMatches).toBeGreaterThanOrEqual(1);
    expect(output.summary.probableMatches).toBeGreaterThanOrEqual(1);
    expect(output.summary.duplicates).toBeGreaterThanOrEqual(1);
    expect(output.summary.dataQualityIssues).toBeGreaterThanOrEqual(1);
  });

  it('embeds the two summary chart images in the exported workbook', async () => {
    const output = await buildRun();
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(
      output.outputWorkbook.binary as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0],
    );

    const summarySheet = workbook.getWorksheet('Summary');

    expect(summarySheet).toBeDefined();
    expect(summarySheet?.getImages().length).toBeGreaterThanOrEqual(2);
    expect((workbook.model.media ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('includes the detailed bank and QBO breakout rows on the Summary sheet', async () => {
    const output = await buildRun();
    const workbook = new ExcelJS.Workbook();

    await workbook.xlsx.load(
      output.outputWorkbook.binary as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0],
    );

    const summarySheet = workbook.getWorksheet('Summary');
    const summaryLabels = summarySheet
      ?.getColumn(1)
      .values
      .filter((value) => typeof value === 'string') as string[];

    expect(summaryLabels).toEqual(
      expect.arrayContaining([
        'Total bank transactions reviewed',
        'Total QBO transactions reviewed',
        'Total duplicates in bank',
        'Total duplicates in QBO',
        'Net amount of unmatched bank transactions',
        'Net amount of unmatched QBO transactions',
        'Narrative Summary',
      ]),
    );

    expect(summarySheet?.getCell('A21').value).toEqual(expect.stringContaining('The reconciliation'));
    expect(summarySheet?.getCell('A21').value).toEqual(expect.stringContaining('OPERATING-001'));
  });

  it('processes a medium workbook within a practical local threshold', async () => {
    const start = performance.now();
    await buildRun();
    const durationMs = performance.now() - start;

    expect(durationMs).toBeLessThan(5000);
  });

  it('maps non-standard bank debit and credit headers without inflating invalid data issues', async () => {
    const output = await buildRunFromRows(nonStandardHeaderBankRows, nonStandardHeaderQboRows);

    expect(output.summary.exactMatches).toBeGreaterThanOrEqual(2);
    expect(output.summary.dataQualityIssues).toBe(0);
    expect(output.exceptions.some((item) => item.category === 'InvalidOrMissingData')).toBe(false);
  });

  it('flags timing differences when dates are outside primary tolerance but inside timing window', async () => {
    const output = await buildRunFromRows(timingDifferenceBankRows, timingDifferenceQboRows);

    const timing = output.exceptions.filter((item) => item.category === 'TimingDifference');
    expect(timing).toHaveLength(2);
    expect(timing.map((item) => item.source).sort((left, right) => left.localeCompare(right))).toEqual(['bank', 'qbo']);
    expect(output.matchResults.some((item) => item.disposition === 'TimingDifference')).toBe(true);
    expect(
      output.matchResults.some(
        (item) => item.disposition === 'TimingDifference' && (item.dateDifferenceDays ?? 0) > 7,
      ),
    ).toBe(true);
    expect(output.summary.timingDifferences).toBeGreaterThanOrEqual(1);
    expect(output.summary.probableMatches).toBe(0);
  });

  it('classifies likely amount mismatch pairs with linked counterpart references', async () => {
    const output = await buildRunFromRows(amountMismatchBankRows, amountMismatchQboRows);

    const mismatch = output.exceptions.find((item) => item.category === 'AmountMismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch?.likelyMatchingReference).toBeTruthy();
    expect(output.summary.amountMismatches).toBeGreaterThanOrEqual(1);
  });

  it('surfaces check or reference number variance as review exceptions instead of clean matches', async () => {
    const output = await buildRunFromRows(referenceMismatchBankRows, referenceMismatchQboRows);

    expect(
      output.exceptions.some(
        (item) => item.category === 'CheckNumberMismatch' || item.category === 'ReferenceNumberMismatch',
      ),
    ).toBe(true);
    expect(output.summary.exactMatches).toBe(0);
  });

  it('marks near-equal competing candidates as ambiguous review items', async () => {
    const output = await buildRunFromRows(ambiguousBankRows, ambiguousQboRows);

    expect(output.exceptions.some((item) => item.category === 'AmbiguousMatchRequiringReview')).toBe(true);
    expect(output.probableMatches.some((item) => item.disposition === 'AmbiguousReview')).toBe(true);
  });

  it('keeps exception categories mutually exclusive for invalid rows', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['', 'WIRE WITHOUT DATE', '', '250.00', '', '999.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-03-04', 'Expense', '', 'Vendor', 'Wire without date', '-250.00'],
      ],
    );

    const invalidItems = output.exceptions.filter((item) => item.category === 'InvalidOrMissingData');
    const missingItems = output.exceptions.filter((item) => item.category === 'MissingFromQBO');

    expect(invalidItems.length).toBeGreaterThanOrEqual(1);
    expect(missingItems).toHaveLength(0);
  });
});
