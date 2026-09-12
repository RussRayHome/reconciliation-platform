import './styles/index.css';
import '@recon/ui/styles.css';

import { type ChangeEvent, type Dispatch, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';
import { SectionCard } from '@recon/ui';
import {
  rolePermissionsByRole,
  userRoles,
  type ApprovalCountsByGroup,
  type CanonicalField,
  type EntityVerificationStatus,
  type IdentityVerificationStatus,
  type ReconciliationAccount,
  type ReviewerDecision,
  type RolePermissions,
  type RuleCatalogResponse,
  type RuleVersionsResponse,
  type UserRole,
} from '@recon/domain';

import { DocsOverview } from './components/DocsOverview';
import { ImportRunApprovalStatus, PendingApprovalsInbox } from './components/ApprovalsPage';
import { ApprovalPolicyPage } from './components/ApprovalPolicyPage';
import { VersionsPage } from './components/VersionsPage';
import { ComingSoonPage } from './components/ComingSoonPage';
import { RunsHomeScreen } from './components/RunsHomeScreen';
import { CreateMappingScreen } from './components/CreateMappingScreen';
import { SignupScreen } from './components/SignupScreen';
import { PlaceholderScreen } from './components/PlaceholderScreen';
import { HelpedLabelField, HelpedSelectField, HelpedTextField } from './components/AppFormFields';
import { MIN_BANK_ACCOUNTS, SourceDropZone } from './components/SourceDropZone';
import { RunSourceRecap } from './components/RunSourceRecap';
import { SourceUnavailableNotice } from './components/SourceUnavailableNotice';
import { SubledgerEntitiesScreen } from './components/SubledgerEntitiesScreen';
import {
  getSourceTab,
  resolveSourceTab,
  sourceTabMeta,
  sourceTabs,
  type SourceTabId,
} from './lib/sourceTabs';
import { RovingTabList } from './components/RovingTabList';
import {
  CloseExportSection,
  type ProgressStep,
  type ProgressStepStatus,
  ReviewSection,
  type RuleVarianceDefaultOverrides,
  RulesCatalogSection,
} from './components/AppWorkspacePanels';
import { RunBar } from './components/RunBar';
import { NavRail } from './components/NavRail';
import { OpenItemsScheduleSection } from './components/OpenItemsScheduleSection';
import kinneyHighlander from './assets/kinney-highlander.png';
import {
  createRuleVersionDraftRequest,
  getApprovalCountsRequest,
  getCanonicalFieldsRequest,
  getLatestImportRunRequest,
  getMappingProfilesRequest,
  getReconciliationRunByIdRequest,
  getRuleVersionsRequest,
  getRulesCatalogRequest,
  loginRequest,
  logoutRequest,
  meRequest,
  publishRuleVersionRequest,
  type ImportRunSummary,
  type ReconciliationRunResponse,
} from './lib/api';
import { resolveLatestRunPhase, type LatestRunPhase } from './lib/latestRunState';
import { subscribeToRunStatus } from './lib/runStatusStream';
import { clearAuthToken, getAuthToken } from './lib/authToken';
import type { AuthenticatedUserSession } from './lib/authSession';
import { resolveEnvironmentPaths } from './lib/environmentPath';
import { routePaths } from './routes/routePaths';
import type { SavedTriageView } from './lib/exceptionTriage';
import { ImportValidationFailedError, useImportRunSubmit } from './hooks/useImportRunSubmit';
import {
  useImportUploadTransfer,
  type ImportUploadTransferState,
} from './hooks/useImportUploadTransfer';
import { useReconciliationAccounts } from './hooks/useReconciliationAccounts';
import { useSubledgerEntityCounts } from './hooks/useSubledgerEntityCounts';
import { useImportPartialAccept } from './hooks/useImportPartialAccept';
import { buildTransferCardProps } from './lib/importUploadProgress';
import { ImportUploadCard } from './components/ImportUploadCard';
import { ImportValidationFailureView } from './components/ImportValidationFailure';
import { BankAccountsScreen } from './components/BankAccountsScreen';
import {
  BANK_TEMPLATE_URL,
  BANK_TEMPLATE_XLSX_URL,
  GL_TEMPLATE_URL,
  GL_TEMPLATE_XLSX_URL,
} from './lib/templates';
import { useReviewerDecisions } from './hooks/useReviewerDecisions';
import { useDensity } from './hooks/useDensity';
import { useWatchlist } from './hooks/useWatchlist';
import { usePriorPeriodRollforward } from './hooks/usePriorPeriodRollforward';

type ReconciliationFrequency = 'Monthly' | 'Annual';
type ReconciliationModel = ReturnType<typeof useImportRunSubmit>;
type UploadTransferModel = ReturnType<typeof useImportUploadTransfer>;
type PartialAcceptModel = ReturnType<typeof useImportPartialAccept>;
// R2 V1: this used to derive from `ReconciliationModel['data']` directly, which kept it in sync
// for free as long as the mutation always resolved to a full report. Now that a queued submission
// resolves to a non-report variant too, deriving it that way would make `RunData` (a materialized
// report, used for persistence and every "the run is done" render path) silently include the
// queued shape. Pin it to the report type explicitly instead.
type RunData = ReconciliationRunResponse;

type SelectOption = {
  value: string;
  label: string;
};

const LAST_SUCCESSFUL_RUN_STORAGE_KEY = 'reconciliation-platform:latest-report-run';
// Bump this whenever a change to display wording, category labels, or the RunData shape would
// make a previously-persisted run render stale or incorrect content (e.g. the QBO->GL rename) --
// loadPersistedRun() discards anything stored under a different version instead of trusting it.
// Bumped 3->4 for Issue #154: one-time insurance so a browser carrying a pre-fix stale success
// starts clean on first load after deploy, rather than relying solely on the new eviction path.
const RUN_STORAGE_SCHEMA_VERSION = 4;
const AUTHENTICATED_USER_STORAGE_KEY = 'reconciliation-platform:authenticated-user';
const SLIDER_DEFAULTS_STORAGE_KEY = 'reconciliation-platform:slider-defaults';
const SLIDER_DEFAULTS_UPDATED_AT_KEY = 'reconciliation-platform:slider-defaults-updated-at';
const invalidLoginMessage = 'Invalid username or password. Try again.';

const roleDisplayLabels: Record<UserRole, string> = {
  'financial-analyst': 'Financial Analyst',
  'senior-analyst': 'Senior Analyst',
  'staff-accountant': 'Staff Accountant',
  controller: 'Controller',
  'vp-finance': 'VP Finance',
  cfo: 'CFO',
  coo: 'COO',
  ceo: 'CEO',
  admin: 'Admin',
  superuser: 'SuperUser',
};


const monthsWithinYear = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const reconciliationFrequencyOptions: ReadonlyArray<SelectOption> = [
  { value: 'Monthly', label: 'Monthly' },
  { value: 'Annual', label: 'Annual' },
];

const loadPersistedRun = (): RunData | undefined => {
  try {
    const storedRun = globalThis.localStorage?.getItem(LAST_SUCCESSFUL_RUN_STORAGE_KEY);

    if (!storedRun) {
      return undefined;
    }

    const parsed = JSON.parse(storedRun) as { version?: number; run?: RunData };

    if (parsed?.version !== RUN_STORAGE_SCHEMA_VERSION || !parsed.run) {
      globalThis.localStorage?.removeItem(LAST_SUCCESSFUL_RUN_STORAGE_KEY);
      return undefined;
    }

    return parsed.run;
  } catch {
    return undefined;
  }
};

const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && (userRoles as readonly string[]).includes(value);

/**
 * Reads the last-known session as an optimistic cache for a non-flashing initial render -- the
 * actual identity check happens against /api/auth/me on mount (see the effect in App()), which
 * corrects or evicts this if the token is stale, expired, or the role changed server-side.
 * ADR-0002 step 6: the server is authoritative, this is a display cache, not the source of truth.
 */
const loadAuthenticatedUserSession = (): AuthenticatedUserSession | null => {
  try {
    const serializedSession = globalThis.localStorage?.getItem(AUTHENTICATED_USER_STORAGE_KEY);

    if (serializedSession) {
      const parsedSession = JSON.parse(serializedSession) as AuthenticatedUserSession;
      const username =
        typeof parsedSession.username === 'string' ? parsedSession.username.trim() : '';
      const organizationId =
        typeof parsedSession.organizationId === 'string' ? parsedSession.organizationId : '';

      if (username.length > 0 && isUserRole(parsedSession.role) && organizationId.length > 0) {
        return {
          username,
          role: parsedSession.role,
          organizationId,
          firstName:
            typeof parsedSession.firstName === 'string' ? parsedSession.firstName : undefined,
          lastName: typeof parsedSession.lastName === 'string' ? parsedSession.lastName : undefined,
          // A session cached before this field existed (or a stale value) defaults to
          // pending/unverified -- harmless, since the mount-time /api/auth/me effect corrects it
          // against the live database within moments.
          identityVerificationStatus:
            parsedSession.identityVerificationStatus === 'verified' ? 'verified' : 'pending',
          entityVerificationStatus:
            parsedSession.entityVerificationStatus === 'verified' ||
            parsedSession.entityVerificationStatus === 'failed'
              ? parsedSession.entityVerificationStatus
              : 'pending',
          isFullyVerified: parsedSession.isFullyVerified === true,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
};

const persistAuthenticatedUserSession = (session: AuthenticatedUserSession | null): void => {
  try {
    if (!session) {
      globalThis.localStorage?.removeItem(AUTHENTICATED_USER_STORAGE_KEY);
      return;
    }

    globalThis.localStorage?.setItem(AUTHENTICATED_USER_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage failures so authentication still works in-memory.
  }
};

const loadSliderDefaultOverrides = (): RuleVarianceDefaultOverrides => {
  try {
    const raw = globalThis.localStorage?.getItem(SLIDER_DEFAULTS_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const next: RuleVarianceDefaultOverrides = {};

    for (const [metricId, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        next[metricId] = value;
      }
    }

    return next;
  } catch {
    return {};
  }
};

const persistSliderDefaultOverrides = (overrides: RuleVarianceDefaultOverrides): void => {
  try {
    globalThis.localStorage?.setItem(SLIDER_DEFAULTS_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Ignore storage failures so rule slider defaults still update in-memory.
  }
};

const loadSliderDefaultsUpdatedAt = (): string | null => {
  try {
    return globalThis.localStorage?.getItem(SLIDER_DEFAULTS_UPDATED_AT_KEY) ?? null;
  } catch {
    return null;
  }
};

const persistSliderDefaultsUpdatedAt = (value: string | null): void => {
  try {
    if (!value) {
      globalThis.localStorage?.removeItem(SLIDER_DEFAULTS_UPDATED_AT_KEY);
      return;
    }

    globalThis.localStorage?.setItem(SLIDER_DEFAULTS_UPDATED_AT_KEY, value);
  } catch {
    // Ignore storage failures so threshold-set versioning still works in-memory.
  }
};

const persistRun = (run: RunData): void => {
  try {
    globalThis.localStorage?.setItem(
      LAST_SUCCESSFUL_RUN_STORAGE_KEY,
      JSON.stringify({ version: RUN_STORAGE_SCHEMA_VERSION, run }),
    );
  } catch {
    // Ignore storage failures so reconciliation results still render in-memory.
  }
};

/** Issue #154: called whenever the server's own latest-run answer disagrees with what's cached --
 * a stale successful run must never keep outranking a fresher failure/idle answer just because it
 * happens to already be in localStorage. */
const clearPersistedRun = (): void => {
  try {
    globalThis.localStorage?.removeItem(LAST_SUCCESSFUL_RUN_STORAGE_KEY);
  } catch {
    // Ignore storage failures -- the in-memory state is what actually matters here.
  }
};

const downloadJson = (fileName: string, data: unknown): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

const buildDefaultPeriodLabel = (
  frequency: ReconciliationFrequency,
  month: string,
  year: string,
  currentYear: number,
): string =>
  frequency === 'Annual' ? `Annual Recon for ${year}` : `Monthly Recon for ${month} ${currentYear}`;

const formatElapsedLabel = (elapsedMs: number): string => {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

type RunStatusTone = 'idle' | 'queued' | 'running' | 'complete' | 'error';

const runStatusLabelsByTone: Record<RunStatusTone, string> = {
  idle: 'Idle',
  queued: 'Queued',
  running: 'Running',
  complete: 'Complete',
  error: 'Failed',
};

/** Issue #154: the live-mutation checks (pending/error/hasRun) come first, unchanged, so nothing
 * currently in flight regresses -- only once none of those apply does the durable `latestRunState`
 * phase (which survives a reload; the live checks don't) get a say.
 *
 * R2 V1 (D6): `isQueued` (from the live mutation's own `{kind:'queued'}` result) fills the gap
 * before the durable phase catches up -- a follow-up fetch confirms the backend's real state, a
 * real network round trip with a real gap, and without this the tone would flash `idle` for that
 * gap (worse than the red-pill-on-queued bug this whole package exists to fix). Deliberately
 * checked *after* the durable phase's terminal branches, not before: `reconciliation.data` never
 * resets itself once a mutation resolves, so `isQueued` stays true for the rest of the session
 * unless the user submits again -- if it were checked first, a run that genuinely finished
 * (validation-failed, matching-failed, succeeded) would read `queued` forever once the durable
 * phase caught up. Checking the durable terminal branches first means they always win the moment
 * they're known, and `isQueued` only ever fills the narrow gap before that. */
const resolveRunStatusTone = (
  isPending: boolean,
  hasError: boolean,
  hasRun: boolean,
  isQueued: boolean,
  durablePhaseKind: LatestRunPhase['kind'],
): RunStatusTone => {
  if (isPending) {
    return 'running';
  }

  if (hasError) {
    return 'error';
  }

  if (hasRun) {
    return 'complete';
  }

  if (durablePhaseKind === 'validation-failed' || durablePhaseKind === 'matching-failed') {
    return 'error';
  }

  if (durablePhaseKind === 'succeeded') {
    return 'complete';
  }

  if (isQueued) {
    return 'queued';
  }

  if (durablePhaseKind === 'queued') {
    return 'queued';
  }

  if (durablePhaseKind === 'running') {
    return 'running';
  }

  return 'idle';
};

/** Names *which* engine failed, when the durable phase is the reason the tone is 'error' --
 * `runStatusLabelsByTone`'s generic 'Failed' otherwise applies (e.g. a live mutation error). */
const resolveRunStatusLabel = (tone: RunStatusTone, phaseKind: LatestRunPhase['kind']): string => {
  if (tone === 'error' && phaseKind === 'validation-failed') {
    return 'Validation failed';
  }

  if (tone === 'error' && phaseKind === 'matching-failed') {
    return 'Reconciliation failed';
  }

  return runStatusLabelsByTone[tone];
};

/** R2 V4: the whole point of this package is one new condition -- a run already underway
 * (queued, validating, or matching) blocks Submit run, checked from the durable phase as well as
 * the live mutation. `isPending` alone doesn't cover this: a queued submission resolves without
 * throwing (R2 V1), so `isPending` drops back to `false` while the run is still working, and the
 * old `canSubmit` re-enabled the button mid-flight -- letting one set of files start a second
 * reconciliation attempt. Every other row in the truth table below is either pre-existing
 * behaviour (the first two) or a new label/reason on an already-disabled state (upload in flight),
 * not a new condition. */
type SubmitButtonState = {
  disabled: boolean;
  label: string;
  reason: string | null;
};

const resolveSubmitButtonState = (
  isUploadStepComplete: boolean,
  isAssignmentComplete: boolean,
  isLabelMissing: boolean,
  uploadTransferKind: ImportUploadTransferState['kind'],
  uploadPercent: number | null,
  isPending: boolean,
  isQueued: boolean,
  durablePhaseKind: LatestRunPhase['kind'],
): SubmitButtonState => {
  // What the button SAYS follows the run phase; whether it is ENABLED follows whether the files
  // are actually there. Keeping those separate is the point.
  //
  // "Submit run" in every state, including after a success -- the run-start vocabulary approved on
  // #455. Four labels for one action left a user unable to tell, from the button alone, whether
  // they were about to navigate or start the engine: "New run" navigates, "Submit run" starts it,
  // "Submit accepted rows" completes a partial accept, "Start over" discards a held run.
  //
  // "Start new run" was the fifth variant and appeared on no designed screen. Retiring it also
  // makes the button's accessible name stable, which is what `submitRunButton` in the e2e helpers
  // works around with a structural `form=` locator -- keep that locator regardless, it is strictly
  // more robust than a name match.
  //
  // N4's history is worth preserving: it once bypassed the upload check after a success, because a
  // completed run resets its own slots and the caption regressed. That fixed the caption by
  // switching off the guard, leaving the button live with no files attached -- and the submit
  // handler silently returns in exactly that state, so the click did nothing and said nothing.
  // Label and enablement stay separate here for that reason; only the label set has narrowed.
  const resolvePhaseLabel = (): string => {
    if (durablePhaseKind === 'validation-failed' || durablePhaseKind === 'matching-failed') {
      return 'Retry run';
    }
    return 'Submit run';
  };
  const phaseLabel = resolvePhaseLabel();

  if (!isUploadStepComplete) {
    return {
      disabled: true,
      label: phaseLabel,
      reason: 'Add every bank statement and the GL workbook to enable.',
    };
  }

  // After the files are present but before anything else: an unassigned statement is a missing
  // input, not a configuration problem, so it reads in the same breath as the upload check above.
  if (!isAssignmentComplete) {
    return {
      disabled: true,
      label: phaseLabel,
      reason: 'Assign every bank statement to a registered account.',
    };
  }

  if (isLabelMissing) {
    return {
      disabled: true,
      label: phaseLabel,
      reason: 'Give the run a label — it names every file this run produces.',
    };
  }

  if (uploadTransferKind === 'uploading') {
    return {
      disabled: true,
      label: 'Uploading…',
      reason: uploadPercent === null ? 'Uploading files.' : `Transferring… ${uploadPercent}%.`,
    };
  }

  if (isPending || isQueued || durablePhaseKind === 'queued' || durablePhaseKind === 'running') {
    return {
      disabled: true,
      label: 'Run in progress',
      reason:
        'This run is already underway — submitting again would start a second attempt on the same files.',
    };
  }

  // Nothing blocks submission: same phase-derived caption as the disabled rows above, so the
  // wording never depends on which branch returns it.
  return { disabled: false, label: phaseLabel, reason: null };
};

const resolveRunElapsedMs = (
  run: RunData | undefined,
  isPending: boolean,
  startedAtMs: number | null,
  nowMs: number,
): number | null => {
  if (run) {
    const completedMs = new Date(run.completedAt ?? run.startedAt).getTime();
    const startedMs = new Date(run.startedAt).getTime();

    return Math.max(0, completedMs - startedMs);
  }

  if (isPending && startedAtMs !== null) {
    return Math.max(0, nowMs - startedAtMs);
  }

  return null;
};

const mergeReviewerDecisions = (run: RunData, exceptionDecisions: ReviewerDecision[]): RunData => {
  const nonExceptionDecisions = (run.reviewerDecisions ?? []).filter(
    (decision) => decision.targetType !== 'ExceptionItem',
  );

  return { ...run, reviewerDecisions: [...nonExceptionDecisions, ...exceptionDecisions] };
};

const useSuggestedPeriodLabel = (
  isCustomPeriodLabel: boolean,
  suggestedPeriodLabel: string,
  setPeriodLabel: Dispatch<SetStateAction<string>>,
): void => {
  useEffect(() => {
    if (!isCustomPeriodLabel) {
      setPeriodLabel(suggestedPeriodLabel);
    }
  }, [isCustomPeriodLabel, suggestedPeriodLabel, setPeriodLabel]);
};

function App() {
  const env = import.meta.env as Record<string, unknown>;
  const { docsHref, appHref, isDocsRoute } = resolveEnvironmentPaths(env);

  const [authenticatedUserSession, setAuthenticatedUserSession] =
    useState<AuthenticatedUserSession | null>(() => loadAuthenticatedUserSession());
  const activeUser = authenticatedUserSession;
  const rolePermissions = activeUser ? rolePermissionsByRole[activeUser.role] : null;

  useEffect(() => {
    persistAuthenticatedUserSession(authenticatedUserSession);
  }, [authenticatedUserSession]);

  // ADR-0002 step 6: the cached session above is an optimistic display value; the identity check
  // itself happens here, against the server. A stale/expired/denylisted token gets evicted, and a
  // server-side role change (or an org/tenant change once that lands) is picked up on next load.
  useEffect(() => {
    if (!getAuthToken()) {
      return;
    }

    let cancelled = false;

    void meRequest()
      .then((principal) => {
        if (cancelled) {
          return;
        }

        setAuthenticatedUserSession((previous) => ({
          username: principal.username,
          role: principal.role,
          organizationId: principal.organizationId,
          firstName: principal.firstName || previous?.firstName,
          lastName: principal.lastName || previous?.lastName,
          identityVerificationStatus: principal.identityVerificationStatus,
          entityVerificationStatus: principal.entityVerificationStatus,
          isFullyVerified: principal.isFullyVerified,
        }));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        clearAuthToken();
        setAuthenticatedUserSession(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!activeUser || !rolePermissions) {
    return (
      <BrowserRouter basename={appHref}>
        <Routes>
          <Route
            path={routePaths.login}
            element={
              <LoginShell
                onAuthenticated={(session) => {
                  // Reset the URL to the app root so a fresh authenticated load doesn't
                  // linger on /login (or one of its sub-screens) after signing in.
                  globalThis.history.replaceState(globalThis.history.state, '', appHref);
                  setAuthenticatedUserSession(session);
                }}
              />
            }
          />
          <Route
            path={routePaths.forgotPassword}
            element={<PlaceholderScreen title="Forgot Password" />}
          />
          <Route
            path={routePaths.signup}
            element={
              <SignupScreen
                onAuthenticated={(session) => {
                  globalThis.history.replaceState(globalThis.history.state, '', appHref);
                  setAuthenticatedUserSession(session);
                }}
              />
            }
          />
          <Route
            path={routePaths.support}
            element={<PlaceholderScreen title="Contact Support" />}
          />
          <Route path="*" element={<Navigate to={routePaths.login} replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  const displayName = [authenticatedUserSession?.firstName, authenticatedUserSession?.lastName]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0)
    .join(' ');

  const handleSignOut = (): void => {
    setAuthenticatedUserSession(null);
    void logoutRequest();
  };

  const controls = (
    <UserRoleControls
      activeUser={activeUser}
      rolePermissions={rolePermissions}
      displayName={displayName.length > 0 ? displayName : undefined}
      onSignOut={handleSignOut}
    />
  );

  if (!rolePermissions.canAccessApplication && !isDocsRoute) {
    return (
      <AccessDeniedShell
        title="Application access restricted"
        description="Your role does not include the reconciliation workspace. Use the Documentation link for your assigned scope."
        docsHref={docsHref}
        controls={controls}
      />
    );
  }

  if (!rolePermissions.canAccessDocumentation && isDocsRoute) {
    return (
      <AccessDeniedShell
        title="Documentation access restricted"
        description="Your role does not include the Documentation Hub in this environment."
        appHref={appHref}
        controls={controls}
      />
    );
  }

  if (isDocsRoute) {
    return (
      <DocsOverview appHref={appHref} docsHref={docsHref} controls={controls} />
    );
  }

  return (
    <BrowserRouter basename={appHref}>
      <ReconciliationApp
        docsHref={docsHref}
        rolePermissions={rolePermissions}
        isAdmin={activeUser.role === 'admin' || activeUser.role === 'superuser'}
        username={activeUser.username}
        profileLabel={displayName.length > 0 ? displayName : activeUser.username}
        roleLabel={roleDisplayLabels[activeUser.role]}
        onSignOut={handleSignOut}
        isFullyVerified={activeUser.isFullyVerified}
        identityVerificationStatus={activeUser.identityVerificationStatus}
        entityVerificationStatus={activeUser.entityVerificationStatus}
      />
    </BrowserRouter>
  );
}

function ReconciliationApp({
  docsHref,
  rolePermissions,
  isAdmin,
  username,
  profileLabel,
  roleLabel,
  onSignOut,
  isFullyVerified,
  identityVerificationStatus,
  entityVerificationStatus,
}: Readonly<{
  docsHref: string;
  rolePermissions: RolePermissions;
  isAdmin: boolean;
  username: string;
  profileLabel: string;
  roleLabel: string;
  onSignOut: () => void;
  isFullyVerified: boolean;
  identityVerificationStatus: IdentityVerificationStatus;
  entityVerificationStatus: EntityVerificationStatus;
}>) {
  const currentYear = new Date().getFullYear();
  const previousSevenYears = Array.from({ length: 7 }, (_, index) =>
    String(currentYear - index - 1),
  );
  const defaultMonth = monthsWithinYear[new Date().getMonth()] ?? 'January';
  // Issue #153: 1-4 bank accounts per run. Starts at two empty slots (the common case, and the
  // prior fixed layout); "Add another" appends a slot (capped at MAX_BANK_ACCOUNTS), a per-slot
  // remove control removes one (floored at MIN_BANK_ACCOUNTS).
  const [bankFiles, setBankFiles] = useState<(File | null)[]>([null, null]);
  // A-D1 (Issue #338): the account each bank slot's statement is explicitly assigned to. Same
  // length and index as `bankFiles` -- SourceDropZone maintains both together when a slot is added
  // or removed, so `bankAccountIds[i]` always belongs to `bankFiles[i]`.
  const [bankAccountIds, setBankAccountIds] = useState<(string | null)[]>([null, null]);
  const [glFile, setGlFile] = useState<File | null>(null);
  // R1 WP2/WP4: 1-4 AP/Billing entity ledgers per run, same cardinality/slot-growth shape as
  // bankFiles above (MIN/MAX_AP_ENTITIES). Starts at one empty slot -- unlike bank's two, since a
  // single-entity AP subledger export is the common case.
  const [accountIdentifier, setAccountIdentifier] = useState('');
  const [reconciliationFrequency, setReconciliationFrequency] =
    useState<ReconciliationFrequency>('Monthly');
  const [annualYear, setAnnualYear] = useState(previousSevenYears[0] ?? '');
  const [monthlyMonth, setMonthlyMonth] = useState(defaultMonth);
  const [isCustomPeriodLabel, setIsCustomPeriodLabel] = useState(false);
  const [hasDownloadedWorkbook, setHasDownloadedWorkbook] = useState(false);
  const [hasExportedJson, setHasExportedJson] = useState(false);
  const navigate = useNavigate();
  /** README 1a's header pill. A capability, not a bare role: the screen's whole question is
   * whether this person may start a run, and "Senior analyst" alone does not answer it —
   * `canSubmitImportRuns` is a deliberate product decision ("file reconciliation should stay with
   * the senior Financial analyst"), so the pill states the consequence rather than the title.
   * Uses the existing `roleDisplayLabels` vocabulary rather than reformatting the role id. */
  const capabilityLabel = `${roleLabel}${
    rolePermissions.canSubmitImportRuns ? ' · can submit runs' : ' · read only'
  }`;

  const location = useLocation();
  /** The source tab is URL state, not route state (Phase 2): `?source=` keeps a tab linkable
   * without making it a navigation decision, which is why the five tabs share one route. An
   * unrecognised value falls back rather than rendering a blank panel. */
  const activeSourceType = resolveSourceTab(new URLSearchParams(location.search).get('source'));
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [pendingSavedViewId, setPendingSavedViewId] = useState<string | null>(null);
  const [persistedRun, setPersistedRun] = useState<RunData | undefined>(() => loadPersistedRun());
  // Issue #154: the RunBar's durable, cross-reload source of truth -- populated by one ungated
  // mount-time fetch of the organization's actual latest run (see the effect below), independent
  // of whether a live mutation is currently in memory.
  const [latestImportRun, setLatestImportRun] = useState<ImportRunSummary | null>(null);
  const [isHydratingLatestBackendReport, setIsHydratingLatestBackendReport] = useState(false);
  const [latestBackendReportError, setLatestBackendReportError] = useState<string | null>(null);
  const [varianceDefaultOverrides, setVarianceDefaultOverrides] =
    useState<RuleVarianceDefaultOverrides>(() => loadSliderDefaultOverrides());
  const [varianceOverridesUpdatedAt, setVarianceOverridesUpdatedAt] = useState<string | null>(() =>
    loadSliderDefaultsUpdatedAt(),
  );
  const [ruleVersions, setRuleVersions] = useState<RuleVersionsResponse | null>(null);
  const [approvalCounts, setApprovalCounts] = useState<ApprovalCountsByGroup | null>(null);
  const [ruleVersionActionError, setRuleVersionActionError] = useState<string | null>(null);
  const [rulesCatalogData, setRulesCatalogData] = useState<RuleCatalogResponse | null>(null);
  const [rulesCatalogError, setRulesCatalogError] = useState<string | null>(null);
  const [mappingProfileNames, setMappingProfileNames] = useState<string[]>([]);
  const [periodLabel, setPeriodLabel] = useState(
    buildDefaultPeriodLabel('Monthly', defaultMonth, annualYear, currentYear),
  );
  const [runStartedAtMs, setRunStartedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const reconciliation = useImportRunSubmit();
  const uploadTransfer = useImportUploadTransfer(reconciliation);
  const partialAccept = useImportPartialAccept();
  // A-D1 (Issue #338): active accounts only. A deactivated account cannot receive a statement, so
  // offering one in the assignment control would only produce a rejection at submit.
  const accounts = useReconciliationAccounts();
  // #400: the rail's AP/AR badges. Mount-scoped by decision -- the rail renders on every in-app
  // screen, so anything per-navigation would put two requests behind every click.
  const subledgerEntityCounts = useSubledgerEntityCounts();
  // R2 V1: `reconciliation.data` is now `{kind:'queued', run} | {kind:'succeeded', report}` --
  // unwrap to the exact `ReconciliationRunResponse | undefined` every existing consumer of `run`/
  // `reportRun` below already expects, so this is the only place that needs to know about the new
  // shape. The queued case has no report yet; see `submittedQueuedRun` for what a queued
  // submission does carry. Narrowed via plain `&&`, not `?.`, so TypeScript discriminates the
  // union reliably rather than leaking the `queued` member into `run`'s inferred type.
  const submittedResult = reconciliation.data;
  const submittedReport =
    submittedResult && submittedResult.kind === 'succeeded' ? submittedResult.report : undefined;
  const submittedQueuedRun =
    submittedResult && submittedResult.kind === 'queued' ? submittedResult.run : undefined;
  const run = partialAccept.data ?? submittedReport;
  const reportRun = run ?? persistedRun;
  // Unreconciled Item Roll-Forward PR F.3: same reportRun-then-latestImportRun precedence the
  // RunBar itself already uses (runBarAccountIdentifier, below) -- they represent the same
  // underlying run in the common case, latestImportRun is just the durable fallback source.
  const priorPeriodRollforward = usePriorPeriodRollforward({
    accountIdentifier: reportRun?.accountIdentifier ?? latestImportRun?.accountIdentifier ?? undefined,
    periodYear: latestImportRun?.periodYear,
    periodMonth: latestImportRun?.periodMonth,
    frequency: latestImportRun?.frequency,
  });
  // Issue #154: the mount-time hydration effect below is async and only runs once -- if it
  // resolves *after* a live submission has already succeeded (a real race, not hypothetical: the
  // background fetch started at mount, a user's own submission can easily finish after it), its
  // stale "nothing to report yet" answer must never overwrite the fresh, correct result. A ref
  // (not `run` itself, which the effect's closure captured as null at mount) lets that check see
  // the latest value regardless of when the effect's callback actually runs.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  // Issue #154: purely derived from the durable `latestImportRun` fetch -- never gates on or
  // races with `reportRun`, so a failed run's phase is knowable even while `reportRun` is still
  // whatever localStorage happened to have cached.
  const durableRunPhase = useMemo(() => resolveLatestRunPhase(latestImportRun), [latestImportRun]);
  // R2 V1: `submittedQueuedRun` is the DRAFT-time run object from `createImportRunRequest` --
  // taken before `submitImportRunRequest` ran, it has no `validationJob` yet, so pushing it into
  // `latestImportRun` directly would make `resolveLatestRunPhase` read it as `running` (via the
  // DRAFT branch), not `queued`. Re-fetch for real instead, once the live mutation confirms the
  // run actually is queued -- by then the backend's own import_job row exists with a real
  // `validationJob.status: 'QUEUED'`, so this reflects genuine state, not a client-side guess.
  useEffect(() => {
    if (!submittedQueuedRun) {
      return;
    }

    void getLatestImportRunRequest().then((latest) => {
      setLatestImportRun(latest);
    });
  }, [submittedQueuedRun]);
  // R2 V1: leaves the queued/running state on its own once the backend actually finishes, instead
  // of requiring a manual reload (the original complaint -- a queued run's real outcome is often
  // known within a second, but nothing previously re-checked). Stops itself the moment the phase
  // becomes anything else; `durableRunPhase.kind` (a primitive) rather than the object itself is
  // the dependency, so a poll tick that reports the *same* kind doesn't restart its own interval.
  useEffect(() => {
    if (durableRunPhase.kind !== 'queued' && durableRunPhase.kind !== 'running') {
      return undefined;
    }

    const intervalId = globalThis.setInterval(() => {
      void getLatestImportRunRequest().then((latest) => {
        setLatestImportRun(latest);
      });
    }, 3000);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [durableRunPhase.kind]);

  // Issue #268: the queued (async) path's missing final step. `useImportRunSubmit` resolves as
  // `{kind:'queued'}` the moment `/submit` returns 202 and deliberately never fetches a report,
  // and the poll effect above only refreshes `latestImportRun` before clearing its own interval
  // once the phase turns terminal. That left `succeeded` as the one terminal phase nothing ever
  // acted on: the report fetch lived solely in the mount-once hydration effect below, which for a
  // run submitted *during* this session already ran (against an org that had no run yet) and
  // never runs again. The result was a finished run still rendering `currentProgressStep`'s
  // in-progress label -- while `resolveRunStatusTone` read the same durable phase as 'complete'
  // -- until the user manually reloaded.
  //
  // Keyed on the matching job id, not a boolean: that dedupes repeat renders and concurrent
  // ticks for the same run while still letting a genuinely different run (a resubmit in the same
  // session) fetch its own report.
  const fetchedReportMatchingJobIdRef = useRef<string | null>(null);
  const succeededMatchingJobId =
    durableRunPhase.kind === 'succeeded' ? durableRunPhase.matchingJobId : null;
  // Issue #293: the guard asks whether the report currently held is for THIS succeeded run -- not
  // whether any report is held at all. On the queued path `run` is undefined, so `reportRun` falls
  // through to `persistedRun`, the PREVIOUS run's report; a `Boolean(reportRun)` guard then read
  // as "already have it" and the new run's report was never fetched, leaving the screen on the
  // stale one until a manual reload. #268 covered the no-report-held case; this is the companion
  // where a stale one is held. The sync path is unaffected either way: its live `run` carries the
  // new id, so this is true and no redundant fetch is scheduled.
  const heldReportIsForSucceededRun = reportRun?.id === succeededMatchingJobId;
  useEffect(() => {
    if (!succeededMatchingJobId || heldReportIsForSucceededRun) {
      return undefined;
    }

    if (fetchedReportMatchingJobIdRef.current === succeededMatchingJobId) {
      return undefined;
    }
    fetchedReportMatchingJobIdRef.current = succeededMatchingJobId;

    let cancelled = false;

    void getReconciliationRunByIdRequest(succeededMatchingJobId)
      .then((report) => {
        // Same precedence the mount hydration applies: a live mutation's own result is always
        // fresher than this background fetch, whichever of the two settles second.
        if (cancelled || runRef.current) {
          return;
        }

        setPersistedRun(report);
        persistRun(report);
        setLatestBackendReportError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        // Release the dedupe key so a transient network failure can't permanently suppress the
        // report -- the RunBar's own `onRefreshDurableRun` re-reports the same phase, which is
        // what gives the user a way to retry without reloading.
        fetchedReportMatchingJobIdRef.current = null;
        setLatestBackendReportError(
          error instanceof Error
            ? error.message
            : 'Unable to load the completed reconciliation run.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [succeededMatchingJobId, heldReportIsForSucceededRun]);
  // Issue #154 (live status push, Pub/Sub not polling): the last statusMessage received over the
  // run's live NDJSON stream, replacing the generic progress-step label with real step-by-step
  // text while a run is actually in flight. Reset (not just left stale) whenever the phase leaves
  // 'running' or the run identity changes, so a message from a previous run can never leak into
  // the next one's banner.
  const [liveStatusMessage, setLiveStatusMessage] = useState<string | null>(null);
  const runningRunId = durableRunPhase.kind === 'running' ? durableRunPhase.run.id : null;
  useEffect(() => {
    setLiveStatusMessage(null);
    if (!runningRunId) {
      return;
    }

    const unsubscribe = subscribeToRunStatus(runningRunId, (message) => {
      setLiveStatusMessage(message.statusMessage);
    });

    return unsubscribe;
  }, [runningRunId]);
  const reportRunExceptionIds = useMemo(
    () => new Set((reportRun?.exceptions ?? []).map((exception) => exception.id)),
    [reportRun],
  );
  const reviewerDecisions = useReviewerDecisions(
    reportRun?.id ?? null,
    reportRun?.reviewerDecisions,
    reportRunExceptionIds,
  );
  // UI-10 (#449): a second instance for pairings. One run carries both kinds of decision, and they
  // are independent verdicts -- confirming a pairing says nothing about an exception -- so they get
  // their own map rather than sharing one keyed by id. The hook filters its seed by target type,
  // which is what keeps the two from reading each other's decisions.
  const matchDecisions = useReviewerDecisions(
    reportRun?.id ?? null,
    reportRun?.reviewerDecisions,
    undefined,
    'ProbableMatch',
  );
  const { starredIds, toggleStar } = useWatchlist(reportRun?.id);
  const { density, setDensity } = useDensity(username);

  const suggestedPeriodLabel = useMemo(
    () => buildDefaultPeriodLabel(reconciliationFrequency, monthlyMonth, annualYear, currentYear),
    [reconciliationFrequency, monthlyMonth, annualYear, currentYear],
  );

  useSuggestedPeriodLabel(isCustomPeriodLabel, suggestedPeriodLabel, setPeriodLabel);

  useEffect(() => {
    persistSliderDefaultOverrides(varianceDefaultOverrides);
  }, [varianceDefaultOverrides]);

  // The rail's "Pending approvals" badge is App state. It refetches on every route change and,
  // via onApprovalStateChange handed to the inbox, after every approval decision -- before that
  // nonce existed, approving a run on /approvals left the badge on the old count until the user
  // navigated somewhere else, because location.pathname was the effect's only trigger.
  const [approvalCountsRefreshNonce, setApprovalCountsRefreshNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void getApprovalCountsRequest()
      .then((counts) => {
        if (!cancelled) {
          setApprovalCounts(counts);
        }
      })
      .catch(() => {
        // Non-fatal: the rail badges just stay hidden until the next successful fetch.
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, approvalCountsRefreshNonce]);

  const isOnRulesRoute = location.pathname === routePaths.mappingRules;

  useEffect(() => {
    if (!isOnRulesRoute) {
      return;
    }

    let cancelled = false;
    setRuleVersionActionError(null);
    void getRuleVersionsRequest()
      .then((data) => {
        if (!cancelled) {
          setRuleVersions(data);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRuleVersionActionError(
            error instanceof Error ? error.message : 'Unable to load matching-rule versions.',
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOnRulesRoute]);

  useEffect(() => {
    if (!isOnRulesRoute) {
      return;
    }

    let cancelled = false;
    void getMappingProfilesRequest()
      .then((names) => {
        if (!cancelled) {
          setMappingProfileNames(names);
        }
      })
      .catch(() => {
        // Non-fatal: the rule grid's ASSIGNED TO column just shows "No profiles yet" instead.
      });

    return () => {
      cancelled = true;
    };
  }, [isOnRulesRoute]);

  useEffect(() => {
    // Fetched once at mount, not gated by route: NavRail needs the family/fixed counts for its
    // Matching Rules sub-items on every page, not just while /mapping/rules is open.
    let cancelled = false;
    setRulesCatalogError(null);
    void getRulesCatalogRequest()
      .then((data) => {
        if (!cancelled) {
          setRulesCatalogData(data);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRulesCatalogError(
            error instanceof Error ? error.message : 'Unable to load the rule catalog.',
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (run) {
      setPersistedRun(run);
      persistRun(run);
      setLatestBackendReportError(null);
      setIsHydratingLatestBackendReport(false);
      // A completed run's upload slots must not keep showing the just-submitted files -- otherwise
      // navigating back to Import Files (browser back, not a fresh landing) shows stale filenames
      // that read as "not yet submitted" even though the Submit button correctly says "Start new
      // run". Reset to the same empty shape SourceUploadSection expects for a clean slate.
      setBankFiles([null, null]);
      setGlFile(null);
      void navigate(routePaths.reconSummary);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate identity is stable per React Router.
  }, [run]);

  // N4: "/" resolves to the active run on a genuine initial landing (a fresh page load), not on
  // every later visit -- clicking Import Files in the rail after a run has succeeded must always
  // actually land there, not bounce straight back to the run it just finished. Consumed exactly
  // once, from inside the hydration effect below (the durable phase isn't known until that async
  // fetch settles -- checking it synchronously at mount would only ever see 'idle', since
  // `latestImportRun` itself starts out null). window.location, not the `location` object from
  // useLocation(): the object closed over by this effect's `[]`-deps callback would still read
  // wherever the user was AT MOUNT, not wherever they've actually navigated to by the time this
  // async check fires a few hundred ms later.
  const hasAppliedInitialLanding = useRef(false);
  const applyInitialLanding = (phaseKind: LatestRunPhase['kind']): void => {
    if (hasAppliedInitialLanding.current) {
      return;
    }
    hasAppliedInitialLanding.current = true;

    if (window.location.pathname !== routePaths.runsHome || window.location.search) {
      return;
    }

    // UI-4 (#403) inverted this. '/' used to be the import screen, so a returning user had to be
    // redirected AWAY from a blank upload form to find their own work -- to reconSummary on
    // success, or to Review for an analyst. Runs home now IS that state: the Continue card shows
    // the run's five measures and puts "Resume exceptions" one click away, which is the thing
    // those redirects were reaching for.
    //
    // So the only landing rule left is the one the phase explicitly keeps: an organization with
    // no runs at all has nothing for Home to show, and New run is the actionable screen for
    // someone who has not run anything yet.
    //
    // Gated on being able to submit. A read-only role forwarded to New run lands on a screen it
    // cannot act on -- the same dead end #392 just fixed one door down. Home tells them honestly
    // that nothing is waiting, which is the true and useful answer for that account.
    if (phaseKind === 'idle' && rolePermissions.canSubmitImportRuns) {
      void navigate(routePaths.importFiles, { replace: true });
    }
  };

  // Issue #154: runs once per mount, never gated on `persistedRun` -- that gate was the bug (a
  // stale cached success silently suppressed ever checking the server again). Always asks the
  // server for the organization's actual latest run and lets it decide what, if anything, the
  // RunBar should show; a stale success is only ever kept when the server genuinely agrees with
  // it (the 'succeeded' branch below) or when the fetch itself fails (network hiccup -- keep
  // showing a possibly-stale-but-real report rather than blanking it).
  useEffect(() => {
    let cancelled = false;
    setIsHydratingLatestBackendReport(true);
    setLatestBackendReportError(null);

    void getLatestImportRunRequest()
      .then(async (latest) => {
        if (cancelled || runRef.current) {
          // A live submission has already succeeded since this fetch started -- its fresh result
          // always wins over this background fetch's now-stale answer, regardless of which
          // settles second.
          return;
        }

        setLatestImportRun(latest);
        const phase = resolveLatestRunPhase(latest);

        if (phase.kind === 'succeeded') {
          const report = await getReconciliationRunByIdRequest(phase.matchingJobId);
          if (cancelled || runRef.current) {
            return;
          }
          setPersistedRun(report);
          persistRun(report);
          setLatestBackendReportError(null);
          applyInitialLanding(phase.kind);
          return;
        }

        // Anything other than a confirmed success -- idle, running, or either failure phase --
        // must not be shadowed by an older cached success.
        setPersistedRun(undefined);
        clearPersistedRun();
        setLatestBackendReportError(null);
        applyInitialLanding(phase.kind);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setLatestBackendReportError(
          error instanceof Error ? error.message : 'Unable to load the latest reconciliation run.',
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsHydratingLatestBackendReport(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // Intentionally runs once on mount only, same reasoning as hasAppliedInitialLanding's own
    // comment above; applyInitialLanding is deliberately excluded so this effect's identity
    // doesn't change across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Old bookmarks/shared links encoded destination as `?tab=...&view=...` on the root path
   * rather than a distinct pathname. Translate them to real routes once on landing.
   *
   * UI-4 (#403): keyed on `runsHome`, not `importFiles`. Those links were written when '/' WAS the
   * import screen, so they arrive at the root path -- which is now Home. Following `importFiles`
   * when it moved to /runs/new would have quietly stopped honouring every one of them.
   */
  useEffect(() => {
    if (location.pathname !== routePaths.runsHome) {
      return;
    }

    const params = new URLSearchParams(location.search);
    const legacyTab = params.get('tab');
    const legacyView = params.get('view');

    if (legacyTab === 'review') {
      const target =
        legacyView === 'probable-matches'
          ? routePaths.probableMatches
          : legacyView === 'exceptions'
            ? routePaths.exceptions
            : routePaths.reconSummary;
      void navigate(target, { replace: true });
      return;
    }

    if (legacyTab === 'close') {
      void navigate(routePaths.export, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const goToImportFiles = (): void => {
    void navigate(routePaths.importFiles);
  };

  const handleApplySavedView = (view: SavedTriageView): void => {
    setPendingSavedViewId(view.id);
    void navigate(routePaths.exceptions);
  };

  // Creates a new DRAFT matching-config version from the locally-staged slider overrides.
  // Deliberately does not touch varianceDefaultOverrides/localStorage -- the draft becomes the
  // record of "what's proposed," independent of this browser's local scratch state. Publishing
  // the draft (a separate, not-yet-built step) is what would make it ACTIVE.
  const handleEditAsDraft = (): void => {
    if (!rolePermissions.canAdjustSliderDefaults) {
      return;
    }

    setRuleVersionActionError(null);
    void createRuleVersionDraftRequest(varianceDefaultOverrides)
      .then((draft) => {
        setRuleVersions((current) =>
          current ? { ...current, draft, history: [draft, ...current.history] } : current,
        );
      })
      .catch((error: unknown) => {
        setRuleVersionActionError(
          error instanceof Error ? error.message : 'Unable to create a draft version.',
        );
      });
  };

  const handlePublishDraft = (): void => {
    if (!rolePermissions.canAdjustSliderDefaults || !ruleVersions?.draft) {
      return;
    }

    const draftId = ruleVersions.draft.id;
    setRuleVersionActionError(null);
    void publishRuleVersionRequest(draftId)
      .then((activated) => {
        setRuleVersions((current) => {
          if (!current) {
            return current;
          }
          const supersededPrevious = current.active
            ? [{ ...current.active, status: 'SUPERSEDED' as const }]
            : [];
          return {
            ...current,
            active: activated,
            draft: null,
            history: [
              activated,
              ...supersededPrevious,
              ...current.history.filter(
                (version) => version.id !== activated.id && version.id !== current.active?.id,
              ),
            ],
          };
        });
      })
      .catch((error: unknown) => {
        setRuleVersionActionError(
          error instanceof Error ? error.message : 'Unable to publish the draft version.',
        );
      });
  };

  const handleChangeVarianceDefault = (metricId: string, value: number): void => {
    if (!rolePermissions.canAdjustSliderDefaults) {
      return;
    }

    setVarianceDefaultOverrides((current) => ({
      ...current,
      [metricId]: value,
    }));
    const timestamp = new Date().toISOString();
    setVarianceOverridesUpdatedAt(timestamp);
    persistSliderDefaultsUpdatedAt(timestamp);
  };

  const handleResetVarianceDefault = (metricId: string): void => {
    if (!rolePermissions.canAdjustSliderDefaults) {
      return;
    }

    setVarianceDefaultOverrides((current) => {
      const next = { ...current };
      delete next[metricId];

      if (Object.keys(next).length === 0) {
        setVarianceOverridesUpdatedAt(null);
        persistSliderDefaultsUpdatedAt(null);
      } else {
        const timestamp = new Date().toISOString();
        setVarianceOverridesUpdatedAt(timestamp);
        persistSliderDefaultsUpdatedAt(timestamp);
      }

      return next;
    });
  };

  const handleResetVarianceDefaults = (): void => {
    if (!rolePermissions.canAdjustSliderDefaults) {
      return;
    }

    setVarianceDefaultOverrides({});
    setVarianceOverridesUpdatedAt(null);
    persistSliderDefaultsUpdatedAt(null);
  };

  const trimmedPeriodLabel = periodLabel.trim();
  const isLabelMissing = trimmedPeriodLabel.length === 0;
  const hasStartedUploadStep = Boolean(bankFiles.some(Boolean) || glFile);
  // `>= MIN_BANK_ACCOUNTS`, not `> 0`: `[].every(Boolean)` is vacuously TRUE, so an empty
  // bankFiles array would satisfy the rest of this and enable submission with no bank workbook at
  // all. Today SourceDropZone's remove control is hidden at the minimum, so the array cannot empty
  // -- but that makes the guarantee depend on a component elsewhere rather than on this check.
  // Naming the constant states the rule where the rule is enforced.
  const isUploadStepComplete = Boolean(
    bankFiles.length >= MIN_BANK_ACCOUNTS && bankFiles.every(Boolean) && glFile,
  );
  // A-D1: a statement with no account assigned cannot be merged, so the run cannot be submitted.
  // Checked per staged file rather than over the whole array so an empty trailing slot -- which
  // `isUploadStepComplete` already rejects -- doesn't produce a second, redundant reason.
  const isAssignmentComplete = bankFiles.every(
    (file, index) => !file || Boolean(bankAccountIds[index]),
  );
  const isConfigurationStepComplete = isUploadStepComplete && !isLabelMissing;
  const isRunStepComplete = Boolean(run);
  const isExportStepComplete = hasDownloadedWorkbook || hasExportedJson;
  const isExportStepCurrent = isRunStepComplete && !isExportStepComplete;
  // R2 V4: total bytes come from the files actually staged right now -- the upload can't be in
  // flight (uploadTransfer.transfer.kind === 'uploading') without them being exactly what was
  // submitted, since the form is disabled for the whole transfer.
  const totalUploadBytes =
    bankFiles.reduce((sum, file) => sum + (file?.size ?? 0), 0) + (glFile?.size ?? 0);
  const uploadPercent =
    uploadTransfer.transfer.kind === 'uploading' && totalUploadBytes > 0
      ? Math.round((uploadTransfer.transfer.loadedBytes / totalUploadBytes) * 100)
      : null;
  const submitState = resolveSubmitButtonState(
    isUploadStepComplete,
    isAssignmentComplete,
    isLabelMissing,
    uploadTransfer.transfer.kind,
    uploadPercent,
    reconciliation.isPending,
    Boolean(submittedQueuedRun),
    durableRunPhase.kind,
  );

  // R2 V2: the run step's status, in the same precedence order `resolveRunStatusTone` already
  // uses for the RunBar pill (live-in-flight signals before durable ones, durable *terminal*
  // phases before the durable `queued` one) -- two places deriving "what state is this run in"
  // from the same inputs in a different order is how they'd quietly disagree.
  const runStepStatus: ProgressStepStatus = isRunStepComplete
    ? 'complete'
    : reconciliation.isPending
      ? 'current'
      : reconciliation.error
        ? 'failed'
        : durableRunPhase.kind === 'validation-failed' || durableRunPhase.kind === 'matching-failed'
          ? 'failed'
          : submittedQueuedRun || durableRunPhase.kind === 'queued'
            ? 'queued'
            : isConfigurationStepComplete
              ? 'ready'
              : 'pending';

  const progressSteps = useMemo<ProgressStep[]>(
    () => [
      {
        id: 'upload',
        label: 'Upload source files',
        description: 'Select both bank account workbooks and the GL workbook.',
        status: isUploadStepComplete ? 'complete' : hasStartedUploadStep ? 'current' : 'pending',
      },
      {
        id: 'configure',
        label: 'Confirm run settings',
        description: 'Choose frequency/period and provide a reconciliation label.',
        status: isConfigurationStepComplete
          ? 'complete'
          : isUploadStepComplete
            ? 'current'
            : 'pending',
      },
      {
        id: 'run',
        label: 'Run reconciliation',
        description: 'Processing includes parsing, matching, and exception generation.',
        status: runStepStatus,
        detail: run ? `${run.summary.totalRecordsReviewed} records reviewed` : undefined,
      },
      {
        id: 'review-export',
        label: 'Review and export outputs',
        description: 'Review results and export workbook/JSON artifacts.',
        // R2 V2.3: `not-run` only after a *failure* -- a queued run's later step still expects to
        // proceed, so it stays `pending`, never `not-run` (confirmed against the reference design's
        // own per-scenario step arrays: the queued scenario keeps this step `pending`).
        status: isExportStepComplete
          ? 'complete'
          : runStepStatus === 'failed'
            ? 'not-run'
            : isExportStepCurrent
              ? 'current'
              : 'pending',
      },
    ],
    [
      hasStartedUploadStep,
      isConfigurationStepComplete,
      isExportStepComplete,
      isExportStepCurrent,
      isUploadStepComplete,
      run,
      runStepStatus,
    ],
  );

  const currentProgressStep = progressSteps.find((step) => step.status === 'current');
  const runStatusTone = resolveRunStatusTone(
    reconciliation.isPending,
    Boolean(reconciliation.error),
    Boolean(reportRun),
    Boolean(submittedQueuedRun),
    durableRunPhase.kind,
  );
  const runStatusLabel = resolveRunStatusLabel(runStatusTone, durableRunPhase.kind);
  const currentStepLabel = reportRun
    ? 'Reconciliation complete'
    : durableRunPhase.kind === 'validation-failed'
      ? 'File validation failed'
      : durableRunPhase.kind === 'matching-failed'
        ? 'Reconciliation failed'
        : durableRunPhase.kind === 'running' && liveStatusMessage
          ? liveStatusMessage
          : (currentProgressStep?.label ?? 'Ready to run');
  const runElapsedMs = resolveRunElapsedMs(
    reportRun,
    reconciliation.isPending,
    runStartedAtMs,
    nowMs,
  );
  const elapsedLabel = runElapsedMs === null ? null : formatElapsedLabel(runElapsedMs);
  // Issue #154: when there's no live/cached report, fall back to the durable latest-run fetch so
  // a failed run still shows *which* run failed instead of reverting to the blank upload-form
  // state. BANK_MERGED/GL are the two roles that matter to a human reading this list -- the raw
  // BANK_ACCOUNT_1..4 uploads (Issue #153) are audit-only duplicates of what BANK_MERGED already
  // represents merged.
  const runBarSourceFileNames = reportRun
    ? reportRun.sourceFiles.map((file) => file.fileName)
    : latestImportRun
      ? latestImportRun.files
          .filter((file) => file.role === 'BANK_MERGED' || file.role === 'GL')
          .map((file) => file.originalFilename)
      : [...bankFiles.map((file) => file?.name), glFile?.name].filter(
          (name): name is string => Boolean(name),
        );
  const runBarAccountIdentifier =
    reportRun?.accountIdentifier ?? latestImportRun?.accountIdentifier ?? accountIdentifier;
  const runBarFrequency = reportRun?.reconciliationFrequency ?? reconciliationFrequency;
  const appliedVarianceOverrides = reportRun?.appliedVarianceOverrides;
  const rulesUsedCount = reportRun ? Object.keys(appliedVarianceOverrides ?? {}).length : null;
  const reviewProgressLabel = reportRun
    ? `${reviewerDecisions.resolvedCount} of ${reportRun.exceptions.length} resolved · ${reviewerDecisions.researchCount} in research`
    : null;
  const unreviewedExceptionCount = reportRun
    ? Math.max(reportRun.exceptions.length - reviewerDecisions.resolvedCount, 0)
    : null;
  // UI-1 item 4: a rail count must never disagree with its screen, so each badge reads the same
  // source its destination renders from -- not a parallel query that can drift.
  //
  // 7b renders `run.probableMatches` and captions it "Showing N probable matches"; there is no
  // confirm-decision state to subtract yet (#449 builds that flow), so the whole array is the
  // count. `null` rather than 0 before a run exists: #400's approved exception to rule 3 says a
  // badge is absent when there is nothing to decide, never a grey zero.
  const probableMatchCount = reportRun ? reportRun.probableMatches.length : null;
  // 3a's registry. `useReconciliationAccounts()` above defaults to active-only, which is exactly
  // what this badge means -- a deactivated account cannot receive a statement. Null while the
  // registry could not be read at all: "we don't know your accounts" is not "you have none", and
  // showing a confident count over a failed fetch would be the worse of the two errors.
  const activeAccountCount = accounts.error === null ? accounts.accounts.length : null;
  const varianceOverrideCount = Object.keys(varianceDefaultOverrides).length;
  const thresholdSetLabel = varianceOverrideCount > 0 ? 'Custom threshold set' : 'Shipped defaults';
  const thresholdSetTimestamp =
    varianceOverrideCount > 0
      ? (varianceOverridesUpdatedAt?.slice(0, 10) ?? 'This session')
      : 'Not yet customized';

  useEffect(() => {
    if (!reportRun) {
      return;
    }

    persistRun(mergeReviewerDecisions(reportRun, reviewerDecisions.decisions));
  }, [reportRun, reviewerDecisions.decisions]);

  useEffect(() => {
    if (!reconciliation.isPending) {
      return undefined;
    }

    const intervalId = globalThis.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [reconciliation.isPending]);

  const handleSubmit = (event: { preventDefault: () => void }): void => {
    event.preventDefault();

    // R2 V4: `aria-disabled` (not the native `disabled` attribute) is what keeps the button
    // focusable so a screen reader can actually reach its reason -- but aria-disabled doesn't
    // block a real click/submit on its own, so this guard is load-bearing, not defensive
    // decoration. Covers every disabled row in the truth table, including the one this package
    // adds (a run already underway), not just the pre-existing incomplete-upload case.
    if (submitState.disabled) {
      return;
    }
    if (bankFiles.length === 0 || bankFiles.some((file) => !file) || !glFile) {
      return;
    }
    if (bankAccountIds.some((accountId, index) => bankFiles[index] && !accountId)) {
      return;
    }
    const confirmedBankFiles = bankFiles as File[];

    // A-D1: a statement whose filename the server already flagged is resubmitted with an explicit
    // confirmation, and only that one. `confirmed` is never set pre-emptively -- doing so would
    // acknowledge a disagreement the operator has not been shown.
    const confirmedFilenames = new Set(
      uploadTransfer.transfer.kind === 'assignment-conflict'
        ? uploadTransfer.transfer.conflicts.map((conflict) => conflict.originalFilename)
        : [],
    );
    const bankAccountAssignments = confirmedBankFiles.map((file, index) => ({
      accountId: bankAccountIds[index]!,
      confirmed: confirmedFilenames.has(file.name) || undefined,
    }));

    setRunStartedAtMs(Date.now());
    setNowMs(Date.now());
    uploadTransfer.start({
      bankFiles: confirmedBankFiles,
      bankAccountAssignments,
      glFile,
      label: trimmedPeriodLabel,
      accountIdentifier: accountIdentifier || undefined,
      frequency: reconciliationFrequency === 'Annual' ? 'ANNUAL' : 'MONTHLY',
      periodYear: reconciliationFrequency === 'Annual' ? Number(annualYear) : currentYear,
      periodMonth:
        reconciliationFrequency === 'Annual'
          ? undefined
          : monthsWithinYear.indexOf(monthlyMonth) + 1,
    });
  };

  const reviewSectionSharedProps = {
    run: reportRun,
    matchDecisionByTargetId: matchDecisions.decisionByTargetId,
    matchPendingTargetId: matchDecisions.pendingTargetId,
    matchDecisionError: matchDecisions.error,
    onDecideMatch: matchDecisions.decide,
    onClearMatchDecision: matchDecisions.clearDecision,
    priorPeriodRollforward,
    isHydrating: isHydratingLatestBackendReport,
    loadError: latestBackendReportError,
    onGoToSetup: goToImportFiles,
    decisionByTargetId: reviewerDecisions.decisionByTargetId,
    pendingTargetId: reviewerDecisions.pendingTargetId,
    decisionError: reviewerDecisions.error,
    lastChange: reviewerDecisions.lastChange,
    onDecide: reviewerDecisions.decide,
    onClearDecision: reviewerDecisions.clearDecision,
    onUndoLastDecision: reviewerDecisions.undoLastDecision,
    pendingSavedViewId,
    onPendingSavedViewApplied: () => setPendingSavedViewId(null),
    onOpenExceptions: () => navigate(routePaths.exceptions),
    starredIds,
    onToggleStar: toggleStar,
    density,
    onChangeDensity: setDensity,
   
  };

  return (
    <div className="app-shell app-shell--workspace" data-density={density}>
      <div className="hero-backdrop" />
      <NavRail
        unreviewedExceptionCount={unreviewedExceptionCount}
        exceptions={reportRun?.exceptions ?? []}
        onApplySavedView={handleApplySavedView}
        docsHref={docsHref}
        canAccessDocumentation={rolePermissions.canAccessDocumentation}
        canApprove={rolePermissions.canApprove}
        approvalCounts={approvalCounts}
        username={username}
        profileLabel={profileLabel}
        roleLabel={roleLabel}
        onSignOut={onSignOut}
        isMobileOpen={isMobileNavOpen}
        onMobileClose={() => setIsMobileNavOpen(false)}
        matchingRuleTotalCount={rulesCatalogData?.rules.length}
        probableMatchCount={probableMatchCount}
        activeAccountCount={activeAccountCount}
        apEntityCount={subledgerEntityCounts.ap}
        arEntityCount={subledgerEntityCounts.ar}
      />
      <main className="app-layout app-layout--rail">
        <RunBar
          periodLabel={reportRun?.periodLabel ?? latestImportRun?.label ?? periodLabel}
          accountIdentifier={runBarAccountIdentifier}
          sourceFileNames={runBarSourceFileNames}
          frequency={runBarFrequency}
          statusLabel={runStatusLabel}
          statusTone={runStatusTone}
          currentStepLabel={currentStepLabel}
          exceptionCount={reportRun ? reportRun.exceptions.length : null}
          runId={reportRun?.id ?? latestImportRun?.id ?? null}
          elapsedLabel={elapsedLabel}
          isComplete={Boolean(reportRun)}
          onOpenReview={() => navigate(routePaths.reconSummary)}
          onOpenRules={() => navigate(routePaths.mappingRules)}
          rulesUsedCount={rulesUsedCount}
          reviewProgressLabel={reviewProgressLabel}
          progressSteps={progressSteps}
          onToggleNav={() => setIsMobileNavOpen((open) => !open)}
        />

        <section className="tabbed-workspace" aria-label="Reconciliation workspace">
            <Routes>
              <Route
                path={routePaths.runsHome}
                element={
                  <RunsHomeScreen
                    profileLabel={profileLabel}
                    run={reportRun}
                    openExceptionCount={unreviewedExceptionCount}
                    decidedExceptionCount={reviewerDecisions.resolvedCount}
                    approvalCounts={approvalCounts}
                    onApplySavedView={handleApplySavedView}
                  />
                }
              />
              <Route
                path={routePaths.importFilesBank}
                element={
                  <SourceUploadSection
                    activeSourceType={activeSourceType}
                    capabilityLabel={capabilityLabel}
                    annualYear={annualYear}
                    bankFiles={bankFiles}
                    bankAccountIds={bankAccountIds}
                    setBankAccountIds={setBankAccountIds}
                    accounts={accounts.accounts}
                    accountsUnavailable={accounts.error !== null}
                    glFile={glFile}
                    submitState={submitState}
                    currentYear={currentYear}
                    handleSubmit={handleSubmit}
                    isCustomPeriodLabel={isCustomPeriodLabel}
                    isLabelMissing={isLabelMissing}
                    monthlyMonth={monthlyMonth}
                    periodLabel={periodLabel}
                    previousSevenYears={previousSevenYears}
                    reconciliation={reconciliation}
                    reconciliationFrequency={reconciliationFrequency}
                    setAccountIdentifier={setAccountIdentifier}
                    setAnnualYear={setAnnualYear}
                    setBankFiles={setBankFiles}
                    setIsCustomPeriodLabel={setIsCustomPeriodLabel}
                    setMonthlyMonth={setMonthlyMonth}
                    setPeriodLabel={setPeriodLabel}
                    setGlFile={setGlFile}
                    setReconciliationFrequency={setReconciliationFrequency}
                    suggestedPeriodLabel={suggestedPeriodLabel}
                    accountIdentifier={accountIdentifier}
                    uploadTransfer={uploadTransfer}
                    partialAccept={partialAccept}
                    durableRunPhase={durableRunPhase}
                    submittedQueuedRun={submittedQueuedRun}
                    latestImportRunId={latestImportRun?.id ?? null}
                    onDismissDurableRun={() => setLatestImportRun(null)}
                    onRefreshDurableRun={() => {
                      void getLatestImportRunRequest().then((latest) => {
                        setLatestImportRun(latest);
                      });
                    }}
                  />
                }
              />

              {/* UI-2 absorbed AP/Billing into New run as a source tab, so this path no longer
                  renders a screen of its own. Kept as a redirect rather than deleted: it shipped,
                  so bookmarks and any link out there must land on the tab that replaced it instead
                  of the unmatched-route fallback. */}
              <Route
                path={routePaths.importFilesBilling}
                element={<Navigate to={`${routePaths.importFilesBank}?source=ap`} replace />}
              />

              {/* UI-9 (#448): AP and AR registries. `canManage` gates the open-entity panel;
                  13c specifies the non-admin variant REMOVES it rather than disabling it, which is
                  what the screen does. */}
              <Route
                path={routePaths.apEntities}
                element={
                  <SubledgerEntitiesScreen
                    kind="ap"
                    canManage={rolePermissions.canManageAccounts}
                  />
                }
              />
              <Route
                path={routePaths.arEntities}
                element={
                  <SubledgerEntitiesScreen
                    kind="ar"
                    canManage={rolePermissions.canManageAccounts}
                  />
                }
              />

              <Route
                path={routePaths.reconSummary}
                element={<ReviewSection activeView="summary" {...reviewSectionSharedProps} />}
              />
              <Route
                path={routePaths.probableMatches}
                element={
                  <ReviewSection activeView="probable-matches" {...reviewSectionSharedProps} />
                }
              />
              <Route
                path={routePaths.exceptions}
                element={<ReviewSection activeView="exceptions" {...reviewSectionSharedProps} />}
              />

              <Route
                path={routePaths.export}
                element={
                  <CloseExportSection
                    run={reportRun}
                    isHydrating={isHydratingLatestBackendReport}
                    loadError={latestBackendReportError}
                    onDownloadWorkbook={() => setHasDownloadedWorkbook(true)}
                    onGoToSetup={goToImportFiles}
                    onExportJson={() => {
                      if (!reportRun) {
                        return;
                      }

                      setHasExportedJson(true);
                      downloadJson(
                        `${reportRun.id}.json`,
                        mergeReviewerDecisions(reportRun, reviewerDecisions.decisions),
                      );
                    }}
                  />
                }
              />

              <Route
                path={routePaths.openItemsSchedule}
                element={
                  <OpenItemsScheduleSection
                    accountIdentifier={runBarAccountIdentifier || undefined}
                    username={username}
                  />
                }
              />

              <Route
                path={routePaths.mappingProfiles}
                element={
                  <ComingSoonPage
                    title="Mapping Profiles"
                    description="Browsing and managing saved mapping profiles is coming soon."
                  />
                }
              />
              <Route
                path={routePaths.bankAccounts}
                element={
                  <BankAccountsScreen
                    canManage={rolePermissions.canManageAccounts}
                  />
                }
              />
              <Route
                path={routePaths.mappingCreate}
                element={
                  isFullyVerified ? (
                    <CreateMappingScreen />
                  ) : (
                    <MappingVerificationRequiredNotice
                      identityVerificationStatus={identityVerificationStatus}
                      entityVerificationStatus={entityVerificationStatus}
                    />
                  )
                }
              />
              <Route
                path={routePaths.mappingRules}
                element={
                  rulesCatalogError ? (
                    <p role="alert">{rulesCatalogError}</p>
                  ) : !rulesCatalogData ? (
                    <p>Loading rule catalog…</p>
                  ) : (
                    <RulesCatalogSection
                      rules={rulesCatalogData.rules}
                      metrics={rulesCatalogData.metrics}
                      varianceOverrides={varianceDefaultOverrides}
                      canAdjustVarianceDefaults={rolePermissions.canAdjustSliderDefaults}
                      onChangeVarianceDefault={handleChangeVarianceDefault}
                      onResetVarianceDefault={handleResetVarianceDefault}
                      onResetVarianceDefaults={handleResetVarianceDefaults}
                      run={reportRun}
                      thresholdSetLabel={thresholdSetLabel}
                      thresholdSetTimestamp={thresholdSetTimestamp}
                      viewingVersion={ruleVersions?.draft ?? ruleVersions?.active ?? null}
                      overridesAppliedToEngine={ruleVersions?.overridesAppliedToEngine ?? false}
                      onEditAsDraft={handleEditAsDraft}
                      onPublishDraft={handlePublishDraft}
                      versionActionError={ruleVersionActionError}
                      activeVersion={ruleVersions?.active ?? null}
                      mappingProfiles={mappingProfileNames}
                    />
                  )
                }
              />
              <Route
                path={routePaths.mappingHistory}
                element={
                  <ComingSoonPage
                    title="Mapping History"
                    description="A history of past mapping profile changes is coming soon."
                  />
                }
              />
              <Route
                path={routePaths.mappingVersions}
                element={
                  <ComingSoonPage
                    title="Mapping Profile Versions"
                    description="Depends on the Mapping Profiles screen itself, which isn't built yet -- coming soon."
                  />
                }
              />
              <Route path={routePaths.mappingRulesVersions} element={<VersionsPage />} />
              <Route
                path={routePaths.approvals}
                element={
                  <PendingApprovalsInbox
                    canApprove={rolePermissions.canApprove}
                    isAdmin={isAdmin}
                    currentUsername={username}
                    onApprovalStateChange={() => setApprovalCountsRefreshNonce((nonce) => nonce + 1)}
                  />
                }
              />
              {/* N1: the five old per-type routes stay declared for one release as redirects to
                  the object each used to shadow -- never rail-linked again, but no old bookmark
                  or link breaks either. mappingProfile has no real object screen yet (still
                  ComingSoonPage) and no way to generate a row, so it redirects to the inbox
                  itself rather than a screen that doesn't exist. */}
              <Route
                path={routePaths.approvalsImports}
                element={<Navigate to={routePaths.importFilesBank} replace />}
              />
              <Route
                path={routePaths.approvalsMappingProfiles}
                element={<Navigate to={routePaths.approvals} replace />}
              />
              <Route
                path={routePaths.approvalsMatchingRules}
                element={<Navigate to={routePaths.mappingRules} replace />}
              />
              <Route
                path={routePaths.approvalsExceptionResolutions}
                element={<Navigate to={routePaths.exceptions} replace />}
              />
              <Route
                path={routePaths.approvalsReportDistribution}
                element={<Navigate to={routePaths.export} replace />}
              />
              {isAdmin ? (
                <Route path={routePaths.approvalsPolicy} element={<ApprovalPolicyPage />} />
              ) : null}
              <Route
                path={routePaths.accountProfile}
                element={
                  <ComingSoonPage title="Profile" description="Profile settings are coming soon." />
                }
              />
              <Route
                path={routePaths.accountSecurity}
                element={
                  <ComingSoonPage
                    title="Security"
                    description="Security settings are coming soon."
                  />
                }
              />
              <Route
                path={routePaths.accountBilling}
                element={
                  <ComingSoonPage title="Billing" description="Billing details are coming soon." />
                }
              />
              <Route
                path={routePaths.accountNotification}
                element={
                  <ComingSoonPage
                    title="Notification"
                    description="Notification preferences are coming soon."
                  />
                }
              />
              <Route
                path={routePaths.accountPreferences}
                element={
                  <ComingSoonPage
                    title="Preferences"
                    description="Workspace preferences are coming soon."
                  />
                }
              />
              {rolePermissions.canAccessRunBook ? (
                <Route
                  path={routePaths.documentationRunBook}
                  element={
                    <ComingSoonPage
                      title="Run Book"
                      description="A browsable run book for matching and exception rules is coming soon."
                    />
                  }
                />
              ) : null}

              <Route path="*" element={<Navigate to={routePaths.importFiles} replace />} />
            </Routes>
        </section>

        <footer className="page-footer">
          <p>
            Next step: run reconciliation, review probable matches and exceptions, then export
            workbook and JSON for audit files.
          </p>
        </footer>
      </main>
    </div>
  );
}

/** R2 V5.4: queued is a real, working outcome, not a failure -- this panel says so plainly, links
 * to where the run's real status lives today (Approvals › Imported files; the plan's "Pending
 * approvals" unified inbox is N1, a later, separate package -- this route survives that change
 * unmodified, since N1 keeps every legacy `/approvals/*` route alive as a redirect), and admits
 * that live per-record progress for a queued run is a missing view, not something broken. `run` is
 * optional: the live path's `submittedQueuedRun` (the DRAFT-time object) always has one, but the
 * durable path's `queued` phase always does too -- both callers pass a real run in practice, the
 * type just doesn't need to promise it. */
function QueuedRunPanel({
  run,
  onRefresh,
}: Readonly<{ run: ImportRunSummary | undefined; onRefresh: () => void }>) {
  const navigate = useNavigate();

  return (
    <div className="outcome-panel outcome-panel--queued" role="status" aria-live="polite">
      <p className="outcome-panel__title">Queued for validation</p>
      <p className="outcome-panel__body">
        {run ? `“${run.label}” is` : 'This run is'} in the async validation queue. Live
        step-by-step progress for a queued run isn&rsquo;t available in this view yet -- that&rsquo;s
        a missing view, not a failure. The result appears here automatically once it&rsquo;s ready.
      </p>
      <div className="outcome-panel__actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => navigate(routePaths.importFilesBank)}
        >
          Open Imported files
        </button>
        <button type="button" className="secondary-button" onClick={onRefresh}>
          Refresh status
        </button>
      </div>
    </div>
  );
}

/** R2 V5.3: a matching failure states up front that validation passed -- the files are fine, this
 * is a Stage 2 (matching engine) problem the user didn't cause -- and gives a job reference for
 * support, since there's no separate "retry matching" endpoint today (confirmed: none exists).
 * Retrying is the same Submit run button, already relabelled "Retry run" for this phase by V4. */
function MatchingFailurePanel({
  run,
  message,
}: Readonly<{ run: ImportRunSummary; message: string }>) {
  const [copied, setCopied] = useState(false);
  const jobReference = run.matchingJob?.id ?? run.validationJob?.id ?? run.id;

  const handleCopyReference = (): void => {
    const markCopied = (): void => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.writeText) {
      void clipboard
        .writeText(jobReference)
        .then(markCopied)
        .catch(() => {
          // Ignore clipboard failures; the reference stays visible for manual copy.
        });
      return;
    }

    markCopied();
  };

  return (
    <div className="outcome-panel outcome-panel--failed" role="alert">
      <p className="outcome-panel__title">Reconciliation failed for &ldquo;{run.label}&rdquo;</p>
      <p className="outcome-panel__body">
        File validation passed, so the files themselves are fine -- this failed after that, during
        matching. {message}
      </p>
      <p className="outcome-panel__reference">Job reference: {jobReference}</p>
      <div className="outcome-panel__actions">
        <button type="button" className="secondary-button" onClick={handleCopyReference}>
          {copied ? 'Copied' : 'Copy job reference'}
        </button>
      </div>
    </div>
  );
}

function SourceUploadSection({
  activeSourceType,
  capabilityLabel,
  accountIdentifier,
  annualYear,
  bankFiles,
  glFile,
  submitState,
  currentYear,
  handleSubmit,
  isCustomPeriodLabel,
  isLabelMissing,
  monthlyMonth,
  periodLabel,
  previousSevenYears,
  reconciliation,
  reconciliationFrequency,
  setAccountIdentifier,
  setAnnualYear,
  setBankFiles,
  setIsCustomPeriodLabel,
  setMonthlyMonth,
  setPeriodLabel,
  setGlFile,
  setReconciliationFrequency,
  suggestedPeriodLabel,
  uploadTransfer,
  partialAccept,
  durableRunPhase,
  submittedQueuedRun,
  latestImportRunId,
  onDismissDurableRun,
  onRefreshDurableRun,
  bankAccountIds,
  setBankAccountIds,
  accounts,
  accountsUnavailable,
}: Readonly<{
  /** Which Import Files tab is active, driven by the matched route (R1 WP2/WP3) -- not local
   * component state, mirroring how the Reconciliation section's File-based/Rules-based split
   * already works (ReviewSection's `activeView` prop, one <Route> per tab). */
  activeSourceType: SourceTabId;
  /** README 1a's header pill — the signed-in role and what it may do here, e.g.
   * "Senior analyst · can submit runs". A capability, not a bare role: the screen's whole question
   * is whether this person can start a run, and a role name alone does not answer it. */
  capabilityLabel: string;
  accountIdentifier: string;
  annualYear: string;
  bankFiles: (File | null)[];
  /** A-D1 (Issue #338): the registry the assignment control offers, and the per-slot choice made
   * against it. Positional with `bankFiles`. */
  bankAccountIds: (string | null)[];
  setBankAccountIds: Dispatch<SetStateAction<(string | null)[]>>;
  accounts: ReconciliationAccount[];
  accountsUnavailable: boolean;
  glFile: File | null;
  submitState: SubmitButtonState;
  currentYear: number;
  handleSubmit: (event: { preventDefault: () => void }) => void;
  isCustomPeriodLabel: boolean;
  isLabelMissing: boolean;
  monthlyMonth: string;
  periodLabel: string;
  previousSevenYears: string[];
  reconciliation: ReconciliationModel;
  reconciliationFrequency: ReconciliationFrequency;
  setAccountIdentifier: Dispatch<SetStateAction<string>>;
  setAnnualYear: Dispatch<SetStateAction<string>>;
  setBankFiles: Dispatch<SetStateAction<(File | null)[]>>;
  setIsCustomPeriodLabel: Dispatch<SetStateAction<boolean>>;
  setMonthlyMonth: Dispatch<SetStateAction<string>>;
  setPeriodLabel: Dispatch<SetStateAction<string>>;
  setGlFile: Dispatch<SetStateAction<File | null>>;
  setReconciliationFrequency: Dispatch<SetStateAction<ReconciliationFrequency>>;
  suggestedPeriodLabel: string;
  uploadTransfer: UploadTransferModel;
  partialAccept: PartialAcceptModel;
  durableRunPhase: LatestRunPhase;
  submittedQueuedRun: ImportRunSummary | undefined;
  /** N1: the current durable run's id, for ImportRunApprovalStatus -- null when there is none. */
  latestImportRunId: string | null;
  onDismissDurableRun: () => void;
  onRefreshDurableRun: () => void;
}>) {
  const navigate = useNavigate();
  const reconciliationLabelErrorId = 'reconciliation-label-error';
  const reconciliationLabelHintId = 'reconciliation-label-hint';
  const submitButtonReasonId = 'submit-run-reason';

  // R2 V6 (warn-only, Issue #250): fetched once for the per-slot fuzzy header preview
  // (useHeaderPreviewWarning, via SourceDropZone). Mirrors CreateMappingScreen's own fetch of the
  // same endpoint exactly -- an empty array while loading is treated as "nothing to check yet".
  const [canonicalFields, setCanonicalFields] = useState<CanonicalField[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCanonicalFieldsRequest()
      .then((fields) => {
        if (!cancelled) setCanonicalFields(fields);
      })
      .catch(() => {
        // Best-effort heads-up only -- if the canonical schema can't be loaded, the preview
        // simply stays off; the real, authoritative check still happens server-side on submit.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** What this run currently carries, per source type. Read by both the tab meta lines and the
   * IN THIS RUN recap, so the strip and the recap can never disagree about the same run. */
  const attachedBySource: Record<SourceTabId, number> = {
    bank: bankFiles.filter(Boolean).length,
    gl: glFile ? 1 : 0,
    // AP, AR and payroll are always zero: no user action attaches one, so a count would imply an
    // affordance that is not there. They stay in the recap so the run's full shape stays legible.
    ap: 0,
    ar: 0,
    payroll: 0,
  };

  const activeTab = getSourceTab(activeSourceType);

  return (
    <div className="import-screen">
      <header className="import-screen__header">
        <div>
          <p className="import-screen__eyebrow">Runs / New run</p>
          {/* The one permitted use of "reconciliation" on this screen (README 3b rule 2): it names
              the thing once, and every string after this says "run". */}
          <h1 className="import-screen__title">Start a reconciliation run</h1>
          <p className="import-screen__subtitle">
            Attach every source for one period, describe the run, submit.
          </p>
        </div>
      </header>
      {/* N1: "a live object screen shows its own approval state" -- AP/Billing runs aren't part
          of the submit flow yet (see the billing tab's own note below), so this only applies to
          the bank tab, where latestImportRunId actually tracks something. */}
      {activeSourceType === 'bank' ? (
        <ImportRunApprovalStatus runId={latestImportRunId} />
      ) : null}
      <SectionCard
        title="Import source files"
        description="CSV or XLSX. Format is detected by extension; the engine preserves original file names, source line numbers, excluded rows, and normalized audit fields."
        actions={
          <div className="import-screen__header-actions">
            {/* README 1a: the header action row carries the capability pill and Download templates
                — and no primary. Submitting is step 3 at the foot of the left column, because the
                screen argues add sources → describe the run → submit. A submit button up here
                inverts that argument, offering the last step before the first. */}
            <span className="import-screen__capability-pill">
              {capabilityLabel}
            </span>
            <details className="import-screen__templates-menu">
              <summary className="secondary-button">Download templates</summary>
              <div className="import-screen__templates-menu-list">
                <a href={BANK_TEMPLATE_URL} download>
                  Bank template (CSV)
                </a>
                <a href={BANK_TEMPLATE_XLSX_URL} download>
                  Bank template (XLSX)
                </a>
                <a href={GL_TEMPLATE_URL} download>
                  GL template (CSV)
                </a>
                <a href={GL_TEMPLATE_XLSX_URL} download>
                  GL template (XLSX)
                </a>
              </div>
            </details>
          </div>
        }
      >
        {/* One place computing "what this run currently carries", read by both the tab meta lines
            and the IN THIS RUN recap so the two can never disagree. */}
        <RovingTabList<SourceTabId>
          items={sourceTabs.map((tab) => ({
            id: tab.id,
            label: tab.label,
            description: sourceTabMeta(tab, attachedBySource[tab.id]),
            // The same hue RunSourceRecap paints its chips with, so the strip and the
            // "IN THIS RUN" recap identify a source type by the same colour.
            accentToken: tab.hueToken,
          }))}
          activeId={activeSourceType}
          // A tab is URL state, not a route: same screen, `?source=` so it stays linkable.
          // `replace` keeps Back leaving the screen rather than walking the tabs the user clicked.
          onSelect={(id) => navigate(`${routePaths.importFilesBank}?source=${id}`, { replace: true })}
          ariaLabel="Import source type"
          tabIdPrefix="import-tab"
          panelIdPrefix="import-panel"
          listClassName="tab-list"
          tabClassName="tab-button"
          activeTabClassName="tab-button tab-button--active"
        />

        <form
          id="source-upload-form"
          className="import-screen__body"
          aria-busy={reconciliation.isPending}
          onSubmit={handleSubmit}
        >
          {activeSourceType === 'bank' || activeSourceType === 'gl' ? (
            <div
              className="import-screen__upload-column"
              role="tabpanel"
              id={`import-panel-${activeSourceType}`}
              aria-labelledby={`import-tab-${activeSourceType}`}
            >
              {/* An assignment conflict keeps the drop zone mounted rather than swapping in
                  progress cards: the banner below tells the operator to change the assignment, so
                  the slot controls have to still be there to change it in. Nothing was uploaded --
                  the run was rejected before creation -- so there is no progress to show. */}
              {uploadTransfer.transfer.kind === 'idle' ||
              uploadTransfer.transfer.kind === 'assignment-conflict' ? (
                <SourceDropZone
                  mode="bank-gl"
                  only={activeSourceType}
                  bankFiles={bankFiles}
                  glFile={glFile}
                  setBankFiles={setBankFiles}
                  setGlFile={setGlFile}
                  accounts={accounts}
                  bankAccountIds={bankAccountIds}
                  setBankAccountIds={setBankAccountIds}
                  accountsUnavailable={accountsUnavailable}
                  canonicalFields={canonicalFields}
                />
              ) : (
                (() => {
                  // Captured as a local const so TS's discriminated-union narrowing (kind !==
                  // 'idle', from the enclosing ternary) persists into the nested closures below --
                  // narrowing on a property access like `uploadTransfer.transfer.kind` doesn't
                  // survive into a callback the way narrowing on a local variable does.
                  const transfer = uploadTransfer.transfer;
                  return (
                    <div className="import-upload-card-list" aria-label="Upload progress">
                      {bankFiles.map((file, index) => {
                        if (!file) {
                          return null;
                        }
                        const precedingBytes = bankFiles
                          .slice(0, index)
                          .reduce((sum, previousFile) => sum + (previousFile?.size ?? 0), 0);
                        return (
                          <ImportUploadCard
                            key={index}
                            {...buildTransferCardProps(
                              transfer,
                              file,
                              `bank ${index + 1}`,
                              precedingBytes,
                              uploadTransfer.cancel,
                              uploadTransfer.retry,
                            )}
                          />
                        );
                      })}
                      {glFile ? (
                        <ImportUploadCard
                          {...buildTransferCardProps(
                            transfer,
                            glFile,
                            'gl',
                            bankFiles.reduce((sum, file) => sum + (file?.size ?? 0), 0),
                            uploadTransfer.cancel,
                            uploadTransfer.retry,
                          )}
                        />
                      ) : null}
                    </div>
                  );
                })()
              )}
            </div>
          ) : (
            <div
              className="import-screen__upload-column"
              role="tabpanel"
              id={`import-panel-${activeSourceType}`}
              aria-labelledby={`import-tab-${activeSourceType}`}
            >
              {/* [OBJECT] rule 27, "not available" case: payroll cannot be attached by any user
                  action until #408, so the panel body IS the reason -- not a greyed-out drop zone.
                  The reason text is the Phase 2 ruling's, deliberately not screen 1a's: 1a shows
                  provider rows and an "Add payroll provider" control, and that panel depicts the
                  post-#408 state. Lifting its copy would promise an ingestion path that does not
                  exist. */}
              <SourceUnavailableNotice
                title={activeTab.kind === 'reason' ? activeTab.headline : ''}
                reason={activeTab.kind === 'reason' ? activeTab.reason : ''}
              />
            </div>
          )}

          {/* Step 3 · Submit. Sits at the foot of the left column, after the sources and the run
              description, because that is the order the screen argues (README 1a). Never a bare
              disabled button: the reason always renders beside it — [OBJECT] rule 27's "not yet
              valid" case, where the user can resolve it themselves, so the control stays put and
              says what is missing. */}
          <div className="import-step-submit">
            <span className="import-step-submit__badge" aria-hidden="true">
              3
            </span>
            <div className="import-step-submit__body">
              <h3 className="import-step-submit__title">Submit</h3>
              <div className="import-screen__submit-group">
                {/* R2 V4.3: `aria-disabled`, not the native `disabled` attribute -- a genuinely
                    disabled button drops out of the tab order, so a screen reader user could never
                    reach `aria-describedby`'s reason at all. `handleSubmit` enforces the same gate
                    for real (see its own comment); this only controls presentation and focusability. */}
                <button
                  type="submit"
                  form="source-upload-form"
                  className="primary-button"
                  aria-disabled={submitState.disabled}
                  aria-describedby={submitState.reason ? submitButtonReasonId : undefined}
                >
                  {submitState.label}
                </button>
                {submitState.reason ? (
                  <p id={submitButtonReasonId} className="import-screen__submit-reason">
                    {submitState.reason}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <RunSourceRecap attachedBySource={attachedBySource} />

          <aside className="run-configuration-panel">
            <h3 className="run-configuration-panel__title">Run configuration</h3>

            <HelpedTextField
              fieldId="account-identifier"
              helpText="Optional. Shown in outputs and exports."
              inputId="account-identifier-input"
              label="Account identifier"
              onChange={(event) => setAccountIdentifier(event.target.value)}
              placeholder="OPERATING-001"
              value={accountIdentifier}
            />

            <div className="run-configuration-panel__row">
              <HelpedFrequencyField
                onChange={(event) =>
                  setReconciliationFrequency(event.target.value as ReconciliationFrequency)
                }
                value={reconciliationFrequency}
              />

              <ReconciliationPeriodField
                annualYear={annualYear}
                currentYear={currentYear}
                monthlyMonth={monthlyMonth}
                previousSevenYears={previousSevenYears}
                reconciliationFrequency={reconciliationFrequency}
                setAnnualYear={setAnnualYear}
                setMonthlyMonth={setMonthlyMonth}
              />
            </div>

            <HelpedLabelField
              hintId={reconciliationLabelHintId}
              isInvalid={isLabelMissing}
              labelErrorId={reconciliationLabelErrorId}
              onChange={(event) => {
                setIsCustomPeriodLabel(true);
                setPeriodLabel(event.target.value);
              }}
              periodLabel={periodLabel}
              suggestedPeriodLabel={suggestedPeriodLabel}
              canResetToSuggested={isCustomPeriodLabel}
              onResetToSuggested={() => {
                setIsCustomPeriodLabel(false);
                setPeriodLabel(suggestedPeriodLabel);
              }}
            />

            <p className="trust-note">
              Uploaded files are stored raw and never mutated. Validation runs on a copy.
            </p>
          </aside>

          {isLabelMissing ? (
            <p
              id={reconciliationLabelErrorId}
              className="error-banner import-screen__status"
              role="alert"
            >
              A run label is required before submitting.
            </p>
          ) : null}
          {/* R2 V5: one outcome panel, switched on phase, replacing the old scattered one-line
              banners. `validating` (informational) and `queued` (a real, working outcome, not a
              failure -- checked before `isPending` has any chance to mask it, since a queued
              submission resolves without staying pending) are new; `validation-failed` is
              unchanged (ImportValidationFailureView already covers V5.2's requirements --
              gate/code naming and the raw-files-preserved reassurance -- so nothing there needed
              touching); `matching-failed` is upgraded from a one-line alert to a real panel. */}
          {reconciliation.error instanceof ImportValidationFailedError ? (
            <ImportValidationFailureView
              run={reconciliation.error.run}
              onRetryUpload={() => {
                reconciliation.reset();
                setBankFiles([null, null]);
                setGlFile(null);
              }}
              partialAccept={partialAccept}
            />
          ) : uploadTransfer.transfer.kind === 'assignment-conflict' ? (
            // A-D1 (Issue #338): a filename disagrees with the account it was assigned to. Neither
            // side is presumed right, so the operator gets both facts and two ways out -- confirm
            // the assignment as it stands, or change it in the slot above and submit again. The
            // banner deliberately offers no "use the filename's account instead" shortcut: that
            // would be the filename establishing identity through the back door.
            <div className="error-banner import-screen__status" role="alert">
              <p className="import-screen__status-message">
                Check these statement assignments before the run is created.
              </p>
              <ul className="import-screen__status-list">
                {uploadTransfer.transfer.conflicts.map((conflict) => (
                  <li key={conflict.originalFilename}>{conflict.message}</li>
                ))}
              </ul>
              <button type="button" className="secondary-button" onClick={handleSubmit}>
                Confirm assignments and submit
              </button>
            </div>
          ) : uploadTransfer.transfer.kind === 'failed' ? (
            // error-handling-build-plan.md EH4: the typed failure -- e.g. a 503 because no
            // database is configured (issue #187) -- carries an authored message plus whatever
            // code/reference/retryable the server attached, instead of just `reconciliation.error`
            // (already reset by `useImportUploadTransfer`'s onError, see that hook's doc comment).
            <div className="error-banner import-screen__status" role="alert">
              <p className="import-screen__status-message">{uploadTransfer.transfer.message}</p>
              {uploadTransfer.transfer.reference ? (
                <p className="import-screen__status-reference">
                  If you contact support, quote reference {uploadTransfer.transfer.reference}.
                </p>
              ) : null}
              {uploadTransfer.transfer.code ? (
                <details className="import-screen__status-code">
                  <summary>Error details</summary>
                  <code>{uploadTransfer.transfer.code}</code>
                </details>
              ) : null}
              {uploadTransfer.transfer.retryable ? (
                <button
                  type="button"
                  className="import-upload-card__retry-button"
                  onClick={uploadTransfer.retry}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : reconciliation.error ? (
            <p className="error-banner import-screen__status" role="alert">
              {reconciliation.error.message}
            </p>
          ) : durableRunPhase.kind === 'validation-failed' ? (
            // Issue #154: same screen as the live-mutation branch above, driven from a plain
            // fetched ImportRunSummary rather than a live error object -- ImportValidationFailureView
            // only needs `run` and independently re-fetches its own per-file detail.
            <ImportValidationFailureView
              run={durableRunPhase.run}
              onRetryUpload={() => {
                onDismissDurableRun();
                setBankFiles([null, null]);
                setGlFile(null);
              }}
              partialAccept={partialAccept}
            />
          ) : durableRunPhase.kind === 'matching-failed' ? (
            <MatchingFailurePanel run={durableRunPhase.run} message={durableRunPhase.message} />
          ) : submittedQueuedRun || durableRunPhase.kind === 'queued' ? (
            <QueuedRunPanel
              run={
                submittedQueuedRun ??
                (durableRunPhase.kind === 'queued' ? durableRunPhase.run : undefined)
              }
              onRefresh={onRefreshDurableRun}
            />
          ) : reconciliation.isPending ? (
            <p className="status-banner import-screen__status" role="status" aria-live="polite">
              Validating files, then matching. This can take a few seconds.
            </p>
          ) : null}
        </form>
      </SectionCard>
    </div>
  );
}

function LoginShell({
  onAuthenticated,
}: Readonly<{
  onAuthenticated: (session: AuthenticatedUserSession) => void;
}>) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (event: { preventDefault: () => void }): void => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setLoginError(null);

    void loginRequest({ username: username.trim(), password })
      .then((result) => {
        onAuthenticated({
          username: result.username,
          role: result.role,
          organizationId: result.organizationId,
          firstName: result.firstName,
          lastName: result.lastName,
          // Login doesn't report verification status -- the mount-time /api/auth/me effect
          // fills these in against the live database within moments of landing in the app.
          identityVerificationStatus: 'pending',
          entityVerificationStatus: 'pending',
          isFullyVerified: false,
        });
      })
      .catch(() => {
        setLoginError(invalidLoginMessage);
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <div className="login-page">
      <div className="login-wrap">
        <div className="login-brand">
          <span className="login-brand__logo">
            <img
              src={kinneyHighlander}
              alt="Kinney Software Solutions logo"
              className="login-brand__logo-image"
            />
          </span>
          <div>
            <p className="login-brand__company">Kinney Software Solutions LLC</p>
            <p className="login-brand__product">Reconciliation Platform</p>
          </div>
        </div>

        <form className="login-card" aria-label="Login page" onSubmit={handleSubmit}>
          <h1>Log in</h1>

          <div className="login-field">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              name="username"
              autoComplete="username"
              placeholder="your.name"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>

          <div className="login-field">
            <div className="login-field__label-row">
              <label htmlFor="login-password">Password</label>
              <Link to={routePaths.forgotPassword}>Forgot password?</Link>
            </div>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <button type="submit" className="login-btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Logging in...' : 'Log in'}
          </button>

          {loginError ? (
            <p className="login-error" role="alert">
              <span className="login-error__mark" aria-hidden="true">
                !
              </span>
              {loginError}
            </p>
          ) : null}

          <div className="login-divider">
            <span className="login-divider__line" />
            <span className="login-divider__text">New here?</span>
            <span className="login-divider__line" />
          </div>

          <Link to={routePaths.signup} className="login-btn-secondary">
            Create an account
          </Link>
        </form>

        <p className="login-help">
          Need help signing in? <Link to={routePaths.support}>Contact support</Link>
        </p>
      </div>
    </div>
  );
}

function UserRoleControls({
  activeUser,
  rolePermissions,
  displayName,
  onSignOut,
}: Readonly<{
  activeUser: Pick<AuthenticatedUserSession, 'username' | 'role'>;
  rolePermissions: RolePermissions;
  displayName?: string;
  onSignOut: () => void;
}>) {
  return (
    <section className="user-role-shell" aria-label="User access profile">
      <div className="user-role-shell__top">
        <div className="user-role-shell__identity">
          <span>Signed in as</span>
          <strong>{displayName ?? activeUser.username}</strong>
        </div>
        <div className="hero-brand user-role-shell__brand">
          <img
            className="hero-brand__mascot"
            src={kinneyHighlander}
            alt="Small Scottish man in a kilt illustration"
          />
          <p className="hero-brand__company">Kinney Software Solutions LLC</p>
        </div>
      </div>
      <div className="user-role-shell__meta">
        <strong>{roleDisplayLabels[activeUser.role]}</strong>
        <span>{activeUser.username}</span>
      </div>
      <ul className="user-role-shell__permissions" aria-label="Role permissions">
        <li>
          {rolePermissions.canAccessApplication
            ? 'Application access enabled'
            : 'Application access blocked'}
        </li>
        <li>
          {rolePermissions.canAccessDocumentation
            ? 'Documentation access enabled'
            : 'Documentation access blocked'}
        </li>
        <li>
          {rolePermissions.canAdjustSliderDefaults
            ? 'Variance slider default adjustments enabled'
            : 'Variance slider default adjustments blocked'}
        </li>
        <li>
          {rolePermissions.canAccessRunBook ? 'Run Book access enabled' : 'Run Book access blocked'}
        </li>
      </ul>
      <button
        type="button"
        className="secondary-button user-role-shell__signout"
        onClick={onSignOut}
      >
        Log out
      </button>
    </section>
  );
}

function AccessDeniedShell({
  title,
  description,
  appHref,
  docsHref,
  controls,
}: Readonly<{
  title: string;
  description: string;
  appHref?: string;
  docsHref?: string;
  controls: ReactNode;
}>) {
  return (
    <div className="app-shell">
      <div className="hero-backdrop" />
      <main className="app-layout">
        {controls}
        <SectionCard title={title} description={description}>
          <div className="access-denied-actions">
            {appHref ? (
              <a className="hero-primary-cta" href={appHref}>
                Reconciliation app
              </a>
            ) : null}
            {docsHref ? (
              <a className="hero-primary-cta" href={docsHref}>
                Documentation
              </a>
            ) : null}
          </div>
        </SectionCard>
      </main>
    </div>
  );
}

/** Shown in place of CreateMappingScreen when the account hasn't cleared both post-signup gates
 * yet. Unlike AccessDeniedShell (a whole-app swap), this renders inside the normal app shell --
 * nav rail and controls stay visible, only the route's own content area changes -- since the rest
 * of the app is usable on an unverified account; only mapping creation is blocked. */
function MappingVerificationRequiredNotice({
  identityVerificationStatus,
  entityVerificationStatus,
}: Readonly<{
  identityVerificationStatus: IdentityVerificationStatus;
  entityVerificationStatus: EntityVerificationStatus;
}>) {
  const entityStatusLabel =
    entityVerificationStatus === 'verified'
      ? 'Verified'
      : entityVerificationStatus === 'failed'
        ? 'Failed -- contact support or retry from Account settings'
        : 'Pending';

  return (
    <SectionCard
      title="Verification required"
      description="Creating a mapping requires both your identity and your organization's entity to be verified first. The rest of the application remains available in the meantime."
    >
      <ul className="verification-required-list">
        <li>
          Identity confirmation:{' '}
          <strong>{identityVerificationStatus === 'verified' ? 'Verified' : 'Pending'}</strong>
        </li>
        <li>
          Entity verification: <strong>{entityStatusLabel}</strong>
        </li>
      </ul>
    </SectionCard>
  );
}

function HelpedFrequencyField({
  onChange,
  value,
}: Readonly<{
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  value: ReconciliationFrequency;
}>) {
  return (
    <HelpedSelectField
      fieldId="reconciliation-frequency"
      helpText="Choose Monthly for one-month close checks, or Annual for full-year reconciliation validation."
      inputId="reconciliation-frequency-select"
      label="Frequency"
      onChange={onChange}
      options={reconciliationFrequencyOptions}
      value={value}
    />
  );
}

function ReconciliationPeriodField({
  annualYear,
  currentYear,
  monthlyMonth,
  previousSevenYears,
  reconciliationFrequency,
  setAnnualYear,
  setMonthlyMonth,
}: Readonly<{
  annualYear: string;
  currentYear: number;
  monthlyMonth: string;
  previousSevenYears: string[];
  reconciliationFrequency: ReconciliationFrequency;
  setAnnualYear: Dispatch<SetStateAction<string>>;
  setMonthlyMonth: Dispatch<SetStateAction<string>>;
}>) {
  if (reconciliationFrequency === 'Annual') {
    const fieldId = 'annual-reconciliation-year';
    const annualYearOptions = previousSevenYears.map((year) => ({
      value: year,
      label: year,
    }));

    return (
      <HelpedSelectField
        fieldId={fieldId}
        helpText="Select the completed year you want to reconcile across all 12 months."
        inputId="annual-reconciliation-year-select"
        label="Year"
        hint={{
          id: 'annual-year-hint',
          text: 'Choose one of the last 7 completed years.',
        }}
        onChange={(event) => setAnnualYear(event.target.value)}
        options={annualYearOptions}
        value={annualYear}
      />
    );
  }

  const fieldId = 'monthly-reconciliation-month';
  const monthlyOptions = monthsWithinYear.map((month) => ({
    value: month,
    label: month,
  }));

  return (
    <HelpedSelectField
      fieldId={fieldId}
      helpText="Select the month in the current year that this reconciliation run represents."
      inputId="monthly-reconciliation-month-select"
      label="Month"
      hint={{
        id: 'monthly-month-hint',
        text: `Month applies to the current year (${currentYear}).`,
      }}
      onChange={(event) => setMonthlyMonth(event.target.value)}
      options={monthlyOptions}
      value={monthlyMonth}
    />
  );
}

export default App;
