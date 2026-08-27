import { beforeAll, describe, expect } from 'vitest';

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dockerGate, hasCommand } from './testHelpers/dockerGate';

const defaultDockerDatabaseUrl =
  'postgresql://recon_app:change-local-password@localhost:5432/reconciliation_platform';

const parsedPortOffset = Number.parseInt(process.env.INTEGRATION_PORT_OFFSET ?? '', 10);
const integrationPortOffset = Number.isFinite(parsedPortOffset)
  ? parsedPortOffset
  : process.pid % 500;
const withPortOffset = (basePort: number): string => `${basePort + integrationPortOffset}`;

const isolatedIntegrationProjectName =
  process.env.INTEGRATION_COMPOSE_PROJECT_NAME ??
  `reconciliation-platform-integration-${process.pid}`;
const isolatedIntegrationWebPort = process.env.INTEGRATION_PUBLIC_WEB_PORT ?? withPortOffset(44173);
const isolatedIntegrationWebHttpsPort =
  process.env.INTEGRATION_PUBLIC_WEB_HTTPS_PORT ?? withPortOffset(44174);
const isolatedIntegrationPostgresPort =
  process.env.INTEGRATION_POSTGRES_HOST_PORT ?? withPortOffset(55432);
const isolatedIntegrationPgwebPort = process.env.INTEGRATION_PGWEB_PORT ?? withPortOffset(58081);
const isolatedIntegrationNginxUiPort =
  process.env.INTEGRATION_NGINX_UI_HTTP_PORT ?? withPortOffset(60082);
const fallbackDockerEnvPath = '.env.docker.dev.fallback';
const isolatedDockerEnvPath = join(tmpdir(), 'reconciliation-platform.integration.env');

const isolatedDockerEnvContents = `${readFileSync(fallbackDockerEnvPath, 'utf-8').trimEnd()}\nCOMPOSE_PROJECT_NAME=${isolatedIntegrationProjectName}\nPUBLIC_WEB_PORT=${isolatedIntegrationWebPort}\nPUBLIC_WEB_HTTPS_PORT=${isolatedIntegrationWebHttpsPort}\nPOSTGRES_HOST_PORT=${isolatedIntegrationPostgresPort}\nPGWEB_PORT=${isolatedIntegrationPgwebPort}\nNGINX_UI_HTTP_PORT=${isolatedIntegrationNginxUiPort}\n`;
writeFileSync(isolatedDockerEnvPath, isolatedDockerEnvContents, 'utf-8');

const dockerEnv = {
  ...process.env,
  DOCKER_ENV_FILE: isolatedDockerEnvPath,
  DOCKER_ENV_FALLBACK_FILE: fallbackDockerEnvPath,
  COMPOSE_PROJECT_NAME: isolatedIntegrationProjectName,
  PUBLIC_WEB_PORT: isolatedIntegrationWebPort,
  PUBLIC_WEB_HTTPS_PORT: isolatedIntegrationWebHttpsPort,
  POSTGRES_HOST_PORT: isolatedIntegrationPostgresPort,
  PGWEB_PORT: isolatedIntegrationPgwebPort,
  NGINX_UI_HTTP_PORT: isolatedIntegrationNginxUiPort,
  DB_PREFLIGHT_FAIL_ON_CRITICAL: 'false',
  DB_PREFLIGHT_FAIL_ON_HIGH: 'false',
  // validate-env.sh requires DATABASE_URL even when using .env.docker.dev.fallback.
  DATABASE_URL: process.env.DATABASE_URL ?? defaultDockerDatabaseUrl,
};

const cleanupCommand = 'bash scripts/pre-flight/cleanup.sh --prune-volumes';

const canRunDeployChecks = hasCommand('bash') && hasCommand('docker');
const gate = dockerGate(canRunDeployChecks, 'bash and Docker');
const deployTest = gate.test;

