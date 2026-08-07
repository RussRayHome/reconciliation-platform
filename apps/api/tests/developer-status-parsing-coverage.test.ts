import { describe, expect, it } from 'vitest';

import {
  parseSecretMetadata,
  parseSecurityMetadata,
  parseTestHighlights,
} from '../src/services/developerStatusParsing';

describe('parseSecretMetadata', () => {
  it('returns {} for a payload with no JSON object', () => {
    expect(parseSecretMetadata('not json at all')).toEqual({});
  });

  it('parses findings, occurrences, verified tri-state, and tools flags', () => {
    const payload = JSON.stringify({
      findings: [
        {
          fingerprint: 'fp1',
          maskedSecret: 'ab**cd',
          ruleId: 'aws-key',
          description: 'test finding',
          sources: ['gitleaks', 'trufflehog'],
          verified: true,
          occurrences: [
            { file: 'a.env', startLine: 3, commit: 'abc123', author: 'rray', date: '2026-01-01', presentAtHead: true },
            { file: 'b.md' }, // minimal occurrence -- exercises every occurrence-field fallback
          ],
        },
        {
          fingerprint: 'fp2',
          verified: false,
          occurrences: [{ file: 'c.env', presentAtHead: false }],
        },
        {
          fingerprint: 'fp3',
          verified: null,
          occurrences: [{ file: 'd.env' }],
        },
        // Dropped: no occurrences at all.
        { fingerprint: 'fp-no-occurrences', occurrences: [] },
        // Dropped: occurrence has no file.
        { fingerprint: 'fp-bad-occurrence', occurrences: [{ startLine: 1 }] },
        // Dropped: no fingerprint.
        { occurrences: [{ file: 'e.env' }] },
        // Dropped: not an object.
        'not-an-object',
      ],
      aggregate: { critical: 1, high: 2, moderate: 0, low: 0, info: 0, total: 3 },
      tools: { gitleaks: true, trufflehog: false },
    });

    const result = parseSecretMetadata(payload);

    expect(result.secretFindings).toHaveLength(3);
    expect(result.secretFindings?.[0]).toMatchObject({
      fingerprint: 'fp1',
      maskedSecret: 'ab**cd',
      ruleId: 'aws-key',
      description: 'test finding',
      sources: ['gitleaks', 'trufflehog'],
      verified: true,
    });
    expect(result.secretFindings?.[0]?.occurrences).toHaveLength(2);
    expect(result.secretFindings?.[0]?.occurrences[1]).toMatchObject({
      file: 'b.md',
      startLine: undefined,
      commit: undefined,
      presentAtHead: false,
    });
    expect(result.secretFindings?.[1]).toMatchObject({
      fingerprint: 'fp2',
      // Fallbacks kick in when maskedSecret/ruleId/description are absent.
      maskedSecret: '********',
      ruleId: 'unknown-rule',
      description: 'Potential secret detected.',
      verified: false,
    });
    expect(result.secretFindings?.[2]).toMatchObject({ fingerprint: 'fp3', verified: null });

    expect(result.secretFindingsAggregate).toMatchObject({ critical: 1, high: 2, total: 3 });
    expect(result.secretScanTools).toEqual({ gitleaks: true, trufflehog: false });
  });

  it('defaults tools to false when the tools object is missing entirely', () => {
    const result = parseSecretMetadata(JSON.stringify({ findings: [] }));
    expect(result.secretScanTools).toEqual({ gitleaks: false, trufflehog: false });
  });
});

describe('parseSecurityMetadata additional branches', () => {
  const findingWith = (overrides: Record<string, unknown>) =>
    JSON.stringify({
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
          cveFindings: [{ id: 'CVE-2026-0100', ...overrides }],
        },
      ],
    });

  it('normalizes an unrecognized severity string to UNKNOWN', () => {
    const result = parseSecurityMetadata(findingWith({ severity: 'not-a-real-severity' }));
    expect(result.securityCveFindings?.[0]?.severity).toBe('UNKNOWN');
  });

  it('drops path and status when they are not one of the known values', () => {
    const result = parseSecurityMetadata(
      findingWith({ path: 'somewhere-weird', status: 'mysterious' }),
    );
    expect(result.securityCveFindings?.[0]?.path).toBeUndefined();
    expect(result.securityCveFindings?.[0]?.status).toBeUndefined();
  });

  it('falls back to a placeholder description when none is provided', () => {
    const result = parseSecurityMetadata(findingWith({ description: '   ' }));
    expect(result.securityCveFindings?.[0]?.description).toBe('No description provided.');
  });

  it('truncates a description longer than 220 characters', () => {
    const longDescription = 'x'.repeat(250);
    const result = parseSecurityMetadata(findingWith({ description: longDescription }));
    const description = result.securityCveFindings?.[0]?.description ?? '';
    expect(description.length).toBeLessThan(250);
    expect(description.endsWith('...')).toBe(true);
  });

  it('defaults an unspecified scanner to "unknown" and reports skipped/error status', () => {
    const payload = JSON.stringify({
      components: [
        { component: 'API', status: 'error', critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 },
        { component: 'Web', status: 'skipped', critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 },
      ],
    });
    const result = parseSecurityMetadata(payload);
    expect(result.securityComponentScores?.[0]).toMatchObject({ scanner: 'unknown', status: 'error' });
    expect(result.securityComponentScores?.[1]).toMatchObject({ status: 'skipped' });
  });

  it('keeps a non-empty component note and drops a whitespace-only one', () => {
    const withNote = JSON.stringify({
      components: [
        { component: 'API', scanner: 'x', status: 'ok', note: '  real note  ', critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 },
        { component: 'Web', scanner: 'x', status: 'ok', note: '   ', critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 },
      ],
    });
    const result = parseSecurityMetadata(withNote);
    expect(result.securityComponentScores?.[0]?.note).toBe('real note');
    expect(result.securityComponentScores?.[1]?.note).toBeUndefined();
  });
});

describe('parseTestHighlights partial matches', () => {
  it('reports only a failing-test highlight when no timeout/error or trace line is present', () => {
    const highlights = parseTestHighlights(
      '1 failed\napps/api/tests/sample.test.ts:10:2 › a failing test',
    );
    expect(highlights).toEqual(['Failing test: apps/api/tests/sample.test.ts:10:2 - a failing test']);
  });

  it('reports only a timeout/error highlight when there is no named failing test or trace line', () => {
    const highlights = parseTestHighlights('5 failed\nError: something broke');
    expect(highlights).toEqual(['Error: something broke']);
  });

  it('reports only a trace highlight when nothing else matches', () => {
    const highlights = parseTestHighlights('5 failed\ntest-results/e2e/spec/trace.zip');
    expect(highlights).toEqual(['Trace: test-results/e2e/spec/trace.zip']);
  });
});
