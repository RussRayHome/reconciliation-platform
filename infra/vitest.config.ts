import { defineConfig } from 'vitest/config';

// Deliberately not part of the root vitest.config.ts's `projects` array (that config's `include`
// globs don't reach infra/test, and adding infra to it is a workspace-wide config change outside
// this build's scope) -- this is a small, self-contained config so `npm run -w @recon/infra test`
// reliably runs infra's own CDK assertion tests, rather than silently matching zero if Vitest
// resolved the root config's `projects` instead of its own defaults.
export default defineConfig({
  test: {
    name: 'infra',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
