import { afterEach, describe, expect, it, vi } from 'vitest';

const configPath = '../../../vitest.config';

interface CoverageConfigShape {
  test?: { coverage?: { exclude?: string[]; include?: string[] } };
}

const loadCoverageExclude = async (extraExcludes?: string): Promise<string[]> => {
  vi.resetModules();
  if (extraExcludes === undefined) {
    delete process.env.COVERAGE_EXTRA_EXCLUDES;
  } else {
    process.env.COVERAGE_EXTRA_EXCLUDES = extraExcludes;
  }

  const module = (await import(configPath)) as { default: CoverageConfigShape };
  return module.default.test?.coverage?.exclude ?? [];
};

/**
 * The Developer Dashboard drops the Testcontainers persistence suites when it cannot reach a host
 * Docker CLI, and has to drop the sources they solely cover along with them — otherwise those
 * files sit in the denominator with nothing driving them and the dashboard publishes a near-zero
 * number for well-covered code.
 *
 * It signals that through COVERAGE_EXTRA_EXCLUDES rather than vitest's `--coverage.exclude` flag,
 * because that flag REPLACES `coverage.exclude` from the config instead of merging with it. Under
 * the flag, excluding one extra path silently pulled dist/, scripts/, server.ts, and types.ts back
 * into the denominator. These tests pin the merge behavior so that trap cannot come back.
 */
describe('coverage exclude configuration', () => {
  const baseExcludes = [
    '**/*.config.*',
    '**/dist/**',
    '**/coverage/**',
    'apps/api/src/index.ts',
    'apps/api/src/server.ts',
    'packages/domain/src/types.ts',
    'scripts/**',
  ];

  afterEach(() => {
    delete process.env.COVERAGE_EXTRA_EXCLUDES;
  });

  it('applies the base exclude list when no extra excludes are set', async () => {
    const exclude = await loadCoverageExclude();

    expect(exclude).toEqual(baseExcludes);
  });

  it('appends extra excludes without dropping any base entry', async () => {
    const exclude = await loadCoverageExclude(
      'packages/persistence/src/reconciliationLifecycleStore.ts',
    );

    expect(exclude).toEqual([
      ...baseExcludes,
      'packages/persistence/src/reconciliationLifecycleStore.ts',
    ]);
  });

  it('accepts several comma-separated extra excludes', async () => {
    const exclude = await loadCoverageExclude('packages/a/src/one.ts,packages/b/src/two.ts');

    expect(exclude).toEqual([...baseExcludes, 'packages/a/src/one.ts', 'packages/b/src/two.ts']);
  });

  it('trims whitespace and ignores empty entries', async () => {
    const exclude = await loadCoverageExclude('  packages/a/src/one.ts ,, ,packages/b/src/two.ts ');

    expect(exclude).toEqual([...baseExcludes, 'packages/a/src/one.ts', 'packages/b/src/two.ts']);
  });

  it('leaves the base list untouched for an empty variable', async () => {
    const exclude = await loadCoverageExclude('');

    expect(exclude).toEqual(baseExcludes);
  });

  it('keeps measuring persistence sources that have their own src-level unit tests', async () => {
    const exclude = await loadCoverageExclude(
      'packages/persistence/src/reconciliationLifecycleStore.ts',
    );

    expect(exclude).not.toContain('packages/persistence/src/readModelStore.ts');
    expect(exclude).not.toContain('packages/persistence/src/postgres.ts');
  });
});
