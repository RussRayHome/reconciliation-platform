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

const getCounterpartLabel = (item: ExceptionItem): string => {
  const counterparts =
    item.ruleTrace?.counterparts?.length || !item.ruleTrace?.counterpart
      ? (item.ruleTrace?.counterparts ?? [])
      : [item.ruleTrace.counterpart];

  if (counterparts.length === 0) {
    return item.likelyMatchingReference ?? 'N/A';
  }

  return counterparts
    .map((counterpart) =>
      counterpart.spreadsheetFileName
        ? `${counterpart.source?.toUpperCase() ?? ''} ${counterpart.spreadsheetFileName} / ${counterpart.lineNumber ?? 'N/A'}`.trim()
        : counterpart.transactionId ?? 'N/A',
    )
    .join(' | ');
};

const getRuleLineageLabel = (item: ExceptionItem): string => {
  const traces = [...(item.priorRuleTraces ?? []), ...(item.ruleTrace ? [item.ruleTrace] : [])];

  if (traces.length === 0) {
    return 'N/A';
  }

  return traces
    .map((trace, index) => `${index === traces.length - 1 ? 'Final' : 'Prior'}: ${trace.ruleName}`)
    .join(' | ');
};

export const ExceptionTable = ({ exceptions }: ExceptionTableProps) => {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const deferredQuery = useDeferredValue(query);
  const categories = ['All', ...new Set(exceptions.map((item) => item.category))];
  const hasActiveFilters = query.trim().length > 0 || categoryFilter !== 'All';

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
      <div className="table-results-meta" aria-live="polite">
        <span>
          Showing {filtered.length} of {exceptions.length} exceptions.
        </span>
        {hasActiveFilters ? (
          <button
            type="button"
            className="secondary-button table-reset-button"
            onClick={() => {
              setQuery('');
              setCategoryFilter('All');
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state-card table-empty-state" role="status" aria-live="polite">
          <span className="eyebrow">No matching exceptions</span>
          <h3>No exceptions match the current filters</h3>
          <p>
            Adjust the search text or category filter to see matching exception items again.
          </p>
        </div>
      ) : (
        <>
          <div className="table-scroll table-scroll--desktop">
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
                  <th>Counterparts</th>
                  <th>Rule Lineage</th>
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
                    <td>{getCounterpartLabel(item)}</td>
                    <td>{getRuleLineageLabel(item)}</td>
                    <td>
                      {item.spreadsheetFileName} / {item.lineNumber}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="exception-card-list" aria-label="Exception report cards">
            {filtered.map((item) => (
              <article className="exception-card" key={`card-${item.id}`}>
                <div className="exception-card__header">
                  <Pill tone={toneBySeverity[item.severity]}>{item.severity}</Pill>
                  <strong>{errorCategoryDisplayNames[item.category] ?? item.category}</strong>
                </div>
                <div className="exception-card__row">
                  <span>Rule</span>
                  <strong>{item.ruleTrace?.ruleName ?? 'Derived classification'}</strong>
                </div>
                <div className="exception-card__row">
                  <span>Source</span>
                  <strong>{item.source.toUpperCase()}</strong>
                </div>
                <div className="exception-card__row">
                  <span>Date</span>
                  <strong>{item.transactionDate ?? 'N/A'}</strong>
                </div>
                <div className="exception-card__row">
                  <span>Amount</span>
                  <strong>{item.amount?.toFixed(2) ?? 'N/A'}</strong>
                </div>
                <div className="exception-card__row">
                  <span>File / Line</span>
                  <strong>
                    {item.spreadsheetFileName} / {item.lineNumber}
                  </strong>
                </div>
                <div className="exception-card__detail-block">
                  <span>Reason</span>
                  <p>{item.ruleTrace?.reason ?? item.errorMessage}</p>
                </div>
                <div className="exception-card__detail-block">
                  <span>Evidence</span>
                  <p>{item.ruleTrace?.evidence.join(' | ') ?? 'N/A'}</p>
                </div>
                <div className="exception-card__detail-block">
                  <span>Next Actions</span>
                  <p>{item.recommendedNextActions.join(' | ')}</p>
                </div>
                <div className="exception-card__detail-block">
                  <span>Counterparts</span>
                  <p>{getCounterpartLabel(item)}</p>
                </div>
                <div className="exception-card__detail-block">
                  <span>Rule Lineage</span>
                  <p>{getRuleLineageLabel(item)}</p>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
