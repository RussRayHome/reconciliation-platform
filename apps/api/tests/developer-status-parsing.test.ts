import {
  buildCoverageBenchmarks,
  formatCommand,
  parseAuditSummary,
  parseCoverageMetrics,
  parseSecurityHighlights,
  parseSecurityMetadata,
  parseTestHighlights,
  parseTestMetadata,
  parseTestMetrics,
  summarizeLintOutput,
  summarizeTestOutput,
  summarizeTypecheckOutput,
  truncateOutput,
} from '../src/services/developerStatusParsing';
import { describe, expect, it } from 'vitest';

describe('developerStatusParsing', () => {
  it('formats commands and truncates oversized output', () => {
    expect(formatCommand('npm', ['run', 'test'])).toBe('npm run test');

    const shortValue = 'short-output';
    expect(truncateOutput(shortValue, 100)).toBe(shortValue);

    const longValue = 'a'.repeat(80);
    const truncated = truncateOutput(longValue, 40);
    expect(truncated).toContain('...output truncated...');
    expect(truncated.length).toBeGreaterThan(40);
    expect(truncated.length).toBeLessThan(longValue.length * 2);
  });

  it('parses test metrics from vitest, playwright, db preflight, and unknown output', () => {
    expect(parseTestMetrics('Test Files  4 passed (4)\nTests  12 passed (12)')).toEqual({
      passed: 12,
      failed: 0,
      total: 12,
      passedFileCount: 4,
      failedFileCount: 0,
      totalFileCount: 4,
    });

    expect(parseTestMetrics('2 failed, 7 passed (7.0s)')).toEqual({
      passed: 7,
      failed: 2,
      total: 9,
    });

    expect(parseTestMetrics('Totals: PASS=10 WARN=2 FAIL=1')).toEqual({
      passed: 12,
      failed: 1,
      total: 13,
    });

    expect(parseTestMetrics('no test summary here')).toBeNull();
  });

  it('summarizes test/lint/typecheck output across success and failure paths', () => {
    expect(summarizeTestOutput('Tests  3 passed (3)')).toBe('Passed: 3, Failed: 0');
    expect(summarizeTestOutput('npm ERR! something bad happened')).toBe('Failed (see details)');
    expect(summarizeTestOutput('all checks complete')).toBe('Completed successfully');

    expect(summarizeLintOutput('0 problems')).toBe('No lint problems');
    expect(summarizeLintOutput('5 problems (5 errors, 0 warnings)')).toBe('5 lint problems');
    expect(summarizeLintOutput('clean')).toBe('No lint problems');

    expect(summarizeTypecheckOutput()).toBe('No type errors');
  });

  it('parses coverage metrics and builds coverage benchmarks from output or fallback summary', () => {
    const parsed = parseCoverageMetrics('All files | 88.1 | 10 | 92 | 90.5');
    expect(parsed).toEqual({
      statements: '88.1',
      branches: '10',
      functions: '92',
      lines: '90.5',
    });
    expect(parseCoverageMetrics('coverage unavailable')).toBeNull();

    const directBenchmarks = buildCoverageBenchmarks('All files | 88 | 10 | 92 | 90', () => null);
    expect(directBenchmarks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'S', meetsThreshold: true }),
        expect.objectContaining({ key: 'B', threshold: '75', meetsThreshold: false }),
      ]),
    );

    const fallbackBenchmarks = buildCoverageBenchmarks('no table', () => ({
      statements: '75',
      branches: '35',
      functions: '80',
      lines: '82',
    }));
    expect(fallbackBenchmarks).toHaveLength(4);

    expect(buildCoverageBenchmarks('no table', () => null)).toBeUndefined();
  });

  it('parses security summaries and highlights from component and legacy payloads', () => {
    const componentPayload = JSON.stringify({
      components: [{ component: 'API' }],
      aggregate: { critical: 1, high: 2, moderate: 3, low: 4, info: 5, total: 15 },
    });

    expect(parseAuditSummary(componentPayload)).toContain('Vulnerabilities across 1 components');
    expect(parseSecurityHighlights(componentPayload)).toEqual([
      'Critical: 1',
      'High: 2',
      'Moderate: 3',
      'Low: 4',
      'Info: 5',
    ]);

    const legacyPayload = JSON.stringify({
      metadata: {
        vulnerabilities: { critical: 1, high: 1, moderate: 1, low: 0, info: 0, total: 3 },
      },
    });

    expect(parseAuditSummary(legacyPayload)).toContain('Vulnerabilities: total 3');
    expect(parseSecurityHighlights(legacyPayload)).toEqual([
      'Critical: 1',
      'High: 1',
      'Moderate: 1',
      'Low: 0',
      'Info: 0',
    ]);

    expect(parseAuditSummary('not-json')).toBe('Security audit completed');
    expect(parseSecurityHighlights('not-json')).toEqual([]);
  });

  it('normalizes security metadata with dedupe, severity mapping, and payload overrides', () => {
    const withoutPayloadFindings = JSON.stringify({
      components: [
        {
          component: 'API',
          scanner: 'npm audit',
          status: 'error',
          critical: 1,
          high: 0,
          moderate: 0,
          low: 0,
          info: 0,
          total: 0,
          cveFindings: [
            null,
            {
              description: 'missing cve id should be ignored',
              severity: 'LOW',
            },
            {
              id: 'CVE-2026-0001',
              description: 'short',
              severity: 'HIGH',
            },
            {
              cve: 'CVE-2026-0001',
              description: 'a much longer description for the same CVE id',
              severity: 'CRITICAL',
            },
          ],
        },
        {
          component: 'Database',
          scanner: 'Trivy',
          status: 'skipped',
          critical: 0,
          high: 0,
          moderate: 1,
          low: 0,
          info: 0,
          total: 0,
          cveFindings: [
            {
              vulnerabilityId: 'CVE-2026-0002',
              description: 'db finding',
              severity: 'MEDIUM',
            },
          ],
        },
        42,
        {
          scanner: 'missing component should be ignored',
        },
      ],
    });

    const metadataFromComponents = parseSecurityMetadata(withoutPayloadFindings);
    expect(metadataFromComponents.securityComponentScores).toHaveLength(2);
    expect(metadataFromComponents.securityComponentScores?.[0]).toMatchObject({ status: 'error' });
    expect(metadataFromComponents.securityComponentScores?.[1]).toMatchObject({
      status: 'skipped',
    });
    expect(metadataFromComponents.securityAggregateScore).toMatchObject({
      critical: 1,
      high: 0,
      moderate: 1,
    });
    expect(metadataFromComponents.securityCveFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'CVE-2026-0001', severity: 'CRITICAL' }),
        expect.objectContaining({ id: 'CVE-2026-0002', severity: 'MODERATE' }),
      ]),
    );

    const withPayloadFindings = JSON.stringify({
      components: [
        {
          component: 'API',
          scanner: 'npm audit',
          status: 'ok',
          critical: 0,
          high: 0,
          moderate: 0,
          low: 0,
          info: 0,
          total: 0,
        },
      ],
      aggregate: { critical: 2, high: 0, moderate: 0, low: 0, info: 0, total: 2 },
      cveFindings: [
        {
          id: 'CVE-2026-9999',
          description: 'payload level finding for component sort tie-breaker',
          severity: 'LOW',
          component: 'Web',
          scanner: 'report',
        },
        {
          id: 'CVE-2026-9999',
          description: 'payload level finding',
          severity: 'LOW',
          component: 'Aggregate',
          scanner: 'report',
        },
      ],
    });

    const metadataFromPayload = parseSecurityMetadata(withPayloadFindings);
    expect(metadataFromPayload.securityAggregateScore).toMatchObject({ critical: 2, total: 2 });
    expect(metadataFromPayload.securityCveFindings).toEqual([
      expect.objectContaining({ id: 'CVE-2026-9999', severity: 'LOW', component: 'Aggregate' }),
      expect.objectContaining({ id: 'CVE-2026-9999', severity: 'LOW', component: 'Web' }),
    ]);

    expect(parseSecurityMetadata('not-json')).toEqual({});
  });

  it('extracts failing test highlights and parses test metadata', () => {
    const failureOutput = [
      'apps/api/tests/sample.test.ts:10:2 › failing suite',
      'Error: boom',
      'test-results/e2e/sample/trace.zip',
    ].join('\n');

    const highlights = parseTestHighlights(failureOutput);
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights[0]).toContain('Failing test:');
    expect(highlights.join(' | ')).toContain('Error: boom');
    expect(highlights.join(' | ')).toContain('Trace: test-results/e2e/sample/trace.zip');
    expect(parseTestHighlights('all good')).toEqual([]);

    const unitMetadataParser = parseTestMetadata('unit', 'Unit');
    expect(unitMetadataParser('Test Files  2 passed (2)\nTests  9 passed (9)')).toMatchObject({
      areaLabel: 'Unit',
      testType: 'unit',
      passedFileCount: 2,
      failedFileCount: 0,
      totalFileCount: 2,
      passedCount: 9,
      failedCount: 0,
      totalCount: 9,
    });

    expect(unitMetadataParser('no metrics present')).toMatchObject({
      areaLabel: 'Unit',
      testType: 'unit',
    });
  });
});
