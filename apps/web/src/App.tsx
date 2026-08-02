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
} from 'react-router-dom';
import { SectionCard } from '@recon/ui';
import type { ReviewerDecision } from '@recon/domain';

import { DocsOverview } from './components/DocsOverview';
import { DeveloperDashboard } from './components/DeveloperDashboard';
import { ComingSoonPage } from './components/ComingSoonPage';
import { CreateMappingScreen } from './components/CreateMappingScreen';
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
import { getLatestReconciliationRunRequest, loginRequest } from './lib/api';
import {
  rulesCatalog,
  rulesCatalogLastRefresh,
  varianceMetricCatalog,
  type AppTab,
} from './lib/appCatalog';
import { readEnvString, resolveEnvironmentPaths } from './lib/environmentPath';
import { routePaths } from './routes/routePaths';
import type { SavedTriageView } from './lib/exceptionTriage';
import { useReconciliationRun } from './hooks/useReconciliationRun';
import { useReviewerDecisions } from './hooks/useReviewerDecisions';
import { useDensity } from './hooks/useDensity';
import { useWatchlist } from './hooks/useWatchlist';

type ReconciliationFrequency = 'Monthly' | 'Annual';
type ReconciliationModel = ReturnType<typeof useReconciliationRun>;
type RunData = NonNullable<ReconciliationModel['data']>;
type UserRole = 'developer' | 'financial-analyst' | 'admin' | 'superuser';
type AppUser = {
  username: string;
  role: UserRole;
};
type AuthenticatedUserSession = {
  username: string;
  firstName?: string;
  lastName?: string;
};
type RolePermissions = {
  canAccessApplication: boolean;
  canAccessDocumentation: boolean;
  canAccessDeveloperDashboard: boolean;
  canAdjustSliderDefaults: boolean;
  canAccessRunBook: boolean;
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

const usersByUsername: Record<string, AppUser> = {
  rray2: { username: 'rray2', role: 'developer' },
  bray: { username: 'bray', role: 'financial-analyst' },
  rray3: { username: 'rray3', role: 'admin' },
  rray: { username: 'rray', role: 'superuser' },
};

const roleDisplayLabels: Record<UserRole, string> = {
  developer: 'Developer',
  'financial-analyst': 'Financial Analyst',
  admin: 'Admin',
  superuser: 'SuperUser',
};

const rolePermissionsByRole: Record<UserRole, RolePermissions> = {
  developer: {
    canAccessApplication: false,
    canAccessDocumentation: true,
    canAccessDeveloperDashboard: true,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
  },
  'financial-analyst': {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAccessDeveloperDashboard: false,
    canAdjustSliderDefaults: false,
    canAccessRunBook: false,
  },
  admin: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAccessDeveloperDashboard: false,
    canAdjustSliderDefaults: true,
    canAccessRunBook: true,
  },
  superuser: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAccessDeveloperDashboard: true,
    canAdjustSliderDefaults: true,
    canAccessRunBook: true,
  },
};

/** Role-aware landing tab: analysts land on Review, everyone else on Setup. */
const resolveRoleLandingTab = (role: UserRole): AppTab =>
  role === 'financial-analyst' ? 'review' : 'setup';

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

const isKnownUsername = (value: string): value is keyof typeof usersByUsername =>
  Object.hasOwn(usersByUsername, value);

