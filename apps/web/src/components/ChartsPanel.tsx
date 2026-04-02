import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { SummaryMetrics } from '@recon/domain';

interface ChartsPanelProps {
  summary: SummaryMetrics;
}

export const ChartsPanel = ({ summary }: ChartsPanelProps) => {
  const countChart = summary.charts.find((chart) => chart.id === 'countByCategory');
  const exposureChart = summary.charts.find((chart) => chart.id === 'exposureByCategory');

  return (
    <div className="chart-grid">
      <div className="chart-card">
        <h3>Counts by Category</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={countChart?.data ?? []}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} angle={-18} textAnchor="end" height={70} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value" fill="#0f766e" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
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
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={exposureChart?.data ?? []}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} angle={-18} textAnchor="end" height={70} />
            <YAxis />
            <Tooltip formatter={(value: number) => value.toFixed(2)} />
            <Bar dataKey="value" fill="#c2410c" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
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
                    <td>{Number(item.value).toFixed(2)}</td>
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
