import './styles/index.css';
import '@recon/ui/styles.css';

import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
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
  type EntityVerificationStatus,
  type IdentityVerificationStatus,
  type ReviewerDecision,
  type RolePermissions,
  type RuleCatalogResponse,
  type RuleFamily,
  type RuleVersionsResponse,
  type UserRole,
} from '@recon/domain';

import { DocsOverview } from './components/DocsOverview';
import { ApprovalsPage } from './components/ApprovalsPage';
import { ApprovalPolicyPage } from './components/ApprovalPolicyPage';
import { VersionsPage } from './components/VersionsPage';
import { ComingSoonPage } from './components/ComingSoonPage';
import { CreateMappingScreen } from './components/CreateMappingScreen';
import { SignupScreen } from './components/SignupScreen';
import { PlaceholderScreen } from './components/PlaceholderScreen';
import { HelpedLabelField, HelpedSelectField, HelpedTextField } from './components/AppFormFields';
import { SourceDropZone } from './components/SourceDropZone';
import {
  CloseExportSection,
  type ProgressStep,
  ReviewSection,
  type RuleVarianceDefaultOverrides,
  RulesCatalogSection,
} from './components/AppWorkspacePanels';
import { RunBar } from './components/RunBar';
import { NavRail } from './components/NavRail';
import kinneyHighlander from './assets/kinney-highlander.png';
import {
  createRuleVersionDraftRequest,
  getApprovalCountsRequest,
  getLatestReconciliationRunRequest,
  getMappingProfilesRequest,
  getRuleVersionsRequest,
  getRulesCatalogRequest,
  loginRequest,
  logoutRequest,
  meRequest,
  publishRuleVersionRequest,
} from './lib/api';
import { clearAuthToken, getAuthToken } from './lib/authToken';
import { countFixedRules, countRulesByFamily } from './lib/ruleFilters';
import type { AppTab } from './lib/appCatalog';
import { resolveEnvironmentPaths } from './lib/environmentPath';
import { routePaths } from './routes/routePaths';
import type { SavedTriageView } from './lib/exceptionTriage';
import { useImportRunSubmit } from './hooks/useImportRunSubmit';
import {
  BANK_TEMPLATE_URL,
  BANK_TEMPLATE_XLSX_URL,
  GL_TEMPLATE_URL,
  GL_TEMPLATE_XLSX_URL,
} from './lib/templates';
import { useReviewerDecisions } from './hooks/useReviewerDecisions';
import { useDensity } from './hooks/useDensity';
import { useWatchlist } from './hooks/useWatchlist';

type ReconciliationFrequency = 'Monthly' | 'Annual';
type ReconciliationModel = ReturnType<typeof useImportRunSubmit>;
type RunData = NonNullable<ReconciliationModel['data']>;
/** The authenticated principal, as reported by the server (login response or /api/auth/me) --
 * ADR-0002 step 6: role travels with the session instead of being looked up from a hardcoded
 * client-side username map. */
export type AuthenticatedUserSession = {
  username: string;
  role: UserRole;
  organizationId: string;
  firstName?: string;
  lastName?: string;
  // Login/signup don't return these -- both start out 'pending'/'pending'/false and are corrected
  // moments later by the /api/auth/me effect below, which reads them live from the database.
  identityVerificationStatus: IdentityVerificationStatus;
  entityVerificationStatus: EntityVerificationStatus;
  isFullyVerified: boolean;
};

type SelectOption = {
  value: string;
  label: string;
};

const LAST_SUCCESSFUL_RUN_STORAGE_KEY = 'reconciliation-platform:latest-report-run';
// Bump this whenever a change to display wording, category labels, or the RunData shape would
// make a previously-persisted run render stale or incorrect content (e.g. the QBO->GL rename) --
// loadPersistedRun() discards anything stored under a different version instead of trusting it.
const RUN_STORAGE_SCHEMA_VERSION = 3;
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
  admin: 'Admin',
  superuser: 'SuperUser',
};

/** Role-aware landing tab (design doc: "Role sets the default landing view"). The two other
 * individual-contributor analyst roles land on Review like financial-analyst; the management-tier
 * roles (controller/vp-finance/cfo) land on Setup alongside admin/superuser. */
