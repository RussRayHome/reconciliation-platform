import type { ReconciliationRunReport } from '@recon/domain';

import type { SemanticIconName } from '../components/SemanticIcon';

/** Union of main app tab identifiers. */
export type AppTab = 'upload' | 'rules' | 'exceptions' | 'reports';
/** Union of sub-view identifiers within the Reports tab. */
export type ReportView =
  | 'run-summary'
  | 'probable-match-review'
  | 'exception-report'
  | 'export-artifacts';

/** Metadata for one matching rule entry in the Rules Catalog tab. */
export type RuleCatalogItem = {
  id: string;
  name: string;
  description: string;
  lastChange: string;
};

/** Metadata for one report view entry in the Reports tab. */
export type ReportCatalogItem = {
  id: ReportView;
  name: string;
  description: string;
};

/** Colour tone variants for stat card backgrounds. */
export type StatCardTone = 'default' | 'positive' | 'warning' | 'critical';

/** Definition for a summary stat card: label, display value accessor, tone, and icon. */
export type SummaryStatDefinition = {
  id: string;
  label: string;
  helper: string;
  tone?: StatCardTone;
  icon: SemanticIconName;
  iconLabel: string;
  value: (summary: ReconciliationRunReport['summary']) => string | number;
};

/** Metadata for one top-level navigation tab including its icon and description. */
export type TabNavigationItem = {
  id: AppTab;
  label: string;
  description: string;
  icon: SemanticIconName;
};

/** Ordered catalog of all matching rules shown in the Rules Catalog tab. */
export const rulesCatalogLastRefresh = '2026-06-18';

const fullRulebookRefresh = `${rulesCatalogLastRefresh} | Expanded to include full matching, grouped, and classifier rule set`;

