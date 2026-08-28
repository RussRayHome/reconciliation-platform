import { expect, type Page } from '@playwright/test';

type LoginCredentials = {
  username: string;
  password: string;
};

let lastSuccessfulCredential: LoginCredentials | null = null;

const dedupeCredentials = (credentials: LoginCredentials[]): LoginCredentials[] => {
  const seen = new Set<string>();

  return credentials.filter((credential) => {
    const key = `${credential.username}\u0000${credential.password}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const resolveLoginCandidates = (): LoginCredentials[] => {
  const envUsername = process.env.PLAYWRIGHT_LOGIN_USERNAME?.trim();
  const envPassword = process.env.PLAYWRIGHT_LOGIN_PASSWORD;

  const configuredCredential =
    envUsername && envUsername.length > 0
      ? [
          {
            username: envUsername,
            password: envPassword ?? envUsername,
          },
        ]
      : [];

  const fallbackCredentials: LoginCredentials[] = [
    // senior-analyst: identical permissions to bray (financial-analyst) except
    // canSubmitImportRuns is true (packages/domain/src/enums.ts) -- a strict superset, so
    // preferring this over bray doesn't change behavior for tests that don't touch imports, and
    // fixes 403s for the ones (openSetup callers) that do.
    { username: 'bray2', password: 'P@ssw0rd' },
    { username: 'bray', password: 'bray123' },
    { username: 'rray', password: 'P@ssw0rd' },
    { username: 'bray', password: 'bray' },
    { username: 'rray', password: 'rray' },
    { username: 'rray3', password: 'P@ssw0rd' },
    { username: 'rray3', password: 'rray3' },
  ];

  const recentSuccessfulCredential = lastSuccessfulCredential ? [lastSuccessfulCredential] : [];

  return dedupeCredentials([
    ...configuredCredential,
    ...recentSuccessfulCredential,
    ...fallbackCredentials,
  ]);
};

export const loginToApplication = async (page: Page): Promise<void> => {
  const candidates = resolveLoginCandidates();
  const loginHeading = page.getByRole('heading', { name: 'Log in' });
  const submitButton = page.getByRole('button', { name: 'Log in' });
  // Import Files became a CollapsibleNavSection (R1 WP1) -- its own header is a button, not a
  // link, so "workspace ready" now waits on its default child instead.
  const workspaceReady = page.getByRole('link', { name: 'Bank Statements' });

  await page.goto('/');
  await expect(loginHeading).toBeVisible();

  for (const candidate of candidates) {
    await page.getByLabel('Username').fill(candidate.username);
    await page.getByLabel('Password').fill(candidate.password);
    const loginResponsePromise = page
      .waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().includes('/api/auth/login'),
        { timeout: 10_000 },
      )
      .catch(() => null);

    await submitButton.click();

    const loginResponse = await loginResponsePromise;

    if (loginResponse?.ok()) {
      await expect(workspaceReady).toBeVisible({ timeout: 10_000 });
      lastSuccessfulCredential = candidate;
      return;
    }

    try {
      await expect(workspaceReady).toBeVisible({ timeout: 2_000 });
      lastSuccessfulCredential = candidate;
      return;
    } catch {
      await expect(loginHeading).toBeVisible({ timeout: 5_000 });
    }
  }

  throw new Error('Unable to authenticate in e2e tests with configured or fallback credentials.');
};

/** R2 V4: this button's accessible name now changes with the run's phase -- "Submit run" only
 * while nothing has been submitted yet; once ANY run for this organization (shared across every
 * e2e test -- confirmed: every seeded login belongs to the same "Default Organization") reaches a
 * terminal phase, it reads "Retry run" or "Start new run" instead, since `durableRunPhase` is
 * fetched fresh from the server on every page load, not local/per-test state. A literal-name
 * locator broke every helper/spec that used one the moment any single e2e run anywhere in the
 * suite completed. What never changes is the `form` attribute (App.tsx sets it once, referencing
 * `source-upload-form`) -- locate by that instead of by name in every e2e helper/spec that needs
 * "the run submission button," regardless of which phase word happens to be showing. */
export const submitRunButton = (page: Page) => page.locator('button[form="source-upload-form"]');

/** Navigates to the workspace and opens Import Files so the upload form is interactable. Screen
 * 01's redesign (File Imports & Validation Phase 9) renamed the submit button from "Run
 * reconciliation" to "Submit run"; R2 V4 (see submitRunButton above) made that name phase-
 * dependent, so this only checks the button exists, not what it's currently labelled. */
export const openSetup = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Bank Statements' }).click();
  await expect(submitRunButton(page)).toBeVisible();
};
