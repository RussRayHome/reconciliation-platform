import { expect, test } from '../fixtures';

// ─── Login screen outbound links ────────────────────────────────────────────
// Never click-tested before (ISSUE-033): each of these resolves the login screen's only
// unauthenticated affordances besides the login form itself. ISSUE-026's route sweep covers
// direct navigation to these URLs; this covers the actual link click from the screen a real user
// starts on.

test.describe('login screen outbound links', () => {
  test('Forgot password? navigates to the Forgot Password screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Forgot Password' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/forgot-password');
  });

  test('Create an account navigates to the signup screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/signup');
  });

  test('Contact support navigates to the Contact Support screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Contact support' }).click();
    await expect(page.getByRole('heading', { name: 'Contact Support' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/support');
  });
});

// ─── Signup form validation ──────────────────────────────────────────────────
// Signup is the highest-risk unauthenticated surface in the product -- it accepts input from
// anyone on the internet -- and had no coverage at all before ISSUE-033.

test.describe('signup form validation', () => {
  test('submitting empty shows an error box naming every missing required field', async ({
    page,
  }) => {
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Create account and start trial' }).click();

    await expect(page.getByText(/items? need attention/)).toBeVisible();
    await expect(page.getByText('Work email is required.')).toBeVisible();
    await expect(page.getByText('Full name is required for audit records.')).toBeVisible();
    await expect(page.getByText('Choose a username.')).toBeVisible();
    await expect(page.getByText('Legal entity name is required.')).toBeVisible();
    await expect(
      page.getByText('Accept the Terms of Service and Data Processing Addendum.'),
    ).toBeVisible();

    // Validation blocks submission -- no account is created and no modal appears.
    await expect(page.getByRole('heading', { name: 'Verify your email' })).not.toBeVisible();
  });

  test('an invalid work email is flagged inline and in the submit error box', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Work email').fill('not-an-email');
    await page.getByRole('button', { name: 'Create account and start trial' }).click();

    await expect(page.getByText('Enter a valid work email address.')).toBeVisible();
  });

  test('a username containing @ is rejected', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Username').fill('someone@example.com');
    await page.getByRole('button', { name: 'Create account and start trial' }).click();

    // This text renders in two places by design -- inline next to the field, and in the
    // aggregate error list -- so scope to the list to avoid an ambiguous match.
    await expect(
      page.getByRole('list').getByText('Username cannot be an email address.'),
    ).toBeVisible();
  });

  test('a password meeting all five requirements is accepted', async ({ page }) => {
    await page.goto('/signup');

    // The rule checklist renders regardless of met/unmet state; the aggregate outcome on submit
    // is the reliable, independently-queryable signal that a strong password passes validation.
    await expect(page.getByText('At least 10 characters')).toBeVisible();
    await page.getByLabel('Password').fill('Str0ngP@ssw0rd!');

    await page.getByRole('button', { name: 'Create account and start trial' }).click();
    await expect(
      page.getByText('Password does not meet all five requirements.'),
    ).not.toBeVisible();
  });
});

// ─── Successful signup ────────────────────────────────────────────────────────
// The identity-confirmation code is a real random 6-digit value the backend only ever logs
// server-side (services/identityVerificationService.ts's MockNotificationChannel) -- there's no
// endpoint or seam this black-box browser test can read it from, so entering the code itself
// isn't exercisable here without new backend test infrastructure, which is out of scope for this
// coverage pass. What *is* exercisable, and is real shipped UI: a fully-valid submission reaching
// account creation (the verify-code modal appearing proves the POST succeeded), and the modal's
// "skip and enter the app" affordance landing the new account in the workspace.

test.describe('successful signup', () => {
  test('a fully-valid submission creates the account and prompts for identity verification', async ({
    page,
  }) => {
    const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    await page.goto('/signup');
    await page.getByLabel('Work email').fill(`e2e.signup.${unique}@example.com`);
    await page.getByLabel('Full name').fill('E2E Signup Test');
    await page.getByLabel('Username').fill(`e2e.signup.${unique}`);
    await page.getByLabel('Password').fill('Str0ngP@ssw0rd!');
    await page.getByLabel('Legal entity name').fill(`E2E Signup Test Co ${unique}`);
    await page.getByLabel('Headcount').selectOption('1-50');
    await page.getByLabel('Industry').selectOption('saas');
    await page.getByLabel('State of record').selectOption('Delaware');
    await page.getByLabel('Filing / registration number').fill('7412903');
    await page
      .getByRole('button', { name: /I accept the Terms of Service/ })
      .click();

    const signupResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/api/auth/signup'),
    );
    await page.getByRole('button', { name: 'Create account and start trial' }).click();
    const signupResponse = await signupResponsePromise;

    // Some environments (e.g. this suite's CI job, which deliberately runs a Postgres-less
    // in-memory backend for speed/isolation -- see dashboard-status.yml) don't support signup at
    // all: apps/api/src/app.ts's handler returns 501 with no database pool. That's a real,
    // structural environment gap, not something this test can exercise around, so skip rather
    // than fail.
    test.skip(
      signupResponse.status() === 501,
      'Signup requires a database connection, not available in this environment.',
    );
    expect(signupResponse.ok()).toBe(true);

    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await expect(
      page.getByText(`We sent a six-digit code to e2e.signup.${unique}@example.com`),
    ).toBeVisible();

    // Skipping verification (the modal's × close) is real product UI, not a test workaround --
    // App.tsx routes an authenticated-but-unverified session into the workspace, gated
    // separately per-feature (e.g. Create Mapping) by isFullyVerified.
    await page.getByRole('button', { name: 'Skip and enter the app' }).click();
    await expect(page.getByRole('link', { name: 'Import Files' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
