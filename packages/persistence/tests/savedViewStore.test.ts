import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import type { CreateSavedViewInput } from '@recon/domain';
import {
  DuplicateSavedViewNameError,
  PostgresSavedViewStore,
  SavedViewNotOwnedError,
  UnknownSavedViewError,
} from '../src';
import { createDatabaseFromTemplate } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

/**
 * Saved views (Issue #458). The store's whole job is deciding *who may see* and *who may change*
 * a view, so that is what this file tests -- not CRUD mechanics.
 *
 * Note on tenancy: this pool connects as the database owner, which bypasses RLS. That is
 * deliberate here. `rlsTenantIsolation.test.ts` proves the policy layer works; what these tests
 * prove is that the store's own `organization_id` predicates are correct *without* leaning on RLS.
 * Both layers have to hold independently -- RLS is the backstop, not the only guard.
 */
let database: TestDatabase | undefined;
let pool: Pool;
let startupError: Error | null = null;
let organizationId: string;
let otherOrganizationId: string;

const OWNER = 'saved.view.owner';
const TEAMMATE = 'saved.view.teammate';
const OUTSIDER = 'saved.view.outsider';

const buildInput = (overrides: Partial<CreateSavedViewInput> = {}): CreateSavedViewInput => ({
  name: 'Critical - unresolved',
  scope: 'exceptions',
  filters: { severity: ['critical'], sort: 'amount-desc' },
  ...overrides,
});

const insertUser = async (userName: string, organization: string, role: string): Promise<void> => {
  await pool.query(
    `INSERT INTO reconciliation_user (user_name, first_name, last_name, password_hash, role, organization_id)
     VALUES ($1, 'Test', 'User', 'hash', $2, $3)`,
    [userName, role, organization],
  );
};

/** Raw text so microsecond precision survives -- a JS Date only resolves to milliseconds, and two
 * transactions can start inside the same one. */
const readTimestamps = async (id: string): Promise<{ createdAt: string; updatedAt: string }> => {
  const result = await pool.query<{ created_at: string; updated_at: string }>(
    'SELECT created_at::text, updated_at::text FROM reconciliation_saved_view WHERE id = $1',
    [id],
  );
  return { createdAt: result.rows[0]!.created_at, updatedAt: result.rows[0]!.updated_at };
};