export const rulesCatalog: RuleCatalogItem[] = [
  {
    id: 'reference-amount-match',
    name: 'Reference + Amount Match',
    description:
      'Pairs bank and QBO transactions when amounts agree within tolerance and reference similarity meets the configured threshold.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'month-end-transfer-review',
    name: 'Month-End Transfer Review Match',
    description:
      'Flags month-end transfer patterns as probable-review candidates when amount, month, and journal-entry context align but should not be forced into an exact match.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'text-reference-variance',
    name: 'Amount + Date + Text with Reference Variance',
    description:
      'Creates a review candidate when amount, date, and description align but check or reference identifiers conflict.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'amount-date-text-match',
    name: 'Amount + Date + Text Match',
    description:
      'Promotes transactions into a clean match when amount, date, and normalized text context align strongly enough for exact matching.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'description-variance',
    name: 'Amount + Date with Description Variance',
    description:
      'Sends same-amount, same-window pairs with weaker narrative similarity into review instead of exact matching.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'extended-date-window',
    name: 'Amount + Extended Date Window Match',
    description:
      'Creates a date-variance candidate when amounts agree but date drift falls outside the primary tolerance and inside the extended review window.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'possible-amount-mismatch',
    name: 'Possible Amount Mismatch',
    description:
      'Marks near-date, high-similarity pairs for amount-mismatch review when narrative context aligns but recorded amounts differ.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'amount-driven-mode',
    name: 'Amount-Driven Mode Gating',
    description:
      'When text similarity threshold is configured very low, narrative-heavy review heuristics are bypassed and ambiguous candidate escalation is suppressed.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'ambiguous-review-escalation',
    name: 'Ambiguous Review Escalation',
    description:
      'Converts close competing pairings into Ambiguous Review when confidence is below hard thresholds and reference confidence is insufficient.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'grouped-reservation-selection',
    name: 'Grouped Reservation Candidate Selection',
    description:
      'Evaluates one-to-many and many-to-one combinations with amount, sign, and date-window constraints before finalizing one-to-one candidate usage.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'grouped-member-reservation',
    name: 'Grouped Member Reservation',
    description:
      'Reserves grouped candidate members so overlapping lower-confidence one-to-one candidates cannot consume those transactions.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'advisory-protected-fallback',
    name: 'Advisory-Protected Missing Fallback',
    description:
      'Transactions attached to advisory categories stay out of missing-item fallback stages so reviewer-oriented classifications are preserved.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'category-precedence-order',
    name: 'Category Precedence Resolution',
    description:
      'When multiple categories can apply to the same transaction key, configured precedence ordering keeps only the highest-priority category.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'duplicate-detection',
    name: 'Duplicate Detection',
    description:
      'Detects same-source duplicates before cross-source matching using amount equality, close dates, and similar description or reference context.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'invalid-or-missing-data',
    name: 'Invalid or Missing Data',
    description:
      'Classifies rows with malformed or missing critical fields as data-quality exceptions so they do not participate in automated matching.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'stale-outstanding-check',
    name: 'Stale Outstanding Check',
    description:
      'Promotes unmatched aged QBO check-like disbursements into a dedicated stale-check exception instead of generic missing-from-bank treatment.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'outstanding-check',
    name: 'Outstanding Check',
    description:
      'Classifies unmatched recent check-like QBO disbursements as outstanding checks before broader missing-item fallback logic.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'ach-return',
    name: 'ACH Return Detection',
    description:
      'Detects offsetting debit-credit bank pairs with ACH or NSF indicators within reversal windows and classifies both sides as ACH returns.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'nsf-returned-deposit',
    name: 'NSF Returned Deposit',
    description:
      'Classifies unmatched bank debits with returned-check indicators after ACH return detection so paired return events are not double-classified.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'reversal-void',
    name: 'Reversal / Void Pair',
    description:
      'Identifies same-amount opposite-sign unmatched bank pairs inside reversal windows and classifies both as reversal or void events.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'chargeback-return',
    name: 'Chargeback / Returned Item',
    description:
      'Classifies unmatched bank debits with chargeback indicators when offsetting same-amount return patterns are present.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'interest-income',
    name: 'Interest Income Classification',
    description:
      'Classifies unmatched bank credits containing interest-income indicators so they are separated from generic missing-item categories.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'intercompany-mismatch',
    name: 'Intercompany Mismatch',
    description:
      'Classifies unmatched transactions containing intercompany or entity-transfer indicators that require cross-entity reconciliation review.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'fee-netting-match',
    name: 'Fee Netting Match',
    description:
      'Classifies grouped scenarios where a bank net receipt equals QBO gross revenue minus one or more fee entries.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'partial-payment-match',
    name: 'Partial Payment Match',
    description:
      'Classifies grouped scenarios where multiple bank debits roll up to a single QBO payable amount within tolerance windows.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'payroll-batch-match',
    name: 'Payroll Batch Match',
    description:
      'Classifies grouped payroll scenarios where one bank payroll debit corresponds to multiple QBO payroll expense rows.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'bank-service-charge-amortization',
    name: 'Bank Service Charge Amortization',
    description:
      'Classifies grouped fee scenarios where one bank service charge maps to multiple QBO expense allocations.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'loan-payment-split',
    name: 'Loan Payment Split',
    description:
      'Classifies grouped loan payment scenarios where one bank debit corresponds to principal and interest components in QBO.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'likely-split-combine-issue',
    name: 'Likely Split/Combine Issue',
    description:
      'Classifies residual grouped sets that balance in amount but indicate split or combined posting patterns needing reviewer confirmation.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'deposit-grouping-issue',
    name: 'Deposit Grouping Issue',
    description:
      'Classifies grouped deposit residuals where batch posting or grouping behavior is detected across sources.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'likely-miscoding',
    name: 'Likely Miscoding',
    description:
      'Promotes same-amount, near-date pairs into a miscoding exception when descriptive or reference context conflicts too strongly for an ordinary variance.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'timing-difference',
    name: 'Timing Difference',
    description:
      'Classifies residual same-amount timing-compatible pairs that fall outside the primary date tolerance but inside timing windows.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'voided-check-cleared',
    name: 'Voided Check Cleared',
    description:
      'Classifies unmatched bank check-like debits with no QBO counterpart after grouped and timing stages complete.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'deposit-in-transit',
    name: 'Deposit in Transit',
    description:
      'Classifies unmatched near-period-end QBO credits as deposits in transit before generic missing-item fallback applies.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'missing-from-qbo',
    name: 'Missing from QBO',
    description:
      'Classifies unmatched bank-side transactions as missing from QBO after exact, review, and variance matching rules are exhausted.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'missing-from-bank',
    name: 'Missing from Bank',
    description:
      'Classifies unmatched QBO-side transactions as missing from bank activity after exact, review, and variance matching rules are exhausted.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'check-number-mismatch',
    name: 'Check Number Mismatch',
    description:
      'Escalates high-confidence candidates into review when amount and date align but check identifiers conflict materially.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'reference-number-mismatch',
    name: 'Reference Number Mismatch',
    description:
      'Escalates high-confidence candidates into review when amount and date align but reference identifiers conflict materially.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'description-merchant-variance',
    name: 'Description / Merchant Variance',
    description:
      'Escalates same-amount same-window candidates into review when merchant or narrative similarity is below exact-match confidence.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'date-variance',
    name: 'Date Variance',
    description:
      'Classifies same-amount candidate pairs that reconcile narratively but exceed primary posting-date tolerance windows.',
    lastChange: fullRulebookRefresh,
  },
  {
    id: 'ambiguous-review',
    name: 'Ambiguous Match Requiring Review',
    description:
      'Holds back low-certainty top candidates when multiple close alternatives exist, preserving them for reviewer choice instead of forcing a weak match.',
    lastChange: fullRulebookRefresh,
  },
];

