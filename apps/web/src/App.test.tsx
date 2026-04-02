// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import App from './App';

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
    fireEvent.change(screen.getByPlaceholderText('January 2025'), {
      target: { value: 'January 2025' },
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
    expect(formData.get('periodLabel')).toBe('January 2025');
  });
});
