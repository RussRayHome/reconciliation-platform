import {
  allExceptionCategories,
  buildAllExceptionsCombinedRows,
  exceptionEdgeCaseFixtures,
  exceptionPrecedenceFixtures,
  exceptionScenarioFixtures,
} from '../../test-fixtures/src/exceptionScenarios';
import {
  ambiguousBankRows,
  ambiguousQboRows,
  amountMismatchBankRows,
  amountMismatchQboRows,
  createSampleBankWorkbook,
  createSampleQboWorkbook,
  createWorkbookFromRows,
  depositGroupingBankRows,
  depositGroupingOversizedBankRows,
  depositGroupingOversizedQboRows,
  depositGroupingQboRows,
  nonStandardHeaderBankRows,
  nonStandardHeaderQboRows,
  referenceMismatchBankRows,
  referenceMismatchQboRows,
  splitCombineBankRows,
  splitCombineNearMissBankRows,
  splitCombineNearMissQboRows,
  splitCombineQboRows,
  staleOutstandingMixedResidualBankRows,
  staleOutstandingMixedResidualQboRows,
  timingDifferenceBankRows,
  timingDifferenceQboRows,
} from '../../test-fixtures/src/sampleRows';
import { describe, expect, it } from 'vitest';

import ExcelJS from 'exceljs';
import { defaultReconciliationConfig } from '@recon/config';
import { errorCategories } from '@recon/domain';
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
  options?: {
    reconciliationFrequency?: 'Monthly' | 'Annual';
  },
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
    reconciliationFrequency: options?.reconciliationFrequency,
    periodLabel: 'Edge Case Period',
  });
};

const splitCombineNearMissBankFixture = splitCombineNearMissBankRows as Array<Array<string | number>>;
const splitCombineNearMissQboFixture = splitCombineNearMissQboRows as Array<Array<string | number>>;
const depositGroupingOversizedBankFixture = depositGroupingOversizedBankRows as Array<Array<string | number>>;
const depositGroupingOversizedQboFixture = depositGroupingOversizedQboRows as Array<Array<string | number>>;
const staleOutstandingMixedResidualBankFixture = staleOutstandingMixedResidualBankRows as Array<Array<string | number>>;
const staleOutstandingMixedResidualQboFixture = staleOutstandingMixedResidualQboRows as Array<Array<string | number>>;

const countExceptionsByCategory = (
  output: Awaited<ReturnType<typeof buildRunFromRows>>,
  category: (typeof errorCategories)[number],
): number => output.exceptions.filter((item) => item.category === category).length;

