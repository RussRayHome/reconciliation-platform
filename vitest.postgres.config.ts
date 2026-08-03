import { defineConfig } from 'vitest/config';

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
  },
});
