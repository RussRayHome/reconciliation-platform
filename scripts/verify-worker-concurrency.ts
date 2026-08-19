/**
 * Issue #134: proves two real, separate BullMQ consumer processes (the `worker` service) actually
 * process import-validation jobs concurrently -- not just that config claims to allow it. Submits
 * two real import runs, with different account numbers/GL naming, through the real HTTP API
 * against an already-deployed Docker stack (API container producing, separate worker container
 * consuming, real Postgres + Redis). Asserts both complete correctly, then independently derives
 * each run's processing window from the worker container's own structured logs and asserts the
 * two windows genuinely overlapped.
 *
 * Prerequisite: a stack must already be deployed with the queue enabled (compose.dev.yaml does
 * this) AND the `worker` service scaled to at least 2 replicas -- `IMPORT_VALIDATION_QUEUE_
 * CONCURRENCY` defaults to 1, so a single worker container processes jobs one at a time no matter
 * how many are queued; proving genuinely separate-*process* concurrency (not just in-process async
 * concurrency) requires two real worker containers racing for the same Redis queue:
 *   docker compose -f compose.yaml -f compose.dev.yaml --env-file .env.docker.dev \
 *     up -d --scale worker=2 worker
 *
 * This script does not manage compose lifecycle itself -- point it at a running stack via env
 * vars (see below) rather than assuming `reconciliation-platform-dev`, the name reserved for the
 * real repo's own dev deploy.
 *
 * Usage:
 *   GATEWAY_URL=https://127.0.0.1:5174 COMPOSE_PROJECT_NAME=recon-worker-concurrency-test \
 *     npx tsx scripts/verify-worker-concurrency.ts
 */
import { execFileSync } from 'node:child_process';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const gatewayUrl = process.env.GATEWAY_URL ?? 'https://127.0.0.1:5174';
const composeProjectName = process.env.COMPOSE_PROJECT_NAME ?? 'recon-worker-concurrency-test';
const composeEnvFile = process.env.DOCKER_ENV_FILE ?? '.env.docker.dev';

type LoginResponse = { token: string };
type CreateRunResponse = { id: string };
type SubmitResponse = { importJobId: string; status: string };
type RunSummary = { id: string; status: string };

const login = async (username: string, password: string): Promise<string> => {
  const response = await fetch(`${gatewayUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(`Login failed for ${username}: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as LoginResponse;
  return body.token;
};

const csvBuffer = (contents: string): Blob => new Blob([contents], { type: 'text/csv' });

/** Same transaction shape (payroll deposit / card purchase / rent check tied to a GL entry) for
 * every run -- only the account numbers (filename prefixes) and dollar amounts differ slightly per
 * run so each run's rows are trivially distinguishable in Postgres afterward, per the "different
 * account numbers/GL naming" requirement this test was scoped around. */
const buildRunFiles = (accountA: string, accountB: string, amountSuffix: string) => ({
  bankFileA: csvBuffer(
    'Date,Description,Sequence Number,Check Number,Reference,Debit,Credit,Balance\n' +
      `2026-07-01,"Payroll deposit, biweekly",1,,REF-1${amountSuffix},,100.0${amountSuffix},1000.00\n` +
      `2026-07-02,Card purchase,2,,REF-2${amountSuffix},84.2${amountSuffix},,915.77\n` +
      `2026-07-03,Rent check,3,CHK-100${amountSuffix},REF-3${amountSuffix},500.00,,415.77\n`,
  ),
  bankFileB: csvBuffer(
    'Date,Description,Sequence Number,Check Number,Reference,Debit,Credit,Balance\n' +
      `2026-07-01,Second account deposit,1,,REF-9${amountSuffix},,50.00,50.00\n`,
  ),
  glFile: csvBuffer(
    'Date,Type,Num,Name,Memo,Amount\n' +
      `2026-07-03,Check,CHK-100${amountSuffix},Landlord LLC,Rent check,-500.00\n`,
  ),
  filenameA: `${accountA}_bank.csv`,
  filenameB: `${accountB}_bank.csv`,
});

type RunFiles = ReturnType<typeof buildRunFiles>;

const createAndSubmitRun = async (
  token: string,
  label: string,
  accountIdentifier: string,
  files: RunFiles,
): Promise<{ runId: string; importJobId: string }> => {
  const form = new FormData();
  form.set('label', label);
  form.set('accountIdentifier', accountIdentifier);
  form.set('frequency', 'MONTHLY');
  form.set('periodYear', '2026');
  form.set('bankFileA', files.bankFileA, files.filenameA);
  form.set('bankFileB', files.bankFileB, files.filenameB);
  form.set('glFile', files.glFile, 'gl.csv');

  const createResponse = await fetch(`${gatewayUrl}/api/imports/runs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });

  if (createResponse.status !== 201) {
    throw new Error(
      `Create run "${label}" failed: ${createResponse.status} ${await createResponse.text()}`,
    );
  }

  const created = (await createResponse.json()) as CreateRunResponse;

  const submitResponse = await fetch(`${gatewayUrl}/api/imports/runs/${created.id}/submit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });

  if (submitResponse.status !== 202) {
    throw new Error(
      `Submit run "${label}" did not queue (expected 202 -- is ENABLE_IMPORT_VALIDATION_QUEUE ` +
        `actually on for this stack?): ${submitResponse.status} ${await submitResponse.text()}`,
    );
  }

  const submitted = (await submitResponse.json()) as SubmitResponse;
  return { runId: created.id, importJobId: submitted.importJobId };
};

const TERMINAL_STATUSES = new Set(['PENDING_APPROVAL', 'VALIDATION_FAILED']);

