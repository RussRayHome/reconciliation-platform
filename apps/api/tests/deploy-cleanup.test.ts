import { describe, expect, it } from 'vitest';

import { execSync, spawnSync } from 'node:child_process';

const defaultDockerDatabaseUrl =
  'postgresql://recon_app:change-local-password@localhost:5432/reconciliation_platform';

const dockerEnv = {
  ...process.env,
  DOCKER_ENV_FILE: '.env.docker.example',
  DB_PREFLIGHT_FAIL_ON_CRITICAL: 'false',
  DB_PREFLIGHT_FAIL_ON_HIGH: 'false',
  // validate-env.sh requires DATABASE_URL even when using .env.docker.example.
  DATABASE_URL: process.env.DATABASE_URL ?? defaultDockerDatabaseUrl,
};

const hasCommand = (command: string): boolean =>
  spawnSync('sh', ['-c', `command -v ${command} >/dev/null 2>&1`], { stdio: 'ignore' }).status ===
  0;

const canRunDeployChecks = hasCommand('bash') && hasCommand('docker');
const deployTest = canRunDeployChecks ? it : it.skip;

const runWithDockerEnv = (command: string): string =>
  execSync(command, {
    encoding: 'utf-8',
    env: dockerEnv,
    // Ignore Docker stderr progress output to keep integration logs concise.
    stdio: ['ignore', 'pipe', 'ignore'],
  });

const deployWithRetry = (): string => {
  try {
    return runWithDockerEnv('bash scripts/ops/deploy.sh');
  } catch {
    runWithDockerEnv('bash scripts/ops/cleanup.sh');
    return runWithDockerEnv('bash scripts/ops/deploy.sh');
  }
};

describe('Deploy and Cleanup Scripts', () => {
  deployTest('deploys the stack successfully', { timeout: 240000 }, () => {
    const output = deployWithRetry();
    expect(output).toMatch(/Local (production-like )?stack deployed\./);
  });

  deployTest('cleans up the stack successfully', () => {
    const output = runWithDockerEnv('bash scripts/ops/cleanup.sh');
    expect(output).toMatch(/Local (production-like )?stack cleaned up\./);
  });
});
