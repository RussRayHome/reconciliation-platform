/**
 * Saved views (Issue #458). A named filter selection a reviewer returns to — "the same view applied
 * to whichever run is open, not a snapshot of one run's results".
 *
 * Until now these lived only in each browser's `localStorage`, which made them per-browser and
 * per-device, and left the designed "Shared" visibility with nowhere to persist. These types are
 * the server-side model that replaces that.
 */

/** Which screen a view applies to. One view model spans both (the "one view with reuse" decision on
 * #396) — the screens have different filter shapes, so the scope says how to read `filters`. */
export const savedViewScopes = ['exceptions', 'open_items'] as const;
export type SavedViewScope = (typeof savedViewScopes)[number];

/**
 * Who can see a view.
 *
 * `team` means the whole finance team, organization-wide — **not** a per-person grant, which is why
 * sharing needs no membership table. Declared as a union rather than a boolean on purpose: sub-teams
 * are a recorded future refinement (#458), and adding a third member here stays additive, where an
 * `isShared` boolean would force a model change on live data.
 */
export const savedViewVisibilities = ['private', 'team'] as const;
export type SavedViewVisibility = (typeof savedViewVisibilities)[number];

/**
 * Lifecycle. A view is retired, never deleted — the same rule bank accounts and subledger entities
 * follow. Retiring frees its name for reuse; the row and its authorship survive.
 */
export const savedViewStatuses = ['ACTIVE', 'RETIRED'] as const;
export type SavedViewStatus = (typeof savedViewStatuses)[number];

/** One saved view, as stored. `filters` is the screen's own filter model, read according to `scope`. */
export interface SavedView {
  id: string;
  organizationId: string;
  /** The view's author. A shared view is still owned by one person even though the team can read it. */
  ownerUsername: string;
  name: string;
  scope: SavedViewScope;
  filters: Record<string, unknown>;
  visibility: SavedViewVisibility;
  status: SavedViewStatus;
  createdAt: string;
  updatedAt: string;
}

/** Fields supplied when saving a new view. The owner and organization come from the authenticated
 * principal, never from the request body. */
export interface CreateSavedViewInput {
  name: string;
  scope: SavedViewScope;
  filters: Record<string, unknown>;
  visibility?: SavedViewVisibility;
}

/** Fields a view's owner may change afterwards. `scope` is absent deliberately: a view's scope is
 * what its saved filters mean, so changing it would reinterpret the payload rather than edit it —
 * save a new view instead. */
export interface UpdateSavedViewInput {
  name?: string;
  filters?: Record<string, unknown>;
  visibility?: SavedViewVisibility;
  status?: SavedViewStatus;
}
