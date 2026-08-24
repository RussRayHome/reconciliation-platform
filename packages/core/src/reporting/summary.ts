import type {
  ExceptionItem,
  MatchResult,
  NormalizedTransaction,
  ReconciliationFrequency,
  SummaryMetrics,
} from '@recon/domain';
import { isCarryEligible } from '@recon/domain';

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
  staleOutstandingCheckDays = 45,
  reconciliationFrequency: ReconciliationFrequency = 'Monthly',
): SummaryMetrics => {
  const exactMatches = matchResults.filter((result) => result.disposition === 'ExactMatch');
  const probableMatches = matchResults.filter((result) =>
    ['ProbableMatch', 'AmbiguousReview'].includes(result.disposition),
  );
  // Carried-forward transactions (Unreconciled Item Roll-Forward PR D, §3.6) are seeded from a
  // prior period's open items, not parsed from this run's own uploaded files -- they don't belong
  // in "records reviewed this period" (bankRecords/glRecords feed totalRecordsReviewed below).
  // Their own contribution to this period's picture is the rollForward figures further down.
  const bankRecords = normalizedTransactions.filter(
    (transaction) =>
      transaction.source === 'bank' && !transaction.isExcluded && !transaction.isCarriedForward,
  );
  const glRecords = normalizedTransactions.filter(
    (transaction) =>
      transaction.source === 'gl' && !transaction.isExcluded && !transaction.isCarriedForward,
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

  // Roll-forward control-equation figures (PR D.4, §3.1): opening = this period's carried-forward
  // transactions (PR D.1's seed, regardless of outcome); cleared = the subset of those that found
  // a counterpart in this run's own matchResults; new = this period's own carry-eligible
  // exceptions whose underlying transaction is NOT carried forward (a genuinely fresh detection,
  // mirroring buildOpenItemCandidates' own eligibility filter without needing that function's
  // database-aware open/carriedForward split, which this pure reporting figure doesn't need).
  const carriedTransactions = normalizedTransactions.filter(
    (transaction) => transaction.isCarriedForward,
  );
  const matchedTransactionIds = new Set<string>();
  matchResults.forEach((result) => {
    if (result.bankTransactionId) {
      matchedTransactionIds.add(result.bankTransactionId);
    }
    if (result.glTransactionId) {
      matchedTransactionIds.add(result.glTransactionId);
    }
  });
  const clearedTransactions = carriedTransactions.filter((transaction) =>
    matchedTransactionIds.has(transaction.id),
  );
  const transactionById = new Map(normalizedTransactions.map((item) => [item.id, item]));
  const newItems = exceptions.filter((item) => {
    if (!isCarryEligible(item.category)) {
      return false;
    }
    const transactionId = item.relatedTransactionIds[0];
    const transaction = transactionId ? transactionById.get(transactionId) : undefined;
    return transaction !== undefined && !transaction.isCarriedForward;
  });
  const openingCount = carriedTransactions.length;
  const openingAmount = sumAmounts(carriedTransactions.map((t) => Math.abs(t.amount ?? 0)));
  const clearedCount = clearedTransactions.length;
  const clearedAmount = sumAmounts(clearedTransactions.map((t) => Math.abs(t.amount ?? 0)));
  const newCount = newItems.length;
  const newAmount = sumAmounts(newItems.map((item) => Math.abs(item.amount ?? 0)));

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
    rollForward: {
      openingCount,
      openingAmount,
      newCount,
      newAmount,
      clearedCount,
      clearedAmount,
      // Write-off has no mechanism yet (PR E) -- stays 0 so the control equation still ties
      // exactly (openingCount + newCount - clearedCount - 0 = closingCount) for every run today.
      writtenOffCount: 0,
      writtenOffAmount: 0,
      closingCount: openingCount + newCount - clearedCount,
      closingAmount: openingAmount + newAmount - clearedAmount,
    },
  };

  summary.charts = buildChartSeries(
    summary,
    exceptions,
    staleOutstandingCheckDays,
    reconciliationFrequency,
  );
  return summary;
};
