import { expect, test } from '../fixtures';
import { loginToApplication } from '../auth';
import { routePaths } from '../../../src/routes/routePaths';

// Mirrors playwright.config.ts's own baseURL/apiURL defaults -- this suite always runs against
// one of these two origins (a native dev server + API, or the Docker `tools` container's nginx +
// api service), and legitimate app traffic never leaves them. Anything else observed here is the
// same bug class ISSUE-110 fixed: a third-party CDN silently baked into the shipped app (Google
// Fonts, in that case) instead of self-hosted. This is the runtime counterpart to
// packages/core/src/security/noExternalSources.test.ts's static source scan -- that test catches
// the external reference in source before a build ever ships; this one catches an actual browser
// fetching from somewhere it shouldn't, which also covers sources the static scan can't see (e.g.
// a dependency's own runtime code making the request).
const webOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173').origin;
const apiOrigin = new URL(process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:4000').origin;
const ALLOWED_ORIGINS = new Set([webOrigin, apiOrigin]);

test.describe('no external network requests', () => {
  test('login and an authenticated page load only fetch same-origin (or configured API) resources', async ({
    page,
  }) => {
    const externalRequestUrls: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      // data:/blob: have no network origin to check -- inline images and client-generated
      // exports/downloads use these and are outside this test's concern (network egress).
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (!ALLOWED_ORIGINS.has(new URL(url).origin)) externalRequestUrls.push(url);
    });

    await loginToApplication(page);

    // A second, distinct authenticated page: exercises a different set of components/styles than
    // the login screen alone, without turning this into a full route sweep (route-sweep.spec.ts
    // already owns that; this test only needs enough page variety to be a meaningful network
    // sample, not full route coverage).
    await page.goto(routePaths.mappingProfiles);
    await page.waitForLoadState('networkidle');

    expect(
      externalRequestUrls,
      `Request(s) went to a non-app origin: ${externalRequestUrls.join(', ')}`,
    ).toEqual([]);
  });
});
