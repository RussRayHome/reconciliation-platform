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

const baseAliases: Record<BusinessField, string[]> = {
  transactionDate: ['date', 'transaction date', 'trans date', 'posted date', 'posting date', 'effective date'],
  postingDate: ['posting date', 'post date', 'bank posted date', 'posted', 'posting'],
  transactionType: ['type', 'transaction type', 'entry type'],
  checkNumber: ['check', 'check number', 'check no', 'chk no'],
  serialNumber: ['serial', 'serial number'],
  referenceNumber: ['reference', 'reference number', 'ref', 'ref no', 'document number', 'transaction id'],
  description: ['description', 'memo', 'details', 'narrative', 'transaction description'],
  merchantName: ['merchant', 'merchant name', 'vendor'],
  payeeName: ['payee', 'name', 'payee/name', 'counterparty'],
  amount: ['amount', 'signed amount', 'transaction amount', 'net amount', 'amt'],
  debit: ['debit', 'withdrawal', 'payment', 'money out', 'debits', 'payments and other debits'],
  credit: ['credit', 'deposit', 'money in', 'credits', 'deposits and other credits'],
  runningBalance: ['balance', 'running balance', 'account balance', 'current balance', 'running bal'],
  accountIdentifier: ['account', 'account number', 'account id'],
};

const buildAliases = (overrides: Partial<ColumnAliasMap> = {}): ColumnAliasMap => ({
  ...baseAliases,
  ...overrides,
});

const defaultSeverityByCategory: Record<ErrorCategory, SeverityLevel> = {
  MissingFromBank: 'High',
  MissingFromQBO: 'High',
  AmountMismatch: 'High',
  DuplicateTransaction: 'High',
  TimingDifference: 'Medium',
  CheckNumberMismatch: 'Medium',
  ReferenceNumberMismatch: 'Medium',
  DescriptionMerchantVariance: 'Low',
  InvalidOrMissingData: 'Critical',
  AmbiguousMatchRequiringReview: 'Medium',
};

const createSourceConfig = (
  source: 'bank' | 'qbo',
  overrides: Partial<SourceReconciliationConfig> = {},
): SourceReconciliationConfig => ({
  headerRow: 1,
  transactionStartRow: 2,
  excludedRows: [],
  excludeBeginningBalance: source === 'qbo',
  beginningBalancePatterns: ['BEGINNING BALANCE', 'OPENING BALANCE'],
  amountSignConvention: 'signedAmount',
  allowZeroAmount: false,
  columnAliases: buildAliases(
    source === 'qbo'
      ? {
          description: ['memo', 'description', 'bank memo', 'detail'],
          payeeName: ['name', 'payee', 'payee/name'],
          referenceNumber: ['num', 'reference', 'ref no'],
        }
      : {
          description: ['description', 'details', 'memo'],
          merchantName: ['merchant', 'description', 'details'],
        },
  ),
  ...overrides,
});

const reportingConfig: ReportingConfig = {
  exceptionSortOrder: ['severity', 'source', 'transactionDate', 'lineNumber'],
  severityByCategory: defaultSeverityByCategory,
};

export const defaultReconciliationConfig: ReconciliationConfig = {
  bank: createSourceConfig('bank', {
    amountSignConvention: 'debitCreditColumns',
  }),
  qbo: createSourceConfig('qbo'),
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
    textSimilarityThreshold: 0.7,
    probableTextSimilarityThreshold: 0.62,
    referenceSimilarityThreshold: 0.9,
    distinctiveAmountMaxOccurrences: 1,
    duplicateDateWindowDays: 3,
    duplicateSimilarityThreshold: 0.78,
    amountMismatchTextSimilarityThreshold: 0.65,
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
  beginningBalancePatterns:
    override?.beginningBalancePatterns ?? base.beginningBalancePatterns,
});

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
    qbo: mergeSourceConfig(defaultReconciliationConfig.qbo, match.qbo),
    textNormalization: defaultReconciliationConfig.textNormalization,
    matching: {
      ...defaultReconciliationConfig.matching,
      ...match.matching,
    },
    reporting: mergeReportingConfig(defaultReconciliationConfig.reporting, match.reporting),
    accountOverrides: overrides,
  };
};
