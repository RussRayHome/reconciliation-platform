import { startTransition, useDeferredValue, useMemo, useState } from 'react';

import { errorCategoryDisplayNames, type ExceptionItem } from '@recon/domain';
import { Pill } from '@recon/ui';

interface ExceptionTableProps {
  exceptions: ExceptionItem[];
}

type ExceptionDisplayItem = {
  item: ExceptionItem;
  categoryLabel: string;
  ruleLabel: string;
  sourceLabel: string;
  dateLabel: string;
  amountLabel: string;
  reasonLabel: string;
  evidenceLabel: string;
  nextActionsLabel: string;
  counterpartLabel: string;
  ruleLineageLabel: string;
  fileLineLabel: string;
};

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
        : (counterpart.transactionId ?? 'N/A'),
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

const getCategoryLabel = (category: ExceptionItem['category']): string =>
  errorCategoryDisplayNames[category] ?? category;

const toDisplayItem = (item: ExceptionItem): ExceptionDisplayItem => ({
  item,
  categoryLabel: getCategoryLabel(item.category),
  ruleLabel: item.ruleTrace?.ruleName ?? 'Derived classification',
  sourceLabel: item.source.toUpperCase(),
  dateLabel: item.transactionDate ?? 'N/A',
  amountLabel: item.amount?.toFixed(2) ?? 'N/A',
  reasonLabel: item.ruleTrace?.reason ?? item.errorMessage,
  evidenceLabel: item.ruleTrace?.evidence.join(' | ') ?? 'N/A',
  nextActionsLabel: item.recommendedNextActions.join(' | '),
  counterpartLabel: getCounterpartLabel(item),
  ruleLineageLabel: getRuleLineageLabel(item),
  fileLineLabel: `${item.spreadsheetFileName} / ${item.lineNumber}`,
});

export const ExceptionTable = ({ exceptions }: ExceptionTableProps) => {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const deferredQuery = useDeferredValue(query);
  const categories = useMemo(
    () => ['All', ...new Set(exceptions.map((item) => item.category))],
    [exceptions],
  );
  const normalizedQuery = deferredQuery.trim().toUpperCase();
  const hasActiveFilters = query.trim().length > 0 || categoryFilter !== 'All';

  const filtered = useMemo(
    () =>
      exceptions.filter((item) => {
        const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter;
        const matchesQuery =
          !normalizedQuery ||
          item.errorMessage.toUpperCase().includes(normalizedQuery) ||
          item.spreadsheetFileName.toUpperCase().includes(normalizedQuery) ||
          item.normalizedComparisonTokens.join(' ').toUpperCase().includes(normalizedQuery);

        return matchesCategory && matchesQuery;
      }),
    [categoryFilter, exceptions, normalizedQuery],
  );
  const displayItems = useMemo(() => filtered.map(toDisplayItem), [filtered]);

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
                : (errorCategoryDisplayNames[category as keyof typeof errorCategoryDisplayNames] ??
                  category)}
            </option>
          ))}
        </select>
      </div>
      <div className="table-results-meta" aria-live="polite">
        <span>
          Showing {displayItems.length} of {exceptions.length} exceptions.
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
      {displayItems.length === 0 ? (
        <div className="empty-state-card table-empty-state" role="status" aria-live="polite">
          <span className="eyebrow">No matching exceptions</span>
          <h3>No exceptions match the current filters</h3>
          <p>Adjust the search text or category filter to see matching exception items again.</p>
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
                {displayItems.map((entry) => (
                  <tr key={entry.item.id}>
                    <td>
                      <Pill tone={toneBySeverity[entry.item.severity]}>{entry.item.severity}</Pill>
                    </td>
                    <td>{entry.categoryLabel}</td>
                    <td>{entry.ruleLabel}</td>
                    <td>{entry.sourceLabel}</td>
                    <td>{entry.dateLabel}</td>
                    <td>{entry.amountLabel}</td>
                    <td>{entry.reasonLabel}</td>
                    <td>{entry.evidenceLabel}</td>
                    <td>{entry.nextActionsLabel}</td>
                    <td>{entry.counterpartLabel}</td>
                    <td>{entry.ruleLineageLabel}</td>
                    <td>{entry.fileLineLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="exception-card-list" aria-label="Exception report cards">
            {displayItems.map((entry) => (
              <article className="exception-card" key={`card-${entry.item.id}`}>
                <div className="exception-card__header">
                  <Pill tone={toneBySeverity[entry.item.severity]}>{entry.item.severity}</Pill>
                  <strong>{entry.categoryLabel}</strong>
                </div>
                <div className="exception-card__row">
                  <span>Rule</span>
                  <strong>{entry.ruleLabel}</strong>
                </div>
                <div className="exception-card__row">
                  <span>Source</span>
                  <strong>{entry.sourceLabel}</strong>
                </div>
                <div className="exception-card__row">
                  <span>Date</span>
                  <strong>{entry.dateLabel}</strong>
                </div>
                <div className="exception-card__row">
                  <span>Amount</span>
                  <strong>{entry.amountLabel}</strong>
                </div>
                <div className="exception-card__row">
                  <span>File / Line</span>
                  <strong>{entry.fileLineLabel}</strong>
                </div>
                <div className="exception-card__detail-block">
                  <span>Reason</span>
                  <p>{entry.reasonLabel}</p>
                </div>
                <div className="exception-card__detail-block">
                  <span>Evidence</span>
                  <p>{entry.evidenceLabel}</p>
                </div>
                <div className="exception-card__detail-block">
                  <span>Next Actions</span>
                  <p>{entry.nextActionsLabel}</p>
                </div>
                <div className="exception-card__detail-block">
                  <span>Counterparts</span>
                  <p>{entry.counterpartLabel}</p>
                </div>
                <div className="exception-card__detail-block">
                  <span>Rule Lineage</span>
                  <p>{entry.ruleLineageLabel}</p>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
