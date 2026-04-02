// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import App from './App';

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
  probableMatches: [],
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
      normalizedComparisonTokens: ['ACME'],
      relatedTransactionIds: [],
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
    timingDifferences: 1,
    dataQualityIssues: 1,
    amountMismatches: 0,
    missingFromBank: 1,
    missingFromQBO: 1,
    cleanMatchedAmount: 6400,
    unresolvedExposure: 125.5,
    countsByCategory: {
      MissingFromQBO: 1,
    },
    amountByCategory: {
      MissingFromQBO: 125.5,
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
    tabNames: ['Summary'],
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
});

describe('App', () => {
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
      expect(screen.getByText('Missing from QBO')).toBeInTheDocument();
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
