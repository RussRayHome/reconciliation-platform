import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      all: true,
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'apps/api/src/**/*.{ts,tsx}',
        'apps/web/src/**/*.{ts,tsx}',
        'packages/*/src/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.config.*',
        '**/dist/**',
        '**/coverage/**',
        'apps/api/src/index.ts',
        'apps/api/src/server.ts',
        'packages/domain/src/types.ts',
        'scripts/**',
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    projects: [
      {
        test: {
          name: 'unit-core',
          environment: 'node',
          include: ['packages/**/src/**/*.test.ts', 'packages/**/src/**/*.test.tsx'],
        },
      },
      {
        test: {
          name: 'unit-data',
          environment: 'node',
          include: ['packages/persistence/tests/**/*.test.ts'],
          testTimeout: 180000,
          hookTimeout: 180000,
        },
      },
      {
        test: {
          name: 'unit-web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.tsx'],
          setupFiles: ['apps/web/src/test/setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['apps/api/tests/**/*.test.ts'],
        },
      },
    ],
  },
});
