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

export type ReconciliationJobState = (typeof reconciliationJobStates)[number];

export const reconciliationSourceFormats = ['xlsx', 'csv'] as const;
export type ReconciliationSourceFormat = (typeof reconciliationSourceFormats)[number];

export const importBatchStates = ['PENDING', 'IMPORTING', 'IMPORTED', 'FAILED'] as const;
export type ImportBatchState = (typeof importBatchStates)[number];

export const exportStates = ['READY', 'FAILED'] as const;
export type ReconciliationExportState = (typeof exportStates)[number];

export const resultBuckets = ['MATCH', 'PROBABLE'] as const;
export type ReconciliationResultBucket = (typeof resultBuckets)[number];

const transitionGraph: Readonly<Record<ReconciliationJobState, readonly ReconciliationJobState[]>> = {
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

export const canTransitionJobState = (
  currentState: ReconciliationJobState,
  nextState: ReconciliationJobState,
): boolean => transitionGraph[currentState].includes(nextState);

export const assertValidJobTransition = (
  currentState: ReconciliationJobState,
  nextState: ReconciliationJobState,
): void => {
  if (!canTransitionJobState(currentState, nextState)) {
    throw new Error(`Invalid reconciliation_job transition: ${currentState} -> ${nextState}`);
  }
};
