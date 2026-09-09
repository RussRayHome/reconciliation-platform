import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

import type {
  CreateSavedViewInput,
  SavedView,
  SavedViewScope,
  UpdateSavedViewInput,
} from '@recon/domain';

import { runInTenantScope } from './postgres';

/** Raised when a view id does not resolve to a row this organization owns. Deliberately
 * indistinguishable from "another tenant's view" for the same reason `UnknownReconciliationAccountError`
 * is: RLS already makes the SELECT return nothing across tenants, and this carries that to the
 * caller rather than letting a missing row read as success. */
export class UnknownSavedViewError extends Error {
  /** @param savedViewId The unresolvable view id, carried so a caller acting on several views can
   * attribute the failure without re-deriving which one was at fault. */
  constructor(public readonly savedViewId: string) {
    super(`No saved view "${savedViewId}" belongs to this organization.`);
    this.name = 'UnknownSavedViewError';
  }
}

/** Raised when someone who is not the current OWNER tries to change a view. A shared view is
 * readable by the whole finance team but edited only by its steward -- "shared" grants read, never
 * edit. Owner, not author: on a shared view ownership transfers when its steward changes team
 * (#458), so the person who may edit it is not necessarily the person who created it. */
export class SavedViewNotOwnedError extends Error {
  /** @param savedViewId The view the caller may read but not change -- named back so the UI can
   * say which one, since a shared list can show many views the caller does not own. */
  constructor(public readonly savedViewId: string) {
    super(`Saved view "${savedViewId}" belongs to another user.`);
    this.name = 'SavedViewNotOwnedError';
  }
}

/** Raised when an owner already has an ACTIVE view of this name. Retiring one frees its name, which
 * is what keeps retire usable as the delete replacement rather than a permanent name reservation. */
export class DuplicateSavedViewNameError extends Error {
  /** @param name The name already in use. Not necessarily the name the failing call supplied:
   * restoring a retired view collides on its own stored name -- see `update`. */
  constructor(public readonly name: string) {
    super(`A saved view named "${name}" already exists.`);
    this.name = 'DuplicateSavedViewNameError';
  }
}

interface SavedViewRow {
  id: string;
  organization_id: string;
  owner_username: string;
  name: string;
  scope: SavedViewScope;
  filters: Record<string, unknown>;
  visibility: 'private' | 'team';
  status: 'ACTIVE' | 'RETIRED';
  created_at: Date;
  updated_at: Date;
}

