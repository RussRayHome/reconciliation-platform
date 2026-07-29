import type { TriageSortDirection, TriageSortKey } from '../lib/exceptionTriage';

type SortState = { key: TriageSortKey; direction: TriageSortDirection };

type HeaderColumn = {
  className: string;
  label: string;
  sortKey?: TriageSortKey;
  srOnlyLabel?: boolean;
};

const columns: ReadonlyArray<HeaderColumn> = [
  {
    className: 'exception-list-header__severity',
    label: 'Severity',
    sortKey: 'severity',
    srOnlyLabel: true,
  },
  { className: 'exception-list-header__category', label: 'Category' },
  { className: 'exception-list-header__date', label: 'Date', sortKey: 'date' },
  { className: 'exception-list-header__amount', label: 'Amount', sortKey: 'amount' },
  { className: 'exception-list-header__counterpart', label: 'Counterpart' },
  { className: 'exception-list-header__fileline', label: 'File / line' },
  { className: 'exception-list-header__decision', label: 'Decision' },
];

const ariaSortFor = (
  column: HeaderColumn,
  sort: SortState,
): 'ascending' | 'descending' | undefined => {
  if (!column.sortKey || column.sortKey !== sort.key) {
    return undefined;
  }

  return sort.direction === 'asc' ? 'ascending' : 'descending';
};

/** Sticky column header that labels the triage grid and doubles as sortable controls. */
export function ExceptionListHeader({
  sort,
  onSort,
}: Readonly<{
  sort: SortState;
  onSort: (key: TriageSortKey) => void;
}>) {
  return (
    <div className="exception-list-header" role="row">
      {columns.map((column) => {
        const ariaSort = ariaSortFor(column, sort);
        const isActive = ariaSort !== undefined;
        const indicator = !isActive ? '' : sort.direction === 'asc' ? '▲' : '▼';

        if (!column.sortKey) {
          return (
            <span key={column.className} className={column.className} role="columnheader">
              {column.label}
            </span>
          );
        }

        return (
          <span
            key={column.className}
            className={column.className}
            role="columnheader"
            aria-sort={ariaSort}
          >
            <button
              type="button"
              className={
                isActive
                  ? 'exception-list-header__sort exception-list-header__sort--active'
                  : 'exception-list-header__sort'
              }
              onClick={() => onSort(column.sortKey as TriageSortKey)}
            >
              <span className={column.srOnlyLabel ? 'visually-hidden' : undefined}>
                {column.label}
              </span>
              {indicator ? (
                <span aria-hidden="true" className="exception-list-header__indicator">
                  {indicator}
                </span>
              ) : null}
            </button>
          </span>
        );
      })}
    </div>
  );
}
