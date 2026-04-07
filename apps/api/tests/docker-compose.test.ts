import { describe, expect, it } from 'vitest';

import { execSync } from 'node:child_process';
import fs from 'node:fs';

describe('Docker Compose', () => {
  it('renders a valid configuration', () => {
    const output = execSync('docker compose --env-file .env.docker.example config', { encoding: 'utf-8' });
    expect(output).toContain('services:');
    expect(output).toContain('postgres:');
    expect(output).toContain('api:');
    expect(output).toContain('web:');
  });

  it('has required environment variables', () => {
    const envFile = fs.readFileSync('.env.docker.example', 'utf-8');
    expect(envFile).toContain('DATABASE_URL');
    expect(envFile).toContain('PUBLIC_WEB_PORT');
  });
});