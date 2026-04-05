import {
  errorCategories,
  errorCategoryDisplayNames,
  type ChartSeries,
  type SummaryMetrics,
} from '@recon/domain';

export const buildChartSeries = (summary: SummaryMetrics): ChartSeries[] => [
  {
    id: 'countByCategory',
    title: 'Counts by Category',
    data: [
      { label: 'Exact Matches', value: summary.exactMatches },
      { label: 'Probable Matches', value: summary.probableMatches },
      ...errorCategories
        .filter((category) => (summary.countsByCategory[category] ?? 0) > 0)
        .map((category) => ({
          label: errorCategoryDisplayNames[category],
          value: summary.countsByCategory[category] ?? 0,
        })),
    ],
  },
  {
    id: 'exposureByCategory',
    title: 'Dollar Exposure by Exception Category',
    data: Object.entries(summary.amountByCategory).map(([label, value]) => ({
      label: errorCategoryDisplayNames[label as keyof typeof errorCategoryDisplayNames] ?? label,
      value,
    })),
  },
];