const toSavedView = (row: SavedViewRow): SavedView => ({
  id: row.id,
  organizationId: row.organization_id,
  ownerUsername: row.owner_username,
  name: row.name,
  scope: row.scope,
  filters: row.filters,
  visibility: row.visibility,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/** Selected everywhere so the caller always gets the owner's *username*, never the internal user id
 * -- the same rule the rest of the app follows: usernames are the identity a reviewer sees.
 *
 * Joins `owner_user_id`, not `created_by_user_id`: the owner is who stewards the view today, which
 * is what a reader needs. Authorship is stored (see changeset 0078) but is not part of this shape
 * until something asks for it. */
const SELECT_COLUMNS = `
  v.id, v.organization_id, u.user_name AS owner_username, v.name, v.scope, v.filters,
  v.visibility, v.status, v.created_at, v.updated_at`;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

/**
 * Saved views (Issue #458), replacing the per-browser `localStorage` list.
 *
 * Visibility is `private` or `team`, where team means the whole finance team org-wide. That is why
 * there is no membership join here: `visibility = 'team'` plus the row's `organization_id` is the
 * entire access rule. Sub-teams are a recorded future refinement, which is why the column is an
 * enum-shaped TEXT rather than a boolean -- see changeset 0078's own comment.
 *
 * Nothing deletes. `retire` sets status and is the only removal path the API exposes.
 */
export class PostgresSavedViewStore {
  /** @param pool The application pool. Every method routes through `runInTenantScope`, so this is
   * never queried directly -- see the class doc comment. */
  constructor(private readonly pool: Pool) {}

  /** Single-row lookup filtered on user_name AND organization_id together -- the same narrow shape
   * `PostgresImportValidationStore.resolveUserId` uses, and the reason this file is allowlisted in
   * `reconciliationUserAccessGuard.test.ts`. Never a list or filter across users. */
  private async resolveUserId(
    client: PoolClient,
    organizationId: string,
    username: string,
  ): Promise<string | null> {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM reconciliation_user WHERE user_name = $1 AND organization_id = $2',
      [username, organizationId],
    );
    return result.rows[0]?.id ?? null;
  }

  /**
   * Every view this user may see: their own (at any visibility) plus the organization's shared
   * ones. Retired views are excluded by default -- they are recoverable, not current.
   */
  async listVisible(
    organizationId: string,
    username: string,
    options: { scope?: SavedViewScope; includeRetired?: boolean } = {},
  ): Promise<SavedView[]> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const conditions = ["(v.visibility = 'team' OR u.user_name = $2)"];
      const params: unknown[] = [organizationId, username];

      if (!options.includeRetired) {
        conditions.push("v.status = 'ACTIVE'");
      }
      if (options.scope) {
        params.push(options.scope);
        conditions.push(`v.scope = $${params.length}`);
      }

      const result = await client.query<SavedViewRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM reconciliation_saved_view v
           JOIN reconciliation_user u ON u.id = v.owner_user_id
          WHERE v.organization_id = $1 AND ${conditions.join(' AND ')}
          ORDER BY v.updated_at DESC`,
        params,
      );

      return result.rows.map(toSavedView);
    });
  }

  /**
   * Saves a new view for `username`, who becomes both its author and its first owner. Visibility
   * defaults to `private`: sharing is an explicit act, never the default a reviewer falls into.
   *
   * Throws `DuplicateSavedViewNameError` when this owner already has an ACTIVE view of the name.
   */
  async create(
    organizationId: string,
    username: string,
    input: CreateSavedViewInput,
  ): Promise<SavedView> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const ownerId = await this.resolveUserId(client, organizationId, username);
      if (!ownerId) {
        throw new Error(`No user "${username}" belongs to this organization.`);
      }

      try {
        const result = await client.query<SavedViewRow>(
          `WITH inserted AS (
             INSERT INTO reconciliation_saved_view
               (id, organization_id, created_by_user_id, owner_user_id, name, scope, filters,
                visibility)
             VALUES ($1, $2, $3, $3, $4, $5, $6::jsonb, $7)
             RETURNING *
           )
           SELECT ${SELECT_COLUMNS}
             FROM inserted v
             JOIN reconciliation_user u ON u.id = v.owner_user_id`,
          [
            randomUUID(),
            organizationId,
            ownerId,
            input.name.trim(),
            input.scope,
            JSON.stringify(input.filters ?? {}),
            input.visibility ?? 'private',
          ],
        );
        return toSavedView(result.rows[0]!);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DuplicateSavedViewNameError(input.name.trim());
        }
        throw error;
      }
    });
  }

  /**
   * Owner-only edit. A non-owner reaching a shared view gets `SavedViewNotOwnedError` rather than
   * `UnknownSavedViewError`, because they can legitimately *see* it -- pretending it does not exist
   * would be a confusing lie to someone looking straight at it.
   */
  async update(
    organizationId: string,
    username: string,
    savedViewId: string,
    input: UpdateSavedViewInput,
  ): Promise<SavedView> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const existing = await client.query<{ owner_user_id: string; name: string }>(
        `SELECT owner_user_id, name FROM reconciliation_saved_view
          WHERE id = $1 AND organization_id = $2`,
        [savedViewId, organizationId],
      );
      if (existing.rows.length === 0) {
        throw new UnknownSavedViewError(savedViewId);
      }

      const actorId = await this.resolveUserId(client, organizationId, username);
      if (!actorId || actorId !== existing.rows[0]!.owner_user_id) {
        throw new SavedViewNotOwnedError(savedViewId);
      }

      const assignments: string[] = [];
      const params: unknown[] = [savedViewId, organizationId];
      const set = (column: string, value: unknown, cast = ''): void => {
        params.push(value);
        assignments.push(`${column} = $${params.length}${cast}`);
      };

      if (input.name !== undefined) set('name', input.name.trim());
      if (input.filters !== undefined) set('filters', JSON.stringify(input.filters), '::jsonb');
      if (input.visibility !== undefined) set('visibility', input.visibility);
      if (input.status !== undefined) set('status', input.status);

      if (assignments.length === 0) {
        const unchanged = await client.query<SavedViewRow>(
          `SELECT ${SELECT_COLUMNS}
             FROM reconciliation_saved_view v
             JOIN reconciliation_user u ON u.id = v.owner_user_id
            WHERE v.id = $1 AND v.organization_id = $2`,
          [savedViewId, organizationId],
        );
        return toSavedView(unchanged.rows[0]!);
      }

      try {
        const result = await client.query<SavedViewRow>(
          `WITH updated AS (
             UPDATE reconciliation_saved_view
                SET ${assignments.join(', ')}
              WHERE id = $1 AND organization_id = $2
              RETURNING *
           )
           SELECT ${SELECT_COLUMNS}
             FROM updated v
             JOIN reconciliation_user u ON u.id = v.owner_user_id`,
          params,
        );
        return toSavedView(result.rows[0]!);
      } catch (error) {
        if (isUniqueViolation(error)) {
          // The name that collided is not necessarily one this call supplied. The unique index is
          // partial (`WHERE status = 'ACTIVE'`), so restoring a RETIRED view collides whenever its
          // name was reclaimed while it was retired -- an update that never touched `name` at all.
          // Reporting `input.name` alone would name the empty string in exactly that case.
          throw new DuplicateSavedViewNameError(input.name?.trim() ?? existing.rows[0]!.name);
        }
        throw error;
      }
    });
  }

  /** The only removal path. There is no delete -- see changeset 0078 and Issue #396. */
  async retire(organizationId: string, username: string, savedViewId: string): Promise<SavedView> {
    return this.update(organizationId, username, savedViewId, { status: 'RETIRED' });
  }
}
