import type {
  ChartMetricDatum,
  ExceptionItem,
  MatchResult,
  NormalizedTransaction,
  OutputWorkbook,
  ReconciliationConfig,
  ReviewerObservation,
  SummaryMetrics,
} from '@recon/domain';

import ExcelJS from 'exceljs';
import { createBarChartPng } from './chartImage';

const categoryDisplayName: Record<string, string> = {
  MissingFromBank: 'Missing from Bank',
  MissingFromQBO: 'Missing from QBO',
  AmountMismatch: 'Amount Mismatch',
  DuplicateTransaction: 'Duplicate Transaction',
  TimingDifference: 'Timing Difference',
  CheckNumberMismatch: 'Check Number Mismatch',
  ReferenceNumberMismatch: 'Reference Number Mismatch',
  DescriptionMerchantVariance: 'Description/Merchant Variance',
  InvalidOrMissingData: 'Invalid or Missing Data',
  AmbiguousMatchRequiringReview: 'Ambiguous Match Requiring Review',
};

const sourceDisplayName = (source: string): string => {
  if (source === 'bank') {
    return 'Bank';
  }

  if (source === 'qbo') {
    return 'QBO';
  }

  return source;
};

const addHeaderRow = (worksheet: ExcelJS.Worksheet, headers: string[]): void => {
  worksheet.addRow(headers);
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
};

const stringifyWorksheetValue = (value: ExcelJS.CellValue | undefined): string => {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return JSON.stringify(value);
};

const setAutoWidth = (worksheet: ExcelJS.Worksheet): void => {
  worksheet.columns.forEach((column) => {
    let maxLength = 12;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const value = stringifyWorksheetValue(cell.value);
      maxLength = Math.max(maxLength, Math.min(48, value.length + 2));
    });
    column.width = maxLength;
  });
};

const addChartDataTable = (
  worksheet: ExcelJS.Worksheet,
  startCell: string,
  heading: string,
  data: ChartMetricDatum[],
  formatAsCurrency = false,
): void => {
  const anchor = worksheet.getCell(startCell);
  anchor.value = heading;
  anchor.font = { bold: true, size: 12 };

  const headerRow = anchor.row + 1;
  worksheet.getCell(headerRow, anchor.col).value = 'Category';
  worksheet.getCell(headerRow, anchor.col + 1).value = formatAsCurrency ? 'Absolute Dollars' : 'Count';
  worksheet.getRow(headerRow).font = { bold: true };

  data.forEach((item, index) => {
    const rowNumber = headerRow + index + 1;
    worksheet.getCell(rowNumber, anchor.col).value = item.label;
    worksheet.getCell(rowNumber, anchor.col + 1).value = item.value;
    if (formatAsCurrency) {
      worksheet.getCell(rowNumber, anchor.col + 1).numFmt = '$#,##0.00';
    }
  });
};

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const buildNarrativeSummary = (
  summary: SummaryMetrics,
  accountIdentifier?: string,
  periodLabel?: string,
): string => {
  const trimmedAccount = accountIdentifier?.trim();
  const accountText = trimmedAccount ? ` for account ${trimmedAccount}` : '';
  const trimmedPeriod = periodLabel?.trim();
  const periodText = trimmedPeriod ? ` during ${trimmedPeriod}` : '';
  let statusSentence = `The reconciliation${accountText}${periodText} requires follow-up on a limited set of outstanding exceptions.`;

  if (summary.unmatchedItems === 0 && summary.amountMismatches === 0) {
    statusSentence = `The reconciliation${accountText}${periodText} reconciles cleanly with no unmatched items or amount mismatches.`;
  } else if (summary.timingDifferences > 0) {
    statusSentence = `The reconciliation${accountText}${periodText} generally reconciles, with most remaining exceptions driven by timing-related differences.`;
  }

  const volumeSentence = `${summary.bankRecords} bank transactions and ${summary.qboRecords} QBO transactions were reviewed, producing ${summary.exactMatches} exact matches and ${summary.probableMatches} probable matches.`;

  const unmatchedBankTransactions = summary.missingFromQBO + summary.dataQualityIssues;
  const exceptionSentence = `Outstanding items include ${unmatchedBankTransactions} unmatched bank transactions totaling ${formatCurrency(summary.unmatchedBankNetAmount)}, ${summary.missingFromBank} unmatched QBO transactions totaling ${formatCurrency(summary.unmatchedQboNetAmount)}, ${summary.bankDuplicates} bank duplicates, ${summary.qboDuplicates} QBO duplicates, and ${summary.dataQualityIssues} data-quality issues.`;

  return `${statusSentence} ${volumeSentence} ${exceptionSentence}`;
};

