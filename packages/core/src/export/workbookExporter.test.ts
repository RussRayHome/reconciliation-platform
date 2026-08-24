import { describe, expect, it } from 'vitest';

import ExcelJS from 'exceljs';
import { defaultReconciliationConfig } from '@recon/config';
import { exportWorkbook } from './workbookExporter';

describe('exportWorkbook', () => {
  it('writes the exception category breakdown for taxonomy-only categories', async () => {
    const workbookOutput = await exportWorkbook({
      runId: 'export-test-run',
      accountIdentifier: 'OPERATING-001',
      periodLabel: 'March 2026',
      config: defaultReconciliationConfig,
      summary: {
        totalRecordsReviewed: 4,
        bankRecords: 2,
        glRecords: 2,
        exactMatches: 1,
        probableMatches: 0,
        unmatchedItems: 2,
        duplicates: 0,
        bankDuplicates: 0,
        glDuplicates: 0,
        dateVariances: 0,
        timingDifferences: 0,
        dataQualityIssues: 0,
        amountMismatches: 0,
        missingFromBank: 0,
        missingFromGL: 0,
        unmatchedBankNetAmount: 0,
        unmatchedGlNetAmount: 0,
        cleanMatchedAmount: 500,
        unresolvedExposure: 660,
        countsByCategory: {
          LikelySplitCombineIssue: 1,
          DepositGroupingIssue: 1,
        },
        amountByCategory: {
          LikelySplitCombineIssue: 250,
          DepositGroupingIssue: 410,
        },
        charts: [
          {
            id: 'countByCategory',
            title: 'Counts by Category',
            data: [
              { label: 'Exact Matches', value: 1 },
              { label: 'Likely Split/Combine Issue', value: 1 },
              { label: 'Deposit Grouping Issue', value: 1 },
            ],
          },
          {
            id: 'exposureByCategory',
            title: 'Dollar Exposure by Exception Category',
            data: [
              { label: 'Likely Split/Combine Issue', value: 250 },
              { label: 'Deposit Grouping Issue', value: 410 },
            ],
          },
        ],
        rollForward: {
          openingCount: 0,
          openingAmount: 0,
          newCount: 0,
          newAmount: 0,
          clearedCount: 0,
          clearedAmount: 0,
          writtenOffCount: 0,
          writtenOffAmount: 0,
          closingCount: 0,
          closingAmount: 0,
        },
      },
      exceptions: [
        {
          id: 'split-1',
          runId: 'export-test-run',
          category: 'LikelySplitCombineIssue',
          severity: 'High',
          source: 'bank',
          spreadsheetFileName: 'bank.xlsx',
          lineNumber: 3,
          amount: -250,
          errorMessage: 'Likely split/combine issue',
          recommendedNextActions: ['Review grouped relationships.'],
          normalizedComparisonTokens: ['GROUPED'],
          relatedTransactionIds: ['bank-3', 'gl-4', 'gl-5'],
        },
        {
          id: 'deposit-1',
          runId: 'export-test-run',
          category: 'DepositGroupingIssue',
          severity: 'High',
          source: 'gl',
          spreadsheetFileName: 'gl.xlsx',
          lineNumber: 9,
          amount: 410,
          errorMessage: 'Deposit grouping issue',
          recommendedNextActions: ['Review deposit batch support.'],
          normalizedComparisonTokens: ['DEPOSIT'],
          relatedTransactionIds: ['bank-9', 'gl-9', 'gl-10'],
        },
      ],
      probableMatches: [],
      reviewerObservations: [],
      normalizedTransactions: [],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      workbookOutput.binary as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0],
    );

    const summarySheet = workbook.getWorksheet('Summary');
    const summaryLabels = summarySheet
      ?.getColumn(1)
      .values.filter((value) => typeof value === 'string') as string[];

    expect(summaryLabels).toEqual(
      expect.arrayContaining([
        'Exception Category Breakdown',
        'Likely Split/Combine Issue',
        'Deposit Grouping Issue',
      ]),
    );
  });

  it('writes the Roll-Forward Summary tab from SummaryMetrics.rollForward (PR F.5)', async () => {
    const workbookOutput = await exportWorkbook({
      runId: 'export-test-run-rollforward',
      accountIdentifier: 'OPERATING-001',
      periodLabel: 'March 2026',
      config: defaultReconciliationConfig,
      summary: {
        totalRecordsReviewed: 2,
        bankRecords: 1,
        glRecords: 1,
        exactMatches: 0,
        probableMatches: 0,
        unmatchedItems: 0,
        duplicates: 0,
        bankDuplicates: 0,
        glDuplicates: 0,
        dateVariances: 0,
        timingDifferences: 0,
        dataQualityIssues: 0,
        amountMismatches: 0,
        missingFromBank: 0,
        missingFromGL: 0,
        unmatchedBankNetAmount: 0,
        unmatchedGlNetAmount: 0,
        cleanMatchedAmount: 0,
        unresolvedExposure: 0,
        countsByCategory: {},
        amountByCategory: {},
        charts: [],
        rollForward: {
          openingCount: 3,
          openingAmount: -450,
          newCount: 1,
          newAmount: -75,
          clearedCount: 1,
          clearedAmount: -125.5,
          writtenOffCount: 0,
          writtenOffAmount: 0,
          closingCount: 3,
          closingAmount: -399.5,
        },
      },
      exceptions: [],
      probableMatches: [],
      reviewerObservations: [],
      normalizedTransactions: [],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      workbookOutput.binary as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0],
    );

    expect(workbookOutput.tabNames).toContain('Roll-Forward Summary');

    const rollForwardSheet = workbook.getWorksheet('Roll-Forward Summary');
    const rows = rollForwardSheet?.getRows(1, 6)?.map((row) => [row.getCell(1).text, row.getCell(2).value, row.getCell(3).value]);

    expect(rows).toEqual([
      ['Line', 'Count', 'Amount'],
      ['Opening (carried in from prior period)', 3, -450],
      ['New this period', 1, -75],
      ['Cleared this period', 1, -125.5],
      ['Written off this period', 0, 0],
      ['Closing (carries into next period)', 3, -399.5],
    ]);
  });
});
