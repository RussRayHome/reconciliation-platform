import type {
  SavedTriageView,
  TriageFacetKey,
  TriageFacetOption,
  TriageFacetSelection,
} from '../lib/exceptionTriage';

import { useState } from 'react';

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

      <p className="exception-facets__count" aria-live="polite">
        Showing {totalShown} of {totalAll} exceptions.
      </p>

      {facetGroups.map((group) => (
        <fieldset key={group.key} className="exception-facet-group">
          <legend>{group.label}</legend>
          {group.options.length === 0 ? (
            <p className="exception-facet-group__empty">No values</p>
          ) : (
            group.options.map((option) => {
              const checked = selection[group.key].includes(option.value);

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
            })
          )}
        </fieldset>
      ))}

      {hasActiveFilters ? (
        <button type="button" className="secondary-button" onClick={onClearFacets}>
          Clear filters
        </button>
      ) : null}

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