describe('runReconciliation', () => {
  it('keeps fixture coverage aligned with the full domain exception taxonomy', () => {
    expect(new Set(exceptionScenarioFixtures.map((fixture) => fixture.expectedCategory))).toEqual(
      new Set(errorCategories),
    );
  });

  it.each(exceptionScenarioFixtures)('produces $expectedCategory from the $name fixture', async (fixture) => {
    const output = await buildRunFromRows(fixture.bankRows, fixture.qboRows);

    expect(countExceptionsByCategory(output, fixture.expectedCategory)).toBe(fixture.expectedCount);
  });

  it.each(exceptionEdgeCaseFixtures)('keeps the $name edge case on the intended fallback path', async (fixture) => {
    const output = await buildRunFromRows(fixture.bankRows, fixture.qboRows);

    fixture.expectedPresent.forEach(({ category, count }) => {
      expect(countExceptionsByCategory(output, category)).toBe(count);
    });

    fixture.expectedAbsent.forEach((category) => {
      expect(countExceptionsByCategory(output, category)).toBe(0);
    });
  });

  it.each(exceptionPrecedenceFixtures)('applies precedence so that $name keeps only the winning categories', async (fixture) => {
    const output = await buildRunFromRows(fixture.bankRows, fixture.qboRows);

    fixture.expectedPresent.forEach(({ category, count }) => {
      expect(countExceptionsByCategory(output, category)).toBe(count);
    });

    fixture.expectedAbsent.forEach((category) => {
      expect(countExceptionsByCategory(output, category)).toBe(0);
    });
  });

  it('triggers the full exception taxonomy from a single combined workbook pair', async () => {
    const combinedRows = buildAllExceptionsCombinedRows();
    const output = await buildRunFromRows(combinedRows.bankRows, combinedRows.qboRows);

    allExceptionCategories.forEach((category) => {
      expect(countExceptionsByCategory(output, category)).toBeGreaterThan(0);
    });
  });

  it('keeps stale outstanding precedence over missing fallback in a mixed residual run', async () => {
    const output = await buildRunFromRows(
      staleOutstandingMixedResidualBankFixture,
      staleOutstandingMixedResidualQboFixture,
    );

    expect(output.exceptions.filter((item) => item.category === 'StaleOutstandingCheck')).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromQBO')).toHaveLength(2);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

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
      expect.arrayContaining(['InvalidOrMissingData']),
    );
    expect(
      output.exceptions.some(
        (item) => item.category === 'DuplicateInBank' || item.category === 'DuplicateInQBO',
      ),
    ).toBe(true);
    expect(output.summary.exactMatches).toBeGreaterThanOrEqual(1);
    expect(output.summary.probableMatches).toBeGreaterThanOrEqual(1);
    expect(output.summary.duplicates).toBeGreaterThanOrEqual(1);
    expect(output.summary.dataQualityIssues).toBeGreaterThanOrEqual(1);
  });

  it('embeds the two summary chart images in the exported workbook', async () => {
    const output = await buildRun();
    const workbook = new ExcelJS.Workbook();
    const workbookPayload = Buffer.from(output.outputWorkbook.binary);

    await workbook.xlsx.load(
      workbookPayload as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );

    const summarySheet = workbook.getWorksheet('Summary');

    expect(summarySheet).toBeDefined();
    expect(summarySheet?.getImages().length).toBeGreaterThanOrEqual(2);
    expect((workbook.model.media ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('includes the detailed bank and QBO breakout rows on the Summary sheet', async () => {
    const output = await buildRun();
    const workbook = new ExcelJS.Workbook();
    const workbookPayload = Buffer.from(output.outputWorkbook.binary);

    await workbook.xlsx.load(
      workbookPayload as unknown as Parameters<typeof workbook.xlsx.load>[0],
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
        'Total date variances',
        'Net amount of items missing in QBO',
        'Net amount of items missing in bank',
        'Narrative Summary',
      ]),
    );

    const narrativeValues = summarySheet?.getColumn(1).values ?? [];
    const narrativeText = narrativeValues.find(
      (value) => typeof value === 'string' && value.includes('The reconciliation'),
    );

    expect(narrativeText).toEqual(expect.stringContaining('The reconciliation'));
    expect(narrativeText).toEqual(expect.stringContaining('OPERATING-001'));
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

  it('classifies timing differences when timing-compatible items fall outside primary tolerance but inside the timing window', async () => {
    const output = await buildRunFromRows(timingDifferenceBankRows, timingDifferenceQboRows);

    const timingItems = output.exceptions.filter((item) => item.category === 'TimingDifference');

    expect(timingItems).toHaveLength(2);
    expect(timingItems.every((item) => item.ruleTrace?.ruleId === 'timing-difference-reclassification')).toBe(true);
    expect(output.matchResults.some((item) => item.disposition === 'DateVariance')).toBe(true);
    expect(output.summary.timingDifferences).toBe(1);
    expect(output.summary.dateVariances).toBe(0);
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies one-to-many residual expense groupings as likely split/combine issues', async () => {
    const output = await buildRunFromRows(splitCombineBankRows, splitCombineQboRows);

    const groupedItems = output.exceptions.filter((item) => item.category === 'LikelySplitCombineIssue');

    expect(groupedItems).toHaveLength(3);
    expect(groupedItems.every((item) => item.ruleTrace?.ruleId === 'grouped-split-combine-residual')).toBe(true);
    expect(groupedItems.every((item) => item.ruleTrace?.evidence.some((entry) => entry.includes('bank=withdrawal')))).toBe(true);
    expect(output.summary.countsByCategory.LikelySplitCombineIssue).toBe(3);
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies grouped receipt batches as deposit grouping issues', async () => {
    const output = await buildRunFromRows(depositGroupingBankRows, depositGroupingQboRows);

    const groupedItems = output.exceptions.filter((item) => item.category === 'DepositGroupingIssue');

    expect(groupedItems).toHaveLength(3);
    expect(groupedItems.every((item) => item.ruleTrace?.ruleId === 'grouped-deposit-residual')).toBe(true);
    expect(groupedItems.every((item) => item.ruleTrace?.evidence.some((entry) => entry.includes('bank=deposit')))).toBe(true);
    expect(output.summary.countsByCategory.DepositGroupingIssue).toBe(3);
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('does not classify grouped near-miss totals as split/combine issues', async () => {
    const output = await buildRunFromRows(splitCombineNearMissBankFixture, splitCombineNearMissQboFixture);

    expect(output.exceptions.some((item) => item.category === 'LikelySplitCombineIssue')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(true);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromBank')).toHaveLength(2);
  });

  it('does not classify grouped deposits when the grouped side exceeds the supported residual limit', async () => {
    const output = await buildRunFromRows(depositGroupingOversizedBankFixture, depositGroupingOversizedQboFixture);

    expect(output.exceptions.some((item) => item.category === 'DepositGroupingIssue')).toBe(false);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromQBO')).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromBank')).toHaveLength(4);
  });

  it('preserves date variance when extended-window matches are not timing-compatible', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-04-01', 'CLIENT BATCH DEPOSIT', '', '', '3200.00', '8200.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-04-15', 'Journal Entry', '', 'Client Batch', 'Deposit clearing entry', '3200.00'],
      ],
    );

    const dateVariance = output.exceptions.filter((item) => item.category === 'DateVariance');

    expect(dateVariance).toHaveLength(1);
    expect(output.summary.dateVariances).toBe(1);
    expect(output.summary.timingDifferences).toBe(0);
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

  it('surfaces invalid QBO rows as data-quality exceptions', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-03-04', 'VALID BANK ROW', '', '250.00', '', '999.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['', 'Expense', '', 'Vendor', 'Missing qbo date', '-250.00'],
      ],
    );

    expect(
      output.exceptions.some(
        (item) => item.category === 'InvalidOrMissingData' && item.source === 'qbo',
      ),
    ).toBe(true);
  });

  it('classifies stale outstanding checks for aged unmatched QBO check disbursements', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-03-31', 'OPERATING ACTIVITY', '', '200.00', '', '800.00'],
        ['2025-04-30', 'MONTH-END ACTIVITY', '', '100.00', '', '700.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-02-10', 'Check', '1124', 'Vendor A', 'Uncleared check', '-150.00'],
      ],
    );

    const staleCheck = output.exceptions.find((item) => item.category === 'StaleOutstandingCheck');

    expect(staleCheck).toBeDefined();
    expect(staleCheck?.source).toBe('qbo');
    expect(staleCheck?.ruleTrace?.ruleId).toBe('stale-outstanding-check');
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
    expect(output.summary.countsByCategory.StaleOutstandingCheck).toBe(1);
  });

  it('classifies likely miscoding when same-amount near-date transactions conflict on context', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-03-10', 'ACME PAYROLL', '', '500.00', '', '9500.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-03-11', 'Expense', '', 'Office Depot', 'Office supplies', '-500.00'],
      ],
    );

    const miscodingItems = output.exceptions.filter((item) => item.category === 'LikelyMiscoding');

    expect(miscodingItems).toHaveLength(2);
    expect(miscodingItems.every((item) => item.ruleTrace?.ruleId === 'likely-miscoding')).toBe(true);
    expect(
      miscodingItems.every(
        (item) =>
          item.ruleTrace?.counterpart?.spreadsheetFileName === 'qbo-edge.xlsx' ||
          item.ruleTrace?.counterpart?.spreadsheetFileName === 'bank-edge.xlsx',
      ),
    ).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromQBO')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
    expect(output.summary.countsByCategory.LikelyMiscoding).toBe(2);
  });

  it('adds reviewer observations for missing months when annual reconciliation is selected', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-01-15', 'JAN ENTRY', '', '100.00', '', '900.00'],
        ['2025-03-15', 'MAR ENTRY', '', '200.00', '', '700.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-02-20', 'Expense', '', 'Vendor A', 'FEB ENTRY', '-150.00'],
        ['2025-04-20', 'Expense', '', 'Vendor B', 'APR ENTRY', '-175.00'],
      ],
      { reconciliationFrequency: 'Annual' },
    );

    const annualCoverageObservations = output.reviewerObservations.filter(
      (item) => item.title === 'Annual month coverage gap detected',
    );

    expect(annualCoverageObservations.length).toBeGreaterThanOrEqual(2);
    expect(
      annualCoverageObservations.some(
        (item) => item.message.includes('bank-edge.xlsx') && item.message.includes('Feb'),
      ),
    ).toBe(true);
    expect(
      annualCoverageObservations.some(
        (item) => item.message.includes('qbo-edge.xlsx') && item.message.includes('Jan'),
      ),
    ).toBe(true);
  });
});
