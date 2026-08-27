import { defineConfig } from '@playwright/test';

// A separate top-level config, not a third project inside playwright.config.ts, because
// `webServer` and `globalSetup` are both top-level-only options in Playwright (apply to every
// project regardless of `--project` filtering) -- adding this project there would make every
// `functional`/`visual` run also try to start the native dev servers this project doesn't use,
// and vice versa. Mirrors vitest.postgres.config.ts's own precedent in this repo: a test suite
// with genuinely different infrastructure needs (a real container, not a native dev server) gets
// its own config file, not a project bolted onto the shared one.
export default defineConfig({
  testDir: './apps/web/tests/e2e/nginx',
  // Generous: this bounds the beforeAll hook too (Playwright's own hook timeout defaults to the
  // test timeout), which has to cover a real `docker compose up --build` plus the readiness
  // waits in security-headers.spec.ts -- a genuinely fresh, differently-named compose project
  // (even with cached image layers) is not fast.
  timeout: 300_000,
  outputDir: './test-results/e2e-nginx',
  retries: process.env.CI ? 2 : 0,
  // Single worker: every spec shares one booted stack (test.beforeAll/afterAll in the spec file
  // itself, not Playwright's own webServer/globalSetup -- see security-headers.spec.ts's header
  // comment), and multiple workers would each try to boot and tear down their own copy.
  workers: 1,
});
