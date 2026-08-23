import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { SummaryMetrics } from '@recon/domain';
import { formatCurrencyWhole } from '../lib/format';

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

interface ChartsPanelProps {
  summary: SummaryMetrics;
}

/** Renders the count-by-category, dollar-exposure-by-category, and outstanding-check-aging bar
 * charts from reconciliation summary data. */
export const ChartsPanel = ({ summary }: ChartsPanelProps) => {
  const countChart = summary.charts.find((chart) => chart.id === 'countByCategory');
  const exposureChart = summary.charts.find((chart) => chart.id === 'exposureByCategory');
  const agingChart = summary.charts.find((chart) => chart.id === 'outstandingCheckAging');

  const countCategoryCount = countChart?.data.length ?? 0;
  const exposureCategoryCount = exposureChart?.data.length ?? 0;

  return (
    <div className="chart-grid">
      <div className="chart-card">
        <h3>Counts by Category</h3>
        <div className="chart-scroll">
          <div style={{ width: `max(100%, ${countCategoryCount * 90}px)`, height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={countChart?.data ?? []}
                margin={{ top: 8, right: 16, bottom: 12, left: 0 }}
                barCategoryGap="24%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(240, 246, 252, 0.08)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: '#a8b3bf' }}
                  interval={0}
                  angle={-60}
                  textAnchor="end"
                  height={190}
                  tickMargin={10}
                />
                <YAxis tick={{ fill: '#a8b3bf' }} />
                <Tooltip
                  contentStyle={{
                    background: '#1c2230',
                    border: '1px solid rgba(240, 246, 252, 0.14)',
                    borderRadius: 8,
                    color: '#e6edf3',
                  }}
                  cursor={{ fill: 'rgba(240, 246, 252, 0.06)' }}
                />
                <Bar dataKey="value" fill="#1fd1a1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <details className="chart-data-details">
          <summary>View chart data table</summary>
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">Counts by category data table</caption>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {(countChart?.data ?? []).map((item) => (
                  <tr key={`count-${item.label}`}>
                    <td>{item.label}</td>
                    <td>{item.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <div className="chart-card">
        <h3>Dollar Exposure by Category</h3>
        <div className="chart-scroll">
          <div style={{ width: `max(100%, ${exposureCategoryCount * 90}px)`, height: 440 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={exposureChart?.data ?? []}
                margin={{ top: 8, right: 16, bottom: 12, left: 0 }}
                barCategoryGap="24%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(240, 246, 252, 0.08)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: '#a8b3bf' }}
                  interval={0}
                  angle={-60}
                  textAnchor="end"
                  height={190}
                  tickMargin={10}
                />
                <YAxis
                  tick={{ fill: '#a8b3bf', fontSize: 12 }}
                  tickFormatter={(value: number) => compactCurrencyFormatter.format(value)}
                  width={72}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1c2230',
                    border: '1px solid rgba(240, 246, 252, 0.14)',
                    borderRadius: 8,
                    color: '#e6edf3',
                  }}
                  cursor={{ fill: 'rgba(240, 246, 252, 0.06)' }}
                  formatter={(
                    value: number | string | ReadonlyArray<number | string> | undefined,
                  ) => {
                    if (typeof value === 'number' || typeof value === 'string') {
                      return formatCurrencyWhole(Number(value));
                    }
                    return formatCurrencyWhole(0);
                  }}
                />
                <Bar dataKey="value" fill="#f2495c" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <details className="chart-data-details">
          <summary>View chart data table</summary>
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">Dollar exposure by category data table</caption>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Exposure</th>
                </tr>
              </thead>
              <tbody>
                {(exposureChart?.data ?? []).map((item) => (
                  <tr key={`exposure-${item.label}`}>
                    <td>{item.label}</td>
                    <td className="cell-amount">{formatCurrencyWhole(Number(item.value))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <div className="chart-card">
        <h3>Outstanding Check Aging</h3>
        <div className="chart-scroll">
          <div style={{ width: '100%', height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={agingChart?.data ?? []}
                margin={{ top: 8, right: 16, bottom: 12, left: 0 }}
                barCategoryGap="24%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(240, 246, 252, 0.08)" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#a8b3bf' }} interval={0} tickMargin={10} />
                <YAxis tick={{ fill: '#a8b3bf' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: '#1c2230',
                    border: '1px solid rgba(240, 246, 252, 0.14)',
                    borderRadius: 8,
                    color: '#e6edf3',
                  }}
                  cursor={{ fill: 'rgba(240, 246, 252, 0.06)' }}
                />
                <Bar dataKey="value" fill="#f2b705" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <details className="chart-data-details">
          <summary>View chart data table</summary>
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">Outstanding check aging data table</caption>
              <thead>
                <tr>
                  <th>Age bucket</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {(agingChart?.data ?? []).map((item) => (
                  <tr key={`aging-${item.label}`}>
                    <td>{item.label}</td>
                    <td>{item.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
};
