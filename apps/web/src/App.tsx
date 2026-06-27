import './styles.css';
import '@recon/ui/styles.css';

import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { SectionCard } from '@recon/ui';

import { DocsOverview } from './components/DocsOverview';
import {
  HelpedFileField,
  HelpedLabelField,
  HelpedSelectField,
  HelpedTextField,
} from './components/AppFormFields';
import {
  ProcessProgressSection,
  ReportsSection,
  type RuleVarianceDefaultOverrides,
  RulesCatalogSection,
  RunResultsSection,
} from './components/AppWorkspacePanels';
import { SemanticIcon } from './components/SemanticIcon';
import kinneyHighlander from './assets/kinney-highlander.png';
import { downloadWorkbookUrl, getLatestReconciliationRunRequest, loginRequest } from './lib/api';
import {
  buildTabNavigationItems,
  reportCatalog,
  rulesCatalog,
  type AppTab,
  type ReportView,
} from './lib/appCatalog';
import { useReconciliationRun } from './hooks/useReconciliationRun';

type ReconciliationFrequency = 'Monthly' | 'Annual';
type OpenHelpField = string | null;
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

type ProgressStep = {
  id: string;
  label: string;
  description: string;
  isComplete: boolean;
  isCurrent: boolean;
  meterValue: number;
};
type SelectOption = {
  value: string;
  label: string;
};

const LAST_SUCCESSFUL_RUN_STORAGE_KEY = 'reconciliation-platform:latest-report-run';
const AUTHENTICATED_USER_STORAGE_KEY = 'reconciliation-platform:authenticated-user';
const SLIDER_DEFAULTS_STORAGE_KEY = 'reconciliation-platform:slider-defaults';
const invalidLoginMessage = 'The user or password does not match.';

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

const useDismissibleFieldHelp = (
  openHelpField: OpenHelpField,
  setOpenHelpField: Dispatch<SetStateAction<OpenHelpField>>,
): void => {
  useEffect(() => {
    if (!openHelpField) {
      return undefined;
    }

    const handleDocumentPointerDown = (event: MouseEvent): void => {
      const target = event.target;

      if (!(target instanceof Element)) {
        setOpenHelpField(null);
        return;
      }

      const activeHelpGroup = target.closest('[data-help-field]');

      if ((activeHelpGroup as HTMLElement | null)?.dataset?.helpField === openHelpField) {
        return;
      }

      setOpenHelpField(null);
    };

    document.addEventListener('mousedown', handleDocumentPointerDown);

    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown);
    };
  }, [openHelpField, setOpenHelpField]);
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
      controls={controls}
      showDeveloperDashboardLink={showDeveloperDashboardLink}
      developerDashboardHref={developerDashboardHref}
    />
  );
}

