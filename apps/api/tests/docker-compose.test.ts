import { describe, expect, it } from 'vitest';

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const hasEnvVariable = (content: string, key: string): boolean =>
  new RegExp(`^${key}=`, 'm').test(content);

const hasCommand = (command: string): boolean =>
  spawnSync('sh', ['-c', `command -v ${command} >/dev/null 2>&1`], { stdio: 'ignore' }).status ===
  0;

const dockerTest = hasCommand('docker') ? it : it.skip;

describe('Docker Compose', () => {
  dockerTest('renders a valid configuration', () => {
    const output = execSync('docker compose --env-file .env.docker.dev.fallback config', {
      encoding: 'utf-8',
    });
    expect(output).toContain('services:');
    expect(output).toContain('postgres:');
    expect(output).toContain('api:');
    expect(output).toContain('web:');
  });

  it('has required environment variables', () => {
    const envFile = fs.readFileSync('.env.docker.dev.fallback', 'utf-8');
    expect(hasEnvVariable(envFile, 'API_DATABASE_URL')).toBe(true);
    expect(hasEnvVariable(envFile, 'PUBLIC_WEB_PORT')).toBe(true);
  });
});
