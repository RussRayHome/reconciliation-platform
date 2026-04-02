import { startTransition, useDeferredValue, useState } from 'react';

import type { ExceptionItem } from '@recon/domain';
import { Pill } from '@recon/ui';

interface ExceptionTableProps {
  exceptions: ExceptionItem[];
}

const toneBySeverity = {
  Critical: 'critical',
  High: 'warning',
  Medium: 'neutral',
  Low: 'positive',
} as const;

export const ExceptionTable = ({ exceptions }: ExceptionTableProps) => {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const deferredQuery = useDeferredValue(query);
  const categories = ['All', ...new Set(exceptions.map((item) => item.category))];

  const filtered = exceptions.filter((item) => {
    const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter;
    const search = deferredQuery.trim().toUpperCase();
    const matchesQuery =
      !search ||
      item.errorMessage.toUpperCase().includes(search) ||
      item.spreadsheetFileName.toUpperCase().includes(search) ||
      item.normalizedComparisonTokens.join(' ').toUpperCase().includes(search);

    return matchesCategory && matchesQuery;
  });

  return (
    <div className="table-shell">
      <div className="table-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search file, message, or tokens"
        />
        <select
          value={categoryFilter}
          onChange={(event) => {
            const value = event.target.value;
            startTransition(() => setCategoryFilter(value));
          }}
        >
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Category</th>
              <th>Source</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Message</th>
              <th>File / Line</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td>
                  <Pill tone={toneBySeverity[item.severity]}>{item.severity}</Pill>
                </td>
                <td>{item.category}</td>
                <td>{item.source.toUpperCase()}</td>
                <td>{item.transactionDate ?? 'N/A'}</td>
                <td>{item.amount?.toFixed(2) ?? 'N/A'}</td>
                <td>{item.errorMessage}</td>
                <td>
                  {item.spreadsheetFileName} / {item.lineNumber}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
