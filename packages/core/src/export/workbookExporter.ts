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
import { errorCategories, errorCategoryDisplayNames } from '@recon/domain';

import ExcelJS from 'exceljs';
import { createBarChartPng } from './chartImage';

const sourceDisplayName = (source: string): string => {
  if (source === 'bank') {
    return 'Bank';
  }

  if (source === 'gl') {
    return 'GL';
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
  const anchorCol = typeof anchor.col === 'number' ? anchor.col : Number(anchor.col);

  const headerRow = Number(anchor.row) + 1;
  worksheet.getCell(headerRow, anchorCol).value = 'Category';
  worksheet.getCell(headerRow, anchorCol + 1).value = formatAsCurrency
    ? 'Absolute Dollars'
    : 'Count';
  worksheet.getRow(headerRow).font = { bold: true };

  data.forEach((item, index) => {
    const rowNumber = headerRow + index + 1;
    worksheet.getCell(rowNumber, anchorCol).value = item.label;
    worksheet.getCell(rowNumber, anchorCol + 1).value = item.value;
    if (formatAsCurrency) {
      worksheet.getCell(rowNumber, anchorCol + 1).numFmt = '$#,##0.00';
    }
  });
};

const getCounterpartTraces = (item: ExceptionItem) =>
  item.ruleTrace?.counterparts?.length || !item.ruleTrace?.counterpart
    ? (item.ruleTrace?.counterparts ?? [])
    : [item.ruleTrace.counterpart];

const formatCounterparts = (item: ExceptionItem): string => {
  const counterparts = getCounterpartTraces(item);

  if (counterparts.length === 0) {
    return item.likelyMatchingReference ?? '';
  }

  return counterparts
    .map((counterpart) =>
      counterpart.spreadsheetFileName
        ? `${sourceDisplayName(counterpart.source ?? '')}: ${counterpart.spreadsheetFileName} / ${counterpart.lineNumber ?? 'N/A'}`
        : (counterpart.transactionId ?? 'N/A'),
    )
    .join(' | ');
};

const formatRuleLineage = (item: ExceptionItem): string => {
  const lineage = [...(item.priorRuleTraces ?? []), ...(item.ruleTrace ? [item.ruleTrace] : [])];

  if (lineage.length === 0) {
    return '';
  }

  return lineage
    .map((trace, index) => {
      const label = index === lineage.length - 1 ? 'Final' : 'Prior';
      return `${label}: ${trace.ruleName} (${trace.ruleId})`;
    })
    .join(' | ');
};

const buildNarrativeSummary = (
  summary: SummaryMetrics,
  accountIdentifier?: string,
  periodLabel?: string,
): string => {
  const trimmedAccount = accountIdentifier?.trim();
  const accountText = trimmedAccount ? ` for account ${trimmedAccount}` : '';
  const trimmedPeriod = periodLabel?.trim();
  const periodText = trimmedPeriod ? ` during ${trimmedPeriod}` : '';
  const hasNoCategorizedExceptions = [
    summary.missingFromBank,
    summary.missingFromGL,
    summary.amountMismatches,
    summary.dateVariances,
    summary.timingDifferences,
    summary.duplicates,
  ].every((count) => count === 0);
  let statusSentence = `The reconciliation${accountText}${periodText} requires follow-up on a limited set of outstanding exceptions.`;

  if (hasNoCategorizedExceptions) {
    statusSentence = `The reconciliation${accountText}${periodText} reconciles cleanly with no categorized exceptions requiring follow-up.`;
  }

  if (!hasNoCategorizedExceptions && summary.timingDifferences > 0) {
    statusSentence = `The reconciliation${accountText}${periodText} generally reconciles, with a meaningful share of remaining exceptions driven by timing-related differences.`;
  }

  const volumeSentence = `${summary.bankRecords} bank transactions and ${summary.glRecords} GL transactions were reviewed, producing ${summary.exactMatches} exact matches and ${summary.probableMatches} probable matches.`;

  const categorySummary = errorCategories
    .filter((category) => (summary.countsByCategory[category] ?? 0) > 0)
    .map(
      (category) =>
        `${summary.countsByCategory[category]} ${errorCategoryDisplayNames[category].toLowerCase()}`,
    );
  const exceptionSentence =
    categorySummary.length > 0
      ? `Categorized exceptions include ${categorySummary.join(', ')}.`
      : 'No classified follow-up categories remain open.';

  return `${statusSentence} ${volumeSentence} ${exceptionSentence}`;
};

const addCategoryBreakdownTable = (worksheet: ExcelJS.Worksheet, summary: SummaryMetrics): void => {
  const presentCategories = errorCategories.filter(
    (category) =>
      (summary.countsByCategory[category] ?? 0) > 0 ||
      (summary.amountByCategory[category] ?? 0) > 0,
  );

  if (presentCategories.length === 0) {
    return;
  }

  worksheet.addRow([]);
  const headingRow = worksheet.addRow(['Exception Category Breakdown']);
  headingRow.getCell(1).font = { bold: true };

  const headerRow = worksheet.addRow(['Category', 'Count', 'Absolute Dollars']);
  headerRow.font = { bold: true };

  presentCategories.forEach((category) => {
    const row = worksheet.addRow([
      errorCategoryDisplayNames[category],
      summary.countsByCategory[category] ?? 0,
      summary.amountByCategory[category] ?? 0,
    ]);
    row.getCell(3).numFmt = '$#,##0.00;[Red]-$#,##0.00';
  });
};

const addSummaryCharts = (
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  summary: SummaryMetrics,
  accountIdentifier?: string,
): void => {
  const trimmedAccount = accountIdentifier?.trim();
  const accountLabel = trimmedAccount || 'Reconciliation';
  const countChartData = summary.charts.find((chart) => chart.id === 'countByCategory')?.data ?? [];
  const exposureChartData = (
    summary.charts.find((chart) => chart.id === 'exposureByCategory')?.data ?? []
  ).filter((item) => item.value > 0);

  const resolvedExposureData =
    exposureChartData.length > 0
      ? exposureChartData
      : [{ label: 'No classified exception exposure', value: 0 }];

  worksheet.getCell('D2').value = `${accountLabel} Reconciliation Summary by Category`;
  worksheet.getCell('D2').font = { bold: true, size: 16 };
  worksheet.mergeCells('D2:K2');

  worksheet.getCell('D29').value = `${accountLabel} Categorized Exception Dollar Exposure`;
  worksheet.getCell('D29').font = { bold: true, size: 16 };
  worksheet.mergeCells('D29:J29');

  addChartDataTable(worksheet, 'D22', 'Summary chart data', countChartData, false);
  addChartDataTable(worksheet, 'D49', 'Exposure chart data', resolvedExposureData, true);

  const countChartPng = createBarChartPng(countChartData, {
    width: 960,
    height: 420,
    barColor: [43, 120, 178, 255],
    accentColor: [15, 118, 110, 255],
  });

  const countChartImageId = workbook.addImage({
    base64: `data:image/png;base64,${countChartPng.toString('base64')}`,
    extension: 'png',
  });

  worksheet.addImage(countChartImageId, {
    tl: { col: 3, row: 2.4 },
    ext: { width: 760, height: 300 },
  });

  const exposureChartPng = createBarChartPng(resolvedExposureData, {
    width: 880,
    height: 420,
    barColor: [194, 65, 12, 255],
    accentColor: [166, 27, 67, 255],
  });

  const exposureChartImageId = workbook.addImage({
    base64: `data:image/png;base64,${exposureChartPng.toString('base64')}`,
    extension: 'png',
  });

  worksheet.addImage(exposureChartImageId, {
    tl: { col: 3, row: 29.4 },
    ext: { width: 700, height: 300 },
  });

  // Row 95 gives the exposure table above (up to errorCategories.length rows starting at D49) a
  // safe margin even in the worst case of every category having nonzero exposure -- the aging
  // table itself is always exactly 4 rows (fixed buckets), so no similar margin is needed below it.
  const agingChartData = summary.charts.find((chart) => chart.id === 'outstandingCheckAging')?.data ?? [];

  worksheet.getCell('D95').value = `${accountLabel} Outstanding Check Aging`;
  worksheet.getCell('D95').font = { bold: true, size: 16 };
  worksheet.mergeCells('D95:J95');

  addChartDataTable(worksheet, 'D115', 'Aging chart data', agingChartData, false);

  const agingChartPng = createBarChartPng(agingChartData, {
    width: 700,
    height: 360,
    barColor: [242, 183, 5, 255],
    accentColor: [166, 120, 5, 255],
  });

  const agingChartImageId = workbook.addImage({
    base64: `data:image/png;base64,${agingChartPng.toString('base64')}`,
    extension: 'png',
  });

  worksheet.addImage(agingChartImageId, {
    tl: { col: 3, row: 95.4 },
    ext: { width: 600, height: 260 },
  });
};

/** All inputs needed to generate the multi-tab reconciliation workbook export. */
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

/**
 * Generates the multi-tab XLSX reconciliation workbook: Summary, Probable Matches,
 * Exceptions, Transaction Detail, and embedded charts. Returns a buffer suitable for
 * HTTP response or file write.
 */
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
    { label: 'Total GL transactions reviewed', value: summary.glRecords, numFmt: '#,##0' },
    { label: 'Total exact matches', value: summary.exactMatches, numFmt: '#,##0' },
    { label: 'Total probable matches', value: summary.probableMatches, numFmt: '#,##0' },
    { label: 'Total items missing in GL', value: summary.missingFromGL, numFmt: '#,##0' },
    { label: 'Total items missing in bank', value: summary.missingFromBank, numFmt: '#,##0' },
    { label: 'Total amount mismatches', value: summary.amountMismatches, numFmt: '#,##0' },
    { label: 'Total duplicates in bank', value: summary.bankDuplicates, numFmt: '#,##0' },
    { label: 'Total duplicates in GL', value: summary.glDuplicates, numFmt: '#,##0' },
    { label: 'Total date variances', value: summary.dateVariances, numFmt: '#,##0' },
    { label: 'Total timing differences', value: summary.timingDifferences, numFmt: '#,##0' },
    { label: 'Total data-quality issues', value: summary.dataQualityIssues, numFmt: '#,##0' },
    {
      label: 'Net amount of items missing in GL',
      value: summary.unmatchedBankNetAmount,
      numFmt: '$#,##0.00;[Red]-$#,##0.00',
    },
    {
      label: 'Net amount of items missing in bank',
      value: summary.unmatchedGlNetAmount,
      numFmt: '$#,##0.00;[Red]-$#,##0.00',
    },
    {
      label: 'Categorized Exception Exposure',
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

  addCategoryBreakdownTable(summarySheet, summary);

  summarySheet.getColumn(1).font = { bold: true };
  addSummaryCharts(workbook, summarySheet, summary, accountIdentifier);

  const assumptionsSheet = workbook.addWorksheet('Mapping and Assumptions');
  assumptionsSheet.addRows([
    ['Bank Header Row', config.bank.headerRow],
    ['Bank Transaction Start Row', config.bank.transactionStartRow],
    ['GL Header Row', config.gl.headerRow],
    ['GL Transaction Start Row', config.gl.transactionStartRow],
    ['Exclude GL Beginning Balance', String(config.gl.excludeBeginningBalance)],
    ['Date Tolerance Days', config.matching.dateToleranceDays],
    ['Timing Difference Window', config.matching.timingDifferenceDays],
    ['Probable Similarity Threshold', config.matching.probableTextSimilarityThreshold],
  ]);
  assumptionsSheet.getColumn(1).font = { bold: true };

  const errorReportSheet = workbook.addWorksheet('Error Report');
  addHeaderRow(errorReportSheet, [
    'Severity',
    'Category',
    'Rule',
    'Source',
    'File Name',
    'Line Number',
    'Transaction Date',
    'Amount',
    'Reason',
    'Message',
    'Evidence',
    'Next Actions',
    'Counterparts',
    'Rule Lineage',
    'Reviewer Notes',
  ]);
  exceptions.forEach((item) => {
    errorReportSheet.addRow([
      item.severity,
      errorCategoryDisplayNames[item.category] ?? item.category,
      item.ruleTrace?.ruleName ?? '',
      sourceDisplayName(item.source),
      item.spreadsheetFileName,
      item.lineNumber,
      item.transactionDate ?? '',
      item.amount ?? '',
      item.ruleTrace?.reason ?? '',
      item.errorMessage,
      (item.ruleTrace?.evidence ?? []).join(' | '),
      item.recommendedNextActions.join(' | '),
      formatCounterparts(item),
      formatRuleLineage(item),
      item.reviewerNotes ?? '',
    ]);
  });

  const probableSheet = workbook.addWorksheet('Probable Matches Review');
  addHeaderRow(probableSheet, [
    'Disposition',
    'Confidence',
    'Rule',
    'Bank Transaction ID',
    'GL Transaction ID',
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
      item.glTransactionId ?? '',
      item.dateDifferenceDays ?? '',
      item.amountDifference,
      item.evidence.join(' | '),
    ]);
  });

  const observationsSheet = workbook.addWorksheet('Reviewer Observations');
  addHeaderRow(observationsSheet, ['Severity', 'Category', 'Title', 'Message', 'Created At']);
  reviewerObservations.forEach((item) => {
    observationsSheet.addRow([
      item.severity,
      item.category,
      item.title,
      item.message,
      item.createdAt,
    ]);
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

  const glSheet = workbook.addWorksheet('GL Normalized');
  addHeaderRow(glSheet, [
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
    .filter((transaction) => transaction.source === 'gl')
    .forEach((item) => {
      glSheet.addRow([
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
