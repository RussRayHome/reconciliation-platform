import './styles.css';
import '@recon/ui/styles.css';

import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { SectionCard } from '@recon/ui';
import type { ReviewerDecision } from '@recon/domain';

import { DocsOverview } from './components/DocsOverview';
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
import { RovingTabList } from './components/RovingTabList';
import { SemanticIcon } from './components/SemanticIcon';
import kinneyHighlander from './assets/kinney-highlander.png';
import { getLatestReconciliationRunRequest, loginRequest } from './lib/api';
import {
  buildTabNavigationItems,
  rulesCatalog,
  rulesCatalogLastRefresh,
  varianceMetricCatalog,
  type AppTab,
  type ReportView,
} from './lib/appCatalog';
import { useReconciliationRun } from './hooks/useReconciliationRun';
import { useReviewerDecisions } from './hooks/useReviewerDecisions';

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
};

type SelectOption = {
  value: string;
  label: string;
};

const LAST_SUCCESSFUL_RUN_STORAGE_KEY = 'reconciliation-platform:latest-report-run';
const AUTHENTICATED_USER_STORAGE_KEY = 'reconciliation-platform:authenticated-user';
const SLIDER_DEFAULTS_STORAGE_KEY = 'reconciliation-platform:slider-defaults';
const SLIDER_DEFAULTS_UPDATED_AT_KEY = 'reconciliation-platform:slider-defaults-updated-at';
const invalidLoginMessage = "That username and password don't match. Check both and try again.";

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
  },
  'financial-analyst': {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAccessDeveloperDashboard: false,
    canAdjustSliderDefaults: false,
  },
  admin: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAccessDeveloperDashboard: false,
    canAdjustSliderDefaults: true,
  },
  superuser: {
    canAccessApplication: true,
    canAccessDocumentation: true,
    canAccessDeveloperDashboard: true,
    canAdjustSliderDefaults: true,
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

    return JSON.parse(storedRun) as RunData;
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
    globalThis.localStorage?.setItem(LAST_SUCCESSFUL_RUN_STORAGE_KEY, JSON.stringify(run));
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

const appTabs = new Set<AppTab>(['setup', 'review', 'close']);
const reportViews = new Set<ReportView>(['summary', 'probable-matches', 'exceptions']);

const readWorkspaceSearchParams = (): URLSearchParams => {
  try {
    return new URLSearchParams(globalThis.location.search);
  } catch {
    return new URLSearchParams();
  }
};

const parseInitialTab = (params: URLSearchParams, fallbackTab: AppTab): AppTab => {
  const value = params.get('tab');

  return value !== null && appTabs.has(value as AppTab) ? (value as AppTab) : fallbackTab;
};

const parseInitialView = (params: URLSearchParams): ReportView => {
  const value = params.get('view');

  return value !== null && reportViews.has(value as ReportView) ? (value as ReportView) : 'summary';
};

const parseInitialRulesPanel = (params: URLSearchParams): boolean =>
  params.get('panel') === 'rules';

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

const readEnvString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

function App() {
  const env = import.meta.env as Record<string, unknown>;
  let pathname = globalThis.location.pathname;
  const configuredEnvironmentPathSegment = (readEnvString(env.VITE_ENVIRONMENT_PATH_SEGMENT) ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  if (pathname === '/' && configuredEnvironmentPathSegment.toLowerCase() === 'dev') {
    const developmentAppPath = `/${configuredEnvironmentPathSegment}`;

    globalThis.history.replaceState(globalThis.history.state, '', developmentAppPath);
    pathname = developmentAppPath;
  }

  const nestedRouteEnvironmentPathSegment =
    /^\/([A-Za-z0-9_-]+)\/(?:docs(?:\/|$)|developer-dashboard\.html$)/.exec(pathname)?.[1] ?? '';
  const rootRouteEnvironmentPathSegment = /^\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)?.[1] ?? '';
  const routeEnvironmentPathSegment =
    nestedRouteEnvironmentPathSegment ||
    (rootRouteEnvironmentPathSegment.toLowerCase() === 'docs'
      ? ''
      : rootRouteEnvironmentPathSegment);
  const activeEnvironmentPathSegment =
    routeEnvironmentPathSegment || configuredEnvironmentPathSegment;
  const docsHref = activeEnvironmentPathSegment ? `/${activeEnvironmentPathSegment}/docs` : '/docs';
  const developerDashboardHref = activeEnvironmentPathSegment
    ? `/${activeEnvironmentPathSegment}/developer-dashboard.html`
    : '/developer-dashboard.html';
  const appHref = activeEnvironmentPathSegment ? `/${activeEnvironmentPathSegment}` : '/';
  const isDocsRoute =
    pathname === '/docs' ||
    pathname.startsWith('/docs/') ||
    /^\/[A-Za-z0-9_-]+\/docs(?:\/|$)/.test(pathname);

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
      <LoginShell
        onAuthenticated={(session) => {
          setAuthenticatedUserSession(session);
        }}
      />
    );
  }

  const displayName = [authenticatedUserSession?.firstName, authenticatedUserSession?.lastName]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0)
    .join(' ');

  const controls = (
    <UserRoleControls
      activeUser={activeUser}
      rolePermissions={rolePermissions}
      displayName={displayName.length > 0 ? displayName : undefined}
      onSignOut={() => {
        setAuthenticatedUserSession(null);
      }}
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
    <ReconciliationApp
      docsHref={docsHref}
      rolePermissions={rolePermissions}
      roleDefaultTab={resolveRoleLandingTab(activeUser.role)}
      controls={controls}
      showDeveloperDashboardLink={showDeveloperDashboardLink}
      developerDashboardHref={developerDashboardHref}
    />
  );
}

