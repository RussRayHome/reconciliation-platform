import { buildOpenApiSpec, createApp } from '../src/app';
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { authedApp } from './testHelpers/authToken';

const execFileAsync = promisify(execFile);

describe('openapi contract', () => {
  it('serves the generated openapi document from the runtime endpoint', async () => {
    const app = createApp();
    const response = await authedApp(app).get('/api/openapi.json').expect(200);

    expect(response.body).toEqual(buildOpenApiSpec());
    expect(response.body.paths['/api/reconciliation/run'].post.responses['202']).toEqual(
      expect.objectContaining({ description: 'Queued reconciliation accepted' }),
    );
    expect(response.body.paths['/api/reconciliation/jobs/{jobId}']).toBeDefined();
  });

  it('supports generate and check modes in the openapi docs script', async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'reconciliation-openapi-'));
    const outputFile = join(outputDirectory, 'openapi.generated.json');

    try {
      await execFileAsync(
        process.execPath,
        ['--import', 'tsx', 'scripts/generate-openapi-docs.ts', `--out=${outputFile}`],
        { cwd: process.cwd() },
      );

      const generated = readFileSync(outputFile, 'utf8');
      expect(generated).toContain('"/api/reconciliation/jobs/{jobId}"');

      const checkResult = await execFileAsync(
        process.execPath,
        ['--import', 'tsx', 'scripts/generate-openapi-docs.ts', '--check', '--out', outputFile],
        { cwd: process.cwd() },
      );

      expect(checkResult.stdout).toContain('OpenAPI output is up to date');

      writeFileSync(outputFile, '{}\n', 'utf8');

      const staleCheckError = (await execFileAsync(
        process.execPath,
        ['--import', 'tsx', 'scripts/generate-openapi-docs.ts', '--check', '--out', outputFile],
        { cwd: process.cwd() },
      ).then(
        () => null,
        (error: unknown) => error,
      )) as null | { message?: string; stdout?: string; stderr?: string };

      expect(staleCheckError).not.toBeNull();
      const staleMessage = [
        staleCheckError?.message,
        staleCheckError?.stdout,
        staleCheckError?.stderr,
      ]
        .filter((value): value is string => typeof value === 'string')
        .join('\n');
      expect(staleMessage).toContain('out of date');
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }, 30000);
});
