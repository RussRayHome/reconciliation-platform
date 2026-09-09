import type {
  AccountAssignmentConflict,
  ApprovableType,
  ApprovalCountsByGroup,
  ApprovalRow,
  CanonicalField,
  CreateSavedViewInput,
  EntityVerificationStatus,
  ErrorCategory,
  ErrorCode,
  IdentityVerificationStatus,
  MappingProfileSavePayload,
  MappingProfileSaveResult,
  MatchingConfigVersion,
  ReconciliationAccount,
  ReconciliationRunReport,
  RegisterReconciliationAccountInput,
  ReviewerDecision,
  ReviewerDecisionOutcome,
  ReviewerDecisionTargetType,
  RuleCatalogResponse,
  RuleVersionsResponse,
  SavedView,
  SavedViewScope,
  UpdateReconciliationAccountInput,
  UpdateSavedViewInput,
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

/** Error-handling-build-plan.md EH4: thrown for a non-2xx API response instead of a plain `Error`,
 * so callers can branch on `code`/`retryable` rather than parsing `message` text. `code` and
 * `reference` are only present once the API's global error handler starts sending them (EH1/EH3)
 * -- older/uncovered responses still parse fine, just without those fields. */
export class ApiError extends Error {
  /** Registry key from the response body, when the server classified the failure. */
  readonly code?: ErrorCode;
  /** Correlation id for this occurrence, for a support/log lookup. */
  readonly reference?: string;
  /** The HTTP status the server responded with. */
  readonly httpStatus: number;
  /** Whether retrying the same request could plausibly succeed. */
  readonly retryable: boolean;
  /** A-D1 (Issue #338): on a 409 from `POST /api/imports/runs`, the per-file assignment
   * disagreements the operator must confirm or correct. Present only for that case -- everywhere
   * else this stays undefined, and a caller that ignores it loses nothing. */
  readonly conflicts?: AccountAssignmentConflict[];

  /**
   * @param message Authored, user-facing text from the response body.
   * @param httpStatus The HTTP status the server responded with.
   * @param options Optional `code`/`reference`/`retryable` from the response envelope.
   */
  constructor(
    message: string,
    httpStatus: number,
    options: {
      code?: ErrorCode;
      reference?: string;
      retryable?: boolean;
      conflicts?: AccountAssignmentConflict[];
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.code = options.code;
    this.reference = options.reference;
    this.retryable = options.retryable ?? false;
    this.conflicts = options.conflicts;
  }
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ message: 'Request failed.' }))) as {
      message?: string;
      code?: ErrorCode;
      reference?: string;
      retryable?: boolean;
      conflicts?: AccountAssignmentConflict[];
    };
    throw new ApiError(payload.message ?? 'Request failed.', response.status, {
      code: payload.code,
      reference: payload.reference,
      retryable: payload.retryable,
      conflicts: payload.conflicts,
    });
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

/** The linked `reconciliation_job`'s terminal state, matching `ImportRunMatchingJobSummary`
 * (packages/persistence/src/importRunStore.ts). Null until matching has been linked -- see that
 * type's own doc comment for why a live Stage-2 failure often leaves this null and lands in
 * `ImportRunValidationJobSummary.errorSummary` instead (Issue #154). */
export interface ImportRunMatchingJobSummary {
  id: string;
  currentState: string;
  failureCode: string | null;
  failureMessage: string | null;
  completedAt: string | null;
}

/** The run's newest `import_job` row (File Validation's own work unit), matching
 * `ImportRunValidationJobSummary`. Carries the durable Stage-2 failure reason today on the live
 * import-run path (Issue #154). */
export interface ImportRunValidationJobSummary {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  errorSummary: string | null;
  queuedAt: string;
  finishedAt: string | null;
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
  matchingJobId: string | null;
  matchingJob: ImportRunMatchingJobSummary | null;
  validationJob: ImportRunValidationJobSummary | null;
  files: ImportRunFileSummary[];
}

