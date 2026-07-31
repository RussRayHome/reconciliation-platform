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

  it('passes trace and debug through unchanged in non-test runtimes', () => {
    expect(resolveLogLevelAtLeastInfo('trace')).toBe('trace');
    expect(resolveLogLevelAtLeastInfo('debug')).toBe('debug');
  });

  it('preserves info and promotes quieter levels up to info in non-test runtimes', () => {
    expect(resolveLogLevelAtLeastInfo('info')).toBe('info');
    expect(resolveLogLevelAtLeastInfo('warn')).toBe('info');
    expect(resolveLogLevelAtLeastInfo('error')).toBe('info');
    expect(resolveLogLevelAtLeastInfo('fatal')).toBe('info');
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