const addSummaryCharts = (
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  summary: SummaryMetrics,
  accountIdentifier?: string,
): void => {
  const trimmedAccount = accountIdentifier?.trim();
  const accountLabel = trimmedAccount || 'Reconciliation';
  const countChartData =
    summary.charts.find((chart) => chart.id === 'countByCategory')?.data ?? [];
  const exposureChartData =
    (summary.charts.find((chart) => chart.id === 'exposureByCategory')?.data ?? [])
      .map((item) => ({
        label: categoryDisplayName[item.label] ?? item.label,
        value: item.value,
      }))
      .filter((item) => item.value > 0);

  const resolvedExposureData = exposureChartData.length > 0
    ? exposureChartData
    : [{ label: 'No unreconciled exposure', value: 0 }];

  worksheet.getCell('D2').value = `${accountLabel} Reconciliation Summary by Category`;
  worksheet.getCell('D2').font = { bold: true, size: 16 };
  worksheet.mergeCells('D2:K2');

  worksheet.getCell('D29').value = `${accountLabel} Unreconciled Dollar Exposure`;
  worksheet.getCell('D29').font = { bold: true, size: 16 };
  worksheet.mergeCells('D29:J29');

  addChartDataTable(worksheet, 'D22', 'Summary chart data', countChartData, false);
  addChartDataTable(worksheet, 'D49', 'Exposure chart data', resolvedExposureData, true);

  const countChartImageId = workbook.addImage({
    buffer: createBarChartPng(countChartData, {
      width: 960,
      height: 420,
      barColor: [43, 120, 178, 255],
      accentColor: [15, 118, 110, 255],
    }),
    extension: 'png',
  });

  worksheet.addImage(countChartImageId, {
    tl: { col: 3, row: 2.4 },
    ext: { width: 760, height: 300 },
  });

  const exposureChartImageId = workbook.addImage({
    buffer: createBarChartPng(resolvedExposureData, {
      width: 880,
      height: 420,
      barColor: [194, 65, 12, 255],
      accentColor: [166, 27, 67, 255],
    }),
    extension: 'png',
  });

  worksheet.addImage(exposureChartImageId, {
    tl: { col: 3, row: 29.4 },
    ext: { width: 700, height: 300 },
  });
};

export interface WorkbookExportInput {
  runId: string;
  accountIdentifier?: string;
  periodLabel?: string;
  config: ReconciliationConfig;
  summary: SummaryMetrics;
  exceptions: ExceptionItem[];
  probableMatches: MatchResult[];
  reviewerObservations: ReviewerObservation[];
  normalizedTransactions: NormalizedTransaction[];
}

