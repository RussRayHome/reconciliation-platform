import type {
  ExceptionItem,
  MatchResult,
  NormalizedTransaction,
  SummaryMetrics,
} from '@recon/domain';

import { buildChartSeries } from './chartData';

const sumAmounts = (items: Array<number | null | undefined>): number =>
  items.reduce<number>((total, amount) => total + (amount ?? 0), 0);

const buildExceptionCaseKey = (item: ExceptionItem): string => {
  if (item.relatedTransactionIds.length > 0) {
    return [...item.relatedTransactionIds]
      .sort((left, right) => left.localeCompare(right))
      .join('|');
  }

  return `${item.category}:${item.source}:${item.spreadsheetFileName}:${item.lineNumber}`;
};

const countExceptionCases = (
  exceptions: ExceptionItem[],
  category: ExceptionItem['category'],
): number =>
  new Set(
    exceptions
      .filter((item) => item.category === category)
      .map((item) => buildExceptionCaseKey(item)),
  ).size;

/**
 * Builds the full summary metrics object from the match engine output and classified
 * exceptions: transaction counts by source, match category totals, exception case
 * counts, and financial exposure figures.
 */
export const buildSummaryMetrics = (
  normalizedTransactions: NormalizedTransaction[],
  matchResults: MatchResult[],
  exceptions: ExceptionItem[],
): SummaryMetrics => {
  const exactMatches = matchResults.filter((result) => result.disposition === 'ExactMatch');
  const probableMatches = matchResults.filter((result) =>
    ['ProbableMatch', 'AmbiguousReview'].includes(result.disposition),
  );
  const bankRecords = normalizedTransactions.filter(
    (transaction) => transaction.source === 'bank' && !transaction.isExcluded,
  );
  const glRecords = normalizedTransactions.filter(
    (transaction) => transaction.source === 'gl' && !transaction.isExcluded,
  );

  const countsByCategory = Object.fromEntries(
    exceptions
      .map((item) => item.category)
      .reduce<Map<string, number>>((map, category) => {
        map.set(category, (map.get(category) ?? 0) + 1);
        return map;
      }, new Map()),
  );

  const amountByCategory = Object.fromEntries(
    exceptions.reduce<Map<string, number>>((map, item) => {
      map.set(item.category, (map.get(item.category) ?? 0) + Math.abs(item.amount ?? 0));
      return map;
    }, new Map()),
  );

  const missingFromBankItems = exceptions.filter((item) => item.category === 'MissingFromBank');
  const missingFromGlItems = exceptions.filter((item) => item.category === 'MissingFromGL');
  const dataQualityItems = exceptions.filter((item) => item.category === 'InvalidOrMissingData');
  const bankDataQualityItems = dataQualityItems.filter((item) => item.source === 'bank');
  const glDataQualityItems = dataQualityItems.filter((item) => item.source === 'gl');
  const bankDuplicateItems = exceptions.filter((item) => item.category === 'DuplicateInBank');
  const glDuplicateItems = exceptions.filter((item) => item.category === 'DuplicateInGL');
  const dateVarianceCount = countExceptionCases(exceptions, 'DateVariance');
  const timingDifferenceCount = countExceptionCases(exceptions, 'TimingDifference');

  const summary: SummaryMetrics = {
    totalRecordsReviewed: bankRecords.length + glRecords.length,
    bankRecords: bankRecords.length,
    glRecords: glRecords.length,
    exactMatches: exactMatches.length,
    probableMatches: probableMatches.length,
    unmatchedItems:
      missingFromBankItems.length +
      missingFromGlItems.length +
      bankDataQualityItems.length +
      glDataQualityItems.length,
    duplicates: bankDuplicateItems.length + glDuplicateItems.length,
    bankDuplicates: bankDuplicateItems.length,
    glDuplicates: glDuplicateItems.length,
    dateVariances: dateVarianceCount,
    timingDifferences: timingDifferenceCount,
    dataQualityIssues: dataQualityItems.length,
    amountMismatches: countsByCategory.AmountMismatch ?? 0,
    missingFromBank: missingFromBankItems.length,
    missingFromGL: missingFromGlItems.length,
    unmatchedBankNetAmount: sumAmounts(
      [...missingFromGlItems, ...bankDataQualityItems].map((item) => item.amount ?? 0),
    ),
    unmatchedGlNetAmount: sumAmounts(
      [...missingFromBankItems, ...glDataQualityItems].map((item) => item.amount ?? 0),
    ),
    cleanMatchedAmount: sumAmounts(
      exactMatches
        .map(
          (result) =>
            normalizedTransactions.find(
              (transaction) => transaction.id === result.bankTransactionId,
            )?.amount,
        )
        .filter((amount) => amount !== undefined),
    ),
    unresolvedExposure: sumAmounts(exceptions.map((item) => Math.abs(item.amount ?? 0))),
    countsByCategory,
    amountByCategory,
    charts: [],
  };

  summary.charts = buildChartSeries(summary);
  return summary;
};