function ReconciliationApp({
  docsHref,
  rolePermissions,
  roleDefaultTab,
  controls,
  showDeveloperDashboardLink,
  developerDashboardHref,
}: Readonly<{
  docsHref: string;
  rolePermissions: RolePermissions;
  roleDefaultTab: AppTab;
  controls: ReactNode;
  showDeveloperDashboardLink: boolean;
  developerDashboardHref: string;
}>) {
  const currentYear = new Date().getFullYear();
  const previousSevenYears = Array.from({ length: 7 }, (_, index) =>
    String(currentYear - index - 1),
  );
  const defaultMonth = monthsWithinYear[new Date().getMonth()] ?? 'January';
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [qboFile, setQboFile] = useState<File | null>(null);
  const [accountIdentifier, setAccountIdentifier] = useState('');
  const [reconciliationFrequency, setReconciliationFrequency] =
    useState<ReconciliationFrequency>('Monthly');
  const [annualYear, setAnnualYear] = useState(previousSevenYears[0] ?? '');
  const [monthlyMonth, setMonthlyMonth] = useState(defaultMonth);
  const [isCustomPeriodLabel, setIsCustomPeriodLabel] = useState(false);
  const [hasDownloadedWorkbook, setHasDownloadedWorkbook] = useState(false);
  const [hasExportedJson, setHasExportedJson] = useState(false);
  const initialWorkspaceParams = readWorkspaceSearchParams();
  const [activeTab, setActiveTab] = useState<AppTab>(() =>
    parseInitialTab(initialWorkspaceParams, roleDefaultTab),
  );
  const [activeView, setActiveView] = useState<ReportView>(() =>
    parseInitialView(initialWorkspaceParams),
  );
  const [isRulesPanelOpen, setIsRulesPanelOpen] = useState<boolean>(() =>
    parseInitialRulesPanel(initialWorkspaceParams),
  );
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
      setActiveTab('review');
      setActiveView('summary');
      setLatestBackendReportError(null);
      setIsHydratingLatestBackendReport(false);
    }
  }, [run]);

  useEffect(() => {
    const params = readWorkspaceSearchParams();
    params.set('tab', activeTab);
    params.set('view', activeView);

    if (isRulesPanelOpen) {
      params.set('panel', 'rules');
    } else {
      params.delete('panel');
    }

    const query = params.toString();
    const querySuffix = query ? `?${query}` : '';
    const nextUrl = `${globalThis.location.pathname}${querySuffix}`;

    try {
      globalThis.history.replaceState(globalThis.history.state, '', nextUrl);
    } catch {
      // Ignore history failures so navigation state still updates in-memory.
    }
  }, [activeTab, activeView, isRulesPanelOpen]);

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

  const handleSelectTab = (nextTab: AppTab): void => {
    if (!rolePermissions.canAccessApplication) {
      return;
    }

    setActiveTab(nextTab);

    if (nextTab === 'review' || nextTab === 'close') {
      hydrateLatestBackendReport();
    }
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
  const hasStartedUploadStep = Boolean(bankFile || qboFile);
  const isUploadStepComplete = Boolean(bankFile && qboFile);
  const isConfigurationStepComplete = isUploadStepComplete && !isLabelMissing;
  const isRunStepComplete = Boolean(run);
  const isRunStepCurrent = isConfigurationStepComplete && !isRunStepComplete;
  const isExportStepComplete = hasDownloadedWorkbook || hasExportedJson;
  const isExportStepCurrent = isRunStepComplete && !isExportStepComplete;
  const isRunPendingStep = isRunStepCurrent || reconciliation.isPending;
  const canSubmit = Boolean(bankFile && qboFile && !reconciliation.isPending && !isLabelMissing);

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
        description: 'Select both Bank and QBO workbooks.',
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
    : [bankFile?.name, qboFile?.name].filter((name): name is string => Boolean(name));
  const runBarAccountIdentifier = reportRun?.accountIdentifier ?? accountIdentifier;
  const runBarFrequency = reportRun?.reconciliationFrequency ?? reconciliationFrequency;
  const appliedVarianceOverrides = reportRun?.appliedVarianceOverrides;
  const rulesUsedCount = reportRun ? Object.keys(appliedVarianceOverrides ?? {}).length : null;
  const reviewProgressLabel = reportRun
    ? `${reviewerDecisions.resolvedCount} of ${reportRun.exceptions.length} resolved · ${reviewerDecisions.researchCount} in research`
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

    if (!bankFile || !qboFile) {
      return;
    }

    setRunStartedAtMs(Date.now());
    setNowMs(Date.now());
    reconciliation.mutate({
      bankFile,
      qboFile,
      accountIdentifier,
      reconciliationFrequency,
      periodLabel: trimmedPeriodLabel,
      varianceOverrides: varianceDefaultOverrides,
    });
  };

  return (
    <div className="app-shell">
      <div className="hero-backdrop" />
      <main className="app-layout">
        {controls}
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
          onOpenReview={() => handleSelectTab('review')}
          onOpenRules={openRulesPanel}
          rulesUsedCount={rulesUsedCount}
          reviewProgressLabel={reviewProgressLabel}
          progressSteps={progressSteps}
          docsHref={docsHref}
          developerDashboardHref={developerDashboardHref}
          showDeveloperDashboardLink={showDeveloperDashboardLink}
          canAccessDocumentation={rolePermissions.canAccessDocumentation}
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
            <TabNavigation
              activeTab={activeTab}
              exceptionCount={run?.exceptions.length ?? 0}
              hasRun={Boolean(run)}
              onSelectTab={handleSelectTab}
            />

            {activeTab === 'setup' ? (
              <SourceUploadSection
                annualYear={annualYear}
                bankFile={bankFile}
                qboFile={qboFile}
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
                setQboFile={setQboFile}
                setReconciliationFrequency={setReconciliationFrequency}
                suggestedPeriodLabel={suggestedPeriodLabel}
                accountIdentifier={accountIdentifier}
              />
            ) : null}

            {activeTab === 'review' ? (
              <ReviewSection
                run={reportRun}
                activeView={activeView}
                isHydrating={isHydratingLatestBackendReport}
                loadError={latestBackendReportError}
                onSelectView={setActiveView}
                onGoToSetup={() => handleSelectTab('setup')}
                decisionByTargetId={reviewerDecisions.decisionByTargetId}
                pendingTargetId={reviewerDecisions.pendingTargetId}
                decisionError={reviewerDecisions.error}
                lastChange={reviewerDecisions.lastChange}
                onDecide={reviewerDecisions.decide}
                onClearDecision={reviewerDecisions.clearDecision}
                onUndoLastDecision={reviewerDecisions.undoLastDecision}
              />
            ) : null}

            {activeTab === 'close' ? (
              <CloseExportSection
                run={reportRun}
                isHydrating={isHydratingLatestBackendReport}
                loadError={latestBackendReportError}
                onDownloadWorkbook={() => setHasDownloadedWorkbook(true)}
                onGoToSetup={() => handleSelectTab('setup')}
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
            ) : null}
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

function TabNavigation({
  activeTab,
  exceptionCount,
  hasRun,
  onSelectTab,
}: Readonly<{
  activeTab: AppTab;
  exceptionCount: number;
  hasRun: boolean;
  onSelectTab: (tab: AppTab) => void;
}>) {
  const tabs = buildTabNavigationItems({ exceptionCount, hasRun });

  return (
    <section className="tab-shell" aria-label="Application sections">
      <RovingTabList
        items={tabs}
        activeId={activeTab}
        onSelect={onSelectTab}
        ariaLabel="Application tabs"
        tabIdPrefix="tab"
        panelIdPrefix="tab-panel"
        listClassName="tab-list"
        tabClassName="tab-button"
        activeTabClassName="tab-button tab-button--active"
        renderContent={(tab) => (
          <>
            <span className="tab-button__label-row">
              <span className="tab-button__icon-shell" aria-hidden="true">
                <SemanticIcon name={tab.icon ?? 'reports'} className="tab-button__icon" />
              </span>
              <span className="tab-button__label-text">{tab.label}</span>
            </span>
            <small>{tab.description}</small>
          </>
        )}
      />
    </section>
  );
}

function TabPanel({
  tabId,
  children,
}: Readonly<{
  tabId: AppTab;
  children: ReactNode;
}>) {
  return (
    <section id={`tab-panel-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`}>
      {children}
    </section>
  );
}

function SourceUploadSection({
  accountIdentifier,
  annualYear,
  bankFile,
  qboFile,
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
  setQboFile,
  setReconciliationFrequency,
  suggestedPeriodLabel,
}: Readonly<{
  accountIdentifier: string;
  annualYear: string;
  bankFile: File | null;
  qboFile: File | null;
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
  setQboFile: Dispatch<SetStateAction<File | null>>;
  setReconciliationFrequency: Dispatch<SetStateAction<ReconciliationFrequency>>;
  suggestedPeriodLabel: string;
}>) {
  const reconciliationLabelErrorId = 'reconciliation-label-error';
  const reconciliationLabelHintId = 'reconciliation-label-hint';

  return (
    <TabPanel tabId="setup">
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
            qboFile={qboFile}
            setBankFile={setBankFile}
            setQboFile={setQboFile}
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
    </TabPanel>
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
    <div className="app-shell">
      <div className="hero-backdrop" />
      <main className="app-layout login-layout">
        <section className="login-card" aria-label="Login page">
          <div className="login-brand">
            <img
              className="login-brand__logo"
              src={kinneyHighlander}
              alt="Small Scottish man in a kilt illustration"
            />
            <p className="login-brand__company">Kinney Software Solutions LLC</p>
          </div>

          <h1>Financial Reconciliation Platform</h1>
          <p className="login-lede">
            Audit-ready monthly workflow: upload source workbooks, preserve row-level traceability,
            run evidence-based matching, and export accountant-friendly workpapers with repeatable
            rules.
          </p>

          <h2 className="login-heading">Login</h2>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="field-group">
              <label htmlFor="login-username">Username</label>
              <input
                id="login-username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
              {loginError ? (
                <p className="login-error" role="alert">
                  {invalidLoginMessage}
                </p>
              ) : null}
            </div>

            <div className="field-group">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>

            <div className="login-actions">
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </form>
        </section>
      </main>
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