/** The organization's most recent import run regardless of outcome -- the RunBar's durable
 * cross-reload status source (Issue #154). `null` (HTTP 204) when the organization has never
 * submitted a run. Distinct from `getLatestReconciliationRunRequest`, whose response shape can
 * only represent a completed report. */
export const getLatestImportRunRequest = async (): Promise<ImportRunSummary | null> => {
  const response = await apiFetch('/api/imports/runs/latest');
  return (await parseResponse<ImportRunSummary | undefined>(response)) ?? null;
};

/** One `reconciliation_run` row from `GET /api/reconciliation/runs` (PR F.1), matching
 * `PostgresImportRunStore.listRuns`'s lightweight row shape -- not the full `ImportRunSummary`
 * (no files/matchingJob/validationJob). */
export interface ReconciliationRunListItem {
  id: string;
  label: string;
  accountIdentifier: string | null;
  frequency: 'MONTHLY' | 'ANNUAL';
  periodYear: number;
  periodMonth: number | null;
  periodEnd: string | null;
  status: string;
  createdAt: string;
}

/** Unreconciled Item Roll-Forward PR F.1: the prior-runs endpoint the Verdict module's Prior-
 * period comparison slot needs. Every filter is optional; pass whichever you have -- the Verdict
 * module always passes all three (account + the specific prior period it's looking for). Results
 * are newest period first. */
export const listReconciliationRunsRequest = async (filters: {
  accountId?: string;
  periodYear?: number;
  periodMonth?: number;
}): Promise<ReconciliationRunListItem[]> => {
  const params = new URLSearchParams();
  if (filters.accountId !== undefined) params.set('accountId', filters.accountId);
  if (filters.periodYear !== undefined) params.set('periodYear', String(filters.periodYear));
  if (filters.periodMonth !== undefined) params.set('periodMonth', String(filters.periodMonth));

  const response = await apiFetch(`/api/reconciliation/runs?${params.toString()}`);
  const { runs } = await parseResponse<{ runs: ReconciliationRunListItem[] }>(response);
  return runs;
};

/** One account's frozen roll-forward snapshot, matching `PeriodRollforwardSnapshot`
 * (packages/persistence/src/openItemStore.ts). Amounts are signed, matching the underlying
 * items -- not the absolute-value exposure figures `SummaryMetrics` uses elsewhere. */
export interface ReconciliationRunRollforwardSnapshot {
  accountId: string;
  accountIdentifier: string;
  openingCount: number;
  openingAmount: number;
  newCount: number;
  newAmount: number;
  clearedCount: number;
  clearedAmount: number;
  writtenOffCount: number;
  writtenOffAmount: number;
  closingCount: number;
  closingAmount: number;
}

/** Unreconciled Item Roll-Forward PR F.2. `snapshots` is empty for a run that was never closed --
 * `reconciliation_period_rollforward` rows only exist post-close (PR E.2). */
export const getReconciliationRunRollforwardRequest = async (
  runId: string,
): Promise<{ snapshots: ReconciliationRunRollforwardSnapshot[] }> => {
  const response = await apiFetch(`/api/reconciliation/runs/${runId}/rollforward`);
  return parseResponse<{ snapshots: ReconciliationRunRollforwardSnapshot[] }>(response);
};

/** One row from `GET /api/reconciliation/open-items` (PR F.4), matching
 * `PostgresOpenItemStore.listOpenItemsSchedule`'s return shape. `ownerUsername`/`dueDate` are
 * always undefined today -- nothing in the app assigns them yet; this is a read-only view. */
export interface OpenItemScheduleRow {
  id: string;
  accountIdentifier: string;
  sourceSystem: string;
  category: ErrorCategory;
  status: string;
  naturalKey: string;
  naturalKeyTier: number;
  originalTransactionDate: string;
  amount: number;
  checkNumber?: string;
  referenceNumber?: string;
  descriptionSnapshot?: string;
  ageInDays: number;
  ownerUsername?: string;
  dueDate?: string;
  dispositionCode?: string;
  dispositionNote?: string;
}

