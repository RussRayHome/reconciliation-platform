import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

import type {
  ReconciliationAccount,
  RegisterReconciliationAccountInput,
  UpdateReconciliationAccountInput,
} from '@recon/domain';
import { deriveLastFour } from '@recon/domain';

import { runInTenantScope } from './postgres';

/** Raised when an account id does not resolve to a row this organization owns -- a deliberately
 * indistinguishable outcome for "no such account" and "another tenant's account", so this never
 * becomes a probe for the existence of other organizations' rows. RLS already makes the SELECT
 * return nothing in the cross-tenant case; this is the error that carries that to the caller
 * instead of letting a missing row read as an empty assignment. */
export class UnknownReconciliationAccountError extends Error {
  /** @param accountId The unresolvable account id, carried so the caller can attribute the failure
   * to one statement of several without re-deriving which assignment was at fault. */
  constructor(public readonly accountId: string) {
    super(`No registered account "${accountId}" belongs to this organization.`);
    this.name = 'UnknownReconciliationAccountError';
  }
}

/** Raised when registering an account whose `accountIdentifier` this organization already uses.
 * Distinct from the last-four ambiguity A-D1 explicitly permits: two accounts may share their last
 * four, but the same full identifier twice is a duplicate registration, not a legitimate pair. */
export class DuplicateReconciliationAccountError extends Error {
  /** @param accountIdentifier The already-registered identifier, named back so the UI can point at
   * the field the operator must change. */
  constructor(public readonly accountIdentifier: string) {
    super(`An account with identifier "${accountIdentifier}" is already registered.`);
    this.name = 'DuplicateReconciliationAccountError';
  }
}

interface AccountRow {
  id: string;
  organization_id: string;
  account_identifier: string;
  display_name: string | null;
  institution_name: string | null;
  last_four: string | null;
  currency_code: string;
  gl_cash_account_code: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `id, organization_id, account_identifier, display_name, institution_name,
       last_four, currency_code, gl_cash_account_code, is_active, created_at, updated_at`;

const toAccount = (row: AccountRow): ReconciliationAccount => ({
  id: row.id,
  organizationId: row.organization_id,
  accountIdentifier: row.account_identifier,
  displayName: row.display_name,
  institutionName: row.institution_name,
  lastFour: row.last_four,
  currencyCode: row.currency_code,
  glCashAccountCode: row.gl_cash_account_code,
  isActive: row.is_active,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/** Postgres unique-violation. `reconciliation_account_org_identifier_key` is the only unique
 * constraint this store can trip. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

/**
 * The registry behind A-D1 (Issue #338): bank accounts exist because an operator registered them,
 * not because a filename mentioned one. Every method is tenant-scoped through `runInTenantScope`
 * so RLS -- not a WHERE clause anyone could forget -- is what confines reads and writes to the
 * caller's organization (see `postgres.ts`; writing without that scope matches zero rows and
 * reports success).
 */
export class PostgresAccountStore {
  /** @param pool The application pool. Every method routes through `runInTenantScope`, so this is
   * never queried directly -- see the class doc comment. */
  constructor(private readonly pool: Pool) {}

  /**
   * The organization's registered accounts, active first and then by label.
   *
   * @param organizationId The tenant whose registry to read.
   * @param options `includeInactive` also returns deactivated accounts, which the management
   * screen needs in order to offer reactivation; the upload path leaves it off, since a statement
   * may not be assigned to a deactivated account.
   */
  async listAccounts(
    organizationId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<ReconciliationAccount[]> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const result = await client.query<AccountRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM reconciliation_account
          WHERE organization_id = $1
            AND ($2::boolean OR is_active)
          ORDER BY is_active DESC, display_name NULLS LAST, account_identifier`,
        [organizationId, options.includeInactive ?? false],
      );
      return result.rows.map(toAccount);
    });
  }

  /**
   * One account, asserted to belong to this organization.
   *
   * @param organizationId The tenant the account must belong to.
   * @param accountId The account's stable id.
   * @throws {UnknownReconciliationAccountError} When no such account is visible to this tenant --
   * deliberately the same outcome for "does not exist" and "belongs to someone else".
   */
  async getAccount(organizationId: string, accountId: string): Promise<ReconciliationAccount> {
    return runInTenantScope(this.pool, organizationId, async (client) =>
      this.requireAccount(client, organizationId, accountId),
    );
  }

  /**
   * Resolves several account ids in one round trip, asserting every one belongs to this
   * organization. Used by the upload path, which must validate an entire multi-file assignment set
   * before merging any of it -- resolving them one at a time would let the first two files' work
   * happen before the third turned out to be someone else's account.
   */
  async resolveAccounts(
    organizationId: string,
    accountIds: readonly string[],
  ): Promise<Map<string, ReconciliationAccount>> {
    if (accountIds.length === 0) return new Map();
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const result = await client.query<AccountRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM reconciliation_account
          WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [organizationId, [...new Set(accountIds)]],
      );
      const resolved = new Map(result.rows.map((row) => [row.id, toAccount(row)]));
      for (const accountId of accountIds) {
        if (!resolved.has(accountId)) {
          throw new UnknownReconciliationAccountError(accountId);
        }
      }
      return resolved;
    });
  }

  /** Every active account sharing `lastFour`. A-D1: when more than one matches, the operator must
   * choose explicitly -- the caller never picks the first. */
  async findByLastFour(
    organizationId: string,
    lastFour: string,
  ): Promise<ReconciliationAccount[]> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      const result = await client.query<AccountRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM reconciliation_account
          WHERE organization_id = $1 AND is_active AND last_four = $2
          ORDER BY display_name NULLS LAST, account_identifier`,
        [organizationId, lastFour],
      );
      return result.rows.map(toAccount);
    });
  }

