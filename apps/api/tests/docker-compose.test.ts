import { beforeAll, describe, expect, it } from 'vitest';

import { execSync } from 'node:child_process';
import fs from 'node:fs';

import { dockerGate, hasCommand } from './testHelpers/dockerGate';

const hasEnvVariable = (content: string, key: string): boolean =>
  new RegExp(`^${key}=`, 'm').test(content);

const gate = dockerGate(hasCommand('docker'), 'Docker');
const dockerTest = gate.test;

describe('Docker Compose', () => {
  beforeAll(gate.assertAvailable);

  dockerTest('renders a valid configuration', { timeout: 20000 }, () => {
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
