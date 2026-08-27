import { AppError, ERROR_DEFINITIONS } from '@recon/domain';
import type { ErrorCode } from '@recon/domain';
import { DatabaseError } from '@recon/persistence';
import multer from 'multer';

/** Multer's own errors, and the upload middleware's file-extension rejection, are already safe,
 * human-appropriate text (not driver internals) -- the global handler surfaces them as-is rather
 * than collapsing them into a classified message. Returns null for anything else so the caller
 * falls through to `classifyError`. */
export const classifyUploadError = (
  error: unknown,
): { httpStatus: number; message: string } | null => {
  if (error instanceof multer.MulterError) {
    return { httpStatus: error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, message: error.message };
  }

  // Matches createUploadMiddleware's fileFilter rejection message for any allowedExtensions list
  // (e.g. 'Only .xlsx files are accepted.', 'Only .xlsx/.csv files are accepted.').
  if (error instanceof Error && /^Only .+ files are accepted\.$/.test(error.message)) {
    return { httpStatus: 400, message: error.message };
  }

  return null;
};

// Postgres SQLSTATE class 23 = integrity constraint violation (unique_violation 23505,
// foreign_key_violation 23503, not_null_violation 23502, check_violation 23514, etc.).
const isIntegrityConstraintViolation = (sqlState: string): boolean => sqlState.startsWith('23');

// pg's own client.js throws these exact strings (not a DatabaseError -- no SQLSTATE was ever
// received) when the connection drops out from under an in-flight query.
const CONNECTION_TERMINATED_MESSAGES = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated',
]);

// Node/net-level failures reaching a configured-but-unreachable database -- also never a
// DatabaseError, since no Postgres server ever answered to issue one.
const CONNECTION_UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ECONNRESET',
]);

/** Classifies an unknown thrown value into an authored `{code, httpStatus, message}` triple
 * (error-handling-build-plan.md EH3) -- the one place allowed to read a caught error's own
 * message, and the boundary past which that message must never travel.
 *
 * `AppError` instances were already classified at their throw site and pass through unchanged.
 * Distinguishing "the database rejected this query" from "the database never responded" hinges on
 * `instanceof DatabaseError`: pg only constructs a `DatabaseError` from an actual server reply
 * (carrying a real SQLSTATE in `.code`), so a raw `Error` with a Node-level connection-refusal
 * code, or one of pg's own "connection terminated" strings, can only mean the database was
 * unreachable or dropped mid-request -- never a rejected query. Anything unrecognized falls to
 * `RCN-INT-001`, never the original message. */
export const classifyError = (
  error: unknown,
): { code: ErrorCode; httpStatus: number; message: string } => {
  if (error instanceof AppError) {
    return {
      code: error.code,
      httpStatus: ERROR_DEFINITIONS[error.code].httpStatus,
      message: error.message,
    };
  }

  let code: ErrorCode = 'RCN-INT-001';

  if (error instanceof DatabaseError) {
    if (error.code && isIntegrityConstraintViolation(error.code)) {
      code = 'RCN-DB-004';
    } else if (error.code === '57014') {
      code = 'RCN-DB-005';
    }
  } else if (error instanceof Error) {
    const nodeErrorCode = (error as NodeJS.ErrnoException).code;
    if (nodeErrorCode && CONNECTION_UNREACHABLE_CODES.has(nodeErrorCode)) {
      code = 'RCN-DB-002';
    } else if (CONNECTION_TERMINATED_MESSAGES.has(error.message)) {
      code = 'RCN-DB-003';
    }
  }

  return {
    code,
    httpStatus: ERROR_DEFINITIONS[code].httpStatus,
    message: ERROR_DEFINITIONS[code].publicMessage,
  };
};
