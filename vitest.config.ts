import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/*.config.*', '**/dist/**', '**/coverage/**'],
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