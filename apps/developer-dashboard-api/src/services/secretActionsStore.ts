/**
 * Persisted state for the Secret Integrity panel's runbook actions (Rotate now / Triage / Dismiss
 * / Verify purge). Lives in the product's own Postgres, not a database of its own -- this data is
 * SOX-relevant audit evidence (see ISSUE-049/ISSUE-050) and Postgres already has a backup story
 * and pgaudit coverage that a standalone file would not. It connects as its own least-privilege
 * role, `dashboard_app_runtime` (packages/persistence/liquibase/changesets/0036), which can touch
 * exactly one table (0035) and nothing else in the schema -- this app has a materially
 * lower-trust auth model (GitHub login allowlist, not the product's tenant auth) than the product
 * API, so sharing app_user's broader grant would widen blast radius for no benefit.
 *
 * Append-only by design: every action is a new row, never an update or delete, so the change log
 * is a real audit trail. "Current state" for a fingerprint (e.g. whether it's been rotated) is
 * derived by reading the latest row per fingerprint, not by mutating a status column.
 *
 * Falls back to an in-memory store (same interface, lost on restart) when DASHBOARD_DATABASE_URL
 * is unset, mirroring packages/persistence/src/postgres.ts's own optional-Postgres convention --
 * local dev shouldn't require a running Postgres just to click around the panel.
 */
import { Pool } from 'pg';
import type pino from 'pino';

export type SecretActionType = 'rotate' | 'triage' | 'dismiss' | 'verify_purge';

export const SECRET_ACTION_TYPES: SecretActionType[] = ['rotate', 'triage', 'dismiss', 'verify_purge'];

export type SecretChangeLogEntry = {
  id: number;
  fingerprint: string;
  action: SecretActionType;
  actor: string;
  ticket: string | null;
  note: string | null;
  createdAt: string;
};

export interface SecretActionsStore {
  recordAction(input: {
    fingerprint: string;
    action: SecretActionType;
    actor: string;
    ticket?: string | null;
    note?: string | null;
  }): Promise<SecretChangeLogEntry>;
  listChangeLog(limit?: number): Promise<SecretChangeLogEntry[]>;
  latestActionsByFingerprint(): Promise<Map<string, SecretChangeLogEntry>>;
  close(): Promise<void>;
}

const createPostgresSecretActionsStore = (connectionString: string): SecretActionsStore => {
  const pool = new Pool({ connectionString, max: 5 });

  return {
    async recordAction({ fingerprint, action, actor, ticket = null, note = null }) {
      const result = await pool.query<{
        id: string;
        fingerprint: string;
        action: SecretActionType;
        actor: string;
        ticket: string | null;
        note: string | null;
        created_at: Date;
      }>(
        `INSERT INTO dashboard_secret_change_log (fingerprint, action, actor, ticket, note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, fingerprint, action, actor, ticket, note, created_at`,
        [fingerprint, action, actor, ticket, note],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('Insert into dashboard_secret_change_log returned no row.');
      }
      return {
        id: Number(row.id),
        fingerprint: row.fingerprint,
        action: row.action,
        actor: row.actor,
        ticket: row.ticket,
        note: row.note,
        createdAt: row.created_at.toISOString(),
      };
    },

    async listChangeLog(limit = 200) {
      const result = await pool.query<{
        id: string;
        fingerprint: string;
        action: SecretActionType;
        actor: string;
        ticket: string | null;
        note: string | null;
        created_at: Date;
      }>(
        `SELECT id, fingerprint, action, actor, ticket, note, created_at
         FROM dashboard_secret_change_log
         ORDER BY created_at DESC, id DESC
         LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({
        id: Number(row.id),
        fingerprint: row.fingerprint,
        action: row.action,
        actor: row.actor,
        ticket: row.ticket,
        note: row.note,
        createdAt: row.created_at.toISOString(),
      }));
    },

    async latestActionsByFingerprint() {
      const result = await pool.query<{
        id: string;
        fingerprint: string;
        action: SecretActionType;
        actor: string;
        ticket: string | null;
        note: string | null;
        created_at: Date;
      }>(`
        SELECT DISTINCT ON (fingerprint) id, fingerprint, action, actor, ticket, note, created_at
        FROM dashboard_secret_change_log
        ORDER BY fingerprint, created_at DESC, id DESC
      `);
      return new Map(
        result.rows.map((row) => [
          row.fingerprint,
          {
            id: Number(row.id),
            fingerprint: row.fingerprint,
            action: row.action,
            actor: row.actor,
            ticket: row.ticket,
            note: row.note,
            createdAt: row.created_at.toISOString(),
          },
        ]),
      );
    },

    async close() {
      await pool.end();
    },
  };
};

const createInMemorySecretActionsStore = (): SecretActionsStore => {
  const rows: SecretChangeLogEntry[] = [];
  let nextId = 1;

  return {
    recordAction({ fingerprint, action, actor, ticket = null, note = null }) {
      const entry: SecretChangeLogEntry = {
        id: nextId++,
        fingerprint,
        action,
        actor,
        ticket,
        note,
        createdAt: new Date().toISOString(),
      };
      rows.push(entry);
      return Promise.resolve(entry);
    },
    listChangeLog(limit = 200) {
      return Promise.resolve(
        [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id).slice(0, limit),
      );
    },
    latestActionsByFingerprint() {
      const latest = new Map<string, SecretChangeLogEntry>();
      for (const entry of rows) {
        const current = latest.get(entry.fingerprint);
        if (!current || entry.id > current.id) {
          latest.set(entry.fingerprint, entry);
        }
      }
      return Promise.resolve(latest);
    },
    close() {
      return Promise.resolve();
    },
  };
};

export const createSecretActionsStore = (logger?: pino.Logger): SecretActionsStore => {
  const connectionString = process.env.DASHBOARD_DATABASE_URL?.trim();
  if (connectionString) {
    return createPostgresSecretActionsStore(connectionString);
  }

  logger?.warn(
    { action: 'dashboard.secret_actions_store.in_memory' },
    'DASHBOARD_DATABASE_URL not set; secret-action history is in-memory only and will be lost on restart.',
  );
  return createInMemorySecretActionsStore();
};
