import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveLogLevelAtLeastInfo } from '../src/services/logLevel';

describe('resolveLogLevelAtLeastInfo', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.VITEST;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to info for undefined or invalid configured values', () => {
    expect(resolveLogLevelAtLeastInfo(undefined)).toBe('info');
    expect(resolveLogLevelAtLeastInfo(' definitely-not-a-level ')).toBe('info');
  });

  it('promotes trace and debug to info in non-test runtimes', () => {
    expect(resolveLogLevelAtLeastInfo('trace')).toBe('info');
    expect(resolveLogLevelAtLeastInfo('debug')).toBe('info');
  });

  it('preserves info-or-higher levels in non-test runtimes', () => {
    expect(resolveLogLevelAtLeastInfo('info')).toBe('info');
    expect(resolveLogLevelAtLeastInfo('warn')).toBe('warn');
    expect(resolveLogLevelAtLeastInfo('error')).toBe('error');
    expect(resolveLogLevelAtLeastInfo('fatal')).toBe('fatal');
  });

  it('allows silent only in test runtimes and otherwise promotes it to info', () => {
    expect(resolveLogLevelAtLeastInfo('silent')).toBe('info');

    process.env.NODE_ENV = 'test';
    expect(resolveLogLevelAtLeastInfo('silent')).toBe('silent');

    delete process.env.NODE_ENV;
    process.env.VITEST = 'true';
    expect(resolveLogLevelAtLeastInfo('silent')).toBe('silent');
  });
});
