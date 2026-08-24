import type { NormalizedTransaction, OpenItemRecord, TextNormalizationConfig } from '@recon/domain';

import { buildComparisonTokens, buildContextFingerprint, normalizeText } from '../normalization/text';
import { deriveNaturalKey } from './naturalKey';

/**
 * Turns one still-`OPEN` item back into a `NormalizedTransaction` the matching engine can pair
 * against this period's fresh data (Unreconciled Item Roll-Forward PR D.1, §3.6). Preserves the
 * item's **original** date and amount (not "today") so aging keeps accumulating correctly across
 * however many periods it has now carried through.
 *
 * Text fields (`normalizedComparisonText`/Tokens, `contextFingerprint`) are recomputed from
 * `descriptionSnapshot` using the exact same helpers `normalization/transactions.ts` uses for a
 * freshly-parsed row -- for a Tier-3 (fingerprint-only) item this reproduces the identical
 * fingerprint it was first opened with, since every input (source, date, amount, check/reference
 * number, normalized text) is preserved unchanged; `deriveNaturalKey`'s own doc comment already
 * relies on that determinism.
 */
const materializeCarriedTransaction = (
  runId: string,
  item: OpenItemRecord,
  textNormalization: TextNormalizationConfig,
): NormalizedTransaction => {
  const normalizedComparisonText = normalizeText(item.descriptionSnapshot, textNormalization);
  const normalizedComparisonTokens = buildComparisonTokens(
    [item.descriptionSnapshot],
    textNormalization,
  );
  const normalizedReferenceTokens = buildComparisonTokens([item.checkNumber, item.referenceNumber], {
    ...textNormalization,
    removeStopWords: false,
    stopWords: [],
  });

  return {
    id: `carried:${item.id}`,
    runId,
    rawRowId: `carried:${item.id}`,
    sourceFileId: 'carried-forward',
    source: item.sourceSystem,
    spreadsheetFileName: 'carried-forward',
    worksheetName: 'carried-forward',
    lineNumber: 0,
    transactionDate: item.originalTransactionDate,
    checkNumber: item.checkNumber,
    referenceNumber: item.referenceNumber,
    description: item.descriptionSnapshot,
    amount: item.amount,
    splitAmount: null,
    debit: item.amount < 0 ? Math.abs(item.amount) : null,
    credit: item.amount > 0 ? item.amount : null,
    runningBalance: null,
    normalizedComparisonText,
    normalizedComparisonTokens,
    normalizedReferenceTokens,
    rawSourceValues: {},
    dataQualityIssues: [],
    isExcluded: false,
    isZeroAmount: item.amount === 0,
    contextFingerprint: buildContextFingerprint([
      item.sourceSystem,
      item.originalTransactionDate,
      item.amount,
      item.checkNumber,
      item.referenceNumber,
      normalizedComparisonText,
    ]),
    accountIdentifier: item.accountIdentifier,
    isCarriedForward: true,
    carriedFromOpenItemId: item.id,
  } satisfies NormalizedTransaction;
};

export interface SeedCarriedForwardResult {
  carriedTransactions: NormalizedTransaction[];
  /** Open items skipped because this period's own fresh upload already contains a row with the
   * same natural key (§3.6's de-duplication guard) -- some accounting systems re-export every
   * still-open item every month, and injecting a synthetic duplicate alongside the real one would
   * double the item in the matching pool and inflate `totalRecordsReviewed`. */
  skippedAlreadyPresent: number;
}

/**
 * Filters `openItems` down to those NOT already represented in this period's own
 * `freshTransactions` (by natural key -- reusing the exact identity logic
 * `buildOpenItemCandidates`/`PostgresOpenItemStore` already use, rather than a separate ad hoc
 * check-number+amount+account comparison), then materializes the rest. Materialized transaction
 * ids are deterministic (`carried:{openItemId}`), so re-seeding the same open item within a run
 * is idempotent at the id level too.
 */
export const seedCarriedForwardTransactions = (
  runId: string,
  openItems: OpenItemRecord[],
  freshTransactions: NormalizedTransaction[],
  textNormalization: TextNormalizationConfig,
): SeedCarriedForwardResult => {
  const freshNaturalKeys = new Set(
    freshTransactions
      .filter((transaction) => transaction.accountIdentifier)
      .map((transaction) => deriveNaturalKey(transaction, transaction.accountIdentifier!).key),
  );

  const eligible = openItems.filter((item) => !freshNaturalKeys.has(item.naturalKey));

  return {
    carriedTransactions: eligible.map((item) =>
      materializeCarriedTransaction(runId, item, textNormalization),
    ),
    skippedAlreadyPresent: openItems.length - eligible.length,
  };
};
