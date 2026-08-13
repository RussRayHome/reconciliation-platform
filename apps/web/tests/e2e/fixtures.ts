import { test as base, expect } from '@playwright/test';

// Mirrors apps/web/src/lib/environmentPath.ts's own prefixing so pathname assertions match what
// the app actually rewrites bare/deep-link URLs to when the target build was compiled with
// VITE_ENVIRONMENT_PATH_SEGMENT set (e.g. Stage's Docker image, which builds with 'stage'). Unset
// for the suite's default target (a native, unprefixed dev server) -- see playwright.config.ts.
const environmentPathSegment = (process.env.PLAYWRIGHT_ENVIRONMENT_PATH_SEGMENT ?? '')
  .trim()
  .replace(/^\/+|\/+$/g, '');

/** The pathname the app will actually settle on after loading `routePath`, accounting for the
 * target build's environment-segment rewrite (see environmentPath.ts). Use this wherever a test
 * asserts on `new URL(page.url()).pathname` for a route reached via a bare/absolute `page.goto`. */
export function expectedPathname(routePath: string): string {
  if (!environmentPathSegment) {
    return routePath;
  }
  return routePath === '/' ? `/${environmentPathSegment}` : `/${environmentPathSegment}${routePath}`;
}

// Console messages that are expected noise rather than defects. Keep this list short --
// each entry needs a reason, discovered empirically, not added speculatively.
const ALLOWED_CONSOLE_PATTERNS: RegExp[] = [
  // Chrome logs this for every non-2xx fetch/XHR response, regardless of whether the app handles
  // it -- several specs deliberately trigger 4xx/5xx responses (bad login, invalid file upload)
  // to assert the resulting error UI. The test's own assertions are the real check there; this
  // browser-level log isn't a signal of an unhandled bug the way an uncaught exception is.
  /^Failed to load resource: the server responded with a status of \d+/,
  // Same reasoning, for a request that never reaches the server at all -- file-import-
  // screens.spec.ts deliberately aborts the upload request (route.abort('failed')) to test
  // Screen 02's network-failed/retry UI, which is exactly what this browser-level log records.
  /^Failed to load resource: net::ERR_FAILED$/,
];

/** Fails the test on any uncaught page exception or console.error, applied to every spec by
 * default via `auto: true` -- opt out was never needed so far; add a per-test override here if
 * one legitimately triggers a console.error as part of the behaviour under test. */
export const test = base.extend<{ forbidRuntimeErrors: void }>({
  forbidRuntimeErrors: [
    async ({ page }, use) => {
      const failures: string[] = [];

      page.on('pageerror', (error) => {
        failures.push(`Uncaught page error: ${error.message}`);
      });

      page.on('console', (message) => {
        if (message.type() !== 'error') {
          return;
        }
        const text = message.text();
        if (ALLOWED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
          return;
        }
        failures.push(`console.error: ${text}`);
      });

      await use();

      expect(failures, 'Runtime error(s) were logged during this test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
