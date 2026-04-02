import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'npm run dev:api:test',
      port: 4000,
      reuseExistingServer: true,
      cwd: './'
    },
    {
      command: 'npm run dev:web:test',
      port: 4173,
      reuseExistingServer: true,
      cwd: './'
    }
  ]
});
