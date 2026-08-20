import type {
  ApprovableType,
  ApprovalCountsByGroup,
  ApprovalRow,
  CanonicalField,
  EntityVerificationStatus,
  ErrorCategory,
  IdentityVerificationStatus,
  MappingProfileSavePayload,
  MappingProfileSaveResult,
  MatchingConfigVersion,
  ReconciliationRunReport,
  ReviewerDecision,
  ReviewerDecisionOutcome,
  ReviewerDecisionTargetType,
  RuleCatalogResponse,
  RuleVersionsResponse,
  UserRole,
} from '@recon/domain';
import { clearAuthToken, getAuthToken, setAuthToken } from './authToken';

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
  token: string;
  username: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  organizationId: string;
}

/** The self-serve-selectable roles offered on the signup form -- admin/superuser are not
 * choosable there, matching the comment on `userRoles` in @recon/domain. */
export type SignupRole = Exclude<UserRole, 'admin' | 'superuser'>;

/** Payload for `POST /api/auth/signup`, matching `signupBodySchema` on the API. */
export interface SignupPayload {
  email: string;
  fullName: string;
  username: string;
  password: string;
  phone: string;
  companyName: string;
  headcount: string;
  industry: string;
  role: SignupRole;
  fiscalYearEnd: string;
  entityState: string;
  entityFilingNumber: string;
  entityType: 'domestic' | 'foreign';
  verificationChannel: 'email' | 'sms';
}

/** Signup returns the same shape as login -- the account is created (and the caller signed in)
 * before either verification gate resolves; both start 'pending'. */
type SignupResponse = LoginResponse;

/** The authenticated principal as reported by the server -- ADR-0002 step 6: the frontend stops
 * trusting a cached identity and instead asks the server (via /api/auth/me) or trusts the just-
 * issued login response, not a locally reconstructed role. `identityVerificationStatus` and
 * `entityVerificationStatus` are read live on every /api/auth/me call, not carried on the JWT --
 * see authMiddleware.ts's createRequireFullyVerified for why. */
export interface AuthenticatedPrincipal {
  username: string;
  role: UserRole;
  organizationId: string;
  firstName: string;
  lastName: string;
  identityVerificationStatus: IdentityVerificationStatus;
  entityVerificationStatus: EntityVerificationStatus;
  isFullyVerified: boolean;
}

/** Form payload sent to `POST /api/reconciliation/run`. */
export interface RunReconciliationPayload {
  bankFile: File;
  glFile: File;
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

