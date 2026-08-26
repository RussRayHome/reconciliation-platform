import { describe, expect, it } from 'vitest';

import { AppError, ERROR_DEFINITIONS, OPERATIONS } from './errors';
import type { ErrorCode } from './errors';

const VALID_HTTP_STATUSES = new Set([400, 404, 409, 500, 502, 503, 504]);

describe('ERROR_DEFINITIONS', () => {
  it('is non-empty and every entry has a valid httpStatus and non-empty publicMessage', () => {
    const codes = Object.keys(ERROR_DEFINITIONS);
    expect(codes.length).toBeGreaterThan(0);

    for (const code of codes) {
      const definition = ERROR_DEFINITIONS[code as ErrorCode];
      expect(VALID_HTTP_STATUSES.has(definition.httpStatus)).toBe(true);
      expect(definition.publicMessage.length).toBeGreaterThan(0);
      expect(typeof definition.retryable).toBe('boolean');
    }
  });

  it('keys every definition with a stable, greppable code shape', () => {
    for (const code of Object.keys(ERROR_DEFINITIONS)) {
      expect(code).toMatch(/^RCN-[A-Z]+-\d{3}$/);
    }
  });
});

describe('OPERATIONS', () => {
  it('is non-empty and every value is a non-empty, lowercase-led phrase usable after "Unable to "', () => {
    const keys = Object.keys(OPERATIONS);
    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      const phrase = OPERATIONS[key as keyof typeof OPERATIONS];
      expect(phrase.length).toBeGreaterThan(0);
      expect(phrase).not.toMatch(/^[A-Z]/);
    }
  });
});

describe('AppError', () => {
  it('derives its message from the registry, never from the constructor call site', () => {
    const error = new AppError('RCN-DB-001');
    expect(error.message).toBe(ERROR_DEFINITIONS['RCN-DB-001'].publicMessage);
    expect(error.code).toBe('RCN-DB-001');
  });

  it('preserves cause for logging without leaking it into message', () => {
    const cause = new Error('connect ECONNREFUSED 10.0.3.14:5432');
    const error = new AppError('RCN-DB-002', { operation: 'IMPORT_RUN_CREATE' }, { cause });

    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain('10.0.3.14');
    expect(error.message).not.toContain('ECONNREFUSED');
  });

  it('carries context for logs/Sentry', () => {
    const error = new AppError('RCN-SUB-001', { operation: 'IMPORT_RUN_SUBMIT', stage: 'lookup' });
    expect(error.context).toEqual({ operation: 'IMPORT_RUN_SUBMIT', stage: 'lookup' });
  });

  it('is a real Error instance', () => {
    const error = new AppError('RCN-INT-001');
    expect(error).toBeInstanceOf(Error);
  });
});
