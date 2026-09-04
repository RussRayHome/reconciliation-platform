import { defineConfig } from 'vitest/config';

// Standalone entrypoint for `npm run test:postgres`. The same files also run as the `unit-data`
// project inside vitest.config.ts, which `coverage` drives -- see that project's comment for why
// both exist (Issue #286).
//
// `test:postgres` sets RUN_POSTGRES_TESTS=true. Nothing in the test code reads it and it is NOT a
// gate; its only consumer is scripts/local-env-check.sh:92, which greps `ps -eo command` for it to
// tell a live postgres-integration run apart from an orphaned testcontainer before flagging one for
// cleanup. Deleting it would weaken that detection, so it stays -- documented rather than removed.
export default defineConfig({
  test: {
    name: 'postgres-integration',
    environment: 'node',
    include: ['packages/persistence/tests/**/*.test.ts'],
    globalSetup: ['packages/persistence/tests/globalSetup.ts'],
    // Container startup, the pgTap install, and the one Liquibase run all happen in globalSetup
    // now, so per-file hooks only clone a template. The remaining budget is for the handful of
    // tests that still drive Liquibase themselves (fresh update, changelog-sync, rollback).
    testTimeout: 120000,
    hookTimeout: 120000,
    // Every test file that drives `liquibase update` itself (liquibase-migrations.test.ts,
    // liquibase-rollback.test.ts) runs it against a fresh per-file database, but roles are
    // cluster-wide (see changeset 0029's own comment) and every changeset from 0029 on touches
    // one via CREATE ROLE/ALTER ROLE/GRANT. Two of those running concurrently in different test
    // files race on the same pg_authid/pg_shdepend catalog rows and Postgres kills the loser with
    // "tuple concurrently updated" -- a real, reproducible-under-load failure, not a flaky
    // assertion. Matches the same fix already used for the same class of problem in the
    // `coverage` npm script (`--no-file-parallelism`).
    fileParallelism: false,
  },
});