describe('PostgresSavedViewStore', () => {
  let store: PostgresSavedViewStore;

  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_saved_view_store');
      pool = database.pool;
      store = new PostgresSavedViewStore(pool);

      const defaultOrganization = await pool.query<{ id: string }>(
        "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
      );
      const found = defaultOrganization.rows[0]?.id;
      if (!found) {
        throw new Error("Expected migrations to seed a 'Default Organization' row.");
      }
      organizationId = found;

      const other = await pool.query<{ id: string }>(
        "INSERT INTO reconciliation_organization (id, name) VALUES (gen_random_uuid(), 'Saved View Other Org') RETURNING id",
      );
      otherOrganizationId = other.rows[0]!.id;

      await insertUser(OWNER, organizationId, 'senior-analyst');
      await insertUser(TEAMMATE, organizationId, 'staff-accountant');
      await insertUser(OUTSIDER, otherOrganizationId, 'controller');
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`PostgreSQL integration setup failed: ${startupError.message}`);
      throw startupError;
    }
  });

  afterAll(async () => {
    if (database) {
      await database.drop();
    }
  });

  /** Each test owns its own rows; the unique index is per owner+name, so shared names would make
   * tests order-dependent. */
  const uniqueName = (label: string): string => `${label} ${Math.random().toString(36).slice(2, 9)}`;

  describe('create', () => {
    it('persists the view and defaults it to a private, ACTIVE view owned by its author', async () => {
      if (startupError) throw startupError;

      const view = await store.create(organizationId, OWNER, buildInput({ name: uniqueName('Defaults') }));

      expect(view.visibility).toBe('private');
      expect(view.status).toBe('ACTIVE');
      expect(view.ownerUsername).toBe(OWNER);
      expect(view.organizationId).toBe(organizationId);
      expect(view.scope).toBe('exceptions');
    });

    it('sets BOTH person columns to the author, so a v1 row has author == owner', async () => {
      if (startupError) throw startupError;

      // The two columns exist because ownership transfers and authorship must not (changeset 0078).
      // Until sub-teams exist nothing diverges them, and a create that populated only one would
      // leave the other NULL -- which the NOT NULL constraint would catch, but silently equal is
      // the state the transfer path will later assume as its starting point.
      const view = await store.create(organizationId, OWNER, buildInput({ name: uniqueName('Authorship') }));

      const row = await pool.query<{ created_by_user_id: string; owner_user_id: string }>(
        'SELECT created_by_user_id, owner_user_id FROM reconciliation_saved_view WHERE id = $1',
        [view.id],
      );
      expect(row.rows[0]!.created_by_user_id).toBe(row.rows[0]!.owner_user_id);
    });

    it('round-trips the filters payload as JSONB rather than a string', async () => {
      if (startupError) throw startupError;

      const filters = { severity: ['critical', 'high'], amountBand: { min: 0, max: 500 }, unmatchedOnly: true };
      const view = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('Filters'), filters }),
      );

      expect(view.filters).toEqual(filters);
      const reread = await store.listVisible(organizationId, OWNER);
      expect(reread.find((candidate) => candidate.id === view.id)?.filters).toEqual(filters);
    });

    it('rejects a second ACTIVE view of the same name for the same owner', async () => {
      if (startupError) throw startupError;

      const name = uniqueName('Duplicate');
      await store.create(organizationId, OWNER, buildInput({ name }));

      await expect(store.create(organizationId, OWNER, buildInput({ name }))).rejects.toBeInstanceOf(
        DuplicateSavedViewNameError,
      );
    });

    it('allows two different owners to keep views of the same name', async () => {
      if (startupError) throw startupError;

      const name = uniqueName('Shared name');
      await store.create(organizationId, OWNER, buildInput({ name }));

      const teammateView = await store.create(organizationId, TEAMMATE, buildInput({ name }));
      expect(teammateView.ownerUsername).toBe(TEAMMATE);
    });

    it('frees the name once a view is retired, which is what makes retire a usable delete', async () => {
      if (startupError) throw startupError;

      const name = uniqueName('Reclaimed');
      const first = await store.create(organizationId, OWNER, buildInput({ name }));
      await store.retire(organizationId, OWNER, first.id);

      const second = await store.create(organizationId, OWNER, buildInput({ name }));
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('ACTIVE');
    });

    it('trims the supplied name, so " Q3" and "Q3" cannot coexist as distinct views', async () => {
      if (startupError) throw startupError;

      const name = uniqueName('Trimmed');
      await store.create(organizationId, OWNER, buildInput({ name }));

      await expect(
        store.create(organizationId, OWNER, buildInput({ name: `  ${name}  ` })),
      ).rejects.toBeInstanceOf(DuplicateSavedViewNameError);
    });

    it('refuses a username that does not belong to the organization', async () => {
      if (startupError) throw startupError;

      await expect(
        store.create(organizationId, OUTSIDER, buildInput({ name: uniqueName('Outsider') })),
      ).rejects.toThrow(/No user/);
    });
  });

  describe('listVisible', () => {
    it("returns the caller's own private view and the team's shared views, never someone else's private view", async () => {
      if (startupError) throw startupError;

      const mine = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('Mine private') }),
      );
      const theirsShared = await store.create(
        organizationId,
        TEAMMATE,
        buildInput({ name: uniqueName('Theirs shared'), visibility: 'team' }),
      );
      const theirsPrivate = await store.create(
        organizationId,
        TEAMMATE,
        buildInput({ name: uniqueName('Theirs private') }),
      );

      const visible = await store.listVisible(organizationId, OWNER);
      const ids = visible.map((view) => view.id);

      expect(ids).toContain(mine.id);
      expect(ids).toContain(theirsShared.id);
      expect(ids).not.toContain(theirsPrivate.id);
    });

    it('excludes retired views by default and returns them on request', async () => {
      if (startupError) throw startupError;

      const view = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('Retired listing') }),
      );
      await store.retire(organizationId, OWNER, view.id);

      const active = await store.listVisible(organizationId, OWNER);
      expect(active.map((candidate) => candidate.id)).not.toContain(view.id);

      const all = await store.listVisible(organizationId, OWNER, { includeRetired: true });
      expect(all.map((candidate) => candidate.id)).toContain(view.id);
    });

    it('filters by scope, so the Open items screen never offers an Exceptions view', async () => {
      if (startupError) throw startupError;

      const exceptions = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('Scoped exceptions'), scope: 'exceptions' }),
      );
      const openItems = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('Scoped open items'), scope: 'open_items' }),
      );

      const listed = await store.listVisible(organizationId, OWNER, { scope: 'open_items' });
      const ids = listed.map((view) => view.id);

      expect(ids).toContain(openItems.id);
      expect(ids).not.toContain(exceptions.id);
    });

    it('orders most-recently-updated first', async () => {
      if (startupError) throw startupError;

      const older = await store.create(
        organizationId,
        TEAMMATE,
        buildInput({ name: uniqueName('Order older'), scope: 'open_items' }),
      );
      const newer = await store.create(
        organizationId,
        TEAMMATE,
        buildInput({ name: uniqueName('Order newer'), scope: 'open_items' }),
      );
      await store.update(organizationId, TEAMMATE, older.id, { filters: { touched: true } });

      const listed = await store.listVisible(organizationId, TEAMMATE, { scope: 'open_items' });
      const olderPosition = listed.findIndex((view) => view.id === older.id);
      const newerPosition = listed.findIndex((view) => view.id === newer.id);

      expect(newerPosition).toBeGreaterThanOrEqual(0);
      expect(olderPosition).toBeLessThan(newerPosition);
    });

    it("never returns another organization's shared view, without relying on RLS", async () => {
      if (startupError) throw startupError;

      const foreign = await store.create(
        otherOrganizationId,
        OUTSIDER,
        buildInput({ name: uniqueName('Foreign shared'), visibility: 'team' }),
      );

      const listed = await store.listVisible(organizationId, OWNER);
      expect(listed.map((view) => view.id)).not.toContain(foreign.id);
    });
  });

  describe('update', () => {
    it('lets the owner rename, refilter and share a view, and moves updated_at', async () => {
      if (startupError) throw startupError;

      const view = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('Before edit') }),
      );
      const before = await readTimestamps(view.id);
      expect(before.createdAt).toBe(before.updatedAt);

      const renamed = uniqueName('After edit');
      const updated = await store.update(organizationId, OWNER, view.id, {
        name: renamed,
        filters: { severity: ['high'] },
        visibility: 'team',
      });

      expect(updated.name).toBe(renamed);
      expect(updated.filters).toEqual({ severity: ['high'] });
      expect(updated.visibility).toBe('team');

      const after = await readTimestamps(view.id);
      expect(after.updatedAt).not.toBe(before.updatedAt);
      expect(after.createdAt).toBe(before.createdAt);
    });

    it('refuses a non-owner even when they can legitimately see the shared view', async () => {
      if (startupError) throw startupError;

      // The 403/404 split is the point: "shared" grants read, never edit, and telling a teammate
      // the view does not exist while it sits on their screen would be a confusing lie.
      const view = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('Not yours'), visibility: 'team' }),
      );

      const visibleToTeammate = await store.listVisible(organizationId, TEAMMATE);
      expect(visibleToTeammate.map((candidate) => candidate.id)).toContain(view.id);

      await expect(
        store.update(organizationId, TEAMMATE, view.id, { name: uniqueName('Hijacked') }),
      ).rejects.toBeInstanceOf(SavedViewNotOwnedError);
    });

    it('reports an unknown id as unknown, not as a permission failure', async () => {
      if (startupError) throw startupError;

      await expect(
        store.update(organizationId, OWNER, '00000000-0000-4000-8000-000000000000', { name: 'Nope' }),
      ).rejects.toBeInstanceOf(UnknownSavedViewError);
    });

    it("treats another organization's view as unknown rather than forbidden", async () => {
      if (startupError) throw startupError;

      const foreign = await store.create(
        otherOrganizationId,
        OUTSIDER,
        buildInput({ name: uniqueName('Foreign edit') }),
      );

      await expect(
        store.update(organizationId, OWNER, foreign.id, { name: 'Reach across' }),
      ).rejects.toBeInstanceOf(UnknownSavedViewError);
    });

    it('returns the row unchanged when the patch is empty', async () => {
      if (startupError) throw startupError;

      const view = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('No-op') }),
      );
      const before = await readTimestamps(view.id);

      const result = await store.update(organizationId, OWNER, view.id, {});

      expect(result).toEqual(view);
      expect((await readTimestamps(view.id)).updatedAt).toBe(before.updatedAt);
    });

    it('rejects a rename onto a name the same owner already uses', async () => {
      if (startupError) throw startupError;

      const taken = uniqueName('Taken');
      await store.create(organizationId, OWNER, buildInput({ name: taken }));
      const other = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('Renamable') }),
      );

      await expect(
        store.update(organizationId, OWNER, other.id, { name: taken }),
      ).rejects.toBeInstanceOf(DuplicateSavedViewNameError);
    });

    it('names the colliding view when restoring a retired one whose name was reclaimed', async () => {
      if (startupError) throw startupError;

      // The unique index is partial (ACTIVE only), so this collision fires on an update that never
      // supplied a name. The error must still say which name is in the way.
      const name = uniqueName('Reclaimed then restored');
      const original = await store.create(organizationId, OWNER, buildInput({ name }));
      await store.retire(organizationId, OWNER, original.id);
      await store.create(organizationId, OWNER, buildInput({ name }));

      await expect(
        store.update(organizationId, OWNER, original.id, { status: 'ACTIVE' }),
      ).rejects.toThrow(new RegExp(`"${name}"`));
    });
  });

  describe('retire', () => {
    it('marks the view RETIRED rather than deleting the row', async () => {
      if (startupError) throw startupError;

      const view = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('To retire') }),
      );

      const retired = await store.retire(organizationId, OWNER, view.id);
      expect(retired.status).toBe('RETIRED');

      const row = await pool.query('SELECT id FROM reconciliation_saved_view WHERE id = $1', [view.id]);
      expect(row.rowCount).toBe(1);
    });

    it('refuses a non-owner, on the same rule as update', async () => {
      if (startupError) throw startupError;

      const view = await store.create(
        organizationId,
        OWNER,
        buildInput({ name: uniqueName('Retire denied'), visibility: 'team' }),
      );

      await expect(store.retire(organizationId, TEAMMATE, view.id)).rejects.toBeInstanceOf(
        SavedViewNotOwnedError,
      );
    });
  });
});
