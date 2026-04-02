import type { OutputWorkbook, ReconciliationRun } from '@recon/domain';

export interface ReconciliationRunResponse
  extends Omit<ReconciliationRun, 'outputWorkbook'> {
  outputWorkbook?: Omit<OutputWorkbook, 'binary'>;
}

export interface RunReconciliationPayload {
  bankFile: File;
  qboFile: File;
  accountIdentifier?: string;
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

export const runReconciliationRequest = async ({
  bankFile,
  qboFile,
  accountIdentifier,
  periodLabel,
}: RunReconciliationPayload): Promise<ReconciliationRunResponse> => {
  const formData = new FormData();
  formData.append('bankFile', bankFile);
  formData.append('qboFile', qboFile);
  if (accountIdentifier) {
    formData.append('accountIdentifier', accountIdentifier);
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

export const downloadWorkbookUrl = (runId: string): string =>
  `/api/reconciliation/${runId}/export/workbook`;
