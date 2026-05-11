/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'packages-must-not-import-apps',
      severity: 'error',
      comment: 'Packages must depend on shared packages/contracts, not app layers.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'packages-must-not-reach-apps-transitively',
      severity: 'error',
      comment:
        'Packages must not directly or transitively reach app layers through intermediate modules.',
      from: { path: '^packages/' },
      to: { path: '^apps/', reachable: true },
    },
    {
      name: 'api-must-not-import-web',
      severity: 'error',
      comment: 'apps/api cannot import from apps/web.',
      from: { path: '^apps/api/' },
      to: { path: '^apps/web/' },
    },
    {
      name: 'web-must-not-import-api',
      severity: 'error',
      comment: 'apps/web cannot import from apps/api.',
      from: { path: '^apps/web/' },
      to: { path: '^apps/api/' },
    },
    {
      name: 'web-must-not-reach-persistence',
      severity: 'error',
      comment: 'apps/web must not directly or transitively depend on packages/persistence.',
      from: { path: '^apps/web/' },
      to: { path: '^packages/persistence/', reachable: true },
    },
    {
      name: 'api-must-not-reach-ui',
      severity: 'error',
      comment: 'apps/api must not directly or transitively depend on packages/ui.',
      from: { path: '^apps/api/' },
      to: { path: '^packages/ui/', reachable: true },
    },
    {
      name: 'no-circular-dependencies',
      severity: 'warn',
      comment: 'Circular dependencies are fragile and should be removed over time.',
      from: { path: '^(apps|packages|scripts)/' },
      to: { circular: true },
    },
  ],
  options: {
    includeOnly: '^(apps|packages|scripts)/',
    tsConfig: {
      fileName: 'tsconfig.typecheck.json',
    },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
    doNotFollow: {
      path: String.raw`(^|/)(node_modules|dist|coverage|playwright-report|test-results|docs/images)(/|$)`,
    },
    exclude: {
      path: String.raw`(^|/)(node_modules|dist|coverage|playwright-report|test-results)(/|$)|\.d\.ts$`,
    },
  },
};
