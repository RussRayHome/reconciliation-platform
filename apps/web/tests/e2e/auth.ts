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

/** The account for this Playwright worker's own organization, seeded by
 * scripts/db/dev-stage/create-e2e-orgs.psql.
 *
 * `durableRunPhase` is fetched from the server per page load and scoped to the logged-in user's
 * organization, so every test sharing one organization also shares run state: once ANY test
 * completed a run, the Import Files screen rendered its post-run shape for everyone, and the specs
 * asserting the pre-run state failed depending on which worker won the race. Giving each worker
 * slot its own organization removes that cross-worker channel.
 *
 * TEST_PARALLEL_INDEX is Playwright's own 0..workers-1 slot number, stable for the life of a
 * worker, which is exactly the granularity the seeded pool is keyed on. It is absent outside a
 * Playwright run, and the seed may not have been applied at all -- in both cases this contributes
 * no candidate and the shared-organization fallbacks below still log in, so this degrades to the
 * previous behaviour rather than breaking. */
const resolveWorkerCredential = (): LoginCredentials[] => {
  const slot = process.env.TEST_PARALLEL_INDEX?.trim();

  if (!slot || !/^\d+$/.test(slot)) {
    return [];
  }

  return [{ username: `e2e_w${slot}`, password: 'P@ssw0rd' }];
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
    ...resolveWorkerCredential(),
    ...recentSuccessfulCredential,
    ...fallbackCredentials,
  ]);
};

/** The pristine organization reserved for pre-run form assertions. See create-e2e-orgs.psql. */
export const FORM_VALIDATION_CREDENTIAL: LoginCredentials = {
  username: 'e2e_form',
  password: 'P@ssw0rd',
};

/**
 * @param preferred Tried first, ahead of the worker and shared-organization accounts. Use it when a
 * spec needs a specific organization's run state rather than whichever one this worker owns. The
 * usual candidates still follow as fallbacks, so an environment without the E2E seed applied logs
 * in exactly as it did before instead of failing outright.
 */
export const loginToApplication = async (
  page: Page,
  preferred?: LoginCredentials,
): Promise<void> => {
  const candidates = preferred
    ? dedupeCredentials([preferred, ...resolveLoginCandidates()])
    : resolveLoginCandidates();
  const loginHeading = page.getByRole('heading', { name: 'Log in' });
  const submitButton = page.getByRole('button', { name: 'Log in' });
  // UI-1 flattened Import Files into a single "New run" leaf. That leaf is now the workspace-ready
  // signal: it is a link (not a disclosure header), it is present for every role, and it is the
  // rail's first destination -- so its appearance means the authenticated shell has rendered.
  const workspaceReady = page.getByRole('link', { name: 'New run' });

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
 * terminal phase, it reads "Retry run" instead, since `durableRunPhase` is
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
  await page.getByRole('link', { name: 'New run' }).click();
  await expect(submitRunButton(page)).toBeVisible();
};

/**
 * Registers one bank account through the real `/accounts` screen (A-D1, Issue #338).
 *
 * Needed by any spec that submits a run, because a statement can no longer be reconciled unless it
 * is assigned to a REGISTERED account, and a fresh database has none: changeset 0059's backfill
 * derives accounts from pre-existing `reconciliation_run`/`reconciliation_canonical_row` rows, so
 * it produces nothing on a database whose first run has not happened yet.
 *
 * Driving the real screen rather than seeding over the API on purpose -- it is the path a new
 * customer actually walks, and it keeps the registry UI covered by the functional lane.
 */
export const registerBankAccount = async (
  page: Page,
  account: { accountNumber: string; name: string },
): Promise<void> => {
  await page.goto('/accounts');
  await expect(page.getByRole('heading', { name: 'Bank accounts' })).toBeVisible();

  // Wait for the LIST to settle, not just the heading. The heading is the SectionCard title and
  // renders immediately, while the accounts themselves are fetched -- so checking for an existing
  // row too early reports "absent" for an account that is merely still loading, and the
  // registration below is then rejected as a duplicate. Exactly one of the empty-state paragraph
  // or the table renders once the fetch resolves, so waiting for either is deterministic.
  await expect(page.locator('.bank-accounts__empty, .bank-accounts__table')).toBeVisible();

  // `rowheader`, not `cell`: the account label sits in a `<th scope="row">` (BankAccountsScreen),
  // which maps to role `rowheader`.
  const row = page.getByRole('rowheader', { name: account.name, exact: false });

  // IDEMPOTENT ON PURPOSE. `playwright.config.ts` retries twice in CI, and an account identifier is
  // unique per organization -- so a test that registered an account and then flaked for any
  // unrelated reason would come back on retry and be rejected with
  // DuplicateReconciliationAccountError, failing for a reason that has nothing to do with the
  // original flake. Registering only what is missing keeps a retry a real retry.
  if ((await row.count()) > 0) {
    return;
  }

  await page.locator('#account-number-input').fill(account.accountNumber);
  await page.locator('#account-name-input').fill(account.name);
  await page.getByRole('button', { name: 'Register account' }).click();

  // A rejected registration surfaces in the form itself; assert its absence first so the failure
  // reports the server's own reason instead of timing out on a row that was never going to appear.
  await expect(page.locator('.bank-accounts__error')).toHaveCount(0);
  await expect(row).toBeVisible();
};

/** The account-assignment `<select>` for one bank slot. Ids follow `SourceDropZone`'s
 * `bankInputId` convention: slot 0 is `bank-workbook-input`, later slots are lettered. */
export const bankAccountSelect = (page: Page, slot: number) =>
  page.locator(
    slot === 0
      ? '#bank-workbook-input-account'
      : `#bank-workbook-${String.fromCodePoint(97 + slot)}-input-account`,
  );