function ReconciliationApp({
  docsHref,
  rolePermissions,
  controls,
  showDeveloperDashboardLink,
  developerDashboardHref,
}: Readonly<{
  docsHref: string;
  rolePermissions: RolePermissions;
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
  const [openHelpField, setOpenHelpField] = useState<OpenHelpField>(null);
  const [hasDownloadedWorkbook, setHasDownloadedWorkbook] = useState(false);
  const [hasExportedJson, setHasExportedJson] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('upload');
  const [activeReport, setActiveReport] = useState<ReportView>('run-summary');
  const [persistedRun, setPersistedRun] = useState<RunData | undefined>(() => loadPersistedRun());
  const [hasAttemptedBackendReportHydration, setHasAttemptedBackendReportHydration] =
    useState(false);
  const [isHydratingLatestBackendReport, setIsHydratingLatestBackendReport] = useState(false);
  const [latestBackendReportError, setLatestBackendReportError] = useState<string | null>(null);
  const [varianceDefaultOverrides, setVarianceDefaultOverrides] =
    useState<RuleVarianceDefaultOverrides>(() => loadSliderDefaultOverrides());
  const [periodLabel, setPeriodLabel] = useState(
    buildDefaultPeriodLabel('Monthly', defaultMonth, annualYear, currentYear),
  );
  const reconciliation = useReconciliationRun();
  const run = reconciliation.data;
  const reportRun = run ?? persistedRun;

  const suggestedPeriodLabel = useMemo(
    () => buildDefaultPeriodLabel(reconciliationFrequency, monthlyMonth, annualYear, currentYear),
    [reconciliationFrequency, monthlyMonth, annualYear, currentYear],
  );

  useSuggestedPeriodLabel(isCustomPeriodLabel, suggestedPeriodLabel, setPeriodLabel);
  useDismissibleFieldHelp(openHelpField, setOpenHelpField);

  useEffect(() => {
    persistSliderDefaultOverrides(varianceDefaultOverrides);
  }, [varianceDefaultOverrides]);

  useEffect(() => {
    if (run) {
      setPersistedRun(run);
      persistRun(run);
      setActiveTab('exceptions');
      setActiveReport('run-summary');
      setLatestBackendReportError(null);
      setIsHydratingLatestBackendReport(false);
    }
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

  const handleSelectTab = (nextTab: AppTab): void => {
    if (nextTab !== 'upload' && !rolePermissions.canAccessApplication) {
      return;
    }

    setActiveTab(nextTab);

    if (nextTab === 'reports') {
      hydrateLatestBackendReport();
    }
  };

  const handleChangeVarianceDefault = (metricId: string, value: number): void => {
    if (!rolePermissions.canAdjustSliderDefaults) {
      return;
    }

    setVarianceDefaultOverrides((current) => ({
      ...current,
      [metricId]: value,
    }));
  };

  const handleResetVarianceDefaults = (): void => {
    if (!rolePermissions.canAdjustSliderDefaults) {
      return;
    }

    setVarianceDefaultOverrides({});
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
  ]);

  const completedStepCount = progressSteps.filter((step) => step.isComplete).length;
  const overallProgressPercent = Math.round((completedStepCount / progressSteps.length) * 100);

  const handleSubmit = (event: { preventDefault: () => void }): void => {
    event.preventDefault();

    if (!bankFile || !qboFile) {
      return;
    }

    reconciliation.mutate({
      bankFile,
      qboFile,
      accountIdentifier,
      reconciliationFrequency,
      periodLabel: trimmedPeriodLabel,
    });
  };

  const toggleFieldHelp = (field: string): void => {
    setOpenHelpField((current) => (current === field ? null : field));
  };

  return (
    <div className="app-shell">
      <div className="hero-backdrop" />
      <main className="app-layout">
        {controls}
        <HeroSection
          docsHref={docsHref}
          rolePermissions={rolePermissions}
          showDeveloperDashboardLink={showDeveloperDashboardLink}
          developerDashboardHref={developerDashboardHref}
          run={run}
          periodLabel={periodLabel}
          reconciliationFrequency={reconciliationFrequency}
          onOpenUploadTab={() => setActiveTab('upload')}
        />

        <section className="tabbed-workspace" aria-label="Reconciliation workspace">
          <TabNavigation
            activeTab={activeTab}
            exceptionCount={run?.exceptions.length ?? 0}
            reportCount={reportCatalog.length}
            canAccessApplication={rolePermissions.canAccessApplication}
            onSelectTab={handleSelectTab}
          />

          {activeTab === 'upload' ? (
            <SourceUploadSection
              annualYear={annualYear}
              canSubmit={canSubmit}
              currentYear={currentYear}
              handleSubmit={handleSubmit}
              isLabelMissing={isLabelMissing}
              monthlyMonth={monthlyMonth}
              openHelpField={openHelpField}
              periodLabel={periodLabel}
              previousSevenYears={previousSevenYears}
              reconciliation={reconciliation}
              reconciliationFrequency={reconciliationFrequency}
              run={run}
              setAccountIdentifier={setAccountIdentifier}
              setAnnualYear={setAnnualYear}
              setBankFile={setBankFile}
              setHasDownloadedWorkbook={setHasDownloadedWorkbook}
              setHasExportedJson={setHasExportedJson}
              setIsCustomPeriodLabel={setIsCustomPeriodLabel}
              setMonthlyMonth={setMonthlyMonth}
              setPeriodLabel={setPeriodLabel}
              setQboFile={setQboFile}
              setReconciliationFrequency={setReconciliationFrequency}
              suggestedPeriodLabel={suggestedPeriodLabel}
              toggleFieldHelp={toggleFieldHelp}
              accountIdentifier={accountIdentifier}
            />
          ) : null}

          {activeTab === 'rules' && rolePermissions.canAccessApplication ? (
            <RulesCatalogSection
              rules={rulesCatalog}
              varianceOverrides={varianceDefaultOverrides}
              canAdjustVarianceDefaults={rolePermissions.canAdjustSliderDefaults}
              onChangeVarianceDefault={handleChangeVarianceDefault}
              onResetVarianceDefaults={handleResetVarianceDefaults}
            />
          ) : null}

          {activeTab === 'exceptions' && rolePermissions.canAccessApplication ? (
            <RunResultsSection
              run={run}
              onExportJson={() => {
                if (!run) {
                  return;
                }

                setHasExportedJson(true);
                downloadJson(`${run.id}.json`, run);
              }}
              onDownloadWorkbook={() => setHasDownloadedWorkbook(true)}
            />
          ) : null}

          {activeTab === 'reports' && rolePermissions.canAccessApplication ? (
            <ReportsSection
              run={reportRun}
              activeReport={activeReport}
              isHydrating={isHydratingLatestBackendReport}
              loadError={latestBackendReportError}
              onSelectReport={setActiveReport}
              onExportJson={() => {
                if (!reportRun) {
                  return;
                }

                setHasExportedJson(true);
                downloadJson(`${reportRun.id}.json`, reportRun);
              }}
              onDownloadWorkbook={() => setHasDownloadedWorkbook(true)}
            />
          ) : null}
        </section>

        {activeTab === 'upload' ? (
          <ProcessProgressSection
            overallProgressPercent={overallProgressPercent}
            progressSteps={progressSteps}
          />
        ) : null}

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

function HeroSection({
  docsHref,
  rolePermissions,
  showDeveloperDashboardLink,
  developerDashboardHref,
  run,
  periodLabel,
  reconciliationFrequency,
  onOpenUploadTab,
}: Readonly<{
  docsHref: string;
  rolePermissions: RolePermissions;
  showDeveloperDashboardLink: boolean;
  developerDashboardHref: string;
  run: RunData | undefined;
  periodLabel: string;
  reconciliationFrequency: ReconciliationFrequency;
  onOpenUploadTab: () => void;
}>) {
  return (
    <header className="hero-card">
      <div>
        <div className="hero-heading-row">
          <div className="hero-title-block">
            <h1>Financial Reconciliation Platform</h1>
          </div>
          <div className="hero-brand">
            <img
              className="hero-brand__mascot"
              src={kinneyHighlander}
              alt="Small Scottish man in a kilt illustration"
            />
            <p className="hero-brand__company">Kinney Software Solutions LLC</p>
          </div>
        </div>
        <p>
          Audit-ready monthly workflow: upload source workbooks, preserve row-level traceability,
          run evidence-based matching, and export accountant-friendly workpapers with repeatable
          rules.
        </p>
        <div className="hero-cta-row">
          {rolePermissions.canAccessApplication ? (
            <a className="hero-primary-cta" href="#source-upload-form" onClick={onOpenUploadTab}>
              Start Reconciliation
            </a>
          ) : null}
          {rolePermissions.canAccessDocumentation ? (
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
      </div>
      <div className="hero-meta">
        <div>
          <span>Correlation-aware processing</span>
          <strong>{run?.correlationId ?? 'Awaiting run'}</strong>
        </div>
        <div>
          <span>Current period</span>
          <strong>{run?.periodLabel ?? (periodLabel || 'Not set')}</strong>
        </div>
        <div>
          <span>Reconciliation frequency</span>
          <strong>{reconciliationFrequency}</strong>
        </div>
      </div>
    </header>
  );
}

function TabNavigation({
  activeTab,
  exceptionCount,
  reportCount,
  canAccessApplication,
  onSelectTab,
}: Readonly<{
  activeTab: AppTab;
  exceptionCount: number;
  reportCount: number;
  canAccessApplication: boolean;
  onSelectTab: (tab: AppTab) => void;
}>) {
  const tabs = buildTabNavigationItems({
    ruleCount: rulesCatalog.length,
    exceptionCount,
    reportCount,
  }).filter((tab) => canAccessApplication || tab.id === 'upload');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);

  const focusAndSelectTab = (index: number): void => {
    const boundedIndex = (index + tabs.length) % tabs.length;
    const nextTab = tabs[boundedIndex];

    if (!nextTab) {
      return;
    }

    onSelectTab(nextTab.id);
    tabRefs.current[boundedIndex]?.focus();
  };

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusAndSelectTab(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusAndSelectTab(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAndSelectTab(0);
        break;
      case 'End':
        event.preventDefault();
        focusAndSelectTab(tabs.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <section className="tab-shell" aria-label="Application sections">
      <div
        className="tab-list"
        role="tablist"
        aria-label="Application tabs"
        aria-orientation="horizontal"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            className={activeTab === tab.id ? 'tab-button tab-button--active' : 'tab-button'}
            aria-selected={activeTab === tab.id}
            aria-controls={`tab-panel-${tab.id}`}
            tabIndex={activeIndex === index ? 0 : -1}
            onClick={() => onSelectTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            <span className="tab-button__label-row">
              <span className="tab-button__icon-shell" aria-hidden="true">
                <SemanticIcon name={tab.icon} className="tab-button__icon" />
              </span>
              <span className="tab-button__label-text">{tab.label}</span>
            </span>
            <small>{tab.description}</small>
          </button>
        ))}
      </div>
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
  canSubmit,
  currentYear,
  handleSubmit,
  isLabelMissing,
  monthlyMonth,
  openHelpField,
  periodLabel,
  previousSevenYears,
  reconciliation,
  reconciliationFrequency,
  run,
  setAccountIdentifier,
  setAnnualYear,
  setBankFile,
  setHasDownloadedWorkbook,
  setHasExportedJson,
  setIsCustomPeriodLabel,
  setMonthlyMonth,
  setPeriodLabel,
  setQboFile,
  setReconciliationFrequency,
  suggestedPeriodLabel,
  toggleFieldHelp,
}: Readonly<{
  accountIdentifier: string;
  annualYear: string;
  canSubmit: boolean;
  currentYear: number;
  handleSubmit: (event: { preventDefault: () => void }) => void;
  isLabelMissing: boolean;
  monthlyMonth: string;
  openHelpField: OpenHelpField;
  periodLabel: string;
  previousSevenYears: string[];
  reconciliation: ReconciliationModel;
  reconciliationFrequency: ReconciliationFrequency;
  run: RunData | undefined;
  setAccountIdentifier: Dispatch<SetStateAction<string>>;
  setAnnualYear: Dispatch<SetStateAction<string>>;
  setBankFile: Dispatch<SetStateAction<File | null>>;
  setHasDownloadedWorkbook: Dispatch<SetStateAction<boolean>>;
  setHasExportedJson: Dispatch<SetStateAction<boolean>>;
  setIsCustomPeriodLabel: Dispatch<SetStateAction<boolean>>;
  setMonthlyMonth: Dispatch<SetStateAction<string>>;
  setPeriodLabel: Dispatch<SetStateAction<string>>;
  setQboFile: Dispatch<SetStateAction<File | null>>;
  setReconciliationFrequency: Dispatch<SetStateAction<ReconciliationFrequency>>;
  suggestedPeriodLabel: string;
  toggleFieldHelp: (field: string) => void;
}>) {
  const reconciliationLabelErrorId = 'reconciliation-label-error';
  const reconciliationLabelHintId = 'reconciliation-label-hint';

  return (
    <TabPanel tabId="upload">
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
          <HelpedFileField
            accept=".xlsx"
            fieldId="bank-workbook"
            helpText="Upload the exported bank transaction workbook used as the bank source of truth."
            inputId="bank-workbook-input"
            isOpen={openHelpField === 'bank-workbook'}
            label="Bank workbook"
            onChange={(event) => setBankFile(event.target.files?.[0] ?? null)}
            toggleFieldHelp={toggleFieldHelp}
          />

          <HelpedFileField
            accept=".xlsx"
            fieldId="qbo-workbook"
            helpText="Upload the QuickBooks Online export workbook to compare against the bank records."
            inputId="qbo-workbook-input"
            isOpen={openHelpField === 'qbo-workbook'}
            label="QBO workbook"
            onChange={(event) => setQboFile(event.target.files?.[0] ?? null)}
            toggleFieldHelp={toggleFieldHelp}
          />

          <HelpedTextField
            fieldId="account-identifier"
            helpText="Optional account code shown in outputs and exports to identify which account this run belongs to."
            inputId="account-identifier-input"
            isOpen={openHelpField === 'account-identifier'}
            label="Account identifier"
            onChange={(event) => setAccountIdentifier(event.target.value)}
            placeholder="OPERATING-001"
            toggleFieldHelp={toggleFieldHelp}
            value={accountIdentifier}
          />

          <HelpedFrequencyField
            isOpen={openHelpField === 'reconciliation-frequency'}
            onChange={(event) =>
              setReconciliationFrequency(event.target.value as ReconciliationFrequency)
            }
            toggleFieldHelp={toggleFieldHelp}
            value={reconciliationFrequency}
          />

          <ReconciliationPeriodField
            annualYear={annualYear}
            currentYear={currentYear}
            monthlyMonth={monthlyMonth}
            openHelpField={openHelpField}
            previousSevenYears={previousSevenYears}
            reconciliationFrequency={reconciliationFrequency}
            setAnnualYear={setAnnualYear}
            setMonthlyMonth={setMonthlyMonth}
            toggleFieldHelp={toggleFieldHelp}
          />

          <HelpedLabelField
            hintId={reconciliationLabelHintId}
            isInvalid={isLabelMissing}
            isOpen={openHelpField === 'reconciliation-label'}
            labelErrorId={reconciliationLabelErrorId}
            onChange={(event) => {
              setIsCustomPeriodLabel(true);
              setPeriodLabel(event.target.value);
            }}
            periodLabel={periodLabel}
            suggestedPeriodLabel={suggestedPeriodLabel}
            toggleFieldHelp={toggleFieldHelp}
          />

          <p className="trust-note">
            Use only authorized XLSX exports and follow your organization&apos;s financial data
            handling policy.
          </p>

          <div className="upload-actions">
            <button type="submit" disabled={!canSubmit}>
              {reconciliation.isPending ? 'Running reconciliation...' : 'Run reconciliation'}
            </button>
            {run ? (
              <>
                <a
                  className="secondary-button"
                  href={downloadWorkbookUrl(run.id)}
                  onClick={() => setHasDownloadedWorkbook(true)}
                >
                  Download workbook
                </a>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setHasExportedJson(true);
                    downloadJson(`${run.id}.json`, run);
                  }}
                >
                  Export JSON
                </button>
              </>
            ) : null}
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

          <h1>Login</h1>

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
      <div className="user-role-shell__identity">
        <span>Signed in as</span>
        <strong>{displayName ?? activeUser.username}</strong>
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
  isOpen,
  onChange,
  toggleFieldHelp,
  value,
}: Readonly<{
  isOpen: boolean;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  toggleFieldHelp: (field: string) => void;
  value: ReconciliationFrequency;
}>) {
  return (
    <HelpedSelectField
      fieldId="reconciliation-frequency"
      helpText="Choose Monthly for one-month close checks, or Annual for full-year reconciliation validation."
      inputId="reconciliation-frequency-select"
      isOpen={isOpen}
      label="Reconciliation frequency"
      onChange={onChange}
      options={reconciliationFrequencyOptions}
      toggleFieldHelp={toggleFieldHelp}
      value={value}
    />
  );
}

function ReconciliationPeriodField({
  annualYear,
  currentYear,
  monthlyMonth,
  openHelpField,
  previousSevenYears,
  reconciliationFrequency,
  setAnnualYear,
  setMonthlyMonth,
  toggleFieldHelp,
}: Readonly<{
  annualYear: string;
  currentYear: number;
  monthlyMonth: string;
  openHelpField: OpenHelpField;
  previousSevenYears: string[];
  reconciliationFrequency: ReconciliationFrequency;
  setAnnualYear: Dispatch<SetStateAction<string>>;
  setMonthlyMonth: Dispatch<SetStateAction<string>>;
  toggleFieldHelp: (field: string) => void;
}>) {
  if (reconciliationFrequency === 'Annual') {
    const fieldId = 'annual-reconciliation-year';
    const isHelpOpen = openHelpField === fieldId;
    const annualYearOptions = previousSevenYears.map((year) => ({
      value: year,
      label: year,
    }));

    return (
      <HelpedSelectField
        fieldId={fieldId}
        helpText="Select the completed year you want to reconcile across all 12 months."
        inputId="annual-reconciliation-year-select"
        isOpen={isHelpOpen}
        label="Annual reconciliation year"
        hint={{
          id: 'annual-year-hint',
          text: 'Choose one of the last 7 completed years.',
        }}
        onChange={(event) => setAnnualYear(event.target.value)}
        options={annualYearOptions}
        toggleFieldHelp={toggleFieldHelp}
        value={annualYear}
      />
    );
  }

  const fieldId = 'monthly-reconciliation-month';
  const isHelpOpen = openHelpField === fieldId;
  const monthlyOptions = monthsWithinYear.map((month) => ({
    value: month,
    label: month,
  }));

  return (
    <HelpedSelectField
      fieldId={fieldId}
      helpText="Select the month in the current year that this reconciliation run represents."
      inputId="monthly-reconciliation-month-select"
      isOpen={isHelpOpen}
      label="Monthly reconciliation month"
      hint={{
        id: 'monthly-month-hint',
        text: `Month applies to the current year (${currentYear}).`,
      }}
      onChange={(event) => setMonthlyMonth(event.target.value)}
      options={monthlyOptions}
      toggleFieldHelp={toggleFieldHelp}
      value={monthlyMonth}
    />
  );
}

export default App;