  /**
   * Registers a bank account -- the only way one comes into existence (A-D1, Issue #338).
   *
   * @param organizationId The tenant that will own the account.
   * @param input The operator-supplied fields. `lastFour` is derived here from
   * `accountIdentifier` rather than accepted, so the display tail can never disagree with the
   * identifier it summarizes.
   * @throws {DuplicateReconciliationAccountError} When this organization already registered that
   * identifier. Two accounts sharing a *last four* is legal and not this case.
   */
  async registerAccount(
    organizationId: string,
    input: RegisterReconciliationAccountInput,
  ): Promise<ReconciliationAccount> {
    const accountIdentifier = input.accountIdentifier.trim();
    return runInTenantScope(this.pool, organizationId, async (client) => {
      try {
        const result = await client.query<AccountRow>(
          `INSERT INTO reconciliation_account
             (id, organization_id, account_identifier, display_name, institution_name, last_four,
              currency_code, gl_cash_account_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${SELECT_COLUMNS}`,
          [
            randomUUID(),
            organizationId,
            accountIdentifier,
            input.displayName?.trim() || null,
            input.institutionName?.trim() || null,
            deriveLastFour(accountIdentifier),
            input.currencyCode?.trim().toUpperCase() || 'USD',
            input.glCashAccountCode?.trim() || null,
          ],
        );
        return toAccount(result.rows[0]!);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DuplicateReconciliationAccountError(accountIdentifier);
        }
        throw error;
      }
    });
  }

  /**
   * `accountIdentifier` is intentionally not updatable -- see
   * `UpdateReconciliationAccountInput`. Undefined fields are left as they are rather than nulled,
   * so a partial update from the UI cannot silently erase the institution name or the GL binding.
   */
  async updateAccount(
    organizationId: string,
    accountId: string,
    input: UpdateReconciliationAccountInput,
  ): Promise<ReconciliationAccount> {
    return runInTenantScope(this.pool, organizationId, async (client) => {
      await this.requireAccount(client, organizationId, accountId);
      const result = await client.query<AccountRow>(
        `UPDATE reconciliation_account
            SET display_name = COALESCE($3, display_name),
                institution_name = COALESCE($4, institution_name),
                currency_code = COALESCE($5, currency_code),
                gl_cash_account_code = COALESCE($6, gl_cash_account_code),
                is_active = COALESCE($7, is_active)
          WHERE organization_id = $1 AND id = $2
          RETURNING ${SELECT_COLUMNS}`,
        [
          organizationId,
          accountId,
          input.displayName === undefined ? null : input.displayName?.trim() || null,
          input.institutionName === undefined ? null : input.institutionName?.trim() || null,
          input.currencyCode === undefined ? null : input.currencyCode.trim().toUpperCase(),
          input.glCashAccountCode === undefined ? null : input.glCashAccountCode?.trim() || null,
          input.isActive === undefined ? null : input.isActive,
        ],
      );
      // RLS makes a cross-tenant UPDATE match zero rows and still report success, so the row count
      // is checked rather than assumed -- requireAccount above already proved the row is visible,
      // meaning a zero here is a real fault, not a missing tenant scope.
      const updated = result.rows[0];
      if (!updated) {
        throw new UnknownReconciliationAccountError(accountId);
      }
      return toAccount(updated);
    });
  }

  private async requireAccount(
    client: PoolClient,
    organizationId: string,
    accountId: string,
  ): Promise<ReconciliationAccount> {
    const result = await client.query<AccountRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM reconciliation_account
        WHERE organization_id = $1 AND id = $2`,
      [organizationId, accountId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new UnknownReconciliationAccountError(accountId);
    }
    return toAccount(row);
  }
}
