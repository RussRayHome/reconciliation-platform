import { startTransition, useDeferredValue, useState } from 'react';

import { errorCategoryDisplayNames, type ExceptionItem } from '@recon/domain';
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
        <label className="visually-hidden" htmlFor="exception-search-input">
          Search exceptions
        </label>
        <input
          id="exception-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search file, message, or tokens"
        />
        <label className="visually-hidden" htmlFor="exception-category-filter">
          Filter exceptions by category
        </label>
        <select
          id="exception-category-filter"
          value={categoryFilter}
          onChange={(event) => {
            const value = event.target.value;
            startTransition(() => setCategoryFilter(value));
          }}
        >
          {categories.map((category) => (
            <option key={category} value={category}>
              {category === 'All'
                ? category
                : errorCategoryDisplayNames[category as keyof typeof errorCategoryDisplayNames] ?? category}
            </option>
          ))}
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">
            Exception report with severity, category, source, amount, and source line details.
          </caption>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Category</th>
              <th>Rule</th>
              <th>Source</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Reason</th>
              <th>Evidence</th>
              <th>Next Actions</th>
              <th>Counterpart</th>
              <th>File / Line</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td>
                  <Pill tone={toneBySeverity[item.severity]}>{item.severity}</Pill>
                </td>
                <td>{errorCategoryDisplayNames[item.category] ?? item.category}</td>
                <td>{item.ruleTrace?.ruleName ?? 'Derived classification'}</td>
                <td>{item.source.toUpperCase()}</td>
                <td>{item.transactionDate ?? 'N/A'}</td>
                <td>{item.amount?.toFixed(2) ?? 'N/A'}</td>
                <td>{item.ruleTrace?.reason ?? item.errorMessage}</td>
                <td>{item.ruleTrace?.evidence.join(' | ') ?? 'N/A'}</td>
                <td>{item.recommendedNextActions.join(' | ')}</td>
                <td>
                  {item.ruleTrace?.counterpart?.spreadsheetFileName
                    ? `${item.ruleTrace.counterpart.source?.toUpperCase() ?? ''} ${item.ruleTrace.counterpart.spreadsheetFileName} / ${item.ruleTrace.counterpart.lineNumber ?? 'N/A'}`
                    : item.likelyMatchingReference ?? 'N/A'}
                </td>
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
