import { describe, expect, it } from 'vitest';

import { execSync } from 'node:child_process';

const dockerEnv = {
  ...process.env,
  DOCKER_ENV_FILE: '.env.docker.example',
};

describe('Deploy and Cleanup Scripts', () => {
  it('deploys the stack successfully', { timeout: 30000 }, () => {
    const output = execSync('bash scripts/ops/deploy.sh', { encoding: 'utf-8', env: dockerEnv });
    expect(output).toContain('Local production-like stack deployed.');
  });

  it('cleans up the stack successfully', () => {
    const output = execSync('bash scripts/ops/cleanup.sh', { encoding: 'utf-8', env: dockerEnv });
    expect(output).toContain('Local production-like stack cleaned up.');
  });
});