import type {
  CanonicalField,
  EntityVerificationStatus,
  ErrorCategory,
  IdentityVerificationStatus,
  MappingProfileSavePayload,
  MappingProfileSaveResult,
  ReconciliationRunReport,
  ReviewerDecision,
  ReviewerDecisionOutcome,
  ReviewerDecisionTargetType,
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
