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
        qboRecords: 2,
        exactMatches: 1,
        probableMatches: 0,
        unmatchedItems: 2,
        duplicates: 0,
        bankDuplicates: 0,
        qboDuplicates: 0,
        dateVariances: 0,
        timingDifferences: 0,
        dataQualityIssues: 0,
        amountMismatches: 0,
        missingFromBank: 0,
        missingFromQBO: 0,
        unmatchedBankNetAmount: 0,
        unmatchedQboNetAmount: 0,
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
          relatedTransactionIds: ['bank-3', 'qbo-4', 'qbo-5'],
        },
        {
          id: 'deposit-1',
          runId: 'export-test-run',
          category: 'DepositGroupingIssue',
          severity: 'High',
          source: 'qbo',
          spreadsheetFileName: 'qbo.xlsx',
          lineNumber: 9,
          amount: 410,
          errorMessage: 'Deposit grouping issue',
          recommendedNextActions: ['Review deposit batch support.'],
          normalizedComparisonTokens: ['DEPOSIT'],
          relatedTransactionIds: ['bank-9', 'qbo-9', 'qbo-10'],
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
      .values
      .filter((value) => typeof value === 'string') as string[];

    expect(summaryLabels).toEqual(
      expect.arrayContaining([
        'Exception Category Breakdown',
        'Likely Split/Combine Issue',
        'Deposit Grouping Issue',
      ]),
    );
  });
});