  // 204 No Content (identity confirm/resend) has no body -- .json() would throw on the empty
  // string rather than return anything meaningful.
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

/**
 * Wraps `fetch` to attach the bearer token (ADR-0002 DECIDE 1 = JWT), so every authenticated
 * request goes through one place instead of each call site remembering the header. Every request
 * in this module except `loginRequest` itself should use this instead of the global `fetch`.
 */
export const apiFetch = (input: string, init?: RequestInit): Promise<Response> => {
  const token = getAuthToken();

  // No token: call fetch with whatever arity the caller used, rather than wrapping it in a
  // freshly-constructed (but equivalent) Headers object -- keeps this a true no-op when there's
  // nothing to add, including matching a caller that passed no init object at all.
  if (!token) {
    return init === undefined ? fetch(input) : fetch(input, init);
  }

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
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
  const response = await apiFetch(`/api/reconciliation/${encodeURIComponent(runId)}`);
  return parseResponse<ReconciliationRunResponse>(response);
};

const getQueuedReconciliationStatusRequest = async (
  jobId: string,
): Promise<QueuedReconciliationStatusResponse> => {
  const response = await apiFetch(`/api/reconciliation/jobs/${encodeURIComponent(jobId)}`);
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

/** Submits a reconciliation run request with bank and GL file uploads and optional metadata. */
export const runReconciliationRequest = async ({
  bankFile,
  glFile,
  accountIdentifier,
  reconciliationFrequency,
  periodLabel,
  varianceOverrides,
}: RunReconciliationPayload): Promise<ReconciliationRunResponse> => {
  const formData = new FormData();
  formData.append('bankFile', bankFile);
  formData.append('glFile', glFile);
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

  const response = await apiFetch('/api/reconciliation/run', {
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
  const response = await apiFetch('/api/reconciliation/latest');
  return parseResponse<ReconciliationRunResponse>(response);
};

/** One uploaded file's status within an import run, matching `ImportRunFileSummary`
 * (packages/persistence/src/importRunStore.ts). */
export interface ImportRunFileSummary {
  importFileId: string;
  role: string;
  sourceType: string;
  originalFilename: string;
  fileFormat: 'CSV' | 'XLSX';
  validationStatus: string;
  byteSize: number;
  contentSha256: string;
  rowCount: number | null;
  errorCount: number | null;
  warningCount: number | null;
}

/** `GET/POST /api/imports/runs` response shape, matching `ImportRunSummary`
 * (packages/persistence/src/importRunStore.ts). */
export interface ImportRunSummary {
  id: string;
  organizationId: string;
  label: string;
  accountIdentifier: string | null;
  frequency: 'MONTHLY' | 'ANNUAL';
  periodYear: number;
  periodMonth: number | null;
  status: string;
  createdAt: string;
  files: ImportRunFileSummary[];
}

/** Payload for `POST /api/imports/runs`, matching `importRunBodySchema`. `bankFiles` is 1-4 bank
 * account uploads (Issue #153) sent as one repeated `bankFiles` form field, not per-slot names. */
export interface CreateImportRunPayload {
  bankFiles: File[];
  glFile: File;
  label: string;
  accountIdentifier?: string;
  frequency: 'MONTHLY' | 'ANNUAL';
  periodYear: number;
  periodMonth?: number;
}

/** Bytes sent so far vs. the total request body size, reported while the combined bank + GL
 * multipart upload (both bank workbooks plus the GL workbook) is in flight (Screen 02's per-file
 * progress bars). */
export interface UploadProgressEvent {
  loadedBytes: number;
  totalBytes: number;
}

export interface CreateImportRunOptions {
  onProgress?: (event: UploadProgressEvent) => void;
  signal?: AbortSignal;
}

/** Creates a DRAFT import run (File Imports & Validation, Phase 5) -- Screen 01's `Submit run`
 * flow calls this, then `submitImportRunRequest`, rather than the old atomic
 * `POST /api/reconciliation/run`.
 *
 * Uses `XMLHttpRequest` rather than `fetch` because `fetch` has no upload-progress event --
 * `xhr.upload`'s `progress` event is the only standard way to observe bytes sent for a multipart
 * body still in flight, which Screen 02's per-file progress bars need. */
export const createImportRunRequest = ({
  bankFiles,
  glFile,
  label,
  accountIdentifier,
  frequency,
  periodYear,
  periodMonth,
  onProgress,
  signal,
}: CreateImportRunPayload & CreateImportRunOptions): Promise<ImportRunSummary> => {
  const formData = new FormData();
  bankFiles.forEach((bankFile) => formData.append('bankFiles', bankFile));
  formData.append('glFile', glFile);
  formData.append('label', label);
  if (accountIdentifier) {
    formData.append('accountIdentifier', accountIdentifier);
  }
  formData.append('frequency', frequency);
  formData.append('periodYear', String(periodYear));
  if (periodMonth !== undefined) {
    formData.append('periodMonth', String(periodMonth));
  }

  return new Promise<ImportRunSummary>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/imports/runs');

    const token = getAuthToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress?.({ loadedBytes: event.loaded, totalBytes: event.total });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as ImportRunSummary);
        } catch {
          reject(new Error('The server returned an unreadable response.'));
        }
        return;
      }

      let message = `Import run creation failed with status ${xhr.status}.`;
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string };
        if (body.message) {
          message = body.message;
        }
      } catch {
        // Body wasn't JSON -- keep the status-based fallback message.
      }
      reject(new Error(message));
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error while uploading source files.'));
    });

    xhr.addEventListener('abort', () => {
      reject(new DOMException('Upload cancelled', 'AbortError'));
    });

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
};

/** `POST /api/imports/runs/:id/submit` response shape -- either queued (BullMQ enabled, no
 * result yet) or resolved synchronously (queue disabled, the default/local-dev fallback), in
 * which case `passed`/`matchingJobId` are set once validation actually ran. */
export type SubmitImportRunResponse =
  | { importJobId: string; status: 'queued' }
  | {
      importJobId: string;
      status: 'completed';
      passed: boolean;
      matchingJobId?: string;
      run: ImportRunSummary;
    }
  | { importJobId: string; status: 'failed'; failedAt: string; reason: string };

/** Submits a DRAFT import run for validation -- DRAFT -> VALIDATING, and (when the queue is
 * disabled) runs validation synchronously in-request, same fallback pattern as
 * `runReconciliationRequest`'s queued/synchronous split above. */
