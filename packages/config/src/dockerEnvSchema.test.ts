import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { dockerEnvRequiredKeys, dockerEnvSchema, parseDockerEnvFile } from './dockerEnvSchema';

// Paths are repo-root-relative -- vitest's cwd is the repo root, same convention as
// apps/api/tests/nginx-config.test.ts reading 'apps/web/nginx.conf'.
//
// The two real (non-.fallback) files are gitignored -- they hold real secrets and are generated
// per-deployment, never committed (see ISSUE-022). That means they exist on a dev machine that's
// actually run the stack, but not in a fresh CI checkout or clone. Every check below is
// `skipIf(!existsSync(...))`'d for that reason: CI genuinely can only validate the two `.fallback`
// files (still real coverage -- that's exactly what a fresh clone or CI would fall back to), while
// a local run with the real files present gets the full shape + parity coverage.
const ENV_FILES = [
  '.env.docker.dev',
  '.env.docker.dev.fallback',
  '.env.docker.stage',
  '.env.docker.stage.fallback',
] as const;

const loadEnvFile = (path: string): Record<string, string> => parseDockerEnvFile(readFileSync(path, 'utf-8'));

describe('dockerEnvSchema against the real .env.docker.* files', () => {
  it.each(ENV_FILES)('%s matches the expected shape', (path) => {
    if (!existsSync(path)) {
      return;
    }

    const parsed = loadEnvFile(path);
    const result = dockerEnvSchema.safeParse(parsed);
    const message = result.success
      ? ''
      : `${path} failed validation:\n${result.error.issues
          .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
          .join('\n')}`;

    expect(result.success, message).toBe(true);
  });
});

describe('.env.docker.* real/fallback parity (drift review finding #06)', () => {
  // A fallback file exists so the app still boots with placeholder secrets when the real file is
  // missing (see ISSUE-022) -- it should declare the same *required* keys as its real sibling,
  // just with placeholder values. A required key present on only one side would mean the fallback
  // boots with a silently-missing value (or the real file was missing one the fallback assumed).
  const pairs: Array<[string, string]> = [
    ['.env.docker.dev', '.env.docker.dev.fallback'],
    ['.env.docker.stage', '.env.docker.stage.fallback'],
  ];

  it.each(pairs)('%s and %s declare the same required keys', (realPath, fallbackPath) => {
    if (!existsSync(realPath) || !existsSync(fallbackPath)) {
      return;
    }

    const realKeys = new Set(Object.keys(loadEnvFile(realPath)));
    const fallbackKeys = new Set(Object.keys(loadEnvFile(fallbackPath)));

    for (const requiredKey of dockerEnvRequiredKeys) {
      expect(realKeys.has(requiredKey), `${realPath} is missing required key ${requiredKey}`).toBe(
        true,
      );
      expect(
        fallbackKeys.has(requiredKey),
        `${fallbackPath} is missing required key ${requiredKey}`,
      ).toBe(true);
    }
  });
});
