import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two tables have row-level security fully disabled -- both for the same structural reason
 * (something has to resolve *which* tenant a request belongs to before the tenant GUC exists to
 * scope a query by, and that bootstrap step can't itself be RLS-gated):
 *
 * - reconciliation_user (changeset 0032, see schemaBaseline.ts's own comment on the same
 *   exception): /api/auth/login looks up a row by username before any tenant is known.
 * - reconciliation_login_event (changeset 0040, ISSUE-050.2): a LOGIN_FAILURE for an
 *   unresolvable username has no organization to scope the row to at insert time either.
 *
 * Both are safe today only because access is narrow and controlled -- a future endpoint that
 * lists or filters either table with no database-layer backstop would read across every tenant.
 *
 * This test makes that invariant fail loudly instead of silently rotting: any new reference to
 * either table in application source must be added to its ALLOWED_FILES entry below, which is
 * itself a deliberate, visible decision rather than an unnoticed accumulation.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const RLS_EXCLUDED_TABLES: Record<string, ReadonlySet<string>> = {
  reconciliation_user: new Set([
    'apps/api/src/app.ts',
    // createRequireFullyVerified: same shape as the login handler's own exception -- a
    // single-row lookup by the already-authenticated request's own username (from the verified
    // JWT `sub` claim, not client-supplied), never a list/filter across users. See its own doc
    // comment.
    'apps/api/src/services/authMiddleware.ts',
    // recordLoginEvent's doc comment names reconciliation_user only to explain
    // reconciliation_login_event's own RLS exclusion by comparison -- no query of
    // reconciliation_user happens in this file.
    'packages/persistence/src/readModelStore.ts',
    // PostgresImportValidationStore.submitRun: resolves a submitter's UUID id (reconciliation_run.
    // submitted_by's FK target) from the already-authenticated, already-tenant-scoped JWT `sub`
    // claim. Narrower than the login lookup above, not looser -- filtered on user_name AND
    // organization_id together (login can't filter by organization_id yet since that's what it's
    // resolving), and it is a single-row lookup, never a list/filter across users.
    'packages/persistence/src/importValidationStore.ts',
  ]),
  reconciliation_login_event: new Set([
    // recordLoginEvent: a single INSERT per authentication event, never a SELECT/list. See its
    // own doc comment.
    'packages/persistence/src/readModelStore.ts',
    // auditLoginEvent's own doc comment names the table while explaining that it persists there
    // via recordLoginEvent -- no direct query of the table happens in this file.
    'apps/api/src/app.ts',
  ]),
};

const SOURCE_ROOTS = ['apps/api/src', 'packages/persistence/src'];

const collectSourceFiles = (root: string): string[] => {
  const files: string[] = [];
  const entries = readdirSync(root);

  for (const entry of entries) {
    const entryPath = path.join(root, entry);
    const stats = statSync(entryPath);

    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(entryPath);
    }
  }

  return files;
};

describe.each(Object.entries(RLS_EXCLUDED_TABLES))(
  '%s RLS-exclusion guard',
  (tableName, allowedFiles) => {
    it('is referenced only from the allowlisted files', () => {
      const offenders: string[] = [];

      for (const root of SOURCE_ROOTS) {
        for (const file of collectSourceFiles(path.resolve(REPO_ROOT, root))) {
          const relative = path.relative(REPO_ROOT, file);
          if (allowedFiles.has(relative)) {
            continue;
          }

          if (readFileSync(file, 'utf8').includes(tableName)) {
            offenders.push(relative);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  },
);
