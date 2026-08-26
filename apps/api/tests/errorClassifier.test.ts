import { describe, expect, it } from 'vitest';

import { AppError, ERROR_DEFINITIONS } from '@recon/domain';
import { DatabaseError } from '@recon/persistence';
import multer from 'multer';

import { classifyError, classifyUploadError } from '../src/services/errorClassifier';

/** Builds a `pg` `DatabaseError` the way the real driver does -- constructed from a wire message,
 * then carrying whatever SQLSTATE the server reported in `.code`. */
const makeDatabaseError = (sqlState: string, message = 'database error'): DatabaseError => {
  const error = new DatabaseError(message, 0, 'error');
  error.code = sqlState;
  return error;
};

const makeNodeError = (code: string, message: string): NodeJS.ErrnoException => {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

describe('classifyError', () => {
  it('passes an AppError through with its own code and authored message', () => {
    const error = new AppError('RCN-SUB-002');
    const result = classifyError(error);

    expect(result.code).toBe('RCN-SUB-002');
    expect(result.httpStatus).toBe(ERROR_DEFINITIONS['RCN-SUB-002'].httpStatus);
    expect(result.message).toBe(ERROR_DEFINITIONS['RCN-SUB-002'].publicMessage);
  });

  it('classifies a raw connection-refused error as RCN-DB-002 with no host/port/driver text', () => {
    const error = makeNodeError('ECONNREFUSED', 'connect ECONNREFUSED 10.0.3.14:5432');
    const result = classifyError(error);

    expect(result.code).toBe('RCN-DB-002');
    expect(result.httpStatus).toBe(503);
    expect(result.message).not.toContain('10.0.3.14');
    expect(result.message).not.toContain('5432');
    expect(result.message).not.toContain('ECONNREFUSED');
  });

  it.each(['ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET'])(
    'classifies %s as RCN-DB-002',
    (code) => {
      const result = classifyError(makeNodeError(code, `some ${code} message`));
      expect(result.code).toBe('RCN-DB-002');
    },
  );

  it.each(['Connection terminated unexpectedly', 'Connection terminated'])(
    'classifies pg\'s own "%s" message as RCN-DB-003',
    (message) => {
      const result = classifyError(new Error(message));
      expect(result.code).toBe('RCN-DB-003');
      expect(result.message).not.toBe(message);
    },
  );

  it('classifies a DatabaseError with a 23xxx SQLSTATE as RCN-DB-004', () => {
    const error = makeDatabaseError('23505', 'duplicate key value violates unique constraint "x"');
    const result = classifyError(error);

    expect(result.code).toBe('RCN-DB-004');
    expect(result.message).not.toContain('constraint');
  });

  it('classifies a DatabaseError with SQLSTATE 57014 (query canceled) as RCN-DB-005', () => {
    const error = makeDatabaseError('57014', 'canceling statement due to statement timeout');
    const result = classifyError(error);

    expect(result.code).toBe('RCN-DB-005');
  });

  it('classifies an unrecognized DatabaseError SQLSTATE as RCN-INT-001, not RCN-DB-004', () => {
    // 42601 = syntax_error -- a real bug, not a data-integrity rejection; RCN-DB-004's message
    // ("rejected by a data integrity rule") would be actively misleading here.
    const error = makeDatabaseError('42601', 'syntax error at or near "SELCT"');
    const result = classifyError(error);

    expect(result.code).toBe('RCN-INT-001');
  });

  it('classifies an unrecognized plain Error as RCN-INT-001', () => {
    const result = classifyError(new Error('something unexpected'));
    expect(result.code).toBe('RCN-INT-001');
  });

  it('classifies a non-Error thrown value as RCN-INT-001', () => {
    const result = classifyError('a string, not an Error');
    expect(result.code).toBe('RCN-INT-001');
  });

  it('never returns the caught error\'s own message for a non-AppError', () => {
    const cases: unknown[] = [
      makeNodeError('ECONNREFUSED', 'connect ECONNREFUSED 10.0.3.14:5432'),
      new Error('Connection terminated unexpectedly'),
      makeDatabaseError('23505', 'duplicate key value violates unique constraint "x"'),
      makeDatabaseError('57014', 'canceling statement due to statement timeout'),
      makeDatabaseError('42601', 'syntax error at or near "SELCT"'),
      new Error('something with a stack trace and internal paths /usr/lib/node'),
    ];

    for (const error of cases) {
      const result = classifyError(error);
      const originalMessage = error instanceof Error ? error.message : String(error);
      expect(result.message).not.toBe(originalMessage);
    }
  });
});

describe('classifyUploadError', () => {
  it('surfaces a MulterError\'s own message with 413 for LIMIT_FILE_SIZE', () => {
    const error = new multer.MulterError('LIMIT_FILE_SIZE');
    const result = classifyUploadError(error);

    expect(result).toEqual({ httpStatus: 413, message: error.message });
  });

  it('surfaces a MulterError\'s own message with 400 for other codes', () => {
    const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
    const result = classifyUploadError(error);

    expect(result).toEqual({ httpStatus: 400, message: error.message });
  });

  it('surfaces the upload middleware\'s file-extension rejection message with 400', () => {
    const error = new Error('Only .xlsx files are accepted.');
    const result = classifyUploadError(error);

    expect(result).toEqual({ httpStatus: 400, message: error.message });
  });

  it('returns null for anything that is not an upload-specific error', () => {
    expect(classifyUploadError(new Error('unrelated failure'))).toBeNull();
    expect(classifyUploadError(new AppError('RCN-DB-001'))).toBeNull();
  });
});
