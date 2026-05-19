import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

const sonarjsRecommendedRulesDisabled = Object.fromEntries(
  Object.keys(sonarjs.configs.recommended.rules).map((ruleName) => [ruleName, 'off']),
);

export default defineConfig([
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      'playwright-browsers/**',
      '**/.vite/**',
      'playwright.config.ts',
      'vitest.config.ts',
      'apps/web/vite.config.ts',
      'scripts/**/*.ts',
      'packages/infra/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['apps/**/src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'apps/web/src/test/**'],
    plugins: {
      sonarjs,
    },
    rules: {
      ...sonarjsRecommendedRulesDisabled,
      'sonarjs/arrow-function-convention': 'off',
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/cors': 'off',
      'sonarjs/cyclomatic-complexity': 'off',
      'sonarjs/declarations-in-global-scope': 'off',
      'sonarjs/file-header': 'off',
      'sonarjs/hashing': 'off',
      'sonarjs/max-lines-per-function': 'off',
      'sonarjs/max-union-size': 'off',
      'sonarjs/no-alphabetical-sort': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-reference-error': 'off',
      'sonarjs/regular-expr': 'off',
      'sonarjs/slow-regex': 'off',
      'sonarjs/no-wildcard-import': 'off',
      'sonarjs/shorthand-property-grouping': 'off',
    },
  },
  {
    files: ['packages/core/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'packages/core/src/export/chartImage.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['apps/**', '**/apps/**'],
              message:
                'Packages must not import from app layers; use shared package interfaces only.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['apps/web/**', '**/apps/web/**', '../web/**', '../../web/**'],
              message: 'API app must not import from web app sources.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['apps/api/**', '**/apps/api/**', '../api/**', '../../api/**'],
              message: 'Web app must not import from API app sources.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'apps/web/tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
]);
