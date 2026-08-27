import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import sonarjs from 'eslint-plugin-sonarjs';
import testingLibrary from 'eslint-plugin-testing-library';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';

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
      // k6 scripts run inside k6's own JS engine, not Node or a browser -- __ENV/__VU/__ITER/open()
      // are real k6 runtime globals (see scripts/perf/k6-golden-path.js's own header comment), not
      // undefined references. eslint-plugin has no k6 environment definition to declare instead.
      'scripts/perf/**/*.js',
      'infra/**',
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
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
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
    plugins: {
      vitest,
    },
    // 'warn', not 'error': installed 2026-08-27 against an existing suite with real violations
    // already in it (192 across both new plugins). Downgraded deliberately so this doesn't break
    // `npm run lint` (part of verify:push and CI's required `test` job) the moment it's wired in
    // -- upgrade specific rules back to 'error' once the existing violations are triaged.
    rules: Object.fromEntries(
      Object.keys(vitest.configs.recommended.rules).map((rule) => [rule, 'warn']),
    ),
  },
  {
    // React Testing Library is only used under apps/web/src (matches vitest.config.ts's
    // unit-web project glob) -- apps/api/tests uses plain supertest, and apps/web/tests/e2e is
    // Playwright, neither of which this plugin's rules apply to.
    files: ['apps/web/src/**/*.test.{ts,tsx}'],
    plugins: {
      'testing-library': testingLibrary,
    },
    // 'warn', see the vitest block above for why.
    rules: Object.fromEntries(
      Object.keys(testingLibrary.configs['flat/react'].rules).map((rule) => [rule, 'warn']),
    ),
  },
]);