export const submitImportRunRequest = async (runId: string): Promise<SubmitImportRunResponse> => {
  const response = await apiFetch(`/api/imports/runs/${encodeURIComponent(runId)}/submit`, {
    method: 'POST',
  });
  return parseResponse<SubmitImportRunResponse>(response);
};

/** One `validation_issue` row surfaced on the failure screens, matching
 * `ImportFileFailureDetail['issues']` (apps/api/src/services/importFailureDetailService.ts). */
export interface ImportFailureIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  field: string | null;
  rowNumber: number | null;
}

export interface ImportFailureHeaderComparisonRow {
  position: number;
  expected: string | null;
  found: string | null;
  matches: boolean;
}

export interface ImportFailureGateSequenceEntry {
  gate: 'HEADER' | 'COLUMN_ORDER' | 'CELL_VALUES';
  state: 'PASSED' | 'FAILED' | 'NOT_RUN';
}

/** `GET /api/imports/runs/:id/files/:fileId/failure-detail` response shape -- drives Screen 05
 * (structure failure, when `headerComparison` is non-null) and Screen 07 (all rows invalid, when
 * `headerComparison` is null and `importableRowCount` is 0). */
export interface ImportFileFailureDetail {
  importFileId: string;
  originalFilename: string;
  sourceType: 'BANK' | 'GL';
  fileFormat: 'CSV' | 'XLSX';
  validationStatus: string;
  rowCount: number | null;
  errorCount: number | null;
  warningCount: number | null;
  importableRowCount: number;
  gateSequence: ImportFailureGateSequenceEntry[];
  headerComparison: ImportFailureHeaderComparisonRow[] | null;
  issues: ImportFailureIssue[];
  issuesByCode: Array<{ code: string; severity: string; count: number }>;
  amountTolerance: number;
}

export const getImportFileFailureDetailRequest = async (
  runId: string,
  fileId: string,
): Promise<ImportFileFailureDetail> => {
  const response = await apiFetch(
    `/api/imports/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(fileId)}/failure-detail`,
  );
  return parseResponse<ImportFileFailureDetail>(response);
};

/** Downloads the run's error report CSV. A plain `<a href>` can't carry the bearer token, same
 * reasoning as `downloadWorkbookRequest`. */
export const downloadImportRunErrorReportRequest = async (runId: string): Promise<void> => {
  const response = await apiFetch(
    `/api/imports/runs/${encodeURIComponent(runId)}/error-report.csv`,
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ message: 'Request failed.' }))) as {
      message?: string;
    };
    throw new Error(payload.message ?? 'Request failed.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `import-run-${runId}-error-report.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export interface ImportRowGridFlag {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
}

export interface ImportRowGridRow {
  lineNumber: number;
  values: Record<string, string>;
  status: 'IMPORT' | 'SKIP';
  flaggedFields: Record<string, ImportRowGridFlag>;
  rowLevelIssues: ImportRowGridFlag[];
}

/** `GET /api/imports/runs/:id/files/:fileId/rows` response shape -- Screen 06's row grid. */
export interface ImportRowGridResult {
  headers: string[];
  rows: ImportRowGridRow[];
  totalRows: number;
  errorRowCount: number;
  warningRowCount: number;
  cleanRowCount: number;
  truncated: boolean;
}

export const getImportFileRowsRequest = async (
  runId: string,
  fileId: string,
): Promise<ImportRowGridResult> => {
  const response = await apiFetch(
    `/api/imports/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(fileId)}/rows`,
  );
  return parseResponse<ImportRowGridResult>(response);
};

/** `POST /api/imports/runs/:id/import` -- Screen 06's "Import N rows & submit". Accepts a
 * VALIDATION_FAILED run's already-passing rows and triggers matching; matching still processes
 * the full original file (see the route's own comment on why "skip" means accept-despite, not
 * remove-from-reconciliation). Same response shape as `submitImportRunRequest`'s completed case,
 * reused directly rather than duplicated. */
