import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import type {
  RegisterSubledgerEntityInput,
  SubledgerEntity,
  SubledgerKind,
  UpdateSubledgerEntityInput,
} from '@recon/domain';

import { runInTenantScope } from './postgres';

/** Raised when an entity id does not resolve to a row this organization owns. Deliberately
 * indistinguishable from "another tenant's entity", for the same reason
 * `UnknownReconciliationAccountError` is: RLS already makes the SELECT return nothing across
 * tenants, and this carries that to the caller rather than letting a missing row read as success. */
export class UnknownSubledgerEntityError extends Error {
  /** @param entityRowId The unresolvable row id, carried so a caller acting on several entities can
   * attribute the failure without re-deriving which one was at fault. */
  constructor(public readonly entityRowId: string) {
    super(`No subledger entity "${entityRowId}" belongs to this organization.`);
    this.name = 'UnknownSubledgerEntityError';
  }
}

/** Raised when opening an entity whose id this organization already uses in that registry.
 * Per-registry, not global: the same id may legitimately exist as both an AP and an AR entity
 * (design 5a), so a collision only counts within one `kind`. */
export class DuplicateSubledgerEntityError extends Error {
  /** @param entityId The already-registered id, named back so the UI can point at the field the
   * operator must change. */
  constructor(
    public readonly entityId: string,
    public readonly kind: SubledgerKind,
  ) {
    super(`A ${kind.toUpperCase()} entity "${entityId}" is already registered.`);
    this.name = 'DuplicateSubledgerEntityError';
  }
}

interface SubledgerEntityRow {
  id: string;
  organization_id: string;
  kind: SubledgerKind;
  entity_id: string;
  display_name: string;
  ledger_source: string | null;
  currency_code: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `id, organization_id, kind, entity_id, display_name, ledger_source,
  currency_code, is_active, created_at, updated_at`;

const toEntity = (row: SubledgerEntityRow): SubledgerEntity => ({
  id: row.id,
  organizationId: row.organization_id,
  kind: row.kind,
  entityId: row.entity_id,
  displayName: row.display_name,
  ledgerSource: row.ledger_source,
  currencyCode: row.currency_code,
  isActive: row.is_active,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

/**
 * The AP and AR entity registries (Issue #448, designs 5a/5b).
 *
 * One store serves both because the registries are structurally identical — `kind` selects which.
 * Splitting them into two stores would duplicate every method to express a difference that is one
 * column.
 *
 * Nothing deletes. `setActive` is the only removal path, mirroring bank accounts: a deactivated
 * entity keeps every file, run and open item already attributed to it.
 */
export class PostgresSubledgerEntityStore {
  /** @param pool The application pool. Every method routes through `runInTenantScope`, so this is
   * never queried directly — see the class doc comment. */
  constructor(private readonly pool: Pool) {}

  /**
   * One registry's entities, active first then alphabetical — the order 5a's table shows.
   * Deactivated rows are included by default because the registry states its own counts
   * ("2 active · 1 deactivated"); a caller wanting only assignable entities passes
   * `activeOnly: true`.
   */
  async listEntities(
    organizationId: string,
    kind: SubledgerKind,
    options: { activeOnly?: boolean } = {},
  ): Promise<SubledgerEntity[]> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const result = await client.query<SubledgerEntityRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM reconciliation_subledger_entity
          WHERE organization_id = $1 AND kind = $2
            ${options.activeOnly ? 'AND is_active = TRUE' : ''}
          ORDER BY is_active DESC, display_name ASC`,
        [organizationId, kind],
      );
      return result.rows.map(toEntity);
    });
  }

  /**
   * Opens a new entity.
   *
   * @throws {DuplicateSubledgerEntityError} When this organization already registered that id in
   * this registry. Matching is case-insensitive (changeset 0079's index), because a filename's
   * casing is not something an operator controls reliably.
   */
  async registerEntity(
    organizationId: string,
    input: RegisterSubledgerEntityInput,
  ): Promise<SubledgerEntity> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      try {
        const result = await client.query<SubledgerEntityRow>(
          `INSERT INTO reconciliation_subledger_entity
             (id, organization_id, kind, entity_id, display_name, ledger_source, currency_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING ${SELECT_COLUMNS}`,
          [
            randomUUID(),
            organizationId,
            input.kind,
            input.entityId.trim(),
            input.displayName.trim(),
            input.ledgerSource?.trim() || null,
            input.currencyCode?.trim() || 'USD',
          ],
        );
        return toEntity(result.rows[0]!);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DuplicateSubledgerEntityError(input.entityId.trim(), input.kind);
        }
        throw error;
      }
    });
  }

  /**
   * Edits an entity. `entityId` and `kind` are unreachable here by design — the first is what
   * filenames claim, the second is which registry the row lives in, and changing either would
   * re-point history rather than edit it (5a: "rename the display name instead").
   *
   * @throws {UnknownSubledgerEntityError} When no such entity is visible to this tenant.
   */
  async updateEntity(
    organizationId: string,
    entityRowId: string,
    input: UpdateSubledgerEntityInput,
  ): Promise<SubledgerEntity> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const assignments: string[] = [];
      const params: unknown[] = [entityRowId, organizationId];
      const set = (column: string, value: unknown): void => {
        params.push(value);
        assignments.push(`${column} = $${params.length}`);
      };

      if (input.displayName !== undefined) set('display_name', input.displayName.trim());
      if (input.ledgerSource !== undefined) set('ledger_source', input.ledgerSource?.trim() || null);
      if (input.currencyCode !== undefined) set('currency_code', input.currencyCode.trim());
      if (input.isActive !== undefined) set('is_active', input.isActive);

      const result = await client.query<SubledgerEntityRow>(
        assignments.length === 0
          ? `SELECT ${SELECT_COLUMNS} FROM reconciliation_subledger_entity
              WHERE id = $1 AND organization_id = $2`
          : `UPDATE reconciliation_subledger_entity
                SET ${assignments.join(', ')}
              WHERE id = $1 AND organization_id = $2
              RETURNING ${SELECT_COLUMNS}`,
        params,
      );

      const row = result.rows[0];
      if (!row) {
        throw new UnknownSubledgerEntityError(entityRowId);
      }
      return toEntity(row);
    });
  }
}