const analystTierLandingRoles = new Set<UserRole>([
  'financial-analyst',
  'senior-analyst',
  'staff-accountant',
]);
const resolveRoleLandingTab = (role: UserRole): AppTab =>
  analystTierLandingRoles.has(role) ? 'review' : 'setup';

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

const resolveMeterValue = (
  isComplete: boolean,
  isCurrent: boolean,
  activeValue: number,
  inactiveValue = 0,
): number => {
  if (isComplete) {
    return 100;
  }

  if (isCurrent) {
    return activeValue;
  }

  return inactiveValue;
};

const formatElapsedLabel = (elapsedMs: number): string => {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

type RunStatusTone = 'idle' | 'running' | 'complete' | 'error';

const runStatusLabelsByTone: Record<RunStatusTone, string> = {
  idle: 'Idle',
  running: 'Running',
  complete: 'Complete',
  error: 'Failed',
};

const resolveRunStatusTone = (
  isPending: boolean,
  hasError: boolean,
  hasRun: boolean,
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

  return 'idle';
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
        roleDefaultTab={resolveRoleLandingTab(activeUser.role)}
        controls={controls}
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
  roleDefaultTab,
  controls,
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
  roleDefaultTab: AppTab;
  controls: ReactNode;
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
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [glFile, setGlFile] = useState<File | null>(null);
  const [accountIdentifier, setAccountIdentifier] = useState('');
  const [reconciliationFrequency, setReconciliationFrequency] =
    useState<ReconciliationFrequency>('Monthly');
  const [annualYear, setAnnualYear] = useState(previousSevenYears[0] ?? '');
  const [monthlyMonth, setMonthlyMonth] = useState(defaultMonth);
  const [isCustomPeriodLabel, setIsCustomPeriodLabel] = useState(false);
  const [hasDownloadedWorkbook, setHasDownloadedWorkbook] = useState(false);
  const [hasExportedJson, setHasExportedJson] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [pendingSavedViewId, setPendingSavedViewId] = useState<string | null>(null);
  const [persistedRun, setPersistedRun] = useState<RunData | undefined>(() => loadPersistedRun());
  const [hasAttemptedBackendReportHydration, setHasAttemptedBackendReportHydration] =
    useState(false);
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
  const run = reconciliation.data;
  const reportRun = run ?? persistedRun;
  const reportRunExceptionIds = useMemo(
    () => new Set((reportRun?.exceptions ?? []).map((exception) => exception.id)),
    [reportRun],
  );
  const reviewerDecisions = useReviewerDecisions(
    reportRun?.id ?? null,
    reportRun?.reviewerDecisions,
    reportRunExceptionIds,
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
  }, [location.pathname]);

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
      void navigate(routePaths.reconSummary);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate identity is stable per React Router.
  }, [run]);

  const hydrateLatestBackendReport = (): void => {
    if (hasAttemptedBackendReportHydration || run || persistedRun) {
      return;
    }

    setHasAttemptedBackendReportHydration(true);
    setIsHydratingLatestBackendReport(true);
    setLatestBackendReportError(null);
    void getLatestReconciliationRunRequest()
      .then((latestRun) => {
        setPersistedRun(latestRun);
        persistRun(latestRun);
        setLatestBackendReportError(null);
      })
      .catch((error: unknown) => {
        setLatestBackendReportError(
          error instanceof Error ? error.message : 'Unable to load the latest reconciliation run.',
        );
      })
      .finally(() => {
        setIsHydratingLatestBackendReport(false);
      });
  };

  const reviewAndExportRoutes = useMemo(
    () =>
      new Set<string>([
        routePaths.reconSummary,
        routePaths.probableMatches,
        routePaths.exceptions,
        routePaths.export,
      ]),
    [],
  );

  useEffect(() => {
    if (reviewAndExportRoutes.has(location.pathname)) {
      hydrateLatestBackendReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrateLatestBackendReport is internally idempotent; only pathname should retrigger this.
  }, [location.pathname, reviewAndExportRoutes]);

  /**
   * Old bookmarks/shared links encoded destination as `?tab=...&view=...` on the root path
   * rather than a distinct pathname. Translate them to real routes once on landing.
   */
  useEffect(() => {
    if (location.pathname !== routePaths.importFiles) {
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

  /**
   * Role-based default landing tab (analysts land on Review) — applies only to the very first
   * app load, not to later visits to "/", so clicking "Import Files" always actually lands there
   * even for roles whose default landing tab is Review.
   */
  const hasAppliedInitialRoleLanding = useRef(false);

  useEffect(() => {
    if (hasAppliedInitialRoleLanding.current) {
      return;
    }

    hasAppliedInitialRoleLanding.current = true;

    if (
      location.pathname === routePaths.importFiles &&
      !location.search &&
      roleDefaultTab === 'review'
    ) {
      void navigate(routePaths.reconSummary, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once on mount only; see hasAppliedInitialRoleLanding.
  }, []);

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
  const hasStartedUploadStep = Boolean(bankFile || glFile);
  const isUploadStepComplete = Boolean(bankFile && glFile);
  const isConfigurationStepComplete = isUploadStepComplete && !isLabelMissing;
  const isRunStepComplete = Boolean(run);
  const isRunStepCurrent = isConfigurationStepComplete && !isRunStepComplete;
  const isExportStepComplete = hasDownloadedWorkbook || hasExportedJson;
  const isExportStepCurrent = isRunStepComplete && !isExportStepComplete;
  const isRunPendingStep = isRunStepCurrent || reconciliation.isPending;
  const canSubmit = Boolean(bankFile && glFile && !reconciliation.isPending && !isLabelMissing);

  const progressSteps = useMemo<ProgressStep[]>(() => {
    const uploadMeterValue = resolveMeterValue(isUploadStepComplete, hasStartedUploadStep, 20);
    const configurationMeterValue = resolveMeterValue(
      isConfigurationStepComplete,
      isUploadStepComplete && !isConfigurationStepComplete,
      50,
    );
    const runMeterValue = resolveMeterValue(
      isRunStepComplete,
      isRunPendingStep,
      reconciliation.isPending ? 70 : 35,
    );
    const exportMeterValue = resolveMeterValue(isExportStepComplete, isExportStepCurrent, 60);

    return [
      {
        id: 'upload',
        label: 'Upload source files',
        description: 'Select both Bank and GL workbooks.',
        isComplete: isUploadStepComplete,
        isCurrent: hasStartedUploadStep && !isUploadStepComplete,
        meterValue: uploadMeterValue,
      },
      {
        id: 'configure',
        label: 'Confirm run settings',
        description: 'Choose frequency/period and provide a reconciliation label.',
        isComplete: isConfigurationStepComplete,
        isCurrent: isUploadStepComplete && !isConfigurationStepComplete,
        meterValue: configurationMeterValue,
      },
      {
        id: 'run',
        label: 'Run reconciliation',
        description: 'Processing includes parsing, matching, and exception generation.',
        isComplete: isRunStepComplete,
        isCurrent: isRunPendingStep,
        meterValue: runMeterValue,
        detail: run ? `${run.summary.totalRecordsReviewed} records reviewed` : undefined,
      },
      {
        id: 'review-export',
        label: 'Review and export outputs',
        description: 'Review results and export workbook/JSON artifacts.',
        isComplete: isExportStepComplete,
        isCurrent: isExportStepCurrent,
        meterValue: exportMeterValue,
      },
    ];
  }, [
    hasStartedUploadStep,
    isConfigurationStepComplete,
    isExportStepComplete,
    isExportStepCurrent,
    isRunPendingStep,
    isRunStepComplete,
    isUploadStepComplete,
    reconciliation.isPending,
    run,
  ]);

  const completedStepCount = progressSteps.filter((step) => step.isComplete).length;
  const overallProgressPercent = Math.round((completedStepCount / progressSteps.length) * 100);

  const currentProgressStep = progressSteps.find((step) => step.isCurrent);
  const runStatusTone = resolveRunStatusTone(
    reconciliation.isPending,
    Boolean(reconciliation.error),
    Boolean(reportRun),
  );
  const runStatusLabel = runStatusLabelsByTone[runStatusTone];
  const currentStepLabel = reportRun
    ? 'Reconciliation complete'
    : (currentProgressStep?.label ?? 'Ready to run');
  const runElapsedMs = resolveRunElapsedMs(
    reportRun,
    reconciliation.isPending,
    runStartedAtMs,
    nowMs,
  );
  const elapsedLabel = runElapsedMs === null ? null : formatElapsedLabel(runElapsedMs);
  const runBarSourceFileNames = reportRun
    ? reportRun.sourceFiles.map((file) => file.fileName)
    : [bankFile?.name, glFile?.name].filter((name): name is string => Boolean(name));
  const runBarAccountIdentifier = reportRun?.accountIdentifier ?? accountIdentifier;
  const runBarFrequency = reportRun?.reconciliationFrequency ?? reconciliationFrequency;
  const appliedVarianceOverrides = reportRun?.appliedVarianceOverrides;
  const rulesUsedCount = reportRun ? Object.keys(appliedVarianceOverrides ?? {}).length : null;
  const matchingRuleFamilyCounts = useMemo(
    () =>
      rulesCatalogData
        ? (Object.entries(countRulesByFamily(rulesCatalogData.rules)) as Array<[RuleFamily, number]>).map(
            ([family, count]) => ({ family, count }),
          )
        : undefined,
    [rulesCatalogData],
  );
  const matchingRuleFixedCount = rulesCatalogData
    ? countFixedRules(rulesCatalogData.rules)
    : undefined;
  const reviewProgressLabel = reportRun
    ? `${reviewerDecisions.resolvedCount} of ${reportRun.exceptions.length} resolved · ${reviewerDecisions.researchCount} in research`
    : null;
  const unreviewedExceptionCount = reportRun
    ? Math.max(reportRun.exceptions.length - reviewerDecisions.resolvedCount, 0)
    : null;
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

    if (!bankFile || !glFile) {
      return;
    }

    setRunStartedAtMs(Date.now());
    setNowMs(Date.now());
    reconciliation.mutate({
      bankFile,
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
        canAccessRunBook={rolePermissions.canAccessRunBook}
        canApprove={rolePermissions.canApprove}
        approvalCounts={approvalCounts}
        username={username}
        profileLabel={profileLabel}
        roleLabel={roleLabel}
        onSignOut={onSignOut}
        isMobileOpen={isMobileNavOpen}
        onMobileClose={() => setIsMobileNavOpen(false)}
        matchingRuleTotalCount={rulesCatalogData?.rules.length}
        matchingRuleFamilyCounts={matchingRuleFamilyCounts}
        matchingRuleFixedCount={matchingRuleFixedCount}
      />
      <main className="app-layout app-layout--rail">
        <RunBar
          periodLabel={reportRun?.periodLabel ?? periodLabel}
          accountIdentifier={runBarAccountIdentifier}
          sourceFileNames={runBarSourceFileNames}
          frequency={runBarFrequency}
          statusLabel={runStatusLabel}
          statusTone={runStatusTone}
          overallProgressPercent={overallProgressPercent}
          currentStepLabel={currentStepLabel}
          exceptionCount={reportRun ? reportRun.exceptions.length : null}
          runId={reportRun?.id ?? null}
          elapsedLabel={elapsedLabel}
          isComplete={Boolean(reportRun)}
          onOpenReview={() => navigate(routePaths.reconSummary)}
          onOpenRules={() => navigate(routePaths.mappingRules)}
          rulesUsedCount={rulesUsedCount}
          reviewProgressLabel={reviewProgressLabel}
          progressSteps={progressSteps}
          profile={controls}
          profileLabel={profileLabel}
          onToggleNav={() => setIsMobileNavOpen((open) => !open)}
          density={density}
          onChangeDensity={setDensity}
        />

        <section className="tabbed-workspace" aria-label="Reconciliation workspace">
            <Routes>
              <Route
                path={routePaths.importFiles}
                element={
                  <SourceUploadSection
                    annualYear={annualYear}
                    bankFile={bankFile}
                    glFile={glFile}
                    canSubmit={canSubmit}
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
                    setBankFile={setBankFile}
                    setIsCustomPeriodLabel={setIsCustomPeriodLabel}
                    setMonthlyMonth={setMonthlyMonth}
                    setPeriodLabel={setPeriodLabel}
                    setGlFile={setGlFile}
                    setReconciliationFrequency={setReconciliationFrequency}
                    suggestedPeriodLabel={suggestedPeriodLabel}
                    accountIdentifier={accountIdentifier}
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
                path={routePaths.mappingProfiles}
                element={
                  <ComingSoonPage
                    title="Mapping Profiles"
                    description="Browsing and managing saved mapping profiles is coming soon."
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
                path={routePaths.approvalsImports}
                element={<ApprovalsPage canApprove={rolePermissions.canApprove} isAdmin={isAdmin} />}
              />
              <Route
                path={routePaths.approvalsMappingProfiles}
                element={<ApprovalsPage canApprove={rolePermissions.canApprove} isAdmin={isAdmin} />}
              />
              <Route
                path={routePaths.approvalsMatchingRules}
                element={<ApprovalsPage canApprove={rolePermissions.canApprove} isAdmin={isAdmin} />}
              />
              <Route
                path={routePaths.approvalsExceptionResolutions}
                element={<ApprovalsPage canApprove={rolePermissions.canApprove} isAdmin={isAdmin} />}
              />
              <Route
                path={routePaths.approvalsReportDistribution}
                element={<ApprovalsPage canApprove={rolePermissions.canApprove} isAdmin={isAdmin} />}
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

function SourceUploadSection({
  accountIdentifier,
  annualYear,
  bankFile,
  glFile,
  canSubmit,
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
  setBankFile,
  setIsCustomPeriodLabel,
  setMonthlyMonth,
  setPeriodLabel,
  setGlFile,
  setReconciliationFrequency,
  suggestedPeriodLabel,
}: Readonly<{
  accountIdentifier: string;
  annualYear: string;
  bankFile: File | null;
  glFile: File | null;
  canSubmit: boolean;
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
  setBankFile: Dispatch<SetStateAction<File | null>>;
  setIsCustomPeriodLabel: Dispatch<SetStateAction<boolean>>;
  setMonthlyMonth: Dispatch<SetStateAction<string>>;
  setPeriodLabel: Dispatch<SetStateAction<string>>;
  setGlFile: Dispatch<SetStateAction<File | null>>;
  setReconciliationFrequency: Dispatch<SetStateAction<ReconciliationFrequency>>;
  suggestedPeriodLabel: string;
}>) {
  const reconciliationLabelErrorId = 'reconciliation-label-error';
  const reconciliationLabelHintId = 'reconciliation-label-hint';

  return (
    <div className="import-screen">
      <p className="import-screen__eyebrow">Reconciliations / New run</p>
      <SectionCard
        title="Import source files"
        description="CSV or XLSX. Format is detected by extension; the engine preserves original file names, source line numbers, excluded rows, and normalized audit fields."
        actions={
          <div className="import-screen__header-actions">
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
            <button
              type="submit"
              form="source-upload-form"
              className="accent-button"
              disabled={!canSubmit}
            >
              {reconciliation.isPending ? 'Submitting…' : 'Submit run'}
            </button>
          </div>
        }
      >
        <form
          id="source-upload-form"
          className="import-screen__body"
          aria-busy={reconciliation.isPending}
          onSubmit={handleSubmit}
        >
          <div className="import-screen__upload-column">
            <SourceDropZone
              bankFile={bankFile}
              glFile={glFile}
              setBankFile={setBankFile}
              setGlFile={setGlFile}
            />
            <p className="source-dropzone__note">
              Bank and GL are detected from each file name; use the slot pickers to override. Row
              counts, date range, and excluded rows are calculated when the reconciliation runs.
            </p>
          </div>

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

          {reconciliation.isPending ? (
            <p className="status-banner import-screen__status" role="status" aria-live="polite">
              Import run submitted. Validation and matching are in progress.
            </p>
          ) : null}

          {isLabelMissing ? (
            <p
              id={reconciliationLabelErrorId}
              className="error-banner import-screen__status"
              role="alert"
            >
              Reconciliation label is required before running.
            </p>
          ) : null}
          {reconciliation.error ? (
            <p className="error-banner import-screen__status" role="alert">
              {reconciliation.error.message}
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
      label="Reconciliation frequency"
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
        label="Annual reconciliation year"
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
      label="Monthly reconciliation month"
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
