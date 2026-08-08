import type { ReconciliationRunReport } from '@recon/domain';

import type { SemanticIconName } from '../components/SemanticIcon';
import { formatCurrencyWhole } from './format';

/** Union of main app tab identifiers for the three-stage workflow. */
export type AppTab = 'setup' | 'review' | 'close';
/** Union of sub-view identifiers within the Review stage. */
export type ReportView = 'summary' | 'probable-matches' | 'exceptions';

/** Metadata for one report view entry in the Reports tab. */
export type ReportCatalogItem = {
  id: ReportView;
  name: string;
  description: string;
};

/** Colour tone variants for stat card backgrounds. */
type StatCardTone = 'default' | 'positive' | 'warning' | 'critical';

/** Definition for a summary stat card: label, display value accessor, tone, and icon. */
type SummaryStatDefinition = {
  id: string;
  label: string;
  helper: string;
  tone?: StatCardTone;
  icon: SemanticIconName;
  iconLabel: string;
  value: (summary: ReconciliationRunReport['summary']) => string | number;
};

/** Metadata for one top-level navigation tab including its icon and description. */
type TabNavigationItem = {
  id: AppTab;
  label: string;
  description: string;
  icon: SemanticIconName;
};

/** Ordered catalog of the Review stage panels. */
export const reportCatalog: ReportCatalogItem[] = [
  {
    id: 'summary',
    name: 'Summary',
    description: 'Reconciliation verdict, category charts, and run context.',
  },
  {
    id: 'probable-matches',
    name: 'Probable matches',
    description: 'Candidate pairings that require reviewer confirmation before close.',
  },
  {
    id: 'exceptions',
    name: 'Exceptions',
    description: 'Searchable exception listing with rule trace, evidence, and next actions.',
  },
];

/** Ordered definitions for all summary stat cards shown in the Run Summary view. */
export const summaryStatDefinitions: SummaryStatDefinition[] = [
  {
    id: 'total-reviewed',
    label: 'Total reviewed',
    helper: 'Bank + GL records',
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
    helper: 'GL-side items without bank support',
    tone: 'critical',
    icon: 'missing',
    iconLabel: 'Missing in bank items',
    value: (summary) => summary.missingFromBank,
  },
  {
    id: 'missing-in-gl',
    label: 'Missing in GL',
    helper: 'Bank-side items without GL support',
    tone: 'critical',
    icon: 'missing',
    iconLabel: 'Missing in GL items',
    value: (summary) => summary.missingFromGL,
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
    id: 'gl-duplicates',
    label: 'GL duplicates',
    helper: 'Potential duplicate GL entries',
    tone: 'warning',
    icon: 'duplicate',
    iconLabel: 'Potential duplicate GL entries',
    value: (summary) => summary.glDuplicates,
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
    value: (summary) => formatCurrencyWhole(summary.unresolvedExposure),
  },
];

/** Builds the three-stage tab navigation items with live badge counts. */
export const buildTabNavigationItems = ({
  exceptionCount,
  hasRun,
}: Readonly<{
  exceptionCount: number;
  hasRun: boolean;
}>): TabNavigationItem[] => [
  {
    id: 'setup',
    label: 'Setup',
    description: 'Source files and run controls',
    icon: 'setup',
  },
  {
    id: 'review',
    label: 'Review',
    description: hasRun ? `${exceptionCount} exceptions to review` : 'Summary, matches, exceptions',
    icon: 'review',
  },
  {
    id: 'close',
    label: 'Close & export',
    description: 'Finalize and export workbook/JSON',
    icon: 'operations',
  },
];
