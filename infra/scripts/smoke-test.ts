#!/usr/bin/env -S npx tsx
/**
 * Post-deploy smoke test: proves the live deployment actually works, not just that it deployed
 * without error. Four checks -- routing, storing, user privileges, error handling -- run after
 * `infra:up` (before calling an environment ready for Go Live) and again after
 * `dr-failover.sh` (before trusting a failed-over standby). See README.md's runbook.
 *
 * Usage: npm run infra:smoke-test -- --base-url https://rb-kinneysoft.com
 *
 * Requires infra/scripts/seed-smoke-orgs.sql to have been run against the target database first
 * (creates the two organizations/users this script authenticates as).
 *
 * Assumes the reconciliation queue is disabled (POST /api/reconciliation/run responds
 * synchronously, 201) -- true for this infra build, which provisions no Redis/ElastiCache.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Always invoked as `npm run infra:smoke-test` from infra/ (package.json's "infra:smoke-test"
// script), so process.cwd() is infra/ and the repo root is exactly one level up.
const REPO_ROOT = resolve(process.cwd(), '..');

// Must match infra/scripts/seed-smoke-orgs.sql -- keep the two in sync.
const ORG_A_USER = 'zz-smoke-a';
const ORG_B_USER = 'zz-smoke-b';
const SMOKE_TEST_PASSWORD = 'Sm0ke-Test-Only-P@ss';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

interface CheckResult {
  readonly group: string;
  readonly name: string;
  readonly pass: boolean;
  readonly detail?: string;
}

const results: CheckResult[] = [];

const record = (group: string, name: string, pass: boolean, detail?: string): void => {
  results.push({ group, name, pass, detail });
  const icon = pass ? 'PASS' : 'FAIL';
  console.log(`[${icon}] ${group}: ${name}${detail ? ` -- ${detail}` : ''}`);
};

const parseBaseUrl = (): string => {
  const flagIndex = process.argv.indexOf('--base-url');
  const baseUrl = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  if (!baseUrl) {
    console.error('Usage: npm run infra:smoke-test -- --base-url https://rb-kinneysoft.com');
    process.exit(1);
  }
  return baseUrl.replace(/\/+$/, '');
};

const login = async (
  baseUrl: string,
  username: string,
  password: string,
): Promise<{ status: number; token?: string; message?: string }> => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = (await response.json().catch(() => ({}))) as { token?: string; message?: string };
  return { status: response.status, token: body.token, message: body.message };
};

async function checkRouting(baseUrl: string): Promise<void> {
  const group = 'Routing';

  const health = await fetch(`${baseUrl}/api/health`);
  record(group, 'GET /api/health reaches the API target group', health.status === 200, `status ${health.status}`);

  const web = await fetch(`${baseUrl}/`);
  record(group, 'GET / reaches the web target group', web.status === 200, `status ${web.status}`);
}

async function checkStoring(baseUrl: string, tokenA: string): Promise<string | undefined> {
  const group = 'Storing';

  const bankFile = readFileSync(resolve(REPO_ROOT, 'docs/sample-files/sample-bank.xlsx'));
  const glFile = readFileSync(resolve(REPO_ROOT, 'docs/sample-files/sample-qbo.xlsx'));

  const form = new FormData();
  form.append('bankFile', new Blob([bankFile]), 'sample-bank.xlsx');
  form.append('glFile', new Blob([glFile]), 'sample-qbo.xlsx');

  const response = await fetch(`${baseUrl}/api/reconciliation/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };

  record(
    group,
    'Upload + store + validate a reconciliation run end-to-end',
    response.status === 201 && Boolean(body.id),
    response.status === 201 ? `run id ${body.id}` : `status ${response.status}: ${body.message ?? 'no body'}`,
  );

  return body.id;
}

async function checkPrivileges(baseUrl: string, tokenB: string, orgARunId: string | undefined): Promise<void> {
  const group = 'User privileges';

  if (!orgARunId) {
    record(group, 'Cross-org isolation (org B cannot read org A\'s run)', false, 'skipped -- storing check did not produce a run id');
    return;
  }

  const response = await fetch(`${baseUrl}/api/reconciliation/${orgARunId}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });

  record(
    group,
    "Cross-org isolation (org B cannot read org A's run)",
    response.status === 404,
    `status ${response.status} (expected 404 -- proves RLS under app_user, not a 200 leak)`,
  );
}

async function checkErrorHandling(baseUrl: string, tokenA: string): Promise<void> {
  const group = 'Error handling';

  const unauthenticated = await fetch(`${baseUrl}/api/auth/me`);
  record(
    group,
    'Unauthenticated request to a protected route is rejected cleanly',
    unauthenticated.status === 401,
    `status ${unauthenticated.status}`,
  );

  const badLogin = await login(baseUrl, ORG_A_USER, 'definitely-the-wrong-password');
  record(
    group,
    'Invalid credentials return a clean 401, not a crash',
    badLogin.status === 401 && typeof badLogin.message === 'string',
    `status ${badLogin.status}`,
  );

  const nonexistent = await fetch(`${baseUrl}/api/reconciliation/${NIL_UUID}`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  record(
    group,
    'Request for a nonexistent resource returns 404, not a crash',
    nonexistent.status === 404,
    `status ${nonexistent.status}`,
  );
}

async function main(): Promise<void> {
  const baseUrl = parseBaseUrl();
  console.log(`Running smoke test against ${baseUrl}\n`);

  await checkRouting(baseUrl);

  const loginA = await login(baseUrl, ORG_A_USER, SMOKE_TEST_PASSWORD);
  const loginB = await login(baseUrl, ORG_B_USER, SMOKE_TEST_PASSWORD);
  record('Storing', 'Authenticate as zz-smoke-a', loginA.status === 200 && Boolean(loginA.token));
  record('User privileges', 'Authenticate as zz-smoke-b', loginB.status === 200 && Boolean(loginB.token));

  const orgARunId =
    loginA.token !== undefined ? await checkStoring(baseUrl, loginA.token) : undefined;

  if (loginB.token) {
    await checkPrivileges(baseUrl, loginB.token, orgARunId);
  }

  if (loginA.token) {
    await checkErrorHandling(baseUrl, loginA.token);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);

  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed:`);
    for (const f of failed) {
      console.error(`  - ${f.group}: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    }
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
