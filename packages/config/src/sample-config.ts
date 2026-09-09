import type { AccountOverrideConfig } from '@recon/domain';

/**
 * Whether this process is an explicitly designated sample/test context (A-D1, Issue #338).
 *
 * `sampleAccountOverrides` keys on bare identifiers like `5703` and `OPERATING-001`. While
 * `NormalizedTransaction.accountIdentifier` was undefined everywhere, resolving production config
 * against that list was inert -- but A-D1's account identity makes it reachable, and a real tenant
 * whose account happens to be numbered 5703 would silently inherit demo matching thresholds
 * (dateToleranceDays 5, textSimilarityThreshold 0.12) instead of the production defaults. A-D1
 * therefore requires production thresholds to come from explicit configuration or a documented
 * default, never from an identifier collision.
 *
 * Opt-in, and read at call time rather than module load so a test can set it per case. Anything
 * other than the exact string `true` -- unset included -- means production.
 */
export const isSampleConfigContext = (): boolean =>
  process.env.RECON_SAMPLE_ACCOUNT_OVERRIDES === 'true';

/**
 * The sample overrides, but only in a designated sample context; an empty list everywhere else, so
 * `resolveReconciliationConfig` falls through to the production default. Use this rather than
 * {@link sampleAccountOverrides} anywhere a real tenant's run could reach the call.
 */
export const sampleAccountOverridesForContext = (): AccountOverrideConfig[] =>
  isSampleConfigContext() ? sampleAccountOverrides : [];

/** Example account-specific overrides demonstrating custom column aliases and matching thresholds. */
export const sampleAccountOverrides: AccountOverrideConfig[] = [
  {
    accountIdentifier: '5703',
    bank: {
      columnAliases: {
        transactionDate: ['date', 'posted date', 'posting date'],
        description: ['description', 'details', 'memo', 'transaction details'],
        debit: ['debit', 'debits', 'payments and other debits', 'money out'],
        credit: ['credit', 'credits', 'deposits and other credits', 'money in'],
        amount: ['amount', 'transaction amount', 'signed amount'],
        runningBalance: ['balance', 'running balance', 'current balance'],
      },
    },
    gl: {
      columnAliases: {
        transactionDate: ['date', 'transaction date'],
        referenceNumber: ['num', 'reference', 'ref no'],
        description: ['memo', 'description', 'bank memo'],
        amount: ['amount', 'net amount'],
      },
    },
    matching: {
      dateToleranceDays: 5,
      timingDifferenceDays: 21,
      staleOutstandingCheckDays: 45,
      textSimilarityThreshold: 0.12,
      probableTextSimilarityThreshold: 0.65,
      groupedCandidatePoolSize: 8,
      groupedMatchMaxSize: 4,
      duplicateDateWindowDays: -1,
      duplicateSimilarityThreshold: 1,
    },
  },
  {
    accountIdentifier: 'OPERATING-001',
    bank: {
      transactionStartRow: 2,
    },
    gl: {
      transactionStartRow: 2,
      excludeBeginningBalance: true,
      beginningBalancePatterns: ['BEGINNING BALANCE', 'OPENING BALANCE'],
    },
    matching: {
      dateToleranceDays: 5,
      timingDifferenceDays: 21,
      staleOutstandingCheckDays: 45,
      probableTextSimilarityThreshold: 0.5,
      groupedCandidatePoolSize: 6,
      groupedMatchMaxSize: 3,
    },
  },
  {
    accountIdentifier: 'PAYROLL-002',
    matching: {
      dateToleranceDays: 1,
      timingDifferenceDays: 3,
      staleOutstandingCheckDays: 30,
      groupedCandidatePoolSize: 4,
      groupedMatchMaxSize: 2,
      duplicateDateWindowDays: 1,
    },
    reporting: {
      severityByCategory: {
        DuplicateInBank: 'Critical',
        DuplicateInGL: 'Critical',
        AmountMismatch: 'Critical',
      },
    },
  },
];
