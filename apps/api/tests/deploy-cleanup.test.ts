import { describe, expect, it } from 'vitest';

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const hasCommand = (command: string): boolean =>
  spawnSync('sh', ['-c', `command -v ${command} >/dev/null 2>&1`], { stdio: 'ignore' }).status ===
  0;

const canRunDeployChecks = hasCommand('bash') && hasCommand('docker');
const deployTest = canRunDeployChecks ? it : it.skip;

const runWithDockerEnv = (command: string, extraEnv: Record<string, string> = {}): string =>
  execSync(command, {
    encoding: 'utf-8',
    env: { ...dockerEnv, ...extraEnv },
    // Ignore Docker stderr progress output to keep integration logs concise.
    stdio: ['ignore', 'pipe', 'ignore'],
  });

const deployWithRetry = (): string => {
  try {
    return runWithDockerEnv('bash scripts/pre-flight/deploy.sh', { DEPLOY_SKIP_BUILD: 'true' });
  } catch {
    runWithDockerEnv(cleanupCommand);
    return runWithDockerEnv('bash scripts/pre-flight/deploy.sh', { DEPLOY_SKIP_BUILD: 'true' });
  }
};

describe('Deploy and Cleanup Scripts', () => {
  // Declared before the deploy test: vitest runs tests within a file in declaration order, and the
  // images this builds persist in the shared local image store (keyed by COMPOSE_PROJECT_NAME) for
  // the deploy test below to reuse via DEPLOY_SKIP_BUILD.
  deployTest('builds the stack images successfully', { timeout: 300000 }, () => {
    const output = runWithDockerEnv('bash scripts/pre-flight/deploy.sh', {
      DEPLOY_BUILD_ONLY: 'true',
    });
    expect(output).toMatch(/Build phase complete\./);
  });

  deployTest('deploys the built stack successfully', { timeout: 180000 }, () => {
    const output = deployWithRetry();
    expect(output).toMatch(/Local (production-like )?stack deployed\./);
  });

  deployTest('cleans up the stack successfully', () => {
    const output = runWithDockerEnv(cleanupCommand);
    expect(output).toMatch(/Local (production-like )?stack cleaned up\./);
  });
});
