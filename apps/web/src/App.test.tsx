// @vitest-environment jsdom

import type * as ApiModule from './lib/api';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import App from './App';
import userEvent from '@testing-library/user-event';

const mockedApiState = vi.hoisted<{
  latestRunResponse: unknown;
  latestRunError: Error | null;
  latestRunPromise: Promise<unknown> | null;
}>(() => ({
  latestRunResponse: null,
  latestRunError: null,
  latestRunPromise: null,
}));

vi.mock('./lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('./lib/api');

  return {
    ...actual,
    getLatestReconciliationRunRequest: vi.fn(async () => {
      if (mockedApiState.latestRunPromise) {
        return (await mockedApiState.latestRunPromise) as Awaited<
          ReturnType<typeof actual.getLatestReconciliationRunRequest>
        >;
      }

      if (mockedApiState.latestRunError) {
        throw mockedApiState.latestRunError;
      }

      if (!mockedApiState.latestRunResponse) {
        throw new Error('No latest reconciliation run available in test state.');
      }

      return mockedApiState.latestRunResponse as Awaited<
        ReturnType<typeof actual.getLatestReconciliationRunRequest>
      >;
    }),
  };
});

const storage = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  },
});

const AUTHENTICATED_USER_STORAGE_KEY = 'reconciliation-platform:authenticated-user';

