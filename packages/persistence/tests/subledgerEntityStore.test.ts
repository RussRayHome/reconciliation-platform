import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pool } from 'pg';
import {
  DuplicateSubledgerEntityError,
  PostgresSubledgerEntityStore,
  UnknownSubledgerEntityError,
} from '../src';
import { createDatabaseFromTemplate } from './testHelpers/database';
import type { TestDatabase } from './testHelpers/database';

/**
 * The AP/AR entity registries (Issue #448). What is worth testing here is not CRUD but the three
 * identity rules screen 5a states: one id may exist in both registries, ids collide
 * case-insensitively within one registry, and nothing deletes.
 */
let database: TestDatabase | undefined;
let pool: Pool;
let startupError: Error | null = null;
let organizationId: string;
let store: PostgresSubledgerEntityStore;

describe('PostgresSubledgerEntityStore', () => {
  beforeAll(async () => {
    try {
      database = await createDatabaseFromTemplate('recon_subledger_entity_store');
      pool = database.pool;
      store = new PostgresSubledgerEntityStore(pool);

      const org = await pool.query<{ id: string }>(
        "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
      );
      const found = org.rows[0]?.id;
      if (!found) throw new Error("Expected migrations to seed a 'Default Organization' row.");
      organizationId = found;
    } catch (error) {
      startupError = error instanceof Error ? error : new Error(String(error));
      console.warn(`PostgreSQL integration setup failed: ${startupError.message}`);
      throw startupError;
    }
  });

  afterAll(async () => {
    if (database) await database.drop();
  });

  const uniqueId = (prefix: string): string =>
    `${prefix}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  it('registers an entity, defaulting it to active and USD', async () => {
    if (startupError) throw startupError;

    const entity = await store.registerEntity(organizationId, {
      kind: 'ap',
      entityId: uniqueId('E'),
      displayName: 'Northwind Trading',
    });

    expect(entity.isActive).toBe(true);
    expect(entity.currencyCode).toBe('USD');
    expect(entity.kind).toBe('ap');
    expect(entity.ledgerSource).toBeNull();
  });

  it('lets one id exist in BOTH registries as a single legal entity', async () => {
    if (startupError) throw startupError;

    // Design 5a states this outright. Northwind can be a vendor and a customer; keying uniqueness
    // on (organization, entity_id) alone would mean deactivating it as a vendor also deactivates
    // it as a customer.
    const shared = uniqueId('E');
    const ap = await store.registerEntity(organizationId, {
      kind: 'ap',
      entityId: shared,
      displayName: 'Northwind Trading',
    });
    const ar = await store.registerEntity(organizationId, {
      kind: 'ar',
      entityId: shared,
      displayName: 'Northwind Trading',
    });

    expect(ap.id).not.toBe(ar.id);
    expect(ap.entityId).toBe(ar.entityId);
  });

  it('rejects a duplicate id within one registry, case-insensitively', async () => {
    if (startupError) throw startupError;

    // A filename's casing is not something an operator controls reliably, so `E100` and `e100`
    // must be the same entity -- two rows differing only by case would make prefix matching
    // ambiguous exactly where it must not be.
    const id = uniqueId('E');
    await store.registerEntity(organizationId, {
      kind: 'ap',
      entityId: id,
      displayName: 'First',
    });

    await expect(
      store.registerEntity(organizationId, {
        kind: 'ap',
        entityId: id.toLowerCase(),
        displayName: 'Second',
      }),
    ).rejects.toBeInstanceOf(DuplicateSubledgerEntityError);
  });

  it('renames the display name without touching the entity id', async () => {
    if (startupError) throw startupError;

    const entity = await store.registerEntity(organizationId, {
      kind: 'ap',
      entityId: uniqueId('E'),
      displayName: 'Old name',
    });

    const renamed = await store.updateEntity(organizationId, entity.id, {
      displayName: 'New name',
    });

    expect(renamed.displayName).toBe('New name');
    // The id is what filenames claim; the update input has no field for it at all, so this
    // asserts the shape of the API as much as the row.
    expect(renamed.entityId).toBe(entity.entityId);
  });

  it('deactivates rather than deleting, and can reactivate', async () => {
    if (startupError) throw startupError;

    const entity = await store.registerEntity(organizationId, {
      kind: 'ar',
      entityId: uniqueId('E'),
      displayName: 'To deactivate',
    });

    const deactivated = await store.updateEntity(organizationId, entity.id, { isActive: false });
    expect(deactivated.isActive).toBe(false);

    const row = await pool.query('SELECT id FROM reconciliation_subledger_entity WHERE id = $1', [
      entity.id,
    ]);
    expect(row.rowCount).toBe(1);

    const reactivated = await store.updateEntity(organizationId, entity.id, { isActive: true });
    expect(reactivated.isActive).toBe(true);
  });

  it('lists one registry only, active first', async () => {
    if (startupError) throw startupError;

    const kindOnly = await store.listEntities(organizationId, 'ar');
    expect(kindOnly.every((entity) => entity.kind === 'ar')).toBe(true);

    const activeFlags = kindOnly.map((entity) => entity.isActive);
    const firstInactive = activeFlags.indexOf(false);
    if (firstInactive !== -1) {
      expect(activeFlags.slice(firstInactive).every((flag) => flag === false)).toBe(true);
    }
  });

  it('excludes deactivated entities when only assignable ones are wanted', async () => {
    if (startupError) throw startupError;

    const entity = await store.registerEntity(organizationId, {
      kind: 'ap',
      entityId: uniqueId('E'),
      displayName: 'Hidden when inactive',
    });
    await store.updateEntity(organizationId, entity.id, { isActive: false });

    const assignable = await store.listEntities(organizationId, 'ap', { activeOnly: true });
    expect(assignable.map((candidate) => candidate.id)).not.toContain(entity.id);
  });

  it('reports an unknown row id rather than silently matching nothing', async () => {
    if (startupError) throw startupError;

    await expect(
      store.updateEntity(organizationId, '00000000-0000-4000-8000-000000000000', {
        displayName: 'Nope',
      }),
    ).rejects.toBeInstanceOf(UnknownSubledgerEntityError);
  });
});
