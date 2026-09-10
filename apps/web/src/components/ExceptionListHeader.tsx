import type { TriageSortDirection, TriageSortKey } from '../lib/exceptionTriage';

type SortState = { key: TriageSortKey; direction: TriageSortDirection };

type ColumnSort = { key: TriageSortKey; label: string };

type HeaderColumn = {
  className: string;
  label: string;
  /** Sort controls this cell owns. A cell may own more than one since the 5-column fold. */
  sorts?: ReadonlyArray<ColumnSort>;
};

/**
 * Five columns, not seven (UI-3, #402). Severity became a dot on the category cell and the date
 * moved beneath it, so neither has a column of its own any more.
 *
 * Both were SORTABLE, and severity is the default sort -- dropping their controls with their columns
 * would have removed the only way to re-apply the order the screen opens in. So the merged cell
 * carries both controls instead. The alternative reading of "keep aria-sort on the surviving
 * columns" would have left `amount` as the only sortable column and quietly cost two of three sort
 * keys; that is a capability loss, not a layout simplification.
 */
const columns: ReadonlyArray<HeaderColumn> = [
  {
    className: 'exception-list-header__category',
    label: 'Category',
    sorts: [
      { key: 'severity', label: 'Severity' },
      { key: 'date', label: 'Date' },
    ],
  },
  {
    className: 'exception-list-header__amount',
    label: 'Amount',
    sorts: [{ key: 'amount', label: 'Amount' }],
  },
  { className: 'exception-list-header__counterpart', label: 'Counterpart' },
  { className: 'exception-list-header__fileline', label: 'File / line' },
  { className: 'exception-list-header__decision', label: 'Decision' },
];

const ariaSortFor = (
  column: HeaderColumn,
  sort: SortState,
): 'ascending' | 'descending' | undefined => {
  if (!column.sorts?.some((candidate) => candidate.key === sort.key)) {
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

        if (!column.sorts) {
          return (
            <span key={column.className} className={column.className} role="columnheader">
              {column.label}
            </span>
          );
        }

        // One control whose label is the column's own reads as a sortable column heading, which is
        // what a single-sort column has always been. Two need the heading stated separately, or the
        // cell would claim to be called "Severity".
        const showsOwnLabel = column.sorts.length > 1;

        return (
          <span
            key={column.className}
            className={column.className}
            role="columnheader"
            aria-sort={ariaSort}
          >
            {showsOwnLabel ? (
              <span className="exception-list-header__label">{column.label}</span>
            ) : null}
            {column.sorts.map((candidate) => {
              const isActive = candidate.key === sort.key;
              const indicator = !isActive ? '' : sort.direction === 'asc' ? '▲' : '▼';

              return (
                <button
                  key={candidate.key}
                  type="button"
                  className={
                    isActive
                      ? 'exception-list-header__sort exception-list-header__sort--active'
                      : 'exception-list-header__sort'
                  }
                  onClick={() => onSort(candidate.key)}
                >
                  <span>{candidate.label}</span>
                  {indicator ? (
                    <span aria-hidden="true" className="exception-list-header__indicator">
                      {indicator}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </span>
        );
      })}
    </div>
  );
}
