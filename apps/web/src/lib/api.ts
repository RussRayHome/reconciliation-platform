import type { ReconciliationRunReport } from '@recon/domain';

/** Alias for the full reconciliation run report returned by the API. */
export type ReconciliationRunResponse = ReconciliationRunReport;

/** Form payload sent to `POST /api/reconciliation/run`. */
export interface RunReconciliationPayload {
  bankFile: File;
  qboFile: File;
  accountIdentifier?: string;
  reconciliationFrequency?: 'Monthly' | 'Annual';
  periodLabel?: string;
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

/** Submits a reconciliation run request with bank and QBO file uploads and optional metadata. */
export const runReconciliationRequest = async ({
  bankFile,
  qboFile,
  accountIdentifier,
  reconciliationFrequency,
  periodLabel,
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

  const response = await fetch('/api/reconciliation/run', {
    method: 'POST',
    body: formData,
  });

  return parseResponse<ReconciliationRunResponse>(response);
};

/** Fetches the most recently completed reconciliation run report. */
export const getLatestReconciliationRunRequest = async (): Promise<ReconciliationRunResponse> => {
  const response = await fetch('/api/reconciliation/latest');
  return parseResponse<ReconciliationRunResponse>(response);
};

/** Returns the workbook download URL for the given run ID. */
export const downloadWorkbookUrl = (runId: string): string =>
  `/api/reconciliation/${runId}/export/workbook`;
