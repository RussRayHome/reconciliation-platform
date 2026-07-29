import type {
  ErrorCategory,
  ReconciliationRunReport,
  ReviewerDecision,
  ReviewerDecisionOutcome,
  ReviewerDecisionTargetType,
} from '@recon/domain';

/** Alias for the full reconciliation run report returned by the API. */
export type ReconciliationRunResponse = ReconciliationRunReport;
type QueuedReconciliationEnqueueResponse = {
  jobId: string;
  status: 'queued';
};

export type QueuedReconciliationStatusResponse = {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  runId?: string;
  run?: ReconciliationRunResponse;
  failedAt?: string;
  reason?: string;
};

interface LoginPayload {
  username: string;
  password: string;
}

interface LoginResponse {
  username: string;
  firstName: string;
  lastName: string;
}

/** Form payload sent to `POST /api/reconciliation/run`. */
export interface RunReconciliationPayload {
  bankFile: File;
  qboFile: File;
  accountIdentifier?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
  periodLabel?: string;
  varianceOverrides?: Record<string, number>;
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ message: 'Request failed.' }))) as {
      message?: string;
    };
    throw new Error(payload.message ?? 'Request failed.');
  }

  return (await response.json()) as T;
};

const isQueuedEnqueueResponse = (
  payload: ReconciliationRunResponse | QueuedReconciliationEnqueueResponse,
): payload is QueuedReconciliationEnqueueResponse => {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'status' in payload &&
    payload.status === 'queued' &&
    'jobId' in payload &&
    typeof payload.jobId === 'string'
  );
};

const wait = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

export const getReconciliationRunByIdRequest = async (
  runId: string,
): Promise<ReconciliationRunResponse> => {
  const response = await fetch(`/api/reconciliation/${encodeURIComponent(runId)}`);
  return parseResponse<ReconciliationRunResponse>(response);
};

const getQueuedReconciliationStatusRequest = async (
  jobId: string,
): Promise<QueuedReconciliationStatusResponse> => {
  const response = await fetch(`/api/reconciliation/jobs/${encodeURIComponent(jobId)}`);
  return parseResponse<QueuedReconciliationStatusResponse>(response);
};

const waitForQueuedReconciliationRun = async (
  jobId: string,
  pollIntervalMs = 1000,
  maxAttempts = 300,
): Promise<ReconciliationRunResponse> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await getQueuedReconciliationStatusRequest(jobId);

    if (status.status === 'failed') {
      throw new Error(status.reason ?? 'Queued reconciliation failed.');
    }

    if (status.status === 'completed') {
      if (status.run) {
        return status.run;
      }

      if (status.runId) {
        return getReconciliationRunByIdRequest(status.runId);
      }

      throw new Error('Queued reconciliation completed without a run payload.');
    }

    await wait(pollIntervalMs);
  }

  throw new Error('Timed out while waiting for queued reconciliation to complete.');
};

/** Submits a reconciliation run request with bank and QBO file uploads and optional metadata. */
export const runReconciliationRequest = async ({
  bankFile,
  qboFile,
  accountIdentifier,
  reconciliationFrequency,
  periodLabel,
  varianceOverrides,
}: RunReconciliationPayload): Promise<ReconciliationRunResponse> => {
  const formData = new FormData();
  formData.append('bankFile', bankFile);
  formData.append('qboFile', qboFile);
  if (accountIdentifier) {
    formData.append('accountIdentifier', accountIdentifier);
  }
  if (reconciliationFrequency) {
    formData.append('reconciliationFrequency', reconciliationFrequency);
  }
  if (periodLabel) {
    formData.append('periodLabel', periodLabel);
  }
  if (varianceOverrides && Object.keys(varianceOverrides).length > 0) {
    formData.append('varianceOverrides', JSON.stringify(varianceOverrides));
  }

  const response = await fetch('/api/reconciliation/run', {
    method: 'POST',
    body: formData,
  });

  const parsed = await parseResponse<
    ReconciliationRunResponse | QueuedReconciliationEnqueueResponse
  >(response);

  if (isQueuedEnqueueResponse(parsed)) {
    return waitForQueuedReconciliationRun(parsed.jobId);
  }

  return parsed;
};

/** Fetches the most recently completed reconciliation run report. */
export const getLatestReconciliationRunRequest = async (): Promise<ReconciliationRunResponse> => {
  const response = await fetch('/api/reconciliation/latest');
  return parseResponse<ReconciliationRunResponse>(response);
};

/** Authenticates a user and returns profile details for the active session. */
export const loginRequest = async ({
  username,
  password,
}: LoginPayload): Promise<LoginResponse> => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  });

  return parseResponse<LoginResponse>(response);
};

/** Returns the workbook download URL for the given run ID. */
export const downloadWorkbookUrl = (runId: string): string =>
  `/api/reconciliation/${runId}/export/workbook`;

/** Input payload for recording a reviewer decision on a run target. */
export interface ReviewerDecisionInput {
  targetType: ReviewerDecisionTargetType;
  targetId: string;
  outcome: ReviewerDecisionOutcome;
  finalCategory?: ErrorCategory;
  notes?: string;
}

/** Fetches all persisted reviewer decisions for a reconciliation run. */
export const getReviewerDecisionsRequest = async (runId: string): Promise<ReviewerDecision[]> => {
  const response = await fetch(
    `/api/reconciliation/${encodeURIComponent(runId)}/reviewer-decisions`,
  );
  return parseResponse<ReviewerDecision[]>(response);
};

/** Persists a single reviewer decision for a run target and returns the saved record. */
export const saveReviewerDecisionRequest = async (
  runId: string,
  input: ReviewerDecisionInput,
): Promise<ReviewerDecision> => {
  const response = await fetch(
    `/api/reconciliation/${encodeURIComponent(runId)}/reviewer-decisions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  );
  return parseResponse<ReviewerDecision>(response);
};