/** Ordered catalog of all report views available in the Reports tab. */
export const reportCatalog: ReportCatalogItem[] = [
  {
    id: 'run-summary',
    name: 'Run Summary',
    description: 'Category charts and run context for the current reconciliation.',
  },
  {
    id: 'probable-match-review',
    name: 'Probable Match Review',
    description: 'Candidate pairings that require reviewer confirmation before close.',
  },
  {
    id: 'exception-report',
    name: 'Exception Report',
    description: 'Searchable exception listing with rule trace, evidence, and next actions.',
  },
  {
    id: 'export-artifacts',
    name: 'Export Artifacts',
    description: 'Workbook and JSON outputs available for audit support and downstream review.',
  },
];

/** Ordered definitions for all summary stat cards shown in the Run Summary view. */
export const summaryStatDefinitions: SummaryStatDefinition[] = [
  {
    id: 'total-reviewed',
    label: 'Total reviewed',
    helper: 'Bank + QBO records',
    icon: 'records',
    iconLabel: 'Total records reviewed',
    value: (summary) => summary.totalRecordsReviewed,
  },
  {
    id: 'exact-matches',
    label: 'Exact matches',
    helper: 'Cleanly matched items',
    tone: 'positive',
    icon: 'match',
    iconLabel: 'Exact matches',
    value: (summary) => summary.exactMatches,
  },
  {
    id: 'probable-matches',
    label: 'Probable matches',
    helper: 'Review queue',
    tone: 'warning',
    icon: 'review',
    iconLabel: 'Probable matches awaiting review',
    value: (summary) => summary.probableMatches,
  },
  {
    id: 'missing-in-bank',
    label: 'Missing in bank',
    helper: 'QBO-side items without bank support',
    tone: 'critical',
    icon: 'missing',
    iconLabel: 'Missing in bank items',
    value: (summary) => summary.missingFromBank,
  },
  {
    id: 'missing-in-qbo',
    label: 'Missing in QBO',
    helper: 'Bank-side items without QBO support',
    tone: 'critical',
    icon: 'missing',
    iconLabel: 'Missing in QBO items',
    value: (summary) => summary.missingFromQBO,
  },
  {
    id: 'bank-duplicates',
    label: 'Bank duplicates',
    helper: 'Potential duplicate bank entries',
    tone: 'warning',
    icon: 'duplicate',
    iconLabel: 'Potential duplicate bank entries',
    value: (summary) => summary.bankDuplicates,
  },
  {
    id: 'qbo-duplicates',
    label: 'QBO duplicates',
    helper: 'Potential duplicate QBO entries',
    tone: 'warning',
    icon: 'duplicate',
    iconLabel: 'Potential duplicate QBO entries',
    value: (summary) => summary.qboDuplicates,
  },
  {
    id: 'date-variances',
    label: 'Date variances',
    helper: 'Matched amounts with reviewable date drift',
    tone: 'warning',
    icon: 'calendar',
    iconLabel: 'Date variances',
    value: (summary) => summary.dateVariances,
  },
  {
    id: 'timing-differences',
    label: 'Timing differences',
    helper: 'Likely posting lag',
    icon: 'clock',
    iconLabel: 'Timing differences',
    value: (summary) => summary.timingDifferences,
  },
  {
    id: 'data-quality-issues',
    label: 'Data quality issues',
    helper: 'Malformed or zero-amount rows',
    tone: 'critical',
    icon: 'quality',
    iconLabel: 'Data quality issues',
    value: (summary) => summary.dataQualityIssues,
  },
  {
    id: 'exception-exposure',
    label: 'Exception exposure',
    helper: 'Absolute dollars across classified exceptions',
    tone: 'critical',
    icon: 'exposure',
    iconLabel: 'Exception exposure in dollars',
    value: (summary) => summary.unresolvedExposure.toFixed(2),
  },
];

/** Builds the tab navigation item array with live badge counts for rules, exceptions, and reports. */
export const buildTabNavigationItems = ({
  ruleCount,
  exceptionCount,
  reportCount,
}: Readonly<{
  ruleCount: number;
  exceptionCount: number;
  reportCount: number;
}>): TabNavigationItem[] => [
  {
    id: 'upload',
    label: 'Upload',
    description: 'Source files and run controls',
    icon: 'upload',
  },
  {
    id: 'rules',
    label: 'Rules',
    description: `${ruleCount} documented rules`,
    icon: 'rules',
  },
  {
    id: 'exceptions',
    label: 'Exceptions',
    description: `${exceptionCount} current items`,
    icon: 'exceptions',
  },
  {
    id: 'reports',
    label: 'Reports',
    description: `${reportCount} available views`,
    icon: 'reports',
  },
];