const setAuthenticatedUser = (username: string): void => {
  globalThis.localStorage.setItem(AUTHENTICATED_USER_STORAGE_KEY, JSON.stringify({ username }));
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

const createRunResponse = () => ({
  id: 'run-1',
  correlationId: 'corr-1',
  status: 'Completed',
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  sourceFiles: [
    { id: '1', source: 'bank', fileName: 'bank.xlsx' },
    { id: '2', source: 'qbo', fileName: 'qbo.xlsx' },
  ],
  rawRows: [],
  normalizedTransactions: [],
  matchResults: [],
  probableMatches: [
    {
      id: 'probable-1',
      disposition: 'Review',
      confidence: 'Medium',
      ruleName: 'Amount + Date + Text with Reference Variance',
      dateDifferenceDays: 2,
      amountDifference: 0,
      evidence: ['Amount aligned', 'Date within tolerance', 'Reference mismatch detected'],
    },
  ],
  exceptions: [
    {
      id: 'exception-1',
      category: 'MissingFromQBO',
      severity: 'High',
      source: 'bank',
      spreadsheetFileName: 'bank.xlsx',
      lineNumber: 5,
      amount: 125.5,
      errorMessage: 'Missing from QBO',
      ruleTrace: {
        ruleId: 'missing-from-qbo',
        ruleName: 'Missing from QBO',
        reason:
          'No QBO-side transaction remained after exact, review, and variance matching rules were applied.',
        evidence: ['Transaction stayed unmatched after cross-source candidate selection.'],
      },
      recommendedNextActions: [
        'Check whether the bank transaction was recorded to the correct QBO account and period.',
        'Create or correct the QBO entry if source support confirms the bank activity is valid.',
      ],
      normalizedComparisonTokens: ['ACME'],
      relatedTransactionIds: [],
    },
    {
      id: 'exception-2',
      category: 'LikelySplitCombineIssue',
      severity: 'High',
      source: 'bank',
      spreadsheetFileName: 'bank.xlsx',
      lineNumber: 8,
      amount: 250,
      errorMessage: 'Likely split/combine issue',
      ruleTrace: {
        ruleId: 'grouped-split-combine-residual',
        ruleName: 'Grouped Split/Combine Residual',
        reason:
          'Residual unmatched transactions form a one-to-many relationship that the one-to-one matcher cannot settle cleanly.',
        evidence: ['Grouped total balances across sources.'],
        counterpart: {
          source: 'qbo',
          spreadsheetFileName: 'qbo.xlsx',
          lineNumber: 4,
          transactionId: 'qbo-4',
        },
        counterparts: [
          {
            source: 'qbo',
            spreadsheetFileName: 'qbo.xlsx',
            lineNumber: 4,
            transactionId: 'qbo-4',
          },
          {
            source: 'qbo',
            spreadsheetFileName: 'qbo.xlsx',
            lineNumber: 5,
            transactionId: 'qbo-5',
          },
        ],
      },
      recommendedNextActions: [
        'Review nearby transactions for one-to-many or many-to-one combinations that sum to the same net activity.',
      ],
      normalizedComparisonTokens: ['GROUPED', 'PAYMENT'],
      relatedTransactionIds: ['bank-8', 'qbo-4', 'qbo-5'],
    },
    {
      id: 'exception-3',
      category: 'DepositGroupingIssue',
      severity: 'High',
      source: 'qbo',
      spreadsheetFileName: 'qbo.xlsx',
      lineNumber: 12,
      amount: 410,
      errorMessage: 'Deposit grouping issue',
      ruleTrace: {
        ruleId: 'grouped-deposit-residual',
        ruleName: 'Grouped Deposit Residual',
        reason:
          'Residual unmatched deposits form a grouped receipt pattern rather than independent missing items.',
        evidence: ['Grouped deposit total balances across sources.'],
        counterpart: {
          source: 'bank',
          spreadsheetFileName: 'bank.xlsx',
          lineNumber: 12,
          transactionId: 'bank-12',
        },
        counterparts: [
          {
            source: 'bank',
            spreadsheetFileName: 'bank.xlsx',
            lineNumber: 12,
            transactionId: 'bank-12',
          },
        ],
      },
      recommendedNextActions: [
        'Compare the bank deposit to underlying receipts or batch detail to confirm whether multiple book entries roll into one deposit.',
      ],
      normalizedComparisonTokens: ['BATCH', 'DEPOSIT'],
      relatedTransactionIds: ['bank-12', 'qbo-8', 'qbo-9'],
    },
    {
      id: 'exception-4',
      category: 'TimingDifference',
      severity: 'Medium',
      source: 'bank',
      spreadsheetFileName: 'bank.xlsx',
      lineNumber: 18,
      amount: -2400,
      errorMessage: 'Timing difference',
      ruleTrace: {
        ruleId: 'timing-difference-reclassification',
        ruleName: 'Timing Difference Reclassification',
        reason:
          'A same-amount, timing-compatible counterpart exists outside the primary date tolerance but within the timing-difference window.',
        evidence: ['Same amount paired within the extended timing window.'],
        counterpart: {
          source: 'qbo',
          spreadsheetFileName: 'qbo.xlsx',
          lineNumber: 21,
          transactionId: 'qbo-21',
        },
        counterparts: [
          {
            source: 'qbo',
            spreadsheetFileName: 'qbo.xlsx',
            lineNumber: 21,
            transactionId: 'qbo-21',
          },
        ],
      },
      priorRuleTraces: [
        {
          ruleId: 'amount-extended-date-window-match',
          ruleName: 'Amount + Extended Date Window Match',
          reason: 'Original date variance classification',
          evidence: ['Amounts agree within configured tolerance.'],
          counterpart: {
            source: 'qbo',
            spreadsheetFileName: 'qbo.xlsx',
            lineNumber: 21,
            transactionId: 'qbo-21',
          },
          counterparts: [
            {
              source: 'qbo',
              spreadsheetFileName: 'qbo.xlsx',
              lineNumber: 21,
              transactionId: 'qbo-21',
            },
          ],
        },
      ],
      recommendedNextActions: [
        'Carry as timing support and monitor the next reconciliation cycle.',
      ],
      normalizedComparisonTokens: ['PAYROLL', 'APRIL'],
      relatedTransactionIds: ['bank-18', 'qbo-21'],
    },
  ],
  summary: {
    totalRecordsReviewed: 12,
    bankRecords: 6,
    qboRecords: 6,
    exactMatches: 4,
    probableMatches: 1,
    unmatchedItems: 2,
    duplicates: 1,
    bankDuplicates: 1,
    qboDuplicates: 0,
    dateVariances: 1,
    timingDifferences: 1,
    dataQualityIssues: 1,
    amountMismatches: 0,
    missingFromBank: 1,
    missingFromQBO: 1,
    unmatchedBankNetAmount: 125.5,
    unmatchedQboNetAmount: 0,
    cleanMatchedAmount: 6400,
    unresolvedExposure: 125.5,
    countsByCategory: {
      MissingFromQBO: 1,
      LikelySplitCombineIssue: 1,
      DepositGroupingIssue: 1,
      TimingDifference: 1,
    },
    amountByCategory: {
      MissingFromQBO: 125.5,
      LikelySplitCombineIssue: 250,
      DepositGroupingIssue: 410,
      TimingDifference: 2400,
    },
    charts: [
      { id: 'countByCategory', title: 'Counts', data: [] },
      { id: 'exposureByCategory', title: 'Exposure', data: [] },
    ],
  },
  reviewerObservations: [],
  auditEvents: [],
  outputWorkbook: {
    fileName: 'run-1.xlsx',
    generatedAt: new Date().toISOString(),
    tabNames: ['Summary', 'Probable Matches', 'Exceptions'],
  },
});

const renderApp = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  storage.clear();
  mockedApiState.latestRunResponse = null;
  mockedApiState.latestRunError = null;
  mockedApiState.latestRunPromise = null;
  globalThis.history.replaceState({}, '', '/');
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('App', () => {
  it('renders the login page when no authenticated user is stored', () => {
    renderApp();

    expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('shows a red login error below username when credentials are invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'The user or password does not match.' }), {
        status: 401,
      }),
    );

    renderApp();

    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'rray' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "That username and password don't match. Check both and try again.",
      );
    });

    const usernameFieldGroup = screen.getByLabelText('Username').closest('.field-group');
    if (!(usernameFieldGroup instanceof HTMLElement)) {
      throw new TypeError('Username field group was not found.');
    }

    expect(within(usernameFieldGroup).getByRole('alert')).toHaveTextContent(
      "That username and password don't match. Check both and try again.",
    );
  });

  it('lands on the application page after successful login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          username: 'rray',
          firstName: 'Ryan',
          lastName: 'Ray',
        }),
        { status: 200 },
      ),
    );

    renderApp();

    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'rray' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'rray' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Setup/i })).toBeInTheDocument();
    });
  });

  it('uses environment-prefixed docs and dashboard links on an environment root route', () => {
    setAuthenticatedUser('rray');
    globalThis.history.pushState({}, '', '/dev');

    renderApp();

    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      '/dev/docs',
    );
    expect(screen.getByRole('link', { name: 'Developer Dashboard' })).toHaveAttribute(
      'href',
      '/dev/developer-dashboard.html',
    );
  });

  it('redirects root to /dev when the development environment path segment is configured', () => {
    setAuthenticatedUser('rray');
    vi.stubEnv('VITE_ENVIRONMENT_PATH_SEGMENT', 'dev');
    globalThis.history.pushState({}, '', '/');

    renderApp();

    expect(globalThis.location.pathname).toBe('/dev');
  });

  it('renders the documentation hub on the docs route', () => {
    setAuthenticatedUser('rray');
    globalThis.history.pushState({}, '', '/docs');

    renderApp();

    expect(screen.getByRole('heading', { name: 'Project Documents Overview' })).toBeInTheDocument();
    expect(screen.getByText('Project Overview')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected document preview')).toBeInTheDocument();
  });

  it('renders the documentation hub on an environment-prefixed docs route', () => {
    setAuthenticatedUser('rray');
    globalThis.history.pushState({}, '', '/dev/docs');

    renderApp();

    expect(screen.getByRole('heading', { name: 'Project Documents Overview' })).toBeInTheDocument();
    expect(screen.getByText('Project Overview')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected document preview')).toBeInTheDocument();
  });

  it('renders the rail destinations and defaults to Setup', () => {
    setAuthenticatedUser('rray');
    renderApp();

    expect(screen.getByRole('tab', { name: /Setup/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Summary/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /Exceptions/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tab', { name: /Close/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Source Upload')).toBeInTheDocument();
  });

  it('supports arrow-key navigation across the rail destinations', async () => {
    const user = userEvent.setup();

    setAuthenticatedUser('rray');

    renderApp();

    const setupTab = screen.getByRole('tab', { name: /Setup/i });
    setupTab.focus();

    await user.keyboard('{ArrowDown}');

    const summaryTab = screen.getByRole('tab', { name: /Summary/i });
    expect(summaryTab).toHaveFocus();
    expect(summaryTab).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');

    const closeTab = screen.getByRole('tab', { name: /Close/i });
    expect(closeTab).toHaveFocus();
    expect(closeTab).toHaveAttribute('aria-selected', 'true');
  });

  it('swaps Review panels via the rail and exports from Close', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('QBO workbook'), {
      target: { files: [new File(['qbo'], 'qbo.xlsx')] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(screen.getByText('Total reviewed')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Summary/i })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('heading', { name: 'Exception Category Breakdown' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Likely Split/Combine Issue')).toBeInTheDocument();
    expect(screen.getByText('Deposit Grouping Issue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Exceptions/i }));

    expect(screen.getByPlaceholderText(/Search file, message, or tokens/i)).toBeInTheDocument();
    expect(screen.getAllByText(/QBO qbo.xlsx \/ 4 \| QBO qbo.xlsx \/ 5/i).length).toBeGreaterThan(
      0,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Close/i }));

    expect(screen.getByText('run-1.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/Summary \| Probable Matches \| Exceptions/i)).toBeInTheDocument();
  });

  it('hydrates the Review tab from the last successful persisted run after remount', () => {
    setAuthenticatedUser('rray');
    globalThis.localStorage.setItem(
      'reconciliation-platform:latest-report-run',
      JSON.stringify(createRunResponse()),
    );

    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: /Summary/i }));

    return waitFor(() => {
      expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Exact matches').length).toBeGreaterThan(0);
      expect(screen.queryByText('No review output yet')).toBeNull();
    });
  });

  it('hydrates the Review tab from the backend latest-run endpoint when storage is empty', async () => {
    mockedApiState.latestRunResponse = createRunResponse();
    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: /Summary/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Exact matches').length).toBeGreaterThan(0);
    expect(screen.queryByText('No review output yet')).toBeNull();
  });

  it('shows a loading state while hydrating the latest backend report', async () => {
    const deferred = createDeferred<ReturnType<typeof createRunResponse>>();
    mockedApiState.latestRunPromise = deferred.promise;
    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: /Summary/i }));

    expect(screen.getByRole('status')).toHaveTextContent('Loading review output');

    deferred.resolve(createRunResponse());

    await waitFor(() => {
      expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
    });
  });

  it('shows an alert when latest-run hydration fails', async () => {
    mockedApiState.latestRunError = new Error('Backend unavailable.');
    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: /Summary/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Backend unavailable.');
    });

    expect(screen.getByText('Latest review output could not be loaded')).toBeInTheDocument();
  });

  it('shows the rules catalog with read-only thresholds for non-admins', () => {
    setAuthenticatedUser('bray');
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

    expect(screen.getByText('Rules Catalog')).toBeInTheDocument();
    expect(screen.getByText('Reference + Amount Match')).toBeInTheDocument();
    expect(screen.getByText('Likely Miscoding')).toBeInTheDocument();
    expect(screen.getAllByText(/Last Change/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Variance thresholds')).toBeInTheDocument();

    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getAllByText(/Admins set thresholds/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('21 days').length).toBeGreaterThan(0);
  });

  it('shows a no-data review state before any reconciliation run exists', () => {
    const deferred = createDeferred<ReturnType<typeof createRunResponse>>();
    mockedApiState.latestRunPromise = deferred.promise;
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: /Summary/i }));

    expect(screen.getByRole('tab', { name: /Summary/i })).toBeInTheDocument();
    expect(screen.getByText('Loading review output')).toBeInTheDocument();
  });

  it('shows a monthly month picker by default with twelve month options', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const monthSelect = screen.getByLabelText(/Monthly reconciliation month/i);
    const options = Array.from((monthSelect as HTMLSelectElement).options).map(
      (option) => option.value,
    );

    expect(options).toHaveLength(12);
    expect(options[0]).toBe('January');
    expect(options[11]).toBe('December');
    expect(screen.queryByLabelText('Annual reconciliation year')).toBeNull();

    const month = monthsWithinYear[new Date().getMonth()] ?? 'January';
    const currentYear = new Date().getFullYear();
    expect(screen.getByLabelText(/Reconciliation label/i)).toHaveValue(
      `Monthly Recon for ${month} ${currentYear}`,
    );
    expect(
      screen.getByText(`Month applies to the current year (${currentYear}).`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Suggested: Monthly Recon for ${month} ${currentYear}`),
    ).toBeInTheDocument();
  });

  it('shows overall process progress and updates it after file selection', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const overallMeter = screen.getByLabelText('Overall process progress');
    expect(screen.getByText('Process Progress')).toBeInTheDocument();
    expect((overallMeter as HTMLProgressElement).value).toBe(0);

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('QBO workbook'), {
      target: { files: [new File(['qbo'], 'qbo.xlsx')] },
    });

    expect((overallMeter as HTMLProgressElement).value).toBe(50);
  });

  it('shows an annual year picker with the previous seven years when annual is selected', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Reconciliation frequency'), {
      target: { value: 'Annual' },
    });

    const annualYearSelect = screen.getByLabelText(/Annual reconciliation year/i);
    const options = Array.from((annualYearSelect as HTMLSelectElement).options).map(
      (option) => option.value,
    );

    const currentYear = new Date().getFullYear();
    expect(options).toHaveLength(7);
    expect(options[0]).toBe(String(currentYear - 1));
    expect(options[6]).toBe(String(currentYear - 7));
    expect(screen.queryByLabelText('Monthly reconciliation month')).toBeNull();
    expect(screen.getByLabelText(/Reconciliation label/i)).toHaveValue(
      `Annual Recon for ${String(currentYear - 1)}`,
    );
    expect(screen.getByText('Choose one of the last 7 completed years.')).toBeInTheDocument();
  });

  it('uploads files and renders returned reconciliation metrics', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('QBO workbook'), {
      target: { files: [new File(['qbo'], 'qbo.xlsx')] },
    });
    fireEvent.change(screen.getByPlaceholderText('OPERATING-001'), {
      target: { value: 'OPERATING-001' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(screen.getByText(/Run finished/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy run ID' })).toBeInTheDocument();
      expect(screen.getByText('Total reviewed')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getAllByText('Missing in QBO').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Missing from QBO').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Likely Split/Combine Issue').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Deposit Grouping Issue').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('announces mutation errors when reconciliation submission fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Upload failed.' }), { status: 500 }),
    );

    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('QBO workbook'), {
      target: { files: [new File(['qbo'], 'qbo.xlsx')] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Upload failed.');
    });
  });

  it('submits the selected local files and metadata as multipart form data', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(createRunResponse()), { status: 201 }));

    setAuthenticatedUser('rray');

    renderApp();

    const bankFile = new File(['bank-data'], 'bank.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const qboFile = new File(['qbo-data'], 'qbo.xlsx', {
      type: 'application/octet-stream',
    });

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [bankFile] },
    });
    fireEvent.change(screen.getByLabelText('QBO workbook'), {
      target: { files: [qboFile] },
    });
    fireEvent.change(screen.getByPlaceholderText('OPERATING-001'), {
      target: { value: 'OPERATING-001' },
    });
    fireEvent.change(screen.getByLabelText(/Reconciliation frequency/i), {
      target: { value: 'Annual' },
    });
    fireEvent.change(screen.getByLabelText(/Annual reconciliation year/i), {
      target: { value: '2023' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/reconciliation/run');
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);

    const formData = options.body as FormData;
    expect(formData.get('bankFile')).toBe(bankFile);
    expect(formData.get('qboFile')).toBe(qboFile);
    expect(formData.get('accountIdentifier')).toBe('OPERATING-001');
    expect(formData.get('reconciliationFrequency')).toBe('Annual');
    expect(formData.get('periodLabel')).toBe('Annual Recon for 2023');
  });

  it('submits selected monthly month as period label when frequency is monthly', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(createRunResponse()), { status: 201 }));

    setAuthenticatedUser('rray');

    renderApp();

    const bankFile = new File(['bank-data'], 'bank.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const qboFile = new File(['qbo-data'], 'qbo.xlsx', {
      type: 'application/octet-stream',
    });

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [bankFile] },
    });
    fireEvent.change(screen.getByLabelText('QBO workbook'), {
      target: { files: [qboFile] },
    });
    fireEvent.change(screen.getByLabelText(/Monthly reconciliation month/i), {
      target: { value: 'March' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const formData = options.body as FormData;

    expect(formData.get('reconciliationFrequency')).toBe('Monthly');
    expect(formData.get('periodLabel')).toBe(`Monthly Recon for March ${new Date().getFullYear()}`);
  });

  it('allows editing the prepopulated reconciliation label before submit', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(createRunResponse()), { status: 201 }));

    setAuthenticatedUser('rray');

    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank-data'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('QBO workbook'), {
      target: { files: [new File(['qbo-data'], 'qbo.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText(/Reconciliation label/i), {
      target: { value: 'Custom Monthly Label' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const formData = options.body as FormData;

    expect(formData.get('periodLabel')).toBe('Custom Monthly Label');
  });

  it('keeps the suggested label hint visible after custom edits', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText(/Reconciliation label/i), {
      target: { value: 'Custom Label' },
    });

    fireEvent.change(screen.getByLabelText(/Monthly reconciliation month/i), {
      target: { value: 'April' },
    });

    expect(screen.getByLabelText(/Reconciliation label/i)).toHaveValue('Custom Label');
    expect(
      screen.getByText(`Suggested: Monthly Recon for April ${new Date().getFullYear()}`),
    ).toBeInTheDocument();
  });

  it('resets the reconciliation label to the suggested value', () => {
    setAuthenticatedUser('rray');
    renderApp();

    const labelInput = screen.getByLabelText(/Reconciliation label/i);
    fireEvent.change(labelInput, { target: { value: 'Custom Label' } });
    expect(labelInput).toHaveValue('Custom Label');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to suggested' }));

    const currentYear = new Date().getFullYear();
    const month = monthsWithinYear[new Date().getMonth()];
    expect(labelInput).toHaveValue(`Monthly Recon for ${month} ${currentYear}`);
  });

  it('assigns bank and QBO files from the merged drop zone by file name', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Source workbooks'), {
      target: { files: [new File(['bank'], 'bank.xlsx'), new File(['qbo'], 'qbo.xlsx')] },
    });

    expect(screen.getByRole('button', { name: 'Run reconciliation' })).not.toBeDisabled();
    expect(screen.getAllByText('bank.xlsx').length).toBeGreaterThan(0);
    expect(screen.getAllByText('qbo.xlsx').length).toBeGreaterThan(0);
  });

  it('lands financial analysts on the Review tab', () => {
    setAuthenticatedUser('bray');
    renderApp();

    expect(screen.getByRole('tab', { name: /Summary/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('leads the Summary panel with the reconciliation verdict', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('QBO workbook'), {
      target: { files: [new File(['qbo'], 'qbo.xlsx')] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => {
      expect(screen.getByText('Unexplained residual')).toBeInTheDocument();
    });

    expect(screen.getByText('Bank unmatched (net)')).toBeInTheDocument();
    expect(screen.getByText('Prior-period comparison')).toBeInTheDocument();
  });

  it('disables submit when reconciliation label is blank', () => {
    setAuthenticatedUser('rray');
    renderApp();

    fireEvent.change(screen.getByLabelText('Bank workbook'), {
      target: { files: [new File(['bank'], 'bank.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText('QBO workbook'), {
      target: { files: [new File(['qbo'], 'qbo.xlsx')] },
    });
    fireEvent.change(screen.getByLabelText(/Reconciliation label/i), {
      target: { value: '   ' },
    });

    expect(screen.getByRole('button', { name: 'Run reconciliation' })).toBeDisabled();
    expect(
      screen.getByText('Reconciliation label is required before running.'),
    ).toBeInTheDocument();
  });

  it('enforces developer role access scope for rray2', () => {
    setAuthenticatedUser('rray2');

    renderApp();

    expect(screen.getByText('Application access restricted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/docs');
    expect(screen.getByRole('link', { name: 'Developer Dashboard' })).toHaveAttribute(
      'href',
      '/developer-dashboard.html',
    );
    expect(screen.queryByRole('link', { name: 'Start Reconciliation' })).toBeNull();
  });

  it('enforces financial analyst scope for bray with app and docs but no developer dashboard', () => {
    setAuthenticatedUser('bray');

    renderApp();

    expect(screen.getByRole('tab', { name: /Setup/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/docs');
    expect(screen.queryByRole('link', { name: 'Developer Dashboard' })).toBeNull();
  });

  it('allows admin role to adjust variance thresholds in Rules', () => {
    setAuthenticatedUser('rray3');

    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

    const slider = screen.getByRole('slider', {
      name: /Dollar tolerance/i,
    });

    expect(slider).not.toBeDisabled();
    expect(screen.getByText(/Admin control mode is enabled\./i)).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '0.65' } });

    expect(screen.getAllByText('$0.65').length).toBeGreaterThan(0);
  });

  it('allows superuser to access all scopes and adjust slider defaults', () => {
    setAuthenticatedUser('rray');

    renderApp();

    expect(screen.getByRole('tab', { name: /Setup/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/docs');
    expect(screen.getByRole('link', { name: 'Developer Dashboard' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

    const slider = screen.getByRole('slider', {
      name: /Timing variance window/i,
    });
    expect(slider).not.toBeDisabled();
  });
});
