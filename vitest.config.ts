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
        'apps/web/src/main.tsx',
        'packages/domain/src/types.ts',
        'scripts/**',
      ],
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 40,
        lines: 40,
      },
    },
    projects: [
      {
        test: {
          name: 'unit-core',
          environment: 'node',
          include: [
            'packages/**/*.test.ts',
            'packages/**/*.test.tsx',
          ],
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