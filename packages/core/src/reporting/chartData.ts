import type { ChartSeries, SummaryMetrics } from '@recon/domain';

export const buildChartSeries = (summary: SummaryMetrics): ChartSeries[] => [
  {
    id: 'countByCategory',
    title: 'Counts by Category',
    data: [
      { label: 'Exact Matches', value: summary.exactMatches },
      { label: 'Probable Matches', value: summary.probableMatches },
      { label: 'Missing from Bank', value: summary.missingFromBank },
      { label: 'Missing from QBO', value: summary.missingFromQBO },
      { label: 'Amount Mismatches', value: summary.amountMismatches },
      { label: 'Duplicates', value: summary.duplicates },
      { label: 'Timing Differences', value: summary.timingDifferences },
      { label: 'Data Quality Issues', value: summary.dataQualityIssues },
    ],
  },
  {
    id: 'exposureByCategory',
    title: 'Dollar Exposure by Exception Category',
    data: Object.entries(summary.amountByCategory).map(([label, value]) => ({
      label,
      value,
    })),
  },
];