/** Unreconciled Item Roll-Forward PR F.4: the open-items schedule -- the read-only replacement
 * for the spreadsheet support schedule reviewers have been keeping by hand. Every status by
 * default; narrow with `status` to just OPEN, CLEARED, etc. */
export const listOpenItemsScheduleRequest = async (filters: {
  accountId?: string;
  status?: string;
}): Promise<OpenItemScheduleRow[]> => {
  const params = new URLSearchParams();
  if (filters.accountId !== undefined) params.set('accountId', filters.accountId);
  if (filters.status !== undefined) params.set('status', filters.status);

  const response = await apiFetch(`/api/reconciliation/open-items?${params.toString()}`);
  const { items } = await parseResponse<{ items: OpenItemScheduleRow[] }>(response);
  return items;
};

// ── Bank account registry (A-D1, Issue #338) ──────────────────────────────────────────────────
// A statement can only be assigned to an account registered here. The UI shows friendly labels
// (`formatAccountLabel`) and keeps the account UUID internal, exactly as A-D1 requires.

export const listAccountsRequest = async (
  options: { includeInactive?: boolean } = {},
): Promise<ReconciliationAccount[]> => {
  const query = options.includeInactive ? '?includeInactive=true' : '';
  const response = await apiFetch(`/api/accounts${query}`);
  const { accounts } = await parseResponse<{ accounts: ReconciliationAccount[] }>(response);
  return accounts;
};

