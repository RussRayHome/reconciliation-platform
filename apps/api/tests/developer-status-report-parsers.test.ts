import {
  countComplexityMethods,
  parseComplexityScan,
  parseCoverageSummaryJson,
  parseDbTestItems,
  parseDependencyScan,
  parseEslintJsonIssues,
  parsePlaywrightJsonSpecs,
  parseVitestJsonTestItems,
} from '../src/services/developerStatusParsing';
import { describe, expect, it } from 'vitest';

/**
 * Covers the five report parsers that turn external tool output (Vitest, Playwright, ESLint,
 * Istanbul) into Developer Dashboard rows. They are defensive by design — every field is
 * optional-and-maybe-the-wrong-type, because a tool version bump changing its JSON shape must
 * degrade to an empty panel rather than crash the dashboard. These tests pin that behaviour on
 * the malformed paths, not just the happy ones.
 */
describe('report parsers', () => {
  describe('parseVitestJsonTestItems', () => {
    const validReport = JSON.stringify({
      testResults: [
        {
          name: '/repo/reconciliation-platform/packages/core/src/engine.test.ts',
          assertionResults: [
            { fullName: 'engine > matches', status: 'passed', duration: 12 },
            {
              fullName: 'engine > explodes',
              status: 'failed',
              duration: 4,
              failureMessages: ['AssertionError: expected 1 to be 2'],
            },
            { title: 'engine > pending', status: 'pending' },
          ],
        },
      ],
    });

    it('maps assertion results into test rows', () => {
      const items = parseVitestJsonTestItems(validReport);

      expect(items).toHaveLength(3);
      expect(items[0]).toEqual({
        name: 'engine > matches',
        suite: 'packages/core/src/engine.test.ts',
        status: 'passed',
        reason: undefined,
        durationMs: 12,
      });
    });

    it('records a failure reason only for failed assertions', () => {
      const items = parseVitestJsonTestItems(validReport);

      expect(items[1]).toMatchObject({
        status: 'failed',
        reason: 'AssertionError: expected 1 to be 2',
      });
    });

    it('treats any status other than passed or failed as skipped', () => {
      const items = parseVitestJsonTestItems(validReport);

      expect(items[2]).toMatchObject({ name: 'engine > pending', status: 'skipped' });
    });

    it('relativizes suite paths against an explicit repo root', () => {
      const items = parseVitestJsonTestItems(validReport, '/repo/reconciliation-platform');

      expect(items[0]?.suite).toBe('packages/core/src/engine.test.ts');
    });

    it('leaves a suite path untouched when it matches neither the root nor the repo marker', () => {
      const report = JSON.stringify({
        testResults: [{ name: '/elsewhere/thing.test.ts', assertionResults: [] }],
      });

      expect(parseVitestJsonTestItems(report)).toEqual([]);
    });

    it('falls back to placeholder text for a missing suite name and test name', () => {
      const report = JSON.stringify({
        testResults: [{ assertionResults: [{ status: 'passed' }] }],
      });

      expect(parseVitestJsonTestItems(report)[0]).toMatchObject({
        name: 'unnamed test',
        suite: 'unknown suite',
      });
    });

    it('omits duration when it is not a number', () => {
      const report = JSON.stringify({
        testResults: [
          { name: 'a.test.ts', assertionResults: [{ status: 'passed', duration: 'fast' }] },
        ],
      });

      expect(parseVitestJsonTestItems(report)[0]?.durationMs).toBeUndefined();
    });

    it('omits the reason when a failure carries no messages', () => {
      const report = JSON.stringify({
        testResults: [
          { name: 'a.test.ts', assertionResults: [{ status: 'failed', failureMessages: [] }] },
        ],
      });

      expect(parseVitestJsonTestItems(report)[0]?.reason).toBeUndefined();
    });

    it.each([
      ['invalid JSON', 'not json at all'],
      ['a JSON scalar', '42'],
      ['JSON null', 'null'],
      ['an object with no testResults', '{}'],
      ['testResults that is not an array', '{"testResults":{}}'],
    ])('returns an empty list for %s', (_label, input) => {
      expect(parseVitestJsonTestItems(input)).toEqual([]);
    });

    it('skips non-object file entries and non-array assertionResults', () => {
      const report = JSON.stringify({
        testResults: [
          null,
          'nope',
          { name: 'a.test.ts' },
          { name: 'b.test.ts', assertionResults: 7 },
        ],
      });

      expect(parseVitestJsonTestItems(report)).toEqual([]);
    });

    it('skips non-object assertion entries', () => {
      const report = JSON.stringify({
        testResults: [{ name: 'a.test.ts', assertionResults: [null, 'nope'] }],
      });

      expect(parseVitestJsonTestItems(report)).toEqual([]);
    });
  });

  describe('parseDbTestItems', () => {
    const dbReport = (names: string[]): string =>
      JSON.stringify({
        testResults: [
          {
            name: 'packages/persistence/tests/db.test.ts',
            assertionResults: names.map((fullName) => ({
              fullName,
              status: 'passed',
              duration: 1,
            })),
          },
        ],
      });

    it.each([
      ['applies every migration', 'migration'],
      ['changelog-sync converges', 'migration'],
      ['rejects a duplicate constraint', 'constraint'],
      ['enforces fk ownership', 'constraint'],
      ['rejects check_ violations', 'constraint'],
      ['loads the seed data', 'seed'],
      ['serializes concurrent isolation', 'behavior'],
      ['recovers from a deadlock', 'behavior'],
      ['persists lifecycle state', 'behavior'],
      ['does something unrelated', 'other'],
    ])('categorizes %s as %s', (name, category) => {
      expect(parseDbTestItems(dbReport([name]))[0]?.category).toBe(category);
    });

    it('drops skipped tests and collapses status to passed or failed', () => {
      const report = JSON.stringify({
        testResults: [
          {
            name: 'db.test.ts',
            assertionResults: [
              { fullName: 'migration ok', status: 'passed' },
              { fullName: 'migration broken', status: 'failed', failureMessages: ['boom'] },
              { fullName: 'migration pending', status: 'pending' },
            ],
          },
        ],
      });

      const items = parseDbTestItems(report);

      expect(items).toHaveLength(2);
      expect(items.map((item) => item.status)).toEqual(['passed', 'failed']);
      expect(items[1]?.failureMessage).toBe('boom');
    });
  });

  describe('parsePlaywrightJsonSpecs', () => {
    const spec = (overrides: Record<string, unknown> = {}) => ({
      title: 'does the thing',
      ok: true,
      tests: [{ results: [{ status: 'passed', duration: 100 }] }],
      ...overrides,
    });

    it('flattens nested suites into prefixed spec names', () => {
      const report = JSON.stringify({
        suites: [
          {
            title: 'reconciliation.spec.ts',
            suites: [{ title: 'form validation', specs: [spec()] }],
          },
        ],
      });

      expect(parsePlaywrightJsonSpecs(report)[0]?.name).toBe(
        'reconciliation.spec.ts › form validation › does the thing',
      );
    });

    it('reports a passing single-attempt spec as passed with no retries', () => {
      const report = JSON.stringify({ suites: [{ title: 's', specs: [spec()] }] });

      expect(parsePlaywrightJsonSpecs(report)[0]).toMatchObject({
        status: 'passed',
        retries: 0,
        durationMs: 100,
      });
    });

    it('reports a spec that passed only after a retry as flaky', () => {
      const report = JSON.stringify({
        suites: [
          {
            title: 's',
            specs: [
              spec({
                tests: [
                  {
                    results: [
                      { status: 'failed', duration: 50 },
                      { status: 'passed', duration: 70 },
                    ],
                  },
                ],
              }),
            ],
          },
        ],
      });

      expect(parsePlaywrightJsonSpecs(report)[0]).toMatchObject({
        status: 'flaky',
        retries: 1,
        durationMs: 120,
      });
    });

    it('reports a spec with ok false as failed', () => {
      const report = JSON.stringify({
        suites: [{ title: 's', specs: [spec({ ok: false })] }],
      });

      expect(parsePlaywrightJsonSpecs(report)[0]?.status).toBe('failed');
    });

    it('reports a spec whose last result is skipped as skipped even though a result exists', () => {
      const report = JSON.stringify({
        suites: [{ title: 's', specs: [spec({ tests: [{ results: [{ status: 'skipped' }] }] })] }],
      });

      expect(parsePlaywrightJsonSpecs(report)[0]?.status).toBe('skipped');
    });

    it('reports a spec that never ran as skipped', () => {
      const report = JSON.stringify({
        suites: [{ title: 's', specs: [spec({ tests: [{ results: [] }] })] }],
      });

      expect(parsePlaywrightJsonSpecs(report)[0]).toMatchObject({ status: 'skipped', retries: 0 });
    });

    it('extracts a trace attachment path from the final result', () => {
      const report = JSON.stringify({
        suites: [
          {
            title: 's',
            specs: [
              spec({
                ok: false,
                tests: [
                  {
                    results: [
                      {
                        status: 'failed',
                        duration: 10,
                        attachments: [
                          { name: 'screenshot', path: '/tmp/shot.png' },
                          { name: 'trace', path: '/tmp/trace.zip' },
                        ],
                      },
                    ],
                  },
                ],
              }),
            ],
          },
        ],
      });

      expect(parsePlaywrightJsonSpecs(report)[0]?.artifactPath).toBe('/tmp/trace.zip');
    });

    it('leaves artifactPath undefined when no trace attachment is present', () => {
      const report = JSON.stringify({
        suites: [
          {
            title: 's',
            specs: [
              spec({
                tests: [{ results: [{ status: 'passed', attachments: [{ name: 'video' }] }] }],
              }),
            ],
          },
        ],
      });

      expect(parsePlaywrightJsonSpecs(report)[0]?.artifactPath).toBeUndefined();
    });

    it('treats a non-numeric duration as zero', () => {
      const report = JSON.stringify({
        suites: [
          {
            title: 's',
            specs: [spec({ tests: [{ results: [{ status: 'passed', duration: null }] }] })],
          },
        ],
      });

      expect(parsePlaywrightJsonSpecs(report)[0]?.durationMs).toBe(0);
    });

    it('falls back to placeholder text for an untitled spec and drops an untitled suite prefix', () => {
      const report = JSON.stringify({ suites: [{ specs: [spec({ title: undefined })] }] });

      expect(parsePlaywrightJsonSpecs(report)[0]?.name).toBe('unnamed spec');
    });

    it.each([
      ['invalid JSON', 'not json'],
      ['JSON null', 'null'],
      ['a JSON scalar', '"text"'],
      ['an object with no suites', '{}'],
      ['suites that is not an array', '{"suites":5}'],
    ])('returns an empty list for %s', (_label, input) => {
      expect(parsePlaywrightJsonSpecs(input)).toEqual([]);
    });

    it('skips malformed suites, specs, and test entries', () => {
      const report = JSON.stringify({
        suites: [
          null,
          'nope',
          { title: 'a', specs: 'not-an-array' },
          { title: 'b', specs: [null, 'nope'] },
          { title: 'c', specs: [{ title: 'no tests', ok: true, tests: 'nope' }] },
          { title: 'd', specs: [{ title: 'test not object', ok: true, tests: ['nope'] }] },
        ],
      });

      const items = parsePlaywrightJsonSpecs(report);

      expect(items.map((item) => item.status)).toEqual(['skipped', 'skipped']);
    });
  });

  describe('parseEslintJsonIssues', () => {
    const eslintReport = JSON.stringify([
      {
        filePath: '/repo/reconciliation-platform/apps/web/src/App.tsx',
        messages: [
          { ruleId: 'no-unused-vars', severity: 2, line: 12, message: 'unused' },
          { ruleId: 'prefer-const', severity: 1, line: 30, message: 'use const' },
        ],
      },
    ]);

    it('maps severity codes onto labels and relativizes the file path', () => {
      const issues = parseEslintJsonIssues(eslintReport);

      expect(issues).toEqual([
        {
          rule: 'no-unused-vars',
          severity: 'error',
          file: 'apps/web/src/App.tsx',
          line: 12,
          message: 'unused',
        },
        {
          rule: 'prefer-const',
          severity: 'warning',
          file: 'apps/web/src/App.tsx',
          line: 30,
          message: 'use const',
        },
      ]);
    });

    it('labels an unrecognized severity code as info', () => {
      const report = JSON.stringify([
        { filePath: 'a.ts', messages: [{ ruleId: 'x', severity: 9, line: 1, message: 'm' }] },
      ]);

      expect(parseEslintJsonIssues(report)[0]?.severity).toBe('info');
    });

    it('defaults a non-numeric severity to warning', () => {
      const report = JSON.stringify([
        { filePath: 'a.ts', messages: [{ ruleId: 'x', severity: 'high', message: 'm' }] },
      ]);

      expect(parseEslintJsonIssues(report)[0]?.severity).toBe('warning');
    });

    it('supplies fallbacks for a missing rule id, message, and file path', () => {
      const report = JSON.stringify([{ messages: [{}] }]);

      expect(parseEslintJsonIssues(report)[0]).toMatchObject({
        rule: 'parse-error',
        file: 'unknown file',
        message: 'No message provided.',
        line: 0,
      });
    });

    it('relativizes against an explicit repo root when one is given', () => {
      const report = JSON.stringify([
        { filePath: '/custom/root/src/a.ts', messages: [{ ruleId: 'x', message: 'm' }] },
      ]);

      expect(parseEslintJsonIssues(report, '/custom/root')[0]?.file).toBe('src/a.ts');
    });

    it.each([
      ['invalid JSON', 'not json'],
      ['a JSON object rather than an array', '{"a":1}'],
    ])('returns an empty list for %s', (_label, input) => {
      expect(parseEslintJsonIssues(input)).toEqual([]);
    });

    it('skips malformed file entries and non-array message lists', () => {
      const report = JSON.stringify([null, 'nope', { filePath: 'a.ts', messages: 3 }]);

      expect(parseEslintJsonIssues(report)).toEqual([]);
    });

    it('skips non-object message entries', () => {
      const report = JSON.stringify([{ filePath: 'a.ts', messages: [null, 'nope'] }]);

      expect(parseEslintJsonIssues(report)).toEqual([]);
    });
  });

  describe('parseCoverageSummaryJson', () => {
    const coverageReport = JSON.stringify({
      total: { lines: { pct: 90 } },
      '/repo/reconciliation-platform/packages/core/src/engine.ts': {
        statements: { pct: 84 },
        lines: { total: 100, covered: 82, pct: 82 },
        branches: { pct: 71 },
        functions: { pct: 95 },
      },
    });

    it('maps a per-file entry and derives the uncovered line count', () => {
      expect(parseCoverageSummaryJson(coverageReport)).toEqual([
        {
          filePath: 'packages/core/src/engine.ts',
          statements: 84,
          lines: 82,
          branches: 71,
          functions: 95,
          uncoveredLineCount: 18,
          meetsMinimum: true,
        },
      ]);
    });

    it('excludes the synthetic total row', () => {
      const entries = parseCoverageSummaryJson(coverageReport);

      expect(entries.map((entry) => entry.filePath)).not.toContain('total');
    });

    it.each([
      [75, true],
      [74.9, false],
    ])('flags line coverage of %s against the 75%% minimum as %s', (pct, expected) => {
      const report = JSON.stringify({ 'a.ts': { lines: { total: 10, covered: 1, pct } } });

      expect(parseCoverageSummaryJson(report)[0]?.meetsMinimum).toBe(expected);
    });

    it('treats missing or non-numeric dimensions as zero', () => {
      const report = JSON.stringify({ 'a.ts': { lines: { pct: 'lots' }, branches: 'nope' } });

      expect(parseCoverageSummaryJson(report)[0]).toMatchObject({
        statements: 0,
        lines: 0,
        branches: 0,
        functions: 0,
        uncoveredLineCount: 0,
      });
    });

    it('treats a non-finite percentage as zero', () => {
      const report = JSON.stringify({ 'a.ts': { lines: { pct: null } } });

      expect(parseCoverageSummaryJson(report)[0]?.lines).toBe(0);
    });

    it('never reports a negative uncovered line count', () => {
      const report = JSON.stringify({ 'a.ts': { lines: { total: 5, covered: 9, pct: 100 } } });

      expect(parseCoverageSummaryJson(report)[0]?.uncoveredLineCount).toBe(0);
    });

    it('reports zero uncovered lines when the lines dimension is absent', () => {
      const report = JSON.stringify({ 'a.ts': { branches: { pct: 50 } } });

      expect(parseCoverageSummaryJson(report)[0]?.uncoveredLineCount).toBe(0);
    });

    it('relativizes against an explicit repo root when one is given', () => {
      const report = JSON.stringify({ '/custom/root/src/a.ts': { lines: { pct: 80 } } });

      expect(parseCoverageSummaryJson(report, '/custom/root')[0]?.filePath).toBe('src/a.ts');
    });

    it.each([
      ['invalid JSON', 'not json'],
      ['JSON null', 'null'],
      ['a JSON scalar', '7'],
    ])('returns an empty list for %s', (_label, input) => {
      expect(parseCoverageSummaryJson(input)).toEqual([]);
    });

    it('skips non-object per-file values', () => {
      const report = JSON.stringify({ 'a.ts': null, 'b.ts': 'nope' });

      expect(parseCoverageSummaryJson(report)).toEqual([]);
    });
  });

  describe('parseComplexityScan', () => {
    const validScan = JSON.stringify({
      scannedAt: '2026-08-11T00:00:00.000Z',
      root: {
        type: 'dir',
        name: 'reconciliation-platform',
        children: [
          {
            type: 'dir',
            name: 'packages',
            children: [
              {
                type: 'file',
                name: 'engine.ts',
                lines: 120,
                methods: [{ name: 'run', cc: 12, lines: 60, params: 3, startLine: 10 }],
              },
            ],
          },
        ],
      },
    });

    it('parses a valid scan into its typed tree', () => {
      expect(parseComplexityScan(validScan)).toEqual({
        scannedAt: '2026-08-11T00:00:00.000Z',
        root: {
          type: 'dir',
          name: 'reconciliation-platform',
          children: [
            {
              type: 'dir',
              name: 'packages',
              children: [
                {
                  type: 'file',
                  name: 'engine.ts',
                  lines: 120,
                  methods: [{ name: 'run', cc: 12, lines: 60, params: 3, startLine: 10 }],
                },
              ],
            },
          ],
        },
      });
    });

    it('drops a method entry with no name', () => {
      const scan = JSON.stringify({
        scannedAt: '2026-08-11T00:00:00.000Z',
        root: {
          type: 'file',
          name: 'a.ts',
          lines: 10,
          methods: [{ cc: 5, lines: 5, params: 0, startLine: 1 }],
        },
      });

      expect(parseComplexityScan(scan)?.root).toMatchObject({ methods: [] });
    });

    it('drops a tree node with an unrecognized type', () => {
      const scan = JSON.stringify({
        scannedAt: '2026-08-11T00:00:00.000Z',
        root: {
          type: 'dir',
          name: 'root',
          children: [{ type: 'symlink', name: 'weird' }],
        },
      });

      expect(parseComplexityScan(scan)?.root).toMatchObject({ children: [] });
    });

    it('treats missing or non-numeric method fields as zero', () => {
      const scan = JSON.stringify({
        scannedAt: '2026-08-11T00:00:00.000Z',
        root: {
          type: 'file',
          name: 'a.ts',
          lines: 10,
          methods: [{ name: 'f', cc: 'lots' }],
        },
      });

      expect(parseComplexityScan(scan)?.root).toMatchObject({
        methods: [{ name: 'f', cc: 0, lines: 0, params: 0, startLine: 0 }],
      });
    });

    it.each([
      ['invalid JSON', 'not json'],
      ['JSON null', 'null'],
      ['a JSON scalar', '7'],
      ['a payload missing scannedAt', JSON.stringify({ root: { type: 'file', name: 'a.ts', lines: 1, methods: [] } })],
      ['a payload missing root', JSON.stringify({ scannedAt: '2026-08-11T00:00:00.000Z' })],
      ['a root with no name', JSON.stringify({ scannedAt: '2026-08-11T00:00:00.000Z', root: { type: 'dir', children: [] } })],
    ])('returns null for %s', (_label, input) => {
      expect(parseComplexityScan(input)).toBeNull();
    });
  });

  describe('countComplexityMethods', () => {
    it('counts methods across nested directories', () => {
      const root: Parameters<typeof countComplexityMethods>[0] = {
        type: 'dir',
        name: 'root',
        children: [
          {
            type: 'dir',
            name: 'nested',
            children: [
              {
                type: 'file',
                name: 'a.ts',
                lines: 10,
                methods: [{ name: 'f', cc: 1, lines: 1, params: 0, startLine: 1 }],
              },
            ],
          },
          {
            type: 'file',
            name: 'b.ts',
            lines: 5,
            methods: [{ name: 'g', cc: 1, lines: 1, params: 0, startLine: 1 }],
          },
        ],
      };

      expect(countComplexityMethods(root)).toBe(2);
    });

    it('returns zero for an empty directory', () => {
      expect(countComplexityMethods({ type: 'dir', name: 'empty', children: [] })).toBe(0);
    });

    it('counts a lone file node directly', () => {
      expect(
        countComplexityMethods({
          type: 'file',
          name: 'a.ts',
          lines: 5,
          methods: [
            { name: 'f', cc: 1, lines: 1, params: 0, startLine: 1 },
            { name: 'g', cc: 1, lines: 1, params: 0, startLine: 5 },
          ],
        }),
      ).toBe(2);
    });
  });

  describe('parseDependencyScan', () => {
    const validScan = JSON.stringify({
      scannedAt: '2026-08-11T00:00:00.000Z',
      modules: [
        {
          name: 'apps/api/src/app',
          folder: 'api',
          loc: 2580,
          deps: ['apps/api/src/services/authMiddleware'],
          fanIn: 12,
          fanOut: 17,
          instability: 0.586,
          cyclic: false,
          isEntryPoint: false,
        },
      ],
      violations: [
        { id: 'no-circular-dependencies', sev: 'warn', from: 'a', to: 'b', note: 'Violates "no-circular-dependencies" (warn).' },
      ],
    });

    it('parses a valid scan into its typed shape', () => {
      expect(parseDependencyScan(validScan)).toEqual({
        scannedAt: '2026-08-11T00:00:00.000Z',
        modules: [
          {
            name: 'apps/api/src/app',
            folder: 'api',
            loc: 2580,
            deps: ['apps/api/src/services/authMiddleware'],
            fanIn: 12,
            fanOut: 17,
            instability: 0.586,
            cyclic: false,
            isEntryPoint: false,
          },
        ],
        violations: [
          {
            id: 'no-circular-dependencies',
            sev: 'warn',
            from: 'a',
            to: 'b',
            note: 'Violates "no-circular-dependencies" (warn).',
          },
        ],
      });
    });

    it('passes through isEntryPoint: true for a known CLI-script/config module', () => {
      const scan = JSON.stringify({
        scannedAt: '2026-08-11T00:00:00.000Z',
        modules: [{ name: 'scripts/check-licenses', folder: 'scripts', isEntryPoint: true }],
        violations: [],
      });

      expect(parseDependencyScan(scan)?.modules[0]?.isEntryPoint).toBe(true);
    });

    it('drops a module with no name or no folder', () => {
      const scan = JSON.stringify({
        scannedAt: '2026-08-11T00:00:00.000Z',
        modules: [
          { folder: 'api', loc: 1, deps: [], fanIn: 0, fanOut: 0, instability: 0, cyclic: false },
          { name: 'a', loc: 1, deps: [], fanIn: 0, fanOut: 0, instability: 0, cyclic: false },
        ],
        violations: [],
      });

      expect(parseDependencyScan(scan)?.modules).toEqual([]);
    });

    it('drops a violation with an unrecognized severity', () => {
      const scan = JSON.stringify({
        scannedAt: '2026-08-11T00:00:00.000Z',
        modules: [],
        violations: [{ id: 'x', sev: 'catastrophic', from: 'a', to: 'b' }],
      });

      expect(parseDependencyScan(scan)?.violations).toEqual([]);
    });

    it('clamps instability into [0, 1] and treats non-numeric values as zero', () => {
      const scan = JSON.stringify({
        scannedAt: '2026-08-11T00:00:00.000Z',
        modules: [
          { name: 'a', folder: 'x', instability: 5 },
          { name: 'b', folder: 'x', instability: -1 },
          { name: 'c', folder: 'x', instability: 'lots' },
        ],
        violations: [],
      });

      expect(parseDependencyScan(scan)?.modules.map((m) => m.instability)).toEqual([1, 0, 0]);
    });

    it('treats missing loc/fanIn/fanOut/deps/cyclic/isEntryPoint as their zero/empty/false defaults', () => {
      const scan = JSON.stringify({
        scannedAt: '2026-08-11T00:00:00.000Z',
        modules: [{ name: 'a', folder: 'x' }],
        violations: [],
      });

      expect(parseDependencyScan(scan)?.modules[0]).toEqual({
        name: 'a',
        folder: 'x',
        loc: 0,
        deps: [],
        fanIn: 0,
        fanOut: 0,
        instability: 0,
        cyclic: false,
        isEntryPoint: false,
      });
    });

    it('defaults a violation with no note to a generated one', () => {
      const scan = JSON.stringify({
        scannedAt: '2026-08-11T00:00:00.000Z',
        modules: [],
        violations: [{ id: 'no-circular-dependencies', sev: 'warn', from: 'a', to: 'b' }],
      });

      expect(parseDependencyScan(scan)?.violations[0]?.note).toBe('Violates "no-circular-dependencies".');
    });

    it.each([
      ['invalid JSON', 'not json'],
      ['JSON null', 'null'],
      ['a JSON scalar', '7'],
      ['a payload missing scannedAt', JSON.stringify({ modules: [] })],
      ['a payload with a non-array modules field', JSON.stringify({ scannedAt: '2026-08-11T00:00:00.000Z', modules: 'nope' })],
    ])('returns null for %s', (_label, input) => {
      expect(parseDependencyScan(input)).toBeNull();
    });

    it('treats a missing violations field as an empty array', () => {
      const scan = JSON.stringify({ scannedAt: '2026-08-11T00:00:00.000Z', modules: [] });

      expect(parseDependencyScan(scan)?.violations).toEqual([]);
    });
  });
});
