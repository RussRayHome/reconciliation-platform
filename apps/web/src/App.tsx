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
  RulesCatalogSection,
  RunResultsSection,
} from './components/AppWorkspacePanels';
import { SemanticIcon } from './components/SemanticIcon';
import kinneyHighlander from './assets/kinney-highlander.png';
import { downloadWorkbookUrl, getLatestReconciliationRunRequest } from './lib/api';
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

function App() {
  const showDeveloperDashboardLink =
    import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEVELOPER_DASHBOARD === 'true';

  if (globalThis.location.pathname.startsWith('/docs')) {
    return <DocsOverview showDeveloperDashboardLink={showDeveloperDashboardLink} />;
  }

  return <ReconciliationApp showDeveloperDashboardLink={showDeveloperDashboardLink} />;
}

function ReconciliationApp({
  showDeveloperDashboardLink,
}: Readonly<{ showDeveloperDashboardLink: boolean }>) {
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
    setActiveTab(nextTab);

    if (nextTab === 'reports') {
      hydrateLatestBackendReport();
    }
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
        <HeroSection
          showDeveloperDashboardLink={showDeveloperDashboardLink}
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

          {activeTab === 'rules' ? <RulesCatalogSection rules={rulesCatalog} /> : null}

          {activeTab === 'exceptions' ? (
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

          {activeTab === 'reports' ? (
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
  showDeveloperDashboardLink,
  run,
  periodLabel,
  reconciliationFrequency,
  onOpenUploadTab,
}: Readonly<{
  showDeveloperDashboardLink: boolean;
  run: RunData | undefined;
  periodLabel: string;
  reconciliationFrequency: ReconciliationFrequency;
  onOpenUploadTab: () => void;
}>) {
  return (
    <header className="hero-card">
      <div>
        <span className="eyebrow">Audit-ready monthly close workflow</span>
        <h1>Bank-to-QBO Reconciliation Platform</h1>
        <p>
          Upload source workbooks, preserve row-level traceability, run evidence-based matching, and
          export accountant-friendly workpapers with repeatable rules.
        </p>
        <a className="hero-primary-cta" href="#source-upload-form" onClick={onOpenUploadTab}>
          Start reconciliation
        </a>
        <a className="hero-secondary-cta" href="/docs">
          Open documentation hub
        </a>
        {showDeveloperDashboardLink ? (
          <a
            className="hero-secondary-cta hero-secondary-cta--spaced"
            href="/developer-dashboard.html"
          >
            Open developer dashboard
          </a>
        ) : null}
      </div>
      <div className="hero-meta">
        <div className="hero-brand">
          <img
            className="hero-brand__mascot"
            src={kinneyHighlander}
            alt="Small Scottish man in a kilt illustration"
          />
          <div>
            <span>Powered by</span>
            <strong>Kinney Software Solutions LLC</strong>
          </div>
        </div>
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
  onSelectTab,
}: Readonly<{
  activeTab: AppTab;
  exceptionCount: number;
  reportCount: number;
  onSelectTab: (tab: AppTab) => void;
}>) {
  const tabs = buildTabNavigationItems({
    ruleCount: rulesCatalog.length,
    exceptionCount,
    reportCount,
  });
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
