import type { ReconciliationRunReport } from '@recon/domain';

import type { SemanticIconName } from '../components/SemanticIcon';

export type AppTab = 'upload' | 'rules' | 'exceptions' | 'reports';
export type ReportView =
  | 'run-summary'
  | 'probable-match-review'
  | 'exception-report'
  | 'export-artifacts';

export type RuleCatalogItem = {
  id: string;
  name: string;
  description: string;
  lastChange: string;
};

export type ReportCatalogItem = {
  id: ReportView;
  name: string;
  description: string;
};

export type StatCardTone = 'default' | 'positive' | 'warning' | 'critical';

export type SummaryStatDefinition = {
  id: string;
  label: string;
  helper: string;
  tone?: StatCardTone;
  icon: SemanticIconName;
  iconLabel: string;
  value: (summary: ReconciliationRunReport['summary']) => string | number;
};

export type TabNavigationItem = {
  id: AppTab;
  label: string;
  description: string;
  icon: SemanticIconName;
};

export const rulesCatalog: RuleCatalogItem[] = [
  {
    id: 'reference-amount-match',
    name: 'Reference + Amount Match',
    description:
      'Pairs bank and QBO transactions when amounts agree within tolerance and reference similarity meets the configured threshold.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'month-end-transfer-review',
    name: 'Month-End Transfer Review Match',
    description:
      'Flags month-end transfer patterns as probable-review candidates when amount, month, and journal-entry context align but should not be forced into an exact match.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'text-reference-variance',
    name: 'Amount + Date + Text with Reference Variance',
    description:
      'Creates a review candidate when amount, date, and description align but check or reference identifiers conflict.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'amount-date-text-match',
    name: 'Amount + Date + Text Match',
    description:
      'Promotes transactions into a clean match when amount, date, and normalized text context align strongly enough for exact matching.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'description-variance',
    name: 'Amount + Date with Description Variance',
    description:
      'Sends same-amount, same-window pairs with weaker narrative similarity into review instead of exact matching.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'extended-date-window',
    name: 'Amount + Extended Date Window Match',
    description:
      'Creates a date-variance candidate when amounts agree but date drift falls outside the primary tolerance and inside the extended review window.',
    lastChange: '2026-04-04 | Date variance handling and downstream reporting refreshed',
  },
  {
    id: 'possible-amount-mismatch',
    name: 'Possible Amount Mismatch',
    description:
      'Marks near-date, high-similarity pairs for amount-mismatch review when narrative context aligns but recorded amounts differ.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'duplicate-detection',
    name: 'Duplicate Detection',
    description:
      'Detects same-source duplicates before cross-source matching using amount equality, close dates, and similar description or reference context.',
    lastChange: '2026-04-04 | Duplicate categories split into bank and QBO-specific exceptions',
  },
  {
    id: 'invalid-or-missing-data',
    name: 'Invalid or Missing Data',
    description:
      'Classifies rows with malformed or missing critical fields as data-quality exceptions so they do not participate in automated matching.',
    lastChange: '2026-04-04 | Exception trace and next-action guidance added',
  },
  {
    id: 'stale-outstanding-check',
    name: 'Stale Outstanding Check',
    description:
      'Promotes unmatched aged QBO check-like disbursements into a dedicated stale-check exception instead of generic missing-from-bank treatment.',
    lastChange: '2026-04-04 | Added deterministic stale-check classification',
  },
  {
    id: 'likely-miscoding',
    name: 'Likely Miscoding',
    description:
      'Promotes same-amount, near-date pairs into a miscoding exception when descriptive or reference context conflicts too strongly for an ordinary variance.',
    lastChange: '2026-04-04 | Added deterministic miscoding classification and trace metadata',
  },
  {
    id: 'missing-from-qbo',
    name: 'Missing from QBO',
    description:
      'Classifies unmatched bank-side transactions as missing from QBO after exact, review, and variance matching rules are exhausted.',
    lastChange: '2026-04-04 | Exception trace and next-action guidance added',
  },
  {
    id: 'missing-from-bank',
    name: 'Missing from Bank',
    description:
      'Classifies unmatched QBO-side transactions as missing from bank activity after exact, review, and variance matching rules are exhausted.',
    lastChange: '2026-04-04 | Exception trace and next-action guidance added',
  },
  {
    id: 'ambiguous-review',
    name: 'Ambiguous Match Requiring Review',
    description:
      'Holds back low-certainty top candidates when multiple close alternatives exist, preserving them for reviewer choice instead of forcing a weak match.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
];

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
