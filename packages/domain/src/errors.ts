/** One shared error vocabulary the API and the web client both reason about (Issue #187,
 * `error-handling-build-plan.md` EH1). Distinguishes the three database failure modes the plan
 * organises around: no pool configured (`RCN-DB-001`), pool present but the database is
 * unreachable (`RCN-DB-002`/`003`), and the database reachable but the operation itself failed
 * (`RCN-DB-004`/`005`, `RCN-SUB-*`). `RCN-INT-001` is the last-resort fallback for anything that
 * isn't classified -- see `apps/api/src/app.ts`'s global error handler. */
export interface ErrorDefinition {
  readonly httpStatus: number;
  /** Authored for a reviewer to read. Never derived from a caught error -- see `AppError`. */
  readonly publicMessage: string;
  /** Whether retrying the same request could plausibly succeed. */
  readonly retryable: boolean;
}

export const ERROR_DEFINITIONS = {
  'RCN-DB-001': {
    httpStatus: 503,
    retryable: false,
    publicMessage: 'This feature requires a database connection, which is not configured in this environment.',
  },
  'RCN-DB-002': {
    httpStatus: 503,
    retryable: true,
    publicMessage: 'The service could not reach its database. Please try again shortly.',
  },
  'RCN-DB-003': {
    httpStatus: 503,
    retryable: true,
    publicMessage: 'The database connection was lost while processing this request. No changes were saved.',
  },
  'RCN-DB-004': {
    httpStatus: 500,
    retryable: false,
    publicMessage: 'The submission was rejected by a data integrity rule. Support has been notified.',
  },
  'RCN-DB-005': {
    httpStatus: 504,
    retryable: true,
    publicMessage: 'The operation took too long and was stopped. Please try again.',
  },
  'RCN-SUB-001': {
    httpStatus: 404,
    retryable: false,
    publicMessage: 'That import run no longer exists.',
  },
  'RCN-SUB-002': {
    httpStatus: 409,
    retryable: false,
    publicMessage: 'This run cannot be submitted from its current status.',
  },
  'RCN-SUB-003': {
    httpStatus: 503,
    retryable: true,
    publicMessage: 'The submission could not be queued for processing. Please try again.',
  },
  'RCN-SUB-004': {
    httpStatus: 500,
    retryable: false,
    publicMessage: 'Validation of this run failed. Support has been notified.',
  },
  'RCN-INT-001': {
    httpStatus: 500,
    retryable: false,
    publicMessage: 'Something went wrong on our side. Support has been notified.',
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

/** One phrase per `requirePool`/`requireDatabase`-guarded route (EH2), keyed by a stable
 * identifier rather than hand-written per call site -- issue #187's own proposed
 * `requirePool(response, 'creating an import run')` shape would let 33 hand-written strings
 * drift independently. Every value composes into `Unable to ${OPERATIONS[key]}.` -- lowercase-led,
 * no trailing period, phrased to read naturally after "Unable to ". */
export const OPERATIONS = {
  RECONCILIATION_RUNS_LIST: 'list reconciliation runs',
  RECONCILIATION_RUN_ROLLFORWARD: 'view the roll-forward for this run',
  RECONCILIATION_OPEN_ITEMS_LIST: 'load the open items schedule',
  IMPORT_RUN_CREATE: 'create an import run',
  IMPORT_RUN_LATEST: 'load the latest import run',
  IMPORT_RUN_GET: 'load this import run',
  IMPORT_RUN_EVENTS: 'stream import run progress',
  IMPORT_RUN_ISSUES: 'load import run issues',
  IMPORT_RUN_RECORDS: 'load import run records',
  IMPORT_RUN_FILE_FAILURE_DETAIL: 'load the failure detail for this file',
  IMPORT_RUN_FILE_ROWS: 'load the rows for this file',
  IMPORT_RUN_ERROR_REPORT: 'generate the error report',
  IMPORT_RUN_SUBMIT: 'submit this run',
  IMPORT_RUN_WITHDRAW: 'withdraw this submission',
  IMPORT_RUN_CLOSE: 'close this run',
  IMPORT_RUN_REOPEN: 'reopen this run',
  IMPORT_OPEN_ITEM_WRITE_OFF: 'write off this open item',
  IMPORT_RUN_IMPORT: 'import this run',
  ALIAS_LIST: 'load payee aliases',
  ALIAS_CREATE: 'create a payee alias',
  ALIAS_UPDATE: 'update this payee alias',
  ALIAS_DELETE: 'delete this payee alias',
  MAPPING_PROFILE_LIST: 'load mapping profiles',
  MAPPING_PROFILE_GET: 'load this mapping profile',
  MAPPING_PROFILE_CREATE: 'create a mapping profile',
  MAPPING_PROFILE_RETIRE: 'retire this mapping profile',
  RULE_VERSIONS_LIST: 'load rule versions',
  RULE_VERSION_DRAFT: 'draft a rule version',
  RULE_VERSION_PUBLISH: 'publish this rule version',
  APPROVALS_LIST: 'load approvals',
  APPROVALS_COUNTS: 'load approval counts',
  APPROVAL_DECISION: 'record this approval decision',
  APPROVAL_CLAIM: 'claim this approval',
} as const satisfies Record<string, string>;

export type OperationCode = keyof typeof OPERATIONS;

/** Thrown anywhere an operation fails in a classified way. `message` is always
 * `ERROR_DEFINITIONS[code].publicMessage` -- authored, never derived from whatever caused the
 * failure. `cause` carries the original error for logs/Sentry and must never be serialized into
 * an HTTP response body (see the global error handler in `apps/api/src/app.ts`). */
export class AppError extends Error {
  /** The registry key this error was thrown as -- `message`/`httpStatus`/`retryable` all derive
   * from `ERROR_DEFINITIONS[code]`. */
  readonly code: ErrorCode;
  /** Structured detail for logs/Sentry only -- never serialized into an HTTP response body. */
  readonly context: { operation?: OperationCode; stage?: string; [key: string]: unknown };

  /** @param code Registry key; determines `message`, `httpStatus`, and `retryable`.
   * @param context Structured detail (operation, stage, etc.) for logs/Sentry only.
   * @param options Standard `Error` cause option; the original failure, kept off the response. */
  constructor(
    code: ErrorCode,
    context: { operation?: OperationCode; stage?: string; [key: string]: unknown } = {},
    options?: { cause?: unknown },
  ) {
    super(ERROR_DEFINITIONS[code].publicMessage, options);
    this.name = 'AppError';
    this.code = code;
    this.context = context;
  }
}
