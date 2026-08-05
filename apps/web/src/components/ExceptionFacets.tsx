import type {
  SavedTriageView,
  TriageFacetKey,
  TriageFacetOption,
  TriageFacetSelection,
} from '../lib/exceptionTriage';

import { useState } from 'react';

/** Maximum unselected facet options shown per group before the "Show all" toggle. */
const FACET_OPTION_CAP = 6;

/** Facet sidebar: free-text search, multi-select filters with counts, and saved views. */
export function ExceptionFacets({
  query,
  onQueryChange,
  facetGroups,
  selection,
  onToggleFacet,
  onClearFacets,
  hasActiveFilters,
  totalShown,
  totalAll,
  savedViews,
  onSaveView,
  onApplyView,
  onDeleteView,
}: Readonly<{
  query: string;
  onQueryChange: (value: string) => void;
  facetGroups: ReadonlyArray<{ key: TriageFacetKey; label: string; options: TriageFacetOption[] }>;
  selection: TriageFacetSelection;
  onToggleFacet: (key: TriageFacetKey, value: string) => void;
  onClearFacets: () => void;
  hasActiveFilters: boolean;
  totalShown: number;
  totalAll: number;
  savedViews: SavedTriageView[];
  onSaveView: (name: string) => void;
  onApplyView: (id: string) => void;
  onDeleteView: (id: string) => void;
}>) {
  const [viewName, setViewName] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const handleSaveView = (): void => {
    const trimmed = viewName.trim();

    if (trimmed.length === 0) {
      return;
    }

    onSaveView(trimmed);
    setViewName('');
  };

  return (
    <aside className="exception-facets" aria-label="Exception filters">
      <div className="exception-facets__field">
        <label className="visually-hidden" htmlFor="exception-search-input">
          Search exceptions
        </label>
        <input
          id="exception-search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search file, message, or tokens"
        />
      </div>

      <div className="exception-facets__sticky">
        <p className="exception-facets__count" aria-live="polite">
          Showing {totalShown} of {totalAll} exceptions.
        </p>
        {hasActiveFilters ? (
          <button
            type="button"
            className="secondary-button exception-facets__clear"
            onClick={onClearFacets}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {facetGroups.map((group) => {
        const selectedValues = selection[group.key];
        const hasSelection = selectedValues.length > 0;
        const isOpen = openGroups[group.key] ?? hasSelection;
        const isExpanded = expandedGroups[group.key] ?? false;

        const selectedOptions = group.options.filter((option) =>
          selectedValues.includes(option.value),
        );
        const unselectedOptions = group.options.filter(
          (option) => !selectedValues.includes(option.value),
        );
        // Selected options are always visible; the cap only trims unselected ones.
        const visibleUnselected = isExpanded
          ? unselectedOptions
          : unselectedOptions.slice(0, Math.max(0, FACET_OPTION_CAP - selectedOptions.length));
        const visibleOptions = [...selectedOptions, ...visibleUnselected];
        const canToggleCap = group.options.length > FACET_OPTION_CAP;

        return (
          <details
            key={group.key}
            className="exception-facet-group"
            open={isOpen}
            onToggle={(event) =>
              setOpenGroups((current) => ({
                ...current,
                // currentTarget can be null here (native, non-bubbling `toggle` event) --
                // target is the same <details> element in that case since toggle never bubbles.
                [group.key]: (event.target as HTMLDetailsElement).open,
              }))
            }
          >
            <summary className="exception-facet-group__summary">
              {group.label}
              {hasSelection ? (
                <span className="exception-facet-group__badge">{selectedValues.length}</span>
              ) : null}
            </summary>
            {group.options.length === 0 ? (
              <p className="exception-facet-group__empty">No values</p>
            ) : (
              <>
                {visibleOptions.map((option) => {
                  const checked = selectedValues.includes(option.value);

                  return (
                    <label key={option.value} className="exception-facet-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleFacet(group.key, option.value)}
                      />
                      <span className="exception-facet-option__label">{option.label}</span>
                      <span className="exception-facet-option__count">{option.count}</span>
                    </label>
                  );
                })}
                {canToggleCap ? (
                  <button
                    type="button"
                    className="exception-facet-group__toggle"
                    onClick={() =>
                      setExpandedGroups((current) => ({
                        ...current,
                        [group.key]: !isExpanded,
                      }))
                    }
                  >
                    {isExpanded ? 'Show fewer' : `Show all (${group.options.length})`}
                  </button>
                ) : null}
              </>
            )}
          </details>
        );
      })}

      <div className="exception-facets__saved">
        <h4>Saved views</h4>
        {savedViews.length === 0 ? (
          <p className="exception-facet-group__empty">No saved views yet</p>
        ) : (
          <ul className="exception-saved-view-list">
            {savedViews.map((view) => (
              <li key={view.id}>
                <button
                  type="button"
                  className="exception-saved-view"
                  onClick={() => onApplyView(view.id)}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  className="exception-saved-view__delete"
                  aria-label={`Delete saved view ${view.name}`}
                  onClick={() => onDeleteView(view.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="exception-facets__save-row">
          <label className="visually-hidden" htmlFor="exception-save-view-input">
            Saved view name
          </label>
          <input
            id="exception-save-view-input"
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
            placeholder="Name this view"
          />
          <button type="button" className="secondary-button" onClick={handleSaveView}>
            Save view
          </button>
        </div>
      </div>
    </aside>
  );
}
