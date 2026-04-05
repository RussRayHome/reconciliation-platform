// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import App from './App';

const mockedApiState = vi.hoisted(() => ({
  latestRunResponse: null as unknown,
}));

vi.mock('./lib/api', async () => {
  const actual = await vi.importActual<typeof import('./lib/api')>('./lib/api');

  return {
    ...actual,
    getLatestReconciliationRunRequest: vi.fn(async () => {
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
        reason: 'No QBO-side transaction remained after exact, review, and variance matching rules were applied.',
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
      recommendedNextActions: [
        'Compare the bank deposit to underlying receipts or batch detail to confirm whether multiple book entries roll into one deposit.',
      ],
      normalizedComparisonTokens: ['BATCH', 'DEPOSIT'],
      relatedTransactionIds: ['bank-12', 'qbo-8', 'qbo-9'],
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
    },
    amountByCategory: {
      MissingFromQBO: 125.5,
      LikelySplitCombineIssue: 250,
      DepositGroupingIssue: 410,
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
  storage.clear();
  mockedApiState.latestRunResponse = null;
  globalThis.history.replaceState({}, '', '/');
});

describe('App', () => {
  it('renders the documentation hub on the docs route', () => {
    globalThis.history.pushState({}, '', '/docs');

    renderApp();

    expect(screen.getByRole('heading', { name: 'Project Documents Overview' })).toBeInTheDocument();
    expect(screen.getByText('Project Overview')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected document preview')).toBeInTheDocument();
  });

  it('renders the four top-level application tabs and defaults to Upload', () => {
    renderApp();

    expect(screen.getByRole('tab', { name: /Upload/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Rules/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /Exceptions/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /Reports/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Source Upload')).toBeInTheDocument();
  });

  it('shows the reports browser and swaps displayed results when a report link is clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

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

    fireEvent.click(screen.getByRole('tab', { name: /Reports/i }));

    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run Summary/i })).toBeInTheDocument();
    expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Exact matches').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Exception Category Breakdown' })).toBeInTheDocument();
    expect(screen.getByText('Likely Split/Combine Issue')).toBeInTheDocument();
    expect(screen.getByText('Deposit Grouping Issue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Exception Report/i }));

    expect(screen.getByPlaceholderText(/Search file, message, or tokens/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Export Artifacts/i }));

    expect(screen.getByText('run-1.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/Summary \| Probable Matches \| Exceptions/i)).toBeInTheDocument();
  });

  it('hydrates the Reports tab from the last successful persisted run after remount', () => {
    globalThis.localStorage.setItem(
      'reconciliation-platform:last-successful-run',
      JSON.stringify(createRunResponse()),
    );

    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: /Reports/i }));

    expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Exact matches').length).toBeGreaterThan(0);
    expect(screen.queryByText('No report output yet')).toBeNull();
  });

  it('hydrates the Reports tab from the backend latest-run endpoint when storage is empty', async () => {
    mockedApiState.latestRunResponse = createRunResponse();

    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: /Reports/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Total reviewed').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Exact matches').length).toBeGreaterThan(0);
    expect(screen.queryByText('No report output yet')).toBeNull();
  });

  it('shows the rules catalog with last-change metadata when the Rules tab is selected', () => {
    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: /Rules/i }));

    expect(screen.getByText('Rules Catalog')).toBeInTheDocument();
    expect(screen.getByText('Reference + Amount Match')).toBeInTheDocument();
    expect(screen.getByText('Likely Miscoding')).toBeInTheDocument();
    expect(screen.getAllByText(/Last Change/i).length).toBeGreaterThan(0);
  });

  it('shows an empty exceptions state before any reconciliation run exists', () => {
    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: /Exceptions/i }));

    expect(screen.getByText('No exception set yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Upload both source workbooks in the Upload tab and run the reconciliation/i),
    ).toBeInTheDocument();
  });

  it('shows a monthly month picker by default with twelve month options', () => {
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
    expect(screen.getByText(`Month applies to the current year (${currentYear}).`)).toBeInTheDocument();
    expect(
      screen.getByText(`Suggested: Monthly Recon for ${month} ${currentYear}`),
    ).toBeInTheDocument();
  });

  it('shows overall process progress and updates it after file selection', () => {
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

  it('shows and hides field help text when question-mark buttons are clicked', () => {
    renderApp();

    const bankHelpButton = screen.getByRole('button', { name: 'Open help for bank source file' });
    expect(
      screen.queryByText('Upload the exported bank transaction workbook used as the bank source of truth.'),
    ).toBeNull();

    fireEvent.click(bankHelpButton);

    expect(
      screen.getByText('Upload the exported bank transaction workbook used as the bank source of truth.'),
    ).toBeInTheDocument();

    fireEvent.click(bankHelpButton);

    expect(
      screen.queryByText('Upload the exported bank transaction workbook used as the bank source of truth.'),
    ).toBeNull();
  });

  it('closes an open field help popover when clicking outside the field', () => {
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Open help for bank source file' }));

    expect(
      screen.getByText('Upload the exported bank transaction workbook used as the bank source of truth.'),
    ).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(
      screen.queryByText('Upload the exported bank transaction workbook used as the bank source of truth.'),
    ).toBeNull();
  });

  it('uploads files and renders returned reconciliation metrics', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

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
      expect(screen.getByAltText('Small Scottish man in a kilt illustration')).toBeInTheDocument();
      expect(screen.getByText('Kinney Software Solutions LLC')).toBeInTheDocument();
      expect(screen.getByText('Total reviewed')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getAllByText('Missing in QBO').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Missing from QBO').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Likely Split/Combine Issue').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Deposit Grouping Issue').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('submits the selected local files and metadata as multipart form data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

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
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

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
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(createRunResponse()), { status: 201 }),
    );

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

  it('disables submit when reconciliation label is blank', () => {
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
    expect(screen.getByText('Reconciliation label is required before running.')).toBeInTheDocument();
  });
});