// Issue #194's RCA: execSync with no `timeout` blocks the event loop indefinitely if the child
// stalls, and Vitest's own testTimeout can't fire in that window -- its setTimeout callback never
// gets a turn while a synchronous call has the thread. That produces the exact reported symptom
// (silent, 0% CPU, indefinite duration) instead of a normal, visible test failure. Passing
// `timeout` here bounds every Docker call: on expiry Node sends SIGTERM to the child and execSync
// throws, so a stalled command becomes a loud, fast failure instead of a hang.
const runWithDockerEnv = (
  command: string,
  extraEnv: Record<string, string> = {},
  timeoutMs: number,
): string =>
  execSync(command, {
    encoding: 'utf-8',
    env: { ...dockerEnv, ...extraEnv },
    // Ignore Docker stderr progress output to keep integration logs concise.
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: timeoutMs,
  });

const deployWithRetry = (): string => {
  try {
    return runWithDockerEnv(
      'bash scripts/pre-flight/deploy.sh',
      { DEPLOY_SKIP_BUILD: 'true' },
      170_000,
    );
  } catch {
    runWithDockerEnv(cleanupCommand, {}, 60_000);
    return runWithDockerEnv(
      'bash scripts/pre-flight/deploy.sh',
      { DEPLOY_SKIP_BUILD: 'true' },
      170_000,
    );
  }
};

describe('Deploy and Cleanup Scripts', () => {
  beforeAll(gate.assertAvailable);

  // Issue #215's real root cause: this file mints a fresh, PID-suffixed COMPOSE_PROJECT_NAME
  // every invocation (deliberately, so a concurrent run of this same test never collides). A
  // process kill mid-test (CI cancellation, local Ctrl+C, a wrapper tool's own timeout) never
  // reaches this file's own cleanup step, so that run's containers/networks are orphaned forever
  // -- the next run picks a new PID and never touches them. Confirmed on 2026-08-27: ~25
  // accumulated leftover projects exhausted Docker's network address pool ("all predefined
  // address pools have been fully subnetted"), which is what actually broke this test, not vitest
  // worker concurrency. Best-effort and non-fatal: a sweep failure must never block this file's
  // own real work.
  beforeAll(() => {
    if (!canRunDeployChecks) return;
    try {
      execSync('bash scripts/pre-flight/cleanup-stale-integration-projects.sh', {
        encoding: 'utf-8',
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 30_000,
      });
    } catch {
      // Best-effort GC only.
    }
  });

  // Declared before the deploy test: vitest runs tests within a file in declaration order, and the
  // images this builds persist in the shared local image store (keyed by COMPOSE_PROJECT_NAME) for
  // the deploy test below to reuse via DEPLOY_SKIP_BUILD.
  deployTest('builds the stack images successfully', { timeout: 300000 }, () => {
    const output = runWithDockerEnv(
      'bash scripts/pre-flight/deploy.sh',
      { DEPLOY_BUILD_ONLY: 'true' },
      290_000,
    );
    expect(output).toMatch(/Build phase complete\./);
  });

  // 420s, not 180s: deployWithRetry's failure path runs deploy (up to 170s) + cleanup (up to 60s)
  // + a second deploy attempt (up to 170s) -- bounding the individual execSync calls prevents an
  // infinite hang, but the retry path's own worst case is still ~400s of real work. Leaving this
  // at the old 180000 would trade an unbounded hang for a *guaranteed* Vitest-level timeout on
  // every retry, which is a worse outcome, not a fixed one.
  deployTest('deploys the built stack successfully', { timeout: 420000 }, () => {
    const output = deployWithRetry();
    expect(output).toMatch(/Local (production-like )?stack deployed\./);
  });

  deployTest('cleans up the stack successfully', { timeout: 120000 }, () => {
    const output = runWithDockerEnv(cleanupCommand, {}, 110_000);
    expect(output).toMatch(/Local (production-like )?stack cleaned up\./);
  });
});