const loadAuthenticatedUserSession = (): AuthenticatedUserSession | null => {
  try {
    const serializedSession = globalThis.localStorage?.getItem(AUTHENTICATED_USER_STORAGE_KEY);

    if (serializedSession) {
      const parsedSession = JSON.parse(serializedSession) as AuthenticatedUserSession;
      const username =
        typeof parsedSession.username === 'string' ? parsedSession.username.trim() : '';

      if (isKnownUsername(username)) {
        return {
          username,
          firstName:
            typeof parsedSession.firstName === 'string' ? parsedSession.firstName : undefined,
          lastName: typeof parsedSession.lastName === 'string' ? parsedSession.lastName : undefined,
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
  const { docsHref, developerDashboardHref, appHref, isDocsRoute } = resolveEnvironmentPaths(env);

  const [authenticatedUserSession, setAuthenticatedUserSession] =
    useState<AuthenticatedUserSession | null>(() => loadAuthenticatedUserSession());
  const activeUser =
    authenticatedUserSession && isKnownUsername(authenticatedUserSession.username)
      ? usersByUsername[authenticatedUserSession.username]
      : null;
  const rolePermissions = activeUser ? rolePermissionsByRole[activeUser.role] : null;
  const showDeveloperDashboardLink =
    Boolean(activeUser) &&
    (env.DEV === true || readEnvString(env.VITE_ENABLE_DEVELOPER_DASHBOARD) === 'true') &&
    Boolean(rolePermissions?.canAccessDeveloperDashboard);

  useEffect(() => {
    persistAuthenticatedUserSession(authenticatedUserSession);
  }, [authenticatedUserSession]);

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
          <Route path={routePaths.signup} element={<PlaceholderScreen title="New Account" />} />
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
        description="Your role does not include the reconciliation workspace. Use Documentation and Developer Dashboard links for your assigned scope."
        docsHref={docsHref}
        showDeveloperDashboardLink={showDeveloperDashboardLink}
        developerDashboardHref={developerDashboardHref}
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
        showDeveloperDashboardLink={showDeveloperDashboardLink}
        developerDashboardHref={developerDashboardHref}
        controls={controls}
      />
    );
  }

  if (isDocsRoute) {
    return (
      <DocsOverview
        appHref={appHref}
        docsHref={docsHref}
        showDeveloperDashboardLink={showDeveloperDashboardLink}
        developerDashboardHref={developerDashboardHref}
        controls={controls}
      />
    );
  }

  return (
    <BrowserRouter basename={appHref}>
      <ReconciliationApp
        docsHref={docsHref}
        rolePermissions={rolePermissions}
        roleDefaultTab={resolveRoleLandingTab(activeUser.role)}
        controls={controls}
        showDeveloperDashboardLink={showDeveloperDashboardLink}
        username={activeUser.username}
        profileLabel={displayName.length > 0 ? displayName : activeUser.username}
        roleLabel={roleDisplayLabels[activeUser.role]}
        onSignOut={handleSignOut}
      />
    </BrowserRouter>
  );
}

function ReconciliationApp({
  docsHref,
  rolePermissions,
  roleDefaultTab,
  controls,
  showDeveloperDashboardLink,
  username,
  profileLabel,
  roleLabel,
  onSignOut,
}: Readonly<{
  docsHref: string;
  rolePermissions: RolePermissions;
  roleDefaultTab: AppTab;
  controls: ReactNode;
  showDeveloperDashboardLink: boolean;
  username: string;
  profileLabel: string;
  roleLabel: string;
  onSignOut: () => void;
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
  const [isRulesPanelOpen, setIsRulesPanelOpen] = useState(false);
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
  const [periodLabel, setPeriodLabel] = useState(
    buildDefaultPeriodLabel('Monthly', defaultMonth, annualYear, currentYear),
  );
  const [runStartedAtMs, setRunStartedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const reconciliation = useReconciliationRun();
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
      return;
    }

    if (legacyTab === 'developer' && showDeveloperDashboardLink) {
      void navigate(routePaths.developer, { replace: true });
    }
  }, [location.pathname, location.search, navigate, showDeveloperDashboardLink]);

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

  const openRulesPanel = (): void => {
    setIsRulesPanelOpen(true);
  };

  const closeRulesPanel = (): void => {
    setIsRulesPanelOpen(false);
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
      : rulesCatalogLastRefresh;

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
      accountIdentifier,
      reconciliationFrequency,
      periodLabel: trimmedPeriodLabel,
      varianceOverrides: varianceDefaultOverrides,
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
        showDeveloperDashboardLink={showDeveloperDashboardLink}
        canAccessDocumentation={rolePermissions.canAccessDocumentation}
        canAccessRunBook={rolePermissions.canAccessRunBook}
        username={username}
        profileLabel={profileLabel}
        roleLabel={roleLabel}
        onSignOut={onSignOut}
        isMobileOpen={isMobileNavOpen}
        onMobileClose={() => setIsMobileNavOpen(false)}
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
          onOpenRules={openRulesPanel}
          rulesUsedCount={rulesUsedCount}
          reviewProgressLabel={reviewProgressLabel}
          progressSteps={progressSteps}
          profile={controls}
          profileLabel={profileLabel}
          onToggleNav={() => setIsMobileNavOpen((open) => !open)}
          density={density}
          onChangeDensity={setDensity}
        />

        {isRulesPanelOpen ? (
          <RulesCatalogSection
            rules={rulesCatalog}
            metrics={varianceMetricCatalog}
            varianceOverrides={varianceDefaultOverrides}
            canAdjustVarianceDefaults={rolePermissions.canAdjustSliderDefaults}
            onChangeVarianceDefault={handleChangeVarianceDefault}
            onResetVarianceDefault={handleResetVarianceDefault}
            onResetVarianceDefaults={handleResetVarianceDefaults}
            run={reportRun}
            thresholdSetLabel={thresholdSetLabel}
            thresholdSetTimestamp={thresholdSetTimestamp}
            onClose={closeRulesPanel}
          />
        ) : (
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

              {showDeveloperDashboardLink ? (
                <Route path={routePaths.developer} element={<DeveloperDashboard />} />
              ) : null}

              <Route
                path={routePaths.mappingProfiles}
                element={
                  <ComingSoonPage
                    title="Mapping Profiles"
                    description="Browsing and managing saved mapping profiles is coming soon."
                  />
                }
              />
              <Route path={routePaths.mappingCreate} element={<CreateMappingScreen />} />
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
                path={routePaths.approvalsPending}
                element={
                  <ComingSoonPage
                    title="Pending Imports"
                    description="Imports awaiting approval will be reviewable here."
                  />
                }
              />
              <Route
                path={routePaths.approvalsApproved}
                element={
                  <ComingSoonPage
                    title="Approved Imports"
                    description="A record of approved imports will be reviewable here."
                  />
                }
              />
              <Route
                path={routePaths.approvalsRejected}
                element={
                  <ComingSoonPage
                    title="Rejected Imports"
                    description="A record of rejected imports will be reviewable here."
                  />
                }
              />
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
        )}

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
    <SectionCard
      title="Source Upload"
      description="XLSX uploads only. The engine preserves original file names, line numbers, excluded rows, and normalized audit fields."
    >
      <form
        id="source-upload-form"
        className="upload-form"
        aria-busy={reconciliation.isPending}
        onSubmit={handleSubmit}
      >
        <SourceDropZone
          bankFile={bankFile}
          glFile={glFile}
          setBankFile={setBankFile}
          setGlFile={setGlFile}
        />

        <HelpedTextField
          fieldId="account-identifier"
          helpText="Optional account code shown in outputs and exports to identify which account this run belongs to."
          inputId="account-identifier-input"
          label="Account identifier"
          onChange={(event) => setAccountIdentifier(event.target.value)}
          placeholder="OPERATING-001"
          value={accountIdentifier}
        />

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
          Use only authorized XLSX exports and follow your organization&apos;s financial data
          handling policy.
        </p>

        <div className="upload-actions">
          <button type="submit" disabled={!canSubmit}>
            {reconciliation.isPending ? 'Running reconciliation...' : 'Run reconciliation'}
          </button>
        </div>

        {reconciliation.isPending ? (
          <p className="status-banner" role="status" aria-live="polite">
            Reconciliation is running. Parsing, matching, and report generation are in progress.
          </p>
        ) : null}

        {isLabelMissing ? (
          <p id={reconciliationLabelErrorId} className="error-banner" role="alert">
            Reconciliation label is required before running.
          </p>
        ) : null}
        {reconciliation.error ? (
          <p className="error-banner" role="alert">
            {reconciliation.error.message}
          </p>
        ) : null}
      </form>
    </SectionCard>
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
        if (!isKnownUsername(result.username)) {
          setLoginError(invalidLoginMessage);
          return;
        }

        onAuthenticated({
          username: result.username,
          firstName: result.firstName,
          lastName: result.lastName,
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
  activeUser: AppUser;
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
          {rolePermissions.canAccessDeveloperDashboard
            ? 'Developer Dashboard access enabled'
            : 'Developer Dashboard access blocked'}
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
  showDeveloperDashboardLink,
  developerDashboardHref,
  controls,
}: Readonly<{
  title: string;
  description: string;
  appHref?: string;
  docsHref?: string;
  showDeveloperDashboardLink: boolean;
  developerDashboardHref: string;
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
            {showDeveloperDashboardLink ? (
              <a className="hero-primary-cta" href={developerDashboardHref}>
                Developer Dashboard
              </a>
            ) : null}
          </div>
        </SectionCard>
      </main>
    </div>
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
