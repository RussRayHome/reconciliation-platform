import type {
  AccountOverrideConfig,
  BusinessField,
  ColumnAliasMap,
  ErrorCategory,
  ReconciliationConfig,
  ReportingConfig,
  SeverityLevel,
  SourceReconciliationConfig,
} from '@recon/domain';

export const baseAliases: Record<BusinessField, string[]> = {
  transactionDate: [
    'date',
    'transaction date',
    'trans date',
    'posted date',
    'posting date',
    'effective date',
  ],
  postingDate: ['posting date', 'post date', 'bank posted date', 'posted', 'posting'],
  transactionType: ['type', 'transaction type', 'entry type'],
  checkNumber: ['check', 'check number', 'check no', 'chk no'],
  serialNumber: ['serial', 'serial number'],
  referenceNumber: [
    'reference',
    'reference number',
    'ref',
    'ref no',
    'document number',
    'transaction id',
  ],
  description: ['description', 'memo', 'details', 'narrative', 'transaction description'],
  merchantName: ['merchant', 'merchant name', 'vendor'],
  payeeName: ['payee', 'name', 'payee/name', 'counterparty'],
  amount: ['amount', 'signed amount', 'transaction amount', 'net amount', 'amt'],
  splitAmount: ['split amount', 'split amt', 'line amount', 'line amt', 'distribution amount'],
  debit: ['debit', 'withdrawal', 'payment', 'money out', 'debits', 'payments and other debits'],
  credit: ['credit', 'deposit', 'money in', 'credits', 'deposits and other credits'],
  runningBalance: [
    'balance',
    'running balance',
    'account balance',
    'current balance',
    'running bal',
  ],
  accountIdentifier: ['account', 'account number', 'account id'],
};

const buildAliases = (overrides: Partial<ColumnAliasMap> = {}): ColumnAliasMap => ({
  ...baseAliases,
  ...overrides,
});

const defaultSeverityByCategory: Record<ErrorCategory, SeverityLevel> = {
  MissingFromBank: 'High',
  MissingFromGL: 'High',
  AmountMismatch: 'High',
  DuplicateInBank: 'High',
  DuplicateInGL: 'High',
  LikelySplitCombineIssue: 'High',
  DepositGroupingIssue: 'High',
  LikelyMiscoding: 'High',
  DateVariance: 'Medium',
  TimingDifference: 'Medium',
  CheckNumberMismatch: 'Medium',
  ReferenceNumberMismatch: 'Medium',
  DescriptionMerchantVariance: 'Low',
  WeakDescriptionMatch: 'Medium',
  StaleOutstandingCheck: 'Medium',
  OutstandingCheck: 'Low',
  FeeNettingMatch: 'High',
  PartialPaymentMatch: 'High',
  PayrollBatchMatch: 'High',
  BankServiceChargeAmortization: 'High',
  LoanPaymentSplit: 'High',
  NSFReturnedDeposit: 'High',
  VoidedCheckCleared: 'High',
  InvalidOrMissingData: 'Critical',
  AmbiguousMatchRequiringReview: 'Medium',
  ReversalVoid: 'Medium',
  ACHReturn: 'High',
  DepositInTransit: 'Low',
  ChargebackReturn: 'High',
  InterestIncome: 'Low',
  IntercompanyMismatch: 'High',
};

const createSourceConfig = (
  source: 'bank' | 'gl',
  overrides: Partial<SourceReconciliationConfig> = {},
): SourceReconciliationConfig => ({
  headerRow: 1,
  transactionStartRow: 2,
  excludedRows: [],
  excludeBeginningBalance: source === 'gl',
  beginningBalancePatterns: ['BEGINNING BALANCE', 'OPENING BALANCE'],
  amountSignConvention: 'signedAmount',
  allowZeroAmount: false,
  columnAliases: buildAliases(
    source === 'gl'
      ? {
          description: ['memo', 'description', 'bank memo', 'detail'],
          payeeName: ['name', 'payee', 'payee/name'],
          referenceNumber: ['num', 'reference', 'ref no'],
        }
      : {
          description: ['description', 'details', 'memo', 'transaction text'],
          merchantName: ['merchant', 'description', 'details'],
        },
  ),
  ...overrides,
});

const reportingConfig: ReportingConfig = {
  exceptionSortOrder: ['severity', 'source', 'transactionDate', 'lineNumber'],
  severityByCategory: defaultSeverityByCategory,
};

/** Default reconciliation configuration used when no account-specific override matches. */
export const defaultReconciliationConfig: ReconciliationConfig = {
  bank: createSourceConfig('bank', {
    amountSignConvention: 'debitCreditColumns',
  }),
  gl: createSourceConfig('gl'),
  textNormalization: {
    uppercase: true,
    stripPunctuation: true,
    collapseWhitespace: true,
    removeStopWords: true,
    stopWords: ['THE', 'AND', 'INC', 'LLC', 'PAYMENT', 'PURCHASE', 'ACH'],
  },
  matching: {
    amountTolerance: 0.01,
    dateToleranceDays: 5,
    timingDifferenceDays: 21,
    staleOutstandingCheckDays: 45,
    textSimilarityThreshold: 0.7,
    probableTextSimilarityThreshold: 0.62,
    referenceSimilarityThreshold: 0.9,
    distinctiveAmountMaxOccurrences: 1,
    groupedCandidatePoolSize: 6,
    groupedMatchMaxSize: 3,
    duplicateDateWindowDays: 3,
    duplicateSimilarityThreshold: 0.78,
    amountMismatchTextSimilarityThreshold: 0.65,
    reversalWindowDays: 7,
    depositInTransitDays: 7,
    partialPaymentWindowDays: 90,
    wireFeeTolerance: 500,
  },
  reporting: reportingConfig,
  accountOverrides: [],
};

const mergeReportingConfig = (
  base: ReportingConfig,
  override: AccountOverrideConfig['reporting'],
): ReportingConfig => ({
  ...base,
  ...override,
  severityByCategory: {
    ...base.severityByCategory,
    ...override?.severityByCategory,
  },
});

const mergeSourceConfig = (
  base: SourceReconciliationConfig,
  override: AccountOverrideConfig['bank'],
): SourceReconciliationConfig => ({
  ...base,
  ...override,
  columnAliases: {
    ...base.columnAliases,
    ...override?.columnAliases,
  },
  excludedRows: override?.excludedRows ?? base.excludedRows,
  beginningBalancePatterns: override?.beginningBalancePatterns ?? base.beginningBalancePatterns,
});

/**
 * Returns the reconciliation config for the given account identifier by merging any
 * matching account override on top of the default config. Returns the default config
 * unchanged when no identifier is provided or no override matches.
 */
export const resolveReconciliationConfig = (
  accountIdentifier?: string,
  overrides: AccountOverrideConfig[] = defaultReconciliationConfig.accountOverrides,
): ReconciliationConfig => {
  if (!accountIdentifier) {
    return defaultReconciliationConfig;
  }

  const match = overrides.find(
    (override) => override.accountIdentifier.toUpperCase() === accountIdentifier.toUpperCase(),
  );

  if (!match) {
    return defaultReconciliationConfig;
  }

  return {
    bank: mergeSourceConfig(defaultReconciliationConfig.bank, match.bank),
    gl: mergeSourceConfig(defaultReconciliationConfig.gl, match.gl),
    textNormalization: defaultReconciliationConfig.textNormalization,
    matching: {
      ...defaultReconciliationConfig.matching,
      ...match.matching,
    },
    reporting: mergeReportingConfig(defaultReconciliationConfig.reporting, match.reporting),
    accountOverrides: overrides,
  };
};
