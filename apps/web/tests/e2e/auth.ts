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
  const loginHeading = page.getByRole('heading', { name: 'Login' });
  const submitButton = page.getByRole('button', { name: 'Submit' });
  const workspaceReady = page.getByRole('tab', { name: 'Setup' });

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

/** Navigates to the workspace and activates the Setup tab so the upload form is interactable. */
export const openSetup = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Setup' }).click();
  await expect(page.getByRole('button', { name: 'Run reconciliation' })).toBeVisible();
};
