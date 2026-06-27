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
  const runReconciliationButton = page.getByRole('button', { name: 'Run reconciliation' });

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
      await expect(runReconciliationButton).toBeVisible({ timeout: 10_000 });
      lastSuccessfulCredential = candidate;
      return;
    }

    try {
      await expect(runReconciliationButton).toBeVisible({ timeout: 2_000 });
      lastSuccessfulCredential = candidate;
      return;
    } catch {
      await expect(loginHeading).toBeVisible({ timeout: 5_000 });
    }
  }

  throw new Error('Unable to authenticate in e2e tests with configured or fallback credentials.');
};
