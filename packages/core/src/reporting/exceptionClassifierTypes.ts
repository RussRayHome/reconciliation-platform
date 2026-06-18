import type {
  ExceptionItem,
  GroupedMatchResult,
  MatchingConfig,
  MatchResult,
  NormalizedTransaction,
  ReportingConfig,
} from '@recon/domain';

export const severityRank: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export const categoryPrecedence: Record<ExceptionItem['category'], number> = {
  InvalidOrMissingData: 0,
  DuplicateInBank: 1,
  DuplicateInQBO: 1,
  AmountMismatch: 2,
  LikelySplitCombineIssue: 3,
  DepositGroupingIssue: 3,
  FeeNettingMatch: 3,
  PartialPaymentMatch: 3,
  PayrollBatchMatch: 3,
  BankServiceChargeAmortization: 3,
  LoanPaymentSplit: 3,
  NSFReturnedDeposit: 2,
  VoidedCheckCleared: 11,
  LikelyMiscoding: 4,
  CheckNumberMismatch: 5,
  ReferenceNumberMismatch: 5,
  DateVariance: 6,
  TimingDifference: 7,
  DescriptionMerchantVariance: 8,
  AmbiguousMatchRequiringReview: 9,
  StaleOutstandingCheck: 10,
  OutstandingCheck: 11,
  MissingFromQBO: 12,
  MissingFromBank: 12,
  ACHReturn: 2,
  ReversalVoid: 3,
  DepositInTransit: 11,
  ChargebackReturn: 2,
  InterestIncome: 12,
  IntercompanyMismatch: 3,
};

export const advisoryReviewCategoriesExcludedFromResidualStages = new Set<
  ExceptionItem['category']
>([
  'AmountMismatch',
  'CheckNumberMismatch',
  'ReferenceNumberMismatch',
  'DescriptionMerchantVariance',
  'AmbiguousMatchRequiringReview',
]);

export interface MiscodingCandidate {
  bankTransaction: NormalizedTransaction;
  qboTransaction: NormalizedTransaction;
  dateDifference: number;
  textSimilarity: number;
  referenceSimilarity: number;
  score: number;
}

export interface MiscodingThresholds {
  textSimilarityMax: number;
  referenceSimilarityMax: number;
}

export interface TimingDifferenceCandidate {
  bankTransaction: NormalizedTransaction & { amount: number };
  qboTransaction: NormalizedTransaction & { amount: number };
  dateDifference: number;
  textSimilarity: number;
  referenceSimilarity: number;
  score: number;
}

export interface GroupedResidualCandidate {
  category: 'LikelySplitCombineIssue' | 'DepositGroupingIssue';
  ruleId: 'grouped-split-combine-residual' | 'grouped-deposit-residual';
  ruleName: string;
  reason: string;
  evidence: string[];
  bankTransactions: Array<NormalizedTransaction & { amount: number }>;
  qboTransactions: Array<NormalizedTransaction & { amount: number }>;
  relatedTransactionIds: string[];
  score: number;
}

export interface MatchResultClassification {
  bankTransaction?: NormalizedTransaction;
  qboTransaction?: NormalizedTransaction;
  resultCategory: ExceptionItem['category'];
  matchedMiscodingCandidate?: MiscodingCandidate;
  matchedTimingDifferenceCandidate?: TimingDifferenceCandidate;
  relatedTransactionIds: string[];
  sourceTrace: {
    ruleId: string | undefined;
    ruleName: string;
    reason: string | undefined;
    evidence: string[];
  };
  derivedTrace: {
    ruleId: string | undefined;
    ruleName: string;
    reason: string | undefined;
    evidence: string[];
  };
}

export type UpsertTransactionException = (
  transaction: NormalizedTransaction,
  build: () => ExceptionItem,
) => void;

export interface ResidualStageParams {
  runId: string;
  reporting: ReportingConfig;
  matching: MatchingConfig;
  matchResults: MatchResult[];
  transactionById: Map<string, NormalizedTransaction>;
  remainingUnmatchedBank: Set<string>;
  remainingUnmatchedQbo: Set<string>;
  normalizedTransactions: NormalizedTransaction[];
  upsertTransactionException: UpsertTransactionException;
  engineReservedGroups: GroupedMatchResult[];
}

export interface ResidualStageState {
  staleOutstandingQboIds: Set<string>;
  outstandingCheckQboIds: Set<string>;
  achReturnBankIds: Set<string>;
  reversalVoidBankIds: Set<string>;
  chargebackBankIds: Set<string>;
  interestBankIds: Set<string>;
  intercompanyBankIds: Set<string>;
  intercompanyQboIds: Set<string>;
  miscodingBankIds: Set<string>;
  miscodingQboIds: Set<string>;
  timingBankIds: Set<string>;
  timingQboIds: Set<string>;
  groupedBankIds: Set<string>;
  groupedQboIds: Set<string>;
  nsfReturnedDepositBankIds: Set<string>;
  voidedCheckClearedBankIds: Set<string>;
  miscodingThresholds: MiscodingThresholds;
}
