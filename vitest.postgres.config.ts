import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'postgres-integration',
    environment: 'node',
    include: ['packages/persistence/tests/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
