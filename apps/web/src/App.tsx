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
import { errorCategories, errorCategoryDisplayNames } from '@recon/domain';
import { SectionCard, StatCard } from '@recon/ui';

import { ChartsPanel } from './components/ChartsPanel';
import { DocsOverview } from './components/DocsOverview';
import { ExceptionTable } from './components/ExceptionTable';
import kinneyHighlander from './assets/kinney-highlander.png';
import { downloadWorkbookUrl, getLatestReconciliationRunRequest } from './lib/api';
import { useReconciliationRun } from './hooks/useReconciliationRun';

type ReconciliationFrequency = 'Monthly' | 'Annual';
type OpenHelpField = string | null;
type AppTab = 'upload' | 'rules' | 'exceptions' | 'reports';
type ReportView =
  | 'run-summary'
  | 'probable-match-review'
  | 'exception-report'
  | 'export-artifacts';
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
type RuleCatalogItem = {
  id: string;
  name: string;
  description: string;
  lastChange: string;
};
type ReportCatalogItem = {
  id: ReportView;
  name: string;
  description: string;
};

type CategorySummaryRow = {
  category: string;
  label: string;
  count: number;
  amount: number;
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

const rulesCatalog: RuleCatalogItem[] = [
  {
    id: 'reference-amount-match',
    name: 'Reference + Amount Match',
    description:
      'Pairs bank and QBO transactions when amounts agree within tolerance and reference similarity meets the configured threshold.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'month-end-transfer-review',
    name: 'Month-End Transfer Review Match',
    description:
      'Flags month-end transfer patterns as probable-review candidates when amount, month, and journal-entry context align but should not be forced into an exact match.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'text-reference-variance',
    name: 'Amount + Date + Text with Reference Variance',
    description:
      'Creates a review candidate when amount, date, and description align but check or reference identifiers conflict.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'amount-date-text-match',
    name: 'Amount + Date + Text Match',
    description:
      'Promotes transactions into a clean match when amount, date, and normalized text context align strongly enough for exact matching.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'description-variance',
    name: 'Amount + Date with Description Variance',
    description:
      'Sends same-amount, same-window pairs with weaker narrative similarity into review instead of exact matching.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'extended-date-window',
    name: 'Amount + Extended Date Window Match',
    description:
      'Creates a date-variance candidate when amounts agree but date drift falls outside the primary tolerance and inside the extended review window.',
    lastChange: '2026-04-04 | Date variance handling and downstream reporting refreshed',
  },
  {
    id: 'possible-amount-mismatch',
    name: 'Possible Amount Mismatch',
    description:
      'Marks near-date, high-similarity pairs for amount-mismatch review when narrative context aligns but recorded amounts differ.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
  {
    id: 'duplicate-detection',
    name: 'Duplicate Detection',
    description:
      'Detects same-source duplicates before cross-source matching using amount equality, close dates, and similar description or reference context.',
    lastChange: '2026-04-04 | Duplicate categories split into bank and QBO-specific exceptions',
  },
  {
    id: 'invalid-or-missing-data',
    name: 'Invalid or Missing Data',
    description:
      'Classifies rows with malformed or missing critical fields as data-quality exceptions so they do not participate in automated matching.',
    lastChange: '2026-04-04 | Exception trace and next-action guidance added',
  },
  {
    id: 'stale-outstanding-check',
    name: 'Stale Outstanding Check',
    description:
      'Promotes unmatched aged QBO check-like disbursements into a dedicated stale-check exception instead of generic missing-from-bank treatment.',
    lastChange: '2026-04-04 | Added deterministic stale-check classification',
  },
  {
    id: 'likely-miscoding',
    name: 'Likely Miscoding',
    description:
      'Promotes same-amount, near-date pairs into a miscoding exception when descriptive or reference context conflicts too strongly for an ordinary variance.',
    lastChange: '2026-04-04 | Added deterministic miscoding classification and trace metadata',
  },
  {
    id: 'missing-from-qbo',
    name: 'Missing from QBO',
    description:
      'Classifies unmatched bank-side transactions as missing from QBO after exact, review, and variance matching rules are exhausted.',
    lastChange: '2026-04-04 | Exception trace and next-action guidance added',
  },
  {
    id: 'missing-from-bank',
    name: 'Missing from Bank',
    description:
      'Classifies unmatched QBO-side transactions as missing from bank activity after exact, review, and variance matching rules are exhausted.',
    lastChange: '2026-04-04 | Exception trace and next-action guidance added',
  },
  {
    id: 'ambiguous-review',
    name: 'Ambiguous Match Requiring Review',
    description:
      'Holds back low-certainty top candidates when multiple close alternatives exist, preserving them for reviewer choice instead of forcing a weak match.',
    lastChange: '2026-04-04 | Matching rule catalog aligned to current reconciliation docs',
  },
];

const reportCatalog: ReportCatalogItem[] = [
  {
    id: 'run-summary',
    name: 'Run Summary',
    description: 'Category charts and run context for the current reconciliation.',
  },
  {
    id: 'probable-match-review',
    name: 'Probable Match Review',
    description: 'Candidate pairings that require reviewer confirmation before close.',
  },
  {
    id: 'exception-report',
    name: 'Exception Report',
    description: 'Searchable exception listing with rule trace, evidence, and next actions.',
  },
  {
    id: 'export-artifacts',
    name: 'Export Artifacts',
    description: 'Workbook and JSON outputs available for audit support and downstream review.',
  },
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
  frequency === 'Annual'
    ? `Annual Recon for ${year}`
    : `Monthly Recon for ${month} ${currentYear}`;

const joinIds = (...ids: Array<string | undefined>): string | undefined => {
  const filtered = ids.filter((item): item is string => Boolean(item));

  return filtered.length > 0 ? filtered.join(' ') : undefined;
};

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

const resolveStepState = (
  isComplete: boolean,
  isCurrent: boolean,
): { className: string; label: string } => {
  if (isComplete) {
    return { className: 'step-progress-state--complete', label: 'Complete' };
  }

  if (isCurrent) {
    return { className: 'step-progress-state--current', label: 'In progress' };
  }

  return { className: 'step-progress-state--pending', label: 'Pending' };
};

const buildCategorySummaryRows = (run: RunData): CategorySummaryRow[] => {
  const knownRows = errorCategories
    .map((category) => ({
      category,
      label: errorCategoryDisplayNames[category],
      count: run.summary.countsByCategory[category] ?? 0,
      amount: run.summary.amountByCategory[category] ?? 0,
    }))
    .filter((row) => row.count > 0 || row.amount > 0);

  const unknownRows = Object.keys(run.summary.countsByCategory)
    .filter((category) => !errorCategories.includes(category as (typeof errorCategories)[number]))
    .map((category) => ({
      category,
      label: category,
      count: run.summary.countsByCategory[category] ?? 0,
      amount: run.summary.amountByCategory[category] ?? 0,
    }))
    .filter((row) => row.count > 0 || row.amount > 0);

  return [...knownRows, ...unknownRows];
};

function ExceptionCategoryBreakdown({
  run,
}: Readonly<{
  run: RunData;
}>) {
  const rows = buildCategorySummaryRows(run);

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="table-shell category-breakdown-shell" aria-label="Exception category breakdown">
      <div className="category-breakdown-header">
        <h3>Exception Category Breakdown</h3>
        <p>Every category present in the detail report is summarized here from the final classified totals.</p>
      </div>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">
            Final exception categories with counts and absolute dollar exposure.
          </caption>
          <thead>
            <tr>
              <th>Category</th>
              <th>Count</th>
              <th>Absolute Dollars</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category}>
                <td>{row.label}</td>
                <td>{row.count}</td>
                <td>{row.amount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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
      return;
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
    import.meta.env.DEV ||
    import.meta.env.VITE_ENABLE_DEVELOPER_DASHBOARD === 'true';

  if (globalThis.location.pathname.startsWith('/docs')) {
    return (
      <DocsOverview
        showDeveloperDashboardLink={showDeveloperDashboardLink}
      />
    );
  }

  return (
    <ReconciliationApp
      showDeveloperDashboardLink={showDeveloperDashboardLink}
    />
  );
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
  const [hasAttemptedBackendReportHydration, setHasAttemptedBackendReportHydration] = useState(false);
  const [isHydratingLatestBackendReport, setIsHydratingLatestBackendReport] = useState(false);
  const [latestBackendReportError, setLatestBackendReportError] = useState<string | null>(null);
  const [periodLabel, setPeriodLabel] = useState(
    buildDefaultPeriodLabel('Monthly', defaultMonth, annualYear, currentYear),
  );
  const reconciliation = useReconciliationRun();
  const run = reconciliation.data;
  const reportRun = run ?? persistedRun;

  const suggestedPeriodLabel = useMemo(
    () =>
      buildDefaultPeriodLabel(
        reconciliationFrequency,
        monthlyMonth,
        annualYear,
        currentYear,
      ),
    [reconciliationFrequency, monthlyMonth, annualYear, currentYear],
  );

  useSuggestedPeriodLabel(
    isCustomPeriodLabel,
    suggestedPeriodLabel,
    setPeriodLabel,
  );
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
  const isConfigurationStepComplete =
    isUploadStepComplete && !isLabelMissing;
  const isRunStepComplete = Boolean(run);
  const isRunStepCurrent =
    isConfigurationStepComplete && !isRunStepComplete;
  const isExportStepComplete = hasDownloadedWorkbook || hasExportedJson;
  const isExportStepCurrent = isRunStepComplete && !isExportStepComplete;
  const isRunPendingStep = isRunStepCurrent || reconciliation.isPending;
  const canSubmit = Boolean(
    bankFile && qboFile && !reconciliation.isPending && !isLabelMissing,
  );

  const progressSteps = useMemo<ProgressStep[]>(() => {
    const uploadMeterValue = resolveMeterValue(
      isUploadStepComplete,
      hasStartedUploadStep,
      20,
    );
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
    const exportMeterValue = resolveMeterValue(
      isExportStepComplete,
      isExportStepCurrent,
      60,
    );

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
        description:
          'Choose frequency/period and provide a reconciliation label.',
        isComplete: isConfigurationStepComplete,
        isCurrent:
          isUploadStepComplete && !isConfigurationStepComplete,
        meterValue: configurationMeterValue,
      },
      {
        id: 'run',
        label: 'Run reconciliation',
        description:
          'Processing includes parsing, matching, and exception generation.',
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

  const completedStepCount = progressSteps.filter(
    (step) => step.isComplete,
  ).length;
  const overallProgressPercent = Math.round(
    (completedStepCount / progressSteps.length) * 100,
  );

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
            Next step: run reconciliation, review probable matches and
            exceptions, then export workbook and JSON for audit files.
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
          Upload source workbooks, preserve row-level traceability, run
          evidence-based matching, and export accountant-friendly workpapers
          with repeatable rules.
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
  const tabs: Array<{ id: AppTab; label: string; description: string }> = [
    { id: 'upload', label: 'Upload', description: 'Source files and run controls' },
    { id: 'rules', label: 'Rules', description: `${rulesCatalog.length} documented rules` },
    { id: 'exceptions', label: 'Exceptions', description: `${exceptionCount} current items` },
    { id: 'reports', label: 'Reports', description: `${reportCount} available views` },
  ];
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

  const handleTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
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
      <div className="tab-list" role="tablist" aria-label="Application tabs" aria-orientation="horizontal">
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
            <span>{tab.label}</span>
            <small>{tab.description}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function SummaryReportContent({
  run,
}: Readonly<{
  run: RunData;
}>) {
  return (
    <div className="reports-display-stack">
      <section className="stats-grid">
        <StatCard
          label="Total reviewed"
          value={run.summary.totalRecordsReviewed}
          helper="Bank + QBO records"
        />
        <StatCard
          label="Exact matches"
          value={run.summary.exactMatches}
          tone="positive"
          helper="Cleanly matched items"
        />
        <StatCard
          label="Probable matches"
          value={run.summary.probableMatches}
          tone="warning"
          helper="Review queue"
        />
        <StatCard
          label="Missing in bank"
          value={run.summary.missingFromBank}
          tone="critical"
          helper="QBO-side items without bank support"
        />
        <StatCard
          label="Missing in QBO"
          value={run.summary.missingFromQBO}
          tone="critical"
          helper="Bank-side items without QBO support"
        />
        <StatCard
          label="Bank duplicates"
          value={run.summary.bankDuplicates}
          tone="warning"
          helper="Potential duplicate bank entries"
        />
        <StatCard
          label="QBO duplicates"
          value={run.summary.qboDuplicates}
          tone="warning"
          helper="Potential duplicate QBO entries"
        />
        <StatCard
          label="Date variances"
          value={run.summary.dateVariances}
          tone="warning"
          helper="Matched amounts with reviewable date drift"
        />
        <StatCard
          label="Timing differences"
          value={run.summary.timingDifferences}
          helper="Likely posting lag"
        />
        <StatCard
          label="Data quality issues"
          value={run.summary.dataQualityIssues}
          tone="critical"
          helper="Malformed or zero-amount rows"
        />
        <StatCard
          label="Exception exposure"
          value={run.summary.unresolvedExposure.toFixed(2)}
          tone="critical"
          helper="Absolute dollars across classified exceptions"
        />
      </section>
      <div className="summary-badges">
        <span>{run.accountIdentifier ?? 'No account override'}</span>
        <span>{run.sourceFiles.map((item) => item.fileName).join(' + ')}</span>
      </div>
      <ChartsPanel summary={run.summary} />
      <ExceptionCategoryBreakdown run={run} />
    </div>
  );
}

function ProbableMatchesContent({
  probableMatches,
}: Readonly<{
  probableMatches: RunData['probableMatches'];
}>) {
  if (probableMatches.length === 0) {
    return (
      <div className="empty-state-card">
        <span className="eyebrow">No candidates</span>
        <h3>No probable matches to review</h3>
        <p>
          This run did not produce any low-confidence candidate pairings that need
          manual confirmation.
        </p>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">
          Probable match candidates to review before final reconciliation.
        </caption>
        <thead>
          <tr>
            <th>Disposition</th>
            <th>Confidence</th>
            <th>Rule</th>
            <th>Date diff</th>
            <th>Amount diff</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {probableMatches.map((item) => (
            <tr key={item.id}>
              <td>{item.disposition}</td>
              <td>{item.confidence}</td>
              <td>{item.ruleName}</td>
              <td>{item.dateDifferenceDays ?? 'N/A'}</td>
              <td>{item.amountDifference.toFixed(2)}</td>
              <td>{item.evidence.join(' | ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExceptionReportContent({
  run,
  onDownloadWorkbook,
  onExportJson,
}: Readonly<{
  run: RunData;
  onDownloadWorkbook: () => void;
  onExportJson: () => void;
}>) {
  return (
    <>
      <div className="summary-badges">
        <a
          className="secondary-button"
          href={downloadWorkbookUrl(run.id)}
          onClick={onDownloadWorkbook}
        >
          Download workbook
        </a>
        <button
          type="button"
          className="secondary-button"
          onClick={onExportJson}
        >
          Export JSON
        </button>
      </div>
      <ExceptionTable exceptions={run.exceptions} />
    </>
  );
}

function ExportArtifactsContent({
  run,
  onDownloadWorkbook,
  onExportJson,
}: Readonly<{
  run: RunData;
  onDownloadWorkbook: () => void;
  onExportJson: () => void;
}>) {
  return (
    <div className="artifacts-grid">
      <article className="rules-overview-card">
        <span className="eyebrow">Workbook package</span>
        <h3>{run.outputWorkbook?.fileName ?? `${run.id}.xlsx`}</h3>
        <p>
          Generated workbook with accountant-facing tabs for reconciliation review
          and archival support.
        </p>
        <div className="rule-card__meta">
          <span>Worksheet tabs</span>
          <strong>{run.outputWorkbook?.tabNames.join(' | ') ?? 'Pending generation'}</strong>
        </div>
        <a
          className="secondary-button"
          href={downloadWorkbookUrl(run.id)}
          onClick={onDownloadWorkbook}
        >
          Download workbook
        </a>
      </article>

      <article className="rules-overview-card">
        <span className="eyebrow">JSON archive</span>
        <h3>{`${run.id}.json`}</h3>
        <p>
          Structured reconciliation output including summary metrics, probable
          matches, grouped review artifacts, exceptions, and reviewer decisions.
        </p>
        <div className="rule-card__meta">
          <span>Includes</span>
          <strong>Summary, grouped matches, exceptions, reviewer decisions</strong>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={onExportJson}
        >
          Export JSON
        </button>
      </article>
    </div>
  );
}

function ReportsSection({
  run,
  activeReport,
  isHydrating,
  loadError,
  onSelectReport,
  onDownloadWorkbook,
  onExportJson,
}: Readonly<{
  run: RunData | undefined;
  activeReport: ReportView;
  isHydrating: boolean;
  loadError: string | null;
  onSelectReport: (report: ReportView) => void;
  onDownloadWorkbook: () => void;
  onExportJson: () => void;
}>) {
  const defaultReport: ReportCatalogItem = {
    id: 'run-summary',
    name: 'Run Summary',
    description: 'Category charts and run context for the current reconciliation.',
  };
  const selectedReport =
    reportCatalog.find((report) => report.id === activeReport) ?? defaultReport;
  let reportContent: ReactNode;

  if (run) {
    reportContent = (
      <>
        {activeReport === 'run-summary' ? <SummaryReportContent run={run} /> : null}
        {activeReport === 'probable-match-review' ? (
          <ProbableMatchesContent probableMatches={run.probableMatches} />
        ) : null}
        {activeReport === 'exception-report' ? (
          <ExceptionReportContent
            run={run}
            onDownloadWorkbook={onDownloadWorkbook}
            onExportJson={onExportJson}
          />
        ) : null}
        {activeReport === 'export-artifacts' ? (
          <ExportArtifactsContent
            run={run}
            onDownloadWorkbook={onDownloadWorkbook}
            onExportJson={onExportJson}
          />
        ) : null}
      </>
    );
  } else if (isHydrating) {
    reportContent = (
      <div className="empty-state-card" role="status" aria-live="polite">
        <span className="eyebrow">Loading latest run</span>
        <h3>Loading report output</h3>
        <p>
          Retrieving the most recent reconciliation run from the backend so
          the selected report can render with saved data.
        </p>
      </div>
    );
  } else if (loadError) {
    reportContent = (
      <div className="empty-state-card" role="alert">
        <span className="eyebrow">Unable to load reports</span>
        <h3>Latest report output could not be loaded</h3>
        <p>{loadError}</p>
      </div>
    );
  } else {
    reportContent = (
      <div className="empty-state-card">
        <span className="eyebrow">Awaiting run</span>
        <h3>No report output yet</h3>
        <p>
          Run a reconciliation from the Upload tab, then select a report to
          display the generated results here.
        </p>
      </div>
    );
  }

  return (
    <section id="tab-panel-reports" role="tabpanel" aria-labelledby="tab-reports">
      <SectionCard
        title="Reports"
        description="Select a report from the list to display the current reconciliation output in-place."
      >
        <div className="reports-browser">
          <nav className="reports-list" aria-label="Available reports">
            {reportCatalog.map((report) => (
              <button
                key={report.id}
                type="button"
                className={
                  activeReport === report.id
                    ? 'report-link report-link--active'
                    : 'report-link'
                }
                onClick={() => onSelectReport(report.id)}
              >
                <span>{report.name}</span>
                <small>{report.description}</small>
              </button>
            ))}
          </nav>

          <section className="reports-display" aria-live="polite" aria-busy={isHydrating}>
            <div className="reports-display__header">
              <span className="eyebrow">Selected report</span>
              <h3>{selectedReport.name}</h3>
              <p>{selectedReport.description}</p>
            </div>
            {reportContent}
          </section>
        </div>
      </SectionCard>
    </section>
  );
}

function RulesCatalogSection({
  rules,
}: Readonly<{
  rules: RuleCatalogItem[];
}>) {
  return (
    <section id="tab-panel-rules" role="tabpanel" aria-labelledby="tab-rules">
      <SectionCard
        title="Rules Catalog"
        description="Current matching and classification rules surfaced from the reconciliation rulebook so reviewers can see the active decision logic in one place."
      >
        <div className="rules-overview-grid">
          <article className="rules-overview-card">
            <span className="eyebrow">Rulebook snapshot</span>
            <h3>{rules.length} rules currently surfaced</h3>
            <p>
              The list below reflects the active matching and exception rules
              documented for this build, including the latest rulebook refresh date.
            </p>
          </article>
          <article className="rules-overview-card">
            <span className="eyebrow">Last rulebook refresh</span>
            <h3>2026-04-04</h3>
            <p>
              Date variance handling, deterministic classifier rules, and
              structured exception trace metadata are included in this catalog.
            </p>
          </article>
        </div>

        <div className="rules-grid">
          {rules.map((rule) => (
            <article key={rule.id} className="rule-card">
              <div className="rule-card__header">
                <h3>{rule.name}</h3>
                <span className="rule-card__pill">Active</span>
              </div>
              <p>{rule.description}</p>
              <div className="rule-card__meta">
                <span>Last Change</span>
                <strong>{rule.lastChange}</strong>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
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
    <section id="tab-panel-upload" role="tabpanel" aria-labelledby="tab-upload">
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
            setReconciliationFrequency(
              event.target.value as ReconciliationFrequency,
            )
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
          Use only authorized XLSX exports and follow your organization&apos;s
          financial data handling policy.
        </p>

        <div className="upload-actions">
          <button type="submit" disabled={!canSubmit}>
            {reconciliation.isPending
              ? 'Running reconciliation...'
              : 'Run reconciliation'}
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
          <p className="error-banner" role="alert">{reconciliation.error.message}</p>
        ) : null}
        </form>
      </SectionCard>
    </section>
  );
}

function ProcessProgressSection({
  overallProgressPercent,
  progressSteps,
}: Readonly<{
  overallProgressPercent: number;
  progressSteps: ProgressStep[];
}>) {
  return (
    <SectionCard
      title="Process Progress"
      description="Track overall reconciliation progress and each individual step until completion."
    >
      <div className="process-progress-grid">
        <article className="overall-progress-card" aria-live="polite">
          <div className="overall-progress-head">
            <span>Overall Process Meter</span>
            <strong>{overallProgressPercent}%</strong>
          </div>
          <progress
            className="progress-meter"
            aria-label="Overall process progress"
            max={100}
            value={overallProgressPercent}
          />
        </article>

        <ul className="step-progress-list" aria-label="Reconciliation step progress">
          {progressSteps.map((step) => {
            const stepState = resolveStepState(step.isComplete, step.isCurrent);

            return (
              <li className="step-progress-item" key={step.id}>
                <div className="step-progress-head">
                  <h3>{step.label}</h3>
                  <span className={`step-progress-state ${stepState.className}`}>
                    {stepState.label}
                  </span>
                </div>
                <progress
                  className="progress-meter"
                  aria-label={`${step.label} progress`}
                  max={100}
                  value={step.meterValue}
                />
                <p>{step.description}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionCard>
  );
}

function RunResultsSection({
  run,
  onDownloadWorkbook,
  onExportJson,
}: Readonly<{
  run: RunData | undefined;
  onDownloadWorkbook: () => void;
  onExportJson: () => void;
}>) {
  if (!run) {
    return (
      <section id="tab-panel-exceptions" role="tabpanel" aria-labelledby="tab-exceptions">
        <SectionCard
          title="Exceptions"
          description="Run a reconciliation first to populate probable matches, summary metrics, and the exception report."
        >
          <div className="empty-state-card">
            <span className="eyebrow">Awaiting run</span>
            <h3>No exception set yet</h3>
            <p>
              Upload both source workbooks in the Upload tab and run the
              reconciliation. The exception report, probable matches, and
              summary metrics will appear here automatically.
            </p>
          </div>
        </SectionCard>
      </section>
    );
  }

  return (
    <section id="tab-panel-exceptions" role="tabpanel" aria-labelledby="tab-exceptions">
      <section className="stats-grid">
        <StatCard
          label="Total reviewed"
          value={run.summary.totalRecordsReviewed}
          helper="Bank + QBO records"
        />
        <StatCard
          label="Exact matches"
          value={run.summary.exactMatches}
          tone="positive"
          helper="Cleanly matched items"
        />
        <StatCard
          label="Probable matches"
          value={run.summary.probableMatches}
          tone="warning"
          helper="Review queue"
        />
        <StatCard
          label="Missing in bank"
          value={run.summary.missingFromBank}
          tone="critical"
          helper="QBO-side items without bank support"
        />
        <StatCard
          label="Missing in QBO"
          value={run.summary.missingFromQBO}
          tone="critical"
          helper="Bank-side items without QBO support"
        />
        <StatCard
          label="Bank duplicates"
          value={run.summary.bankDuplicates}
          tone="warning"
          helper="Potential duplicate bank entries"
        />
        <StatCard
          label="QBO duplicates"
          value={run.summary.qboDuplicates}
          tone="warning"
          helper="Potential duplicate QBO entries"
        />
        <StatCard
          label="Date variances"
          value={run.summary.dateVariances}
          tone="warning"
          helper="Matched amounts with reviewable date drift"
        />
        <StatCard
          label="Timing differences"
          value={run.summary.timingDifferences}
          helper="Likely posting lag"
        />
        <StatCard
          label="Data quality issues"
          value={run.summary.dataQualityIssues}
          tone="critical"
          helper="Malformed or zero-amount rows"
        />
        <StatCard
          label="Exception exposure"
          value={run.summary.unresolvedExposure.toFixed(2)}
          tone="critical"
          helper="Absolute dollars across classified exceptions"
        />
      </section>

      <SectionCard
        title="Run Summary"
        description="Exceptions are sorted by severity, source, transaction date, and line number for accounting review."
        actions={
          <div className="summary-badges">
            <span>{run.accountIdentifier ?? 'No account override'}</span>
            <span>{run.sourceFiles.map((item) => item.fileName).join(' + ')}</span>
          </div>
        }
      >
        <ChartsPanel summary={run.summary} />
        <ExceptionCategoryBreakdown run={run} />
      </SectionCard>

      <SectionCard
        title="Probable Match Review"
        description="The engine never forces weak matches. Review these candidate pairings separately from the error report."
      >
        <ProbableMatchesContent probableMatches={run.probableMatches} />
      </SectionCard>

      <SectionCard
        title="Exception Report"
        description="Filter and search exceptions without losing source-line traceability."
        actions={
          <div className="summary-badges">
            <a
              className="secondary-button"
              href={downloadWorkbookUrl(run.id)}
              onClick={onDownloadWorkbook}
            >
              Download workbook
            </a>
            <button
              type="button"
              className="secondary-button"
              onClick={onExportJson}
            >
              Export JSON
            </button>
          </div>
        }
      >
        <ExceptionTable exceptions={run.exceptions} />
      </SectionCard>
    </section>
  );
}

function HelpedFileField({
  accept,
  fieldId,
  helpText,
  inputId,
  isOpen,
  label,
  onChange,
  toggleFieldHelp,
}: Readonly<{
  accept: string;
  fieldId: string;
  helpText: string;
  inputId: string;
  isOpen: boolean;
  label: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  toggleFieldHelp: (field: string) => void;
}>) {
  const helpId = `${fieldId}-help`;

  return (
    <div className="field-group" data-help-field={fieldId}>
      <FieldLabelRow
        fieldId={fieldId}
        helpId={helpId}
        inputId={inputId}
        isOpen={isOpen}
        label={label}
        helpButtonLabel={fieldId === 'bank-workbook' ? 'bank source file' : label}
        toggleFieldHelp={toggleFieldHelp}
      />
      {isOpen ? <small id={helpId} className="field-help-popover">{helpText}</small> : null}
      <input
        id={inputId}
        type="file"
        accept={accept}
        aria-describedby={isOpen ? helpId : undefined}
        onChange={onChange}
      />
    </div>
  );
}

function HelpedTextField({
  fieldId,
  helpText,
  inputId,
  isOpen,
  label,
  onChange,
  placeholder,
  toggleFieldHelp,
  value,
}: Readonly<{
  fieldId: string;
  helpText: string;
  inputId: string;
  isOpen: boolean;
  label: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  toggleFieldHelp: (field: string) => void;
  value: string;
}>) {
  const helpId = `${fieldId}-help`;

  return (
    <div className="field-group" data-help-field={fieldId}>
      <FieldLabelRow
        fieldId={fieldId}
        helpId={helpId}
        inputId={inputId}
        isOpen={isOpen}
        label={label}
        toggleFieldHelp={toggleFieldHelp}
      />
      {isOpen ? <small id={helpId} className="field-help-popover">{helpText}</small> : null}
      <input
        id={inputId}
        value={value}
        aria-describedby={isOpen ? helpId : undefined}
        onChange={onChange}
        placeholder={placeholder}
      />
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
  const fieldId = 'reconciliation-frequency';
  const helpId = `${fieldId}-help`;

  return (
    <div className="field-group" data-help-field={fieldId}>
      <FieldLabelRow
        fieldId={fieldId}
        helpId={helpId}
        inputId="reconciliation-frequency-select"
        isOpen={isOpen}
        label="Reconciliation frequency"
        toggleFieldHelp={toggleFieldHelp}
      />
      {isOpen ? (
        <small id={helpId} className="field-help-popover">
          Choose Monthly for one-month close checks, or Annual for full-year
          reconciliation validation.
        </small>
      ) : null}
      <select
        id="reconciliation-frequency-select"
        value={value}
        aria-describedby={isOpen ? helpId : undefined}
        onChange={onChange}
      >
        <option value="Monthly">Monthly</option>
        <option value="Annual">Annual</option>
      </select>
    </div>
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
    const helpId = `${fieldId}-help`;

    return (
      <div className="field-group" data-help-field={fieldId}>
        <FieldLabelRow
          fieldId={fieldId}
          helpId={helpId}
          inputId="annual-reconciliation-year-select"
          isOpen={openHelpField === fieldId}
          label="Annual reconciliation year"
          toggleFieldHelp={toggleFieldHelp}
        />
        {openHelpField === fieldId ? (
          <small id={helpId} className="field-help-popover">
            Select the completed year you want to reconcile across all 12 months.
          </small>
        ) : null}
        <select
          id="annual-reconciliation-year-select"
          value={annualYear}
          aria-describedby={joinIds(
            openHelpField === fieldId ? helpId : undefined,
            'annual-year-hint',
          )}
          onChange={(event) => setAnnualYear(event.target.value)}
        >
          {previousSevenYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <small id="annual-year-hint" className="field-hint">
          Choose one of the last 7 completed years.
        </small>
      </div>
    );
  }

  const fieldId = 'monthly-reconciliation-month';
  const helpId = `${fieldId}-help`;

  return (
    <div className="field-group" data-help-field={fieldId}>
      <FieldLabelRow
        fieldId={fieldId}
        helpId={helpId}
        inputId="monthly-reconciliation-month-select"
        isOpen={openHelpField === fieldId}
        label="Monthly reconciliation month"
        toggleFieldHelp={toggleFieldHelp}
      />
      {openHelpField === fieldId ? (
        <small id={helpId} className="field-help-popover">
          Select the month in the current year that this reconciliation run
          represents.
        </small>
      ) : null}
      <select
        id="monthly-reconciliation-month-select"
        value={monthlyMonth}
        aria-describedby={joinIds(
          openHelpField === fieldId ? helpId : undefined,
          'monthly-month-hint',
        )}
        onChange={(event) => setMonthlyMonth(event.target.value)}
      >
        {monthsWithinYear.map((month) => (
          <option key={month} value={month}>
            {month}
          </option>
        ))}
      </select>
      <small id="monthly-month-hint" className="field-hint">
        Month applies to the current year ({currentYear}).
      </small>
    </div>
  );
}

function HelpedLabelField({
  hintId,
  isInvalid,
  isOpen,
  labelErrorId,
  onChange,
  periodLabel,
  suggestedPeriodLabel,
  toggleFieldHelp,
}: Readonly<{
  hintId: string;
  isInvalid: boolean;
  isOpen: boolean;
  labelErrorId: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  periodLabel: string;
  suggestedPeriodLabel: string;
  toggleFieldHelp: (field: string) => void;
}>) {
  const fieldId = 'reconciliation-label';
  const helpId = `${fieldId}-help`;

  return (
    <div className="field-group" data-help-field={fieldId}>
      <FieldLabelRow
        fieldId={fieldId}
        helpId={helpId}
        inputId="reconciliation-label-input"
        isOpen={isOpen}
        label="Reconciliation label"
        toggleFieldHelp={toggleFieldHelp}
      />
      {isOpen ? (
        <small id={helpId} className="field-help-popover">
          Editable run title used in reports and workbook exports so reviewers
          can identify the period quickly.
        </small>
      ) : null}
      <div className="label-input-row">
        <input
          id="reconciliation-label-input"
          value={periodLabel}
          aria-invalid={isInvalid}
          aria-describedby={joinIds(
            isOpen ? helpId : undefined,
            hintId,
            isInvalid ? labelErrorId : undefined,
          )}
          onChange={onChange}
          placeholder="Reconciliation label"
        />
      </div>
      <small id={hintId} className="field-hint">
        Suggested: {suggestedPeriodLabel}
      </small>
    </div>
  );
}

function FieldLabelRow({
  fieldId,
  helpId,
  inputId,
  isOpen,
  helpButtonLabel,
  label,
  toggleFieldHelp,
}: Readonly<{
  fieldId: string;
  helpId: string;
  inputId: string;
  isOpen: boolean;
  helpButtonLabel?: string;
  label: string;
  toggleFieldHelp: (field: string) => void;
}>) {
  return (
    <div className="field-label-row">
      <label htmlFor={inputId}>{label}</label>
      <button
        type="button"
        className="help-icon-button"
        aria-label={
          helpButtonLabel
            ? `Open help for ${helpButtonLabel.toLowerCase()}`
            : 'Open help for this field'
        }
        aria-expanded={isOpen}
        aria-controls={helpId}
        onClick={() => toggleFieldHelp(fieldId)}
      >
        ?
      </button>
    </div>
  );
}

export default App;