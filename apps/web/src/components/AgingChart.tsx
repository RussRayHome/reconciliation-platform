import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/** Domain hue this card's bars/band table are colored with -- one per source type sharing this
 * module (R1: AP inclusion & shared aging). Compliant bands use the hue directly; the source data
 * itself already decides which bucket (including the final/breach one) each count belongs to. */
export type AgingChartHue = 'bank' | 'ap';

const HUE_FILL: Record<AgingChartHue, string> = {
  bank: 'var(--bank)',
  ap: 'var(--ap)',
};

export interface AgingChartProps {
  title: string;
  data: ReadonlyArray<{ label: string; value: number }>;
  hue: AgingChartHue;
}

/**
 * Shared aging bar chart + band table, extracted from the Summary panel's original Outstanding
 * Check Aging card (R1 WP5) so the Open Items Schedule's payable aging can reuse the same
 * presentation once payable open items exist (WP0.2, deferred -- see the R1 plan). Bands come
 * from the caller (`buildAgingBuckets`) unchanged; this component only renders them. The band
 * table is a plain table, not a `<details>` disclosure -- promoted out per WP5, unlike the two
 * sibling Summary cards (Counts by Category, Dollar Exposure) which keep theirs.
 */
export const AgingChart = ({ title, data, hue }: AgingChartProps) => (
  <div className="chart-card">
    <h3>{title}</h3>
    <div className="chart-scroll">
      <div style={{ width: '100%', height: 420 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[...data]} margin={{ top: 8, right: 16, bottom: 12, left: 0 }} barCategoryGap="24%">
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
            <Bar dataKey="value" fill={HUE_FILL[hue]} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">{title} data table</caption>
        <thead>
          <tr>
            <th>Age bucket</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={`aging-${item.label}`}>
              <td>{item.label}</td>
              <td>{item.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