export const registerAccountRequest = async (
  input: RegisterReconciliationAccountInput,
): Promise<ReconciliationAccount> => {
  const response = await apiFetch('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseResponse<ReconciliationAccount>(response);
};

export const updateAccountRequest = async (
  accountId: string,
  input: UpdateReconciliationAccountInput,
): Promise<ReconciliationAccount> => {
  const response = await apiFetch(`/api/accounts/${accountId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseResponse<ReconciliationAccount>(response);
};

/**
 * Saved views (Issue #458). These replace `SAVED_VIEWS_STORAGE_KEY` in `exceptionTriage.ts`, which
 * kept views in each browser's own `localStorage` -- per-device, invisible to the server, and with
 * nowhere for the designed "Shared" visibility to live.
 */
export const listSavedViewsRequest = async (
  options: { scope?: SavedViewScope; includeRetired?: boolean } = {},
): Promise<SavedView[]> => {
  const query = new URLSearchParams();
  if (options.scope) query.set('scope', options.scope);
  if (options.includeRetired) query.set('includeRetired', 'true');
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : '';
  const response = await apiFetch(`/api/saved-views${suffix}`);
  const { savedViews } = await parseResponse<{ savedViews: SavedView[] }>(response);
  return savedViews;
};

export const createSavedViewRequest = async (input: CreateSavedViewInput): Promise<SavedView> => {
  const response = await apiFetch('/api/saved-views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const { savedView } = await parseResponse<{ savedView: SavedView }>(response);
  return savedView;
};

export const updateSavedViewRequest = async (
  savedViewId: string,
  input: UpdateSavedViewInput,
): Promise<SavedView> => {
  const response = await apiFetch(`/api/saved-views/${savedViewId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const { savedView } = await parseResponse<{ savedView: SavedView }>(response);
  return savedView;
};

/** The only removal path -- there is no DELETE endpoint. Retiring frees the name for reuse and
 * keeps the row, so a view can be brought back (#396: "Nothing is deleted. It is retired"). */
export const retireSavedViewRequest = async (savedViewId: string): Promise<SavedView> =>
  updateSavedViewRequest(savedViewId, { status: 'RETIRED' });

/** Accounts a filename could refer to. Returns every match -- the caller pre-selects only when
 * there is exactly one, because A-D1 forbids choosing the first of several automatically. */
export const suggestAccountsRequest = async (
  filename: string,
): Promise<{ filenameLastFour: string | null; candidates: ReconciliationAccount[] }> => {
  const response = await apiFetch(`/api/accounts/suggest?filename=${encodeURIComponent(filename)}`);
  return parseResponse<{ filenameLastFour: string | null; candidates: ReconciliationAccount[] }>(
    response,
  );
};

/** Payload for `POST /api/imports/runs`, matching `importRunBodySchema`. `bankFiles` is 1-4 bank
 * account uploads (Issue #153) sent as one repeated `bankFiles` form field, not per-slot names. */
export interface CreateImportRunPayload {
  bankFiles: File[];
  glFile: File;
  /** One assignment per entry of `bankFiles`, in the same order (A-D1, Issue #338). The server
   * rejects a set whose length does not match, so the two are always built together. */
  bankAccountAssignments: BankAccountAssignment[];
  label: string;
  accountIdentifier?: string;
  frequency: 'MONTHLY' | 'ANNUAL';
  periodYear: number;
  periodMonth?: number;
}

/** The operator's explicit choice of account for one uploaded statement. `confirmed` acknowledges
 * a reported filename disagreement; it is never set without the operator acting on the prompt. */
export interface BankAccountAssignment {
  accountId: string;
  confirmed?: boolean;
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
  bankAccountAssignments,
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
  // Multipart carries strings only, so the assignment set travels as JSON alongside the files.
  formData.append('bankAccountAssignments', JSON.stringify(bankAccountAssignments));
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

    // Issue #251: a stall watchdog, not a flat overall timeout -- a large multi-file upload on a
    // slow connection can legitimately take minutes, so any fixed deadline from `send()` risks
    // punishing a transfer that's still actively progressing. Reset on every upload-progress tick
    // instead, so it only fires when *nothing* has happened (no more bytes going out, no response
    // coming back) for the full window -- exactly the failure mode a real hang produces: the
    // observed case had the server log a normal 200 for the create-run request while the XHR's own
    // `load` event simply never fired, leaving this promise (and everything chained after it --
    // the very next line in the mutation always calls `/submit`) pending forever with no error, no
    // retry prompt, and a run stuck permanently in `DRAFT` that `resolveLatestRunPhase` then reads
    // as perpetually "running" for the whole organization.
    const STALL_TIMEOUT_MS = 30_000;
    let timedOut = false;
    let stallTimer: ReturnType<typeof setTimeout>;
    const resetStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        timedOut = true;
        xhr.abort();
      }, STALL_TIMEOUT_MS);
    };
    resetStallTimer();

    xhr.upload.addEventListener('progress', (event) => {
      resetStallTimer();
      if (event.lengthComputable) {
        onProgress?.({ loadedBytes: event.loaded, totalBytes: event.total });
      }
    });

    xhr.addEventListener('load', () => {
      clearTimeout(stallTimer);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as ImportRunSummary);
        } catch {
          reject(new Error('The server returned an unreadable response.'));
        }
        return;
      }

      let message = `Import run creation failed with status ${xhr.status}.`;
      let code: ErrorCode | undefined;
      let reference: string | undefined;
      let retryable: boolean | undefined;
      let conflicts: AccountAssignmentConflict[] | undefined;
      try {
        const body = JSON.parse(xhr.responseText) as {
          message?: string;
          code?: ErrorCode;
          reference?: string;
          retryable?: boolean;
          conflicts?: AccountAssignmentConflict[];
        };
        if (body.message) {
          message = body.message;
        }
        code = body.code;
        reference = body.reference;
        retryable = body.retryable;
        conflicts = body.conflicts;
      } catch {
        // Body wasn't JSON -- keep the status-based fallback message.
      }
      reject(new ApiError(message, xhr.status, { code, reference, retryable, conflicts }));
    });

    xhr.addEventListener('error', () => {
      clearTimeout(stallTimer);
      reject(new Error('Network error while uploading source files.'));
    });

    xhr.addEventListener('abort', () => {
      clearTimeout(stallTimer);
      if (timedOut) {
        reject(new Error('Network error while uploading source files.'));
        return;
      }
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