export const importPartialRunRequest = async (
  runId: string,
): Promise<Extract<SubmitImportRunResponse, { status: 'completed' }>> => {
  const response = await apiFetch(`/api/imports/runs/${encodeURIComponent(runId)}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipInvalidRows: true }),
  });
  return parseResponse<Extract<SubmitImportRunResponse, { status: 'completed' }>>(response);
};

/** Authenticates a user, stores the returned bearer token, and returns the login profile.
 * Deliberately uses the bare `fetch` -- there is no token yet to attach. */
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

  const result = await parseResponse<LoginResponse>(response);
  setAuthToken(result.token);
  return result;
};

/** Revokes the current token server-side (best effort) and always clears it locally. Network
 * failure here (offline, server down) must not block sign-out, so it's swallowed rather than
 * thrown -- the token still expires naturally, same tradeoff as the server-side denylist. */
export const logoutRequest = async (): Promise<void> => {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Best-effort only; see comment above.
  } finally {
    clearAuthToken();
  }
};

/** Re-derives the authenticated principal from the current bearer token -- ADR-0002 step 6, the
 * server is the source of truth for identity/role, not a cached copy in localStorage. */
export const meRequest = async (): Promise<AuthenticatedPrincipal> => {
  const response = await apiFetch('/api/auth/me');
  return parseResponse<AuthenticatedPrincipal>(response);
};

/** Payload for the pre-signup entity precheck -- a subset of {@link SignupPayload}'s entity fields. */
export interface EntityVerificationCheckPayload {
  companyName: string;
  entityState: string;
  entityFilingNumber: string;
  entityType: 'domestic' | 'foreign';
}

export interface EntityVerificationCheckResponse {
  status: Extract<EntityVerificationStatus, 'verified' | 'failed'>;
  registeredName?: string;
  standing?: string;
}

/** Advisory Secretary of State check the signup form runs inline, before the account (and its
 * token) exist -- unauthenticated, writes nothing. See entityVerificationCheckBodySchema. */
export const entityVerificationCheckRequest = async (
  payload: EntityVerificationCheckPayload,
): Promise<EntityVerificationCheckResponse> => {
  const response = await fetch('/api/entity-verification/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseResponse<EntityVerificationCheckResponse>(response);
};

/** Creates the account and organization, then signs the caller in immediately -- account creation
 * does not wait on entity or identity verification, both of which start 'pending'. */
export const signupRequest = async (payload: SignupPayload): Promise<SignupResponse> => {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await parseResponse<SignupResponse>(response);
  setAuthToken(result.token);
  return result;
};

/** Confirms the six-digit code sent to the signup email/phone, moving identityVerificationStatus
 * to 'verified'. */
export const identityConfirmRequest = async (code: string): Promise<void> => {
  const response = await apiFetch('/api/auth/identity/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  await parseResponse<void>(response);
};

/** Requests a fresh six-digit code (the previous one, if any, expired or was never received). */
export const identityResendRequest = async (): Promise<void> => {
  const response = await apiFetch('/api/auth/identity/resend', { method: 'POST' });
  await parseResponse<void>(response);
};

/** Re-runs the Secretary of State entity check for the caller's organization -- the mockup's
 * "Re-run verification" affordance for a 'failed' result. */
export const entityVerificationRetryRequest = async (): Promise<{
  status: EntityVerificationStatus;
}> => {
  const response = await apiFetch('/api/organizations/entity-verification/retry', {
    method: 'POST',
  });
  return parseResponse<{ status: EntityVerificationStatus }>(response);
};

/** Downloads the output workbook for a run. A plain `<a href>` can't carry the bearer token, so
 * this fetches the bytes and triggers the save via a blob URL instead. */
export const downloadWorkbookRequest = async (runId: string, fileName: string): Promise<void> => {
  const response = await apiFetch(`/api/reconciliation/${encodeURIComponent(runId)}/export/workbook`);

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ message: 'Request failed.' }))) as {
      message?: string;
    };
    throw new Error(payload.message ?? 'Request failed.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

/** Fetches the canonical transaction schema the Create Mapping canvas targets. */
export const getCanonicalFieldsRequest = async (): Promise<CanonicalField[]> => {
  const response = await apiFetch('/api/mapping/canonical-fields');
  return parseResponse<CanonicalField[]>(response);
};

/** Fetches the organization's distinct saved mapping profile names. */
export const getMappingProfilesRequest = async (): Promise<string[]> => {
  const response = await apiFetch('/api/mapping/profiles');
  return parseResponse<string[]>(response);
};

/** Fetches the organization's active/draft matching-config versions and publish history. */
export const getRuleVersionsRequest = async (): Promise<RuleVersionsResponse> => {
  const response = await apiFetch('/api/rules/versions');
  return parseResponse<RuleVersionsResponse>(response);
};

/** Fetches every rule the matching engine and exception classifier can emit, with tunable metrics. */
export const getRulesCatalogRequest = async (): Promise<RuleCatalogResponse> => {
  const response = await apiFetch('/api/rules/catalog');
  return parseResponse<RuleCatalogResponse>(response);
};

/** Drafts a new matching-config version from a proposed set of variance overrides. Admin-only. */
export const createRuleVersionDraftRequest = async (
  varianceOverrides: Record<string, number>,
): Promise<MatchingConfigVersion> => {
  const response = await apiFetch('/api/rules/versions/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ varianceOverrides }),
  });
  return parseResponse<MatchingConfigVersion>(response);
};

/** Publishes a draft matching-config version, superseding the previous active version. Admin-only. */
export const publishRuleVersionRequest = async (
  versionId: string,
): Promise<MatchingConfigVersion> => {
  const response = await apiFetch(`/api/rules/versions/${encodeURIComponent(versionId)}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return parseResponse<MatchingConfigVersion>(response);
};

export type ApprovalTab = 'pending' | 'approved' | 'rejected' | 'mine';

/** Fetches one approvable type's rows for a given Approvals tab, privilege-scoped server-side. */
export const getApprovalsRequest = async (
  type: ApprovableType,
  tab: ApprovalTab,
): Promise<ApprovalRow[]> => {
  const response = await apiFetch(
    `/api/approvals?type=${encodeURIComponent(type)}&tab=${encodeURIComponent(tab)}`,
  );
  return parseResponse<ApprovalRow[]>(response);
};

/** Fetches the Approvals rail badge counts, one per rail submenu, privilege-scoped server-side. */
export const getApprovalCountsRequest = async (): Promise<ApprovalCountsByGroup> => {
  const response = await apiFetch('/api/approvals/counts');
  return parseResponse<ApprovalCountsByGroup>(response);
};

/** Approves, rejects, or overrides a pending approval of any ApprovableType. Approver-only. */
export const decideApprovalRequest = async (
  type: ApprovableType,
  approvalId: string,
  status: 'APPROVED' | 'REJECTED' | 'OVERRIDDEN',
  rationale?: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/approvals/${encodeURIComponent(type)}/${encodeURIComponent(approvalId)}/decision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, rationale }),
    },
  );
  await parseResponse<unknown>(response);
};

