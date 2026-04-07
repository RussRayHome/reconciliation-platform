import type { ExceptionItem, MatchResult, NormalizedTransaction, SummaryMetrics } from '@recon/domain';

import { buildChartSeries } from './chartData';

const sumAmounts = (items: Array<number | null | undefined>): number =>
  items.reduce<number>((total, amount) => total + (amount ?? 0), 0);

const buildExceptionCaseKey = (item: ExceptionItem): string => {
  if (item.relatedTransactionIds.length > 0) {
    return [...item.relatedTransactionIds].sort((left, right) => left.localeCompare(right)).join('|');
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
  const qboRecords = normalizedTransactions.filter(
    (transaction) => transaction.source === 'qbo' && !transaction.isExcluded,
  );

  const countsByCategory = Object.fromEntries(
    exceptions.map((item) => item.category).reduce<Map<string, number>>((map, category) => {
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
  const missingFromQboItems = exceptions.filter((item) => item.category === 'MissingFromQBO');
  const dataQualityItems = exceptions.filter((item) => item.category === 'InvalidOrMissingData');
  const bankDataQualityItems = dataQualityItems.filter((item) => item.source === 'bank');
  const qboDataQualityItems = dataQualityItems.filter((item) => item.source === 'qbo');
  const bankDuplicateItems = exceptions.filter(
    (item) => item.category === 'DuplicateInBank',
  );
  const qboDuplicateItems = exceptions.filter(
    (item) => item.category === 'DuplicateInQBO',
  );
  const dateVarianceCount = countExceptionCases(exceptions, 'DateVariance');
  const timingDifferenceCount = countExceptionCases(exceptions, 'TimingDifference');

  const summary: SummaryMetrics = {
    totalRecordsReviewed: bankRecords.length + qboRecords.length,
    bankRecords: bankRecords.length,
    qboRecords: qboRecords.length,
    exactMatches: exactMatches.length,
    probableMatches: probableMatches.length,
    unmatchedItems:
      missingFromBankItems.length +
      missingFromQboItems.length +
      bankDataQualityItems.length +
      qboDataQualityItems.length,
    duplicates: bankDuplicateItems.length + qboDuplicateItems.length,
    bankDuplicates: bankDuplicateItems.length,
    qboDuplicates: qboDuplicateItems.length,
    dateVariances: dateVarianceCount,
    timingDifferences: timingDifferenceCount,
    dataQualityIssues: dataQualityItems.length,
    amountMismatches: countsByCategory.AmountMismatch ?? 0,
    missingFromBank: missingFromBankItems.length,
    missingFromQBO: missingFromQboItems.length,
    unmatchedBankNetAmount: sumAmounts(
      [...missingFromQboItems, ...bankDataQualityItems].map((item) => item.amount ?? 0),
    ),
    unmatchedQboNetAmount: sumAmounts(
      [...missingFromBankItems, ...qboDataQualityItems].map((item) => item.amount ?? 0),
    ),
    cleanMatchedAmount: sumAmounts(
      exactMatches
        .map((result) =>
          normalizedTransactions.find((transaction) => transaction.id === result.bankTransactionId)?.amount,
        )
        .filter((amount) => amount !== undefined),
    ),
    unresolvedExposure: sumAmounts(
      exceptions.map((item) => Math.abs(item.amount ?? 0)),
    ),
    countsByCategory,
    amountByCategory,
    charts: [],
  };

  summary.charts = buildChartSeries(summary);
  return summary;
};