export const exportWorkbook = async ({
  runId,
  accountIdentifier,
  periodLabel,
  config,
  summary,
  exceptions,
  probableMatches,
  reviewerObservations,
  normalizedTransactions,
}: WorkbookExportInput): Promise<OutputWorkbook> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GitHub Copilot';
  workbook.created = new Date();
  workbook.modified = new Date();

  const summarySheet = workbook.addWorksheet('Summary');
  const summaryRows: Array<{ label: string; value: string | number; numFmt?: string }> = [
    { label: 'Reconciliation Run ID', value: runId },
    { label: 'Account Identifier', value: accountIdentifier ?? 'Not provided' },
    { label: 'Period', value: periodLabel ?? 'Not provided' },
    { label: 'Total records reviewed', value: summary.totalRecordsReviewed, numFmt: '#,##0' },
    { label: 'Total bank transactions reviewed', value: summary.bankRecords, numFmt: '#,##0' },
    { label: 'Total QBO transactions reviewed', value: summary.qboRecords, numFmt: '#,##0' },
    { label: 'Total exact matches', value: summary.exactMatches, numFmt: '#,##0' },
    { label: 'Total probable matches', value: summary.probableMatches, numFmt: '#,##0' },
    {
      label: 'Total unmatched bank transactions',
      value: summary.missingFromQBO + summary.dataQualityIssues,
      numFmt: '#,##0',
    },
    { label: 'Total unmatched QBO transactions', value: summary.missingFromBank, numFmt: '#,##0' },
    { label: 'Total amount mismatches', value: summary.amountMismatches, numFmt: '#,##0' },
    { label: 'Total duplicates in bank', value: summary.bankDuplicates, numFmt: '#,##0' },
    { label: 'Total duplicates in QBO', value: summary.qboDuplicates, numFmt: '#,##0' },
    { label: 'Total timing differences', value: summary.timingDifferences, numFmt: '#,##0' },
    { label: 'Total data-quality issues', value: summary.dataQualityIssues, numFmt: '#,##0' },
    {
      label: 'Net amount of unmatched bank transactions',
      value: summary.unmatchedBankNetAmount,
      numFmt: '$#,##0.00;[Red]-$#,##0.00',
    },
    {
      label: 'Net amount of unmatched QBO transactions',
      value: summary.unmatchedQboNetAmount,
      numFmt: '$#,##0.00;[Red]-$#,##0.00',
    },
    {
      label: 'Unresolved Exposure',
      value: summary.unresolvedExposure,
      numFmt: '$#,##0.00;[Red]-$#,##0.00',
    },
  ];

  summaryRows.forEach((item) => {
    const row = summarySheet.addRow([item.label, item.value]);
    if (item.numFmt) {
      row.getCell(2).numFmt = item.numFmt;
    }
  });

  summarySheet.addRow([]);
  const narrativeHeadingRow = summarySheet.addRow(['Narrative Summary']);
  narrativeHeadingRow.getCell(1).font = { bold: true };

  const narrativeBodyRow = summarySheet.addRow([
    buildNarrativeSummary(summary, accountIdentifier, periodLabel),
  ]);
  summarySheet.mergeCells(`A${narrativeBodyRow.number}:B${narrativeBodyRow.number}`);
  narrativeBodyRow.height = 54;
  narrativeBodyRow.getCell(1).alignment = { wrapText: true, vertical: 'top' };

  summarySheet.getColumn(1).font = { bold: true };
  addSummaryCharts(workbook, summarySheet, summary, accountIdentifier);

  const assumptionsSheet = workbook.addWorksheet('Mapping and Assumptions');
  assumptionsSheet.addRows([
    ['Bank Header Row', config.bank.headerRow],
    ['Bank Transaction Start Row', config.bank.transactionStartRow],
    ['QBO Header Row', config.qbo.headerRow],
    ['QBO Transaction Start Row', config.qbo.transactionStartRow],
    ['Exclude QBO Beginning Balance', String(config.qbo.excludeBeginningBalance)],
    ['Date Tolerance Days', config.matching.dateToleranceDays],
    ['Timing Difference Window', config.matching.timingDifferenceDays],
    ['Probable Similarity Threshold', config.matching.probableTextSimilarityThreshold],
  ]);
  assumptionsSheet.getColumn(1).font = { bold: true };

  const errorReportSheet = workbook.addWorksheet('Error Report');
  addHeaderRow(errorReportSheet, [
    'Severity',
    'Category',
    'Source',
    'File Name',
    'Line Number',
    'Transaction Date',
    'Amount',
    'Message',
    'Likely Matching Reference',
    'Reviewer Notes',
  ]);
  exceptions.forEach((item) => {
    errorReportSheet.addRow([
      item.severity,
      categoryDisplayName[item.category] ?? item.category,
      sourceDisplayName(item.source),
      item.spreadsheetFileName,
      item.lineNumber,
      item.transactionDate ?? '',
      item.amount ?? '',
      item.errorMessage,
      item.likelyMatchingReference ?? '',
      item.reviewerNotes ?? '',
    ]);
  });

  const probableSheet = workbook.addWorksheet('Probable Matches Review');
  addHeaderRow(probableSheet, [
    'Disposition',
    'Confidence',
    'Rule',
    'Bank Transaction ID',
    'QBO Transaction ID',
    'Date Difference',
    'Amount Difference',
    'Evidence',
  ]);
  probableMatches.forEach((item) => {
    probableSheet.addRow([
      item.disposition,
      item.confidence,
      item.ruleName,
      item.bankTransactionId ?? '',
      item.qboTransactionId ?? '',
      item.dateDifferenceDays ?? '',
      item.amountDifference,
      item.evidence.join(' | '),
    ]);
  });

  const observationsSheet = workbook.addWorksheet('Reviewer Observations');
  addHeaderRow(observationsSheet, ['Severity', 'Category', 'Title', 'Message', 'Created At']);
  reviewerObservations.forEach((item) => {
    observationsSheet.addRow([item.severity, item.category, item.title, item.message, item.createdAt]);
  });

  const bankSheet = workbook.addWorksheet('Bank Normalized');
  addHeaderRow(bankSheet, [
    'Line Number',
    'Transaction Date',
    'Posting Date',
    'Description',
    'Merchant',
    'Payee',
    'Amount',
    'Reference',
    'Check',
    'Tokens',
    'Data Quality Issues',
  ]);
  normalizedTransactions
    .filter((transaction) => transaction.source === 'bank')
    .forEach((item) => {
      bankSheet.addRow([
        item.lineNumber,
        item.transactionDate ?? '',
        item.postingDate ?? '',
        item.description ?? '',
        item.merchantName ?? '',
        item.payeeName ?? '',
        item.amount ?? '',
        item.referenceNumber ?? '',
        item.checkNumber ?? '',
        item.normalizedComparisonTokens.join(', '),
        item.dataQualityIssues.join(' | '),
      ]);
    });

  const qboSheet = workbook.addWorksheet('QBO Normalized');
  addHeaderRow(qboSheet, [
    'Line Number',
    'Transaction Date',
    'Posting Date',
    'Description',
    'Merchant',
    'Payee',
    'Amount',
    'Reference',
    'Check',
    'Tokens',
    'Exclusion Reason',
  ]);
  normalizedTransactions
    .filter((transaction) => transaction.source === 'qbo')
    .forEach((item) => {
      qboSheet.addRow([
        item.lineNumber,
        item.transactionDate ?? '',
        item.postingDate ?? '',
        item.description ?? '',
        item.merchantName ?? '',
        item.payeeName ?? '',
        item.amount ?? '',
        item.referenceNumber ?? '',
        item.checkNumber ?? '',
        item.normalizedComparisonTokens.join(', '),
        item.exclusionReason ?? '',
      ]);
    });

  workbook.worksheets.forEach(setAutoWidth);

  const binary = await workbook.xlsx.writeBuffer();
  const uint8Array = binary instanceof Uint8Array ? binary : new Uint8Array(binary);

  return {
    fileName: `${accountIdentifier ?? 'reconciliation'}-${runId}.xlsx`,
    generatedAt: new Date().toISOString(),
    tabNames: workbook.worksheets.map((sheet) => sheet.name),
    binary: uint8Array,
  };
};