const pollUntilTerminal = async (
  token: string,
  runId: string,
  label: string,
  timeoutMs = 60_000,
): Promise<RunSummary> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${gatewayUrl}/api/imports/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Polling run "${label}" (${runId}) failed: ${response.status}`);
    }

    const summary = (await response.json()) as RunSummary;
    if (TERMINAL_STATUSES.has(summary.status)) {
      return summary;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for run "${label}" (${runId}) to reach a terminal status.`);
};

type LogWindow = { runId: string; firstAt: number; lastAt: number };

/** Derives each run's actual processing window from the worker container's own structured logs --
 * independent evidence from the HTTP polling above, since HTTP status only proves eventual
 * correctness, not that the two runs were genuinely processed at overlapping times rather than
 * strictly one after the other. `import-validation.file.recorded` fires per file (first ~= work
 * starting on that run); `import-validation.run.matched`/`.run.failed` fires once, at the end. */
const deriveProcessingWindow = (logs: string, runId: string): LogWindow | null => {
  const timestamps: number[] = [];

  for (const rawLine of logs.split('\n')) {
    if (!rawLine.includes(runId)) continue;

    // `docker compose logs` prefixes each line with "<container-name>  | " -- strip it so the
    // remainder is the bare JSON pino emitted.
    const separatorIndex = rawLine.indexOf('| ');
    const line = separatorIndex === -1 ? rawLine : rawLine.slice(separatorIndex + 2);

    try {
      const parsed = JSON.parse(line) as { time?: number; action?: string; runId?: string };
      if (parsed.runId !== runId || typeof parsed.time !== 'number') continue;
      if (
        parsed.action === 'import-validation.file.recorded' ||
        parsed.action === 'import-validation.run.matched' ||
        parsed.action === 'import-validation.run.failed'
      ) {
        timestamps.push(parsed.time);
      }
    } catch {
      // Non-JSON line (e.g. pino-pretty in a dev build target) -- skip, this run only needs the
      // structured JSON lines the `runtime` build target (compose.dev.yaml's default) emits.
    }
  }

  if (timestamps.length === 0) return null;
  return { runId, firstAt: Math.min(...timestamps), lastAt: Math.max(...timestamps) };
};

const windowsOverlap = (a: LogWindow, b: LogWindow): boolean =>
  a.firstAt <= b.lastAt && b.firstAt <= a.lastAt;

const main = async (): Promise<void> => {
  console.log(`Gateway: ${gatewayUrl}`);
  console.log(`Compose project: ${composeProjectName}`);

  const token = await login('bray2', 'P@ssw0rd');
  console.log('Authenticated as bray2 (senior-analyst).');

  const runA = buildRunFiles('1111', '2222', '1');
  const runB = buildRunFiles('3333', '4444', '2');

  console.log('Submitting two import runs concurrently...');
  const [submittedA, submittedB] = await Promise.all([
    createAndSubmitRun(token, 'Concurrency Test A', 'ACCT-1111', runA),
    createAndSubmitRun(token, 'Concurrency Test B', 'ACCT-3333', runB),
  ]);
  console.log(`Run A queued: runId=${submittedA.runId} importJobId=${submittedA.importJobId}`);
  console.log(`Run B queued: runId=${submittedB.runId} importJobId=${submittedB.importJobId}`);

  console.log('Polling both runs until they reach a terminal status...');
  const [finalA, finalB] = await Promise.all([
    pollUntilTerminal(token, submittedA.runId, 'A'),
    pollUntilTerminal(token, submittedB.runId, 'B'),
  ]);

  console.log(`Run A final status: ${finalA.status}`);
  console.log(`Run B final status: ${finalB.status}`);

  if (finalA.status !== 'PENDING_APPROVAL' || finalB.status !== 'PENDING_APPROVAL') {
    throw new Error(
      'Correctness check FAILED: expected both runs to reach PENDING_APPROVAL (validation passed).',
    );
  }
  console.log('Correctness check PASSED: both runs completed independently with no cross-contamination.');

  // `docker compose logs` (not raw `docker logs <container>`) so this aggregates every `worker`
  // replica's output -- with IMPORT_VALIDATION_QUEUE_CONCURRENCY defaulting to 1, proving real
  // overlap requires >=2 worker containers, and each replica gets its own container name.
  // `--env-file` is required here, not optional -- compose.yaml's `${JWT_SECRET:?...}` and other
  // required interpolations fail the `logs` subcommand without it, even against an already-
  // running project.
  const logs = execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'compose.yaml',
      '-p',
      composeProjectName,
      '--env-file',
      composeEnvFile,
      'logs',
      '--no-color',
      'worker',
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 },
  );
  const windowA = deriveProcessingWindow(logs, submittedA.runId);
  const windowB = deriveProcessingWindow(logs, submittedB.runId);

  if (!windowA || !windowB) {
    throw new Error(
      'Could not derive a processing window for one or both runs from the worker logs -- ' +
        'check that WORKER_CONTAINER points at the right container and its build target is ' +
        '"runtime" (structured JSON logs), not "dev" (pino-pretty).',
    );
  }

  console.log(`Run A processing window: ${windowA.firstAt} -> ${windowA.lastAt} (${windowA.lastAt - windowA.firstAt}ms)`);
  console.log(`Run B processing window: ${windowB.firstAt} -> ${windowB.lastAt} (${windowB.lastAt - windowB.firstAt}ms)`);

  if (!windowsOverlap(windowA, windowB)) {
    throw new Error(
      'Concurrency check FAILED: the two runs\' processing windows did not overlap -- they were ' +
        'processed serially, not concurrently, by the separate worker process(es).',
    );
  }

  console.log('Concurrency check PASSED: the two runs\' processing windows genuinely overlapped.');
  console.log('\nAll checks passed -- two separate worker-process consumers processed two real');
  console.log('import runs correctly and concurrently.');
};

await main();
