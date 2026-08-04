import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * reconciliation_user has row-level security fully disabled (changeset 0032, see
 * schemaBaseline.ts's own comment on the same exception): /api/auth/login must look up a row by
 * username before any tenant is known, since that lookup is what establishes the tenant GUC in
 * the first place. That's safe today only because nothing else reads the table directly -- a
 * future endpoint that lists or queries reconciliation_user would read across every tenant with
 * no database-layer backstop.
 *
 * This test makes that invariant fail loudly instead of silently rotting: any new reference to
 * reconciliation_user in application source must be added to ALLOWED_FILES below, which is
 * itself a deliberate, visible decision rather than an unnoticed accumulation.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const ALLOWED_FILES = new Set(['apps/api/src/app.ts']);

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

describe('reconciliation_user RLS-exclusion guard', () => {
  it('is referenced only from the allowlisted login handler', () => {
    const offenders: string[] = [];

    for (const root of SOURCE_ROOTS) {
      for (const file of collectSourceFiles(path.resolve(REPO_ROOT, root))) {
        const relative = path.relative(REPO_ROOT, file);
        if (ALLOWED_FILES.has(relative)) {
          continue;
        }

        if (readFileSync(file, 'utf8').includes('reconciliation_user')) {
          offenders.push(relative);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
