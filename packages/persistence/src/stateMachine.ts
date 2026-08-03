/**
 * All valid states in the reconciliation job lifecycle.
 * The happy path is: CREATED → FILE_REGISTERED → IMPORTING → IMPORTED →
 * NORMALIZING → NORMALIZED → MATCHING → MATCHED → EXCEPTIONS_IDENTIFIED →
 * REVIEW_READY → FINALIZED.
 * Any state can transition to FAILED or CANCELLED; FAILED can retry via RETRY_PENDING.
 */
export const reconciliationJobStates = [
  'CREATED',
  'FILE_REGISTERED',
  'IMPORTING',
  'IMPORTED',
  'NORMALIZING',
  'NORMALIZED',
  'MATCHING',
  'MATCHED',
  'EXCEPTIONS_IDENTIFIED',
  'REVIEW_READY',
  'FINALIZED',
  'FAILED',
  'RETRY_PENDING',
  'CANCELLED',
] as const;

/** Union of all valid reconciliation job state strings. */
export type ReconciliationJobState = (typeof reconciliationJobStates)[number];

/** Accepted upload file formats for source workbooks. */
export const reconciliationSourceFormats = ['xlsx', 'csv'] as const;
/** Union of accepted upload file format strings. */
export type ReconciliationSourceFormat = (typeof reconciliationSourceFormats)[number];

/** Valid states for a file-import batch row. */
export const importBatchStates = ['PENDING', 'IMPORTING', 'IMPORTED', 'FAILED'] as const;
/** Union of valid import batch state strings. */
export type ImportBatchState = (typeof importBatchStates)[number];

/** Valid states for a workbook export record. */
export const exportStates = ['READY', 'FAILED'] as const;
/** Union of valid export state strings. */
export type ReconciliationExportState = (typeof exportStates)[number];

/** Valid match-result bucket labels stored in the `reconciliation_result` table. */
export const resultBuckets = ['MATCH', 'PROBABLE'] as const;
/** Union of valid result bucket strings. */
export type ReconciliationResultBucket = (typeof resultBuckets)[number];

const transitionGraph: Readonly<Record<ReconciliationJobState, readonly ReconciliationJobState[]>> =
  {
    CREATED: ['FILE_REGISTERED', 'FAILED', 'CANCELLED'],
    FILE_REGISTERED: ['IMPORTING', 'FAILED', 'CANCELLED', 'RETRY_PENDING'],
    IMPORTING: ['IMPORTED', 'FAILED', 'RETRY_PENDING', 'CANCELLED'],
    IMPORTED: ['NORMALIZING', 'FAILED', 'RETRY_PENDING', 'CANCELLED'],
    NORMALIZING: ['NORMALIZED', 'FAILED', 'RETRY_PENDING', 'CANCELLED'],
    NORMALIZED: ['MATCHING', 'FAILED', 'RETRY_PENDING', 'CANCELLED'],
    MATCHING: ['MATCHED', 'FAILED', 'RETRY_PENDING', 'CANCELLED'],
    MATCHED: ['EXCEPTIONS_IDENTIFIED', 'FAILED', 'RETRY_PENDING', 'CANCELLED'],
    EXCEPTIONS_IDENTIFIED: ['REVIEW_READY', 'FAILED', 'RETRY_PENDING', 'CANCELLED'],
    REVIEW_READY: ['FINALIZED', 'FAILED', 'RETRY_PENDING', 'CANCELLED'],
    FINALIZED: [],
    FAILED: ['RETRY_PENDING', 'CANCELLED'],
    RETRY_PENDING: ['IMPORTING', 'NORMALIZING', 'MATCHING', 'FILE_REGISTERED', 'CANCELLED'],
    CANCELLED: [],
  };

/** Returns true when moving from `currentState` to `nextState` is permitted by the transition graph. */
export const canTransitionJobState = (
  currentState: ReconciliationJobState,
  nextState: ReconciliationJobState,
): boolean => transitionGraph[currentState].includes(nextState);

/**
 * Throws if the transition `currentState → nextState` is not permitted.
 * Called inside every database write that advances or fails a job so that the
 * state machine invariants are enforced at the persistence layer, not just in application code.
 */
export const assertValidJobTransition = (
  currentState: ReconciliationJobState,
  nextState: ReconciliationJobState,
): void => {
  if (!canTransitionJobState(currentState, nextState)) {
    throw new Error(`Invalid reconciliation_job transition: ${currentState} -> ${nextState}`);
  }
};