/** Claims an unassigned pending approval of any ApprovableType as the current user. Approver-only. */
export const claimApprovalRequest = async (
  type: ApprovableType,
  approvalId: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/approvals/${encodeURIComponent(type)}/${encodeURIComponent(approvalId)}/claim`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  await parseResponse<unknown>(response);
};

/** Phase 14: pulls a PENDING_APPROVAL import run back to DRAFT (README §7 item 7, "an analyst...
 * may withdraw a submission"). Self-service on the submitter's own run, not a decision on the
 * polymorphic /api/approvals/:type/:id/* surface -- lives under /api/imports/runs/:id instead,
 * same as submit/import. */
export const withdrawImportRunRequest = async (runId: string): Promise<ImportRunSummary> => {
  const response = await apiFetch(`/api/imports/runs/${encodeURIComponent(runId)}/withdraw`, {
    method: 'POST',
  });
  const payload = await parseResponse<{ run: ImportRunSummary }>(response);
  return payload.run;
};

/** Saves (or adds a new version to) a paired GL + Bank mapping profile. */
export const saveMappingProfileRequest = async (
  payload: MappingProfileSavePayload,
): Promise<MappingProfileSaveResult> => {
  const response = await apiFetch('/api/mapping/profiles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return parseResponse<MappingProfileSaveResult>(response);
};

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
  const response = await apiFetch(
    `/api/reconciliation/${encodeURIComponent(runId)}/reviewer-decisions`,
  );
  return parseResponse<ReviewerDecision[]>(response);
};

/** Persists a single reviewer decision for a run target and returns the saved record. */
export const saveReviewerDecisionRequest = async (
  runId: string,
  input: ReviewerDecisionInput,
): Promise<ReviewerDecision> => {
  const response = await apiFetch(
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

/** Clears a reviewer decision for a run target, returning it to an undecided state. */
export const deleteReviewerDecisionRequest = async (
  runId: string,
  targetId: string,
  targetType: ReviewerDecisionTargetType = 'ExceptionItem',
): Promise<void> => {
  const response = await apiFetch(
    `/api/reconciliation/${encodeURIComponent(runId)}/reviewer-decisions/${encodeURIComponent(
      targetId,
    )}?targetType=${encodeURIComponent(targetType)}`,
    { method: 'DELETE' },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ message: 'Request failed.' }))) as {
      message?: string;
    };
    throw new Error(payload.message ?? 'Request failed.');
  }
};
