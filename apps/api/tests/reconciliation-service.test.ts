import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const parseWorkbookMock = vi.fn();
const normalizeTransactionsMock = vi.fn();
const reconcileMatchesMock = vi.fn();
const classifyExceptionsMock = vi.fn();
const buildSummaryMetricsMock = vi.fn();
const exportWorkbookMock = vi.fn();
const resolveReconciliationConfigMock = vi.fn();
const randomUUIDMock = vi.fn(() => 'generated-run-id');
const pinoMock = vi.fn();

const defaultConfig = {
  matching: {
    dateToleranceDays: 2,
    timingDifferenceDays: 5,
  },
  bank: {
    headerRow: 1,
  },
  gl: {
    headerRow: 1,
  },
  reporting: {},
};

vi.mock('@recon/core', () => ({
  parseWorkbook: parseWorkbookMock,
  normalizeTransactions: normalizeTransactionsMock,
  reconcileMatches: reconcileMatchesMock,
  classifyExceptions: classifyExceptionsMock,
  buildSummaryMetrics: buildSummaryMetricsMock,
  exportWorkbook: exportWorkbookMock,
}));

vi.mock('@recon/config', () => ({
  defaultReconciliationConfig: defaultConfig,
  resolveReconciliationConfig: resolveReconciliationConfigMock,
  sampleAccountOverrides: {},
}));

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock,
}));

vi.mock('pino', () => ({
  default: pinoMock,
}));

const makeUploadedFile = (name: string) => ({
  originalname: name,
  mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size: 128,
  buffer: Buffer.from('xlsx-data'),
});

const makeParseResult = (source: 'bank' | 'gl', fileName: string) => ({
  sourceFile: {
    id: `${source}-file-id`,
    source,
    fileName,
    worksheetName: 'Transactions',
    uploadedAt: '2026-06-18T00:00:00.000Z',
  },
  rawRows: [
    {
      id: `${source}-raw-1`,
      source,
      lineNumber: 2,
      rawValues: { Amount: '100.00' },
    },
  ],
});

const makeMatchingOutput = () => ({
  matchResults: [{ id: 'match-1' }],
  groupedMatchResults: [{ id: 'grouped-1' }],
  probableMatches: [{ id: 'probable-1' }],
  unmatchedBankTransactionIds: new Set(['bank-unmatched']),
  unmatchedGlTransactionIds: new Set(['gl-unmatched']),
  duplicateTransactionIds: new Set(['duplicate-1']),
});

const makeSummary = () => ({
  exactMatches: 1,
  timingDifferences: 2,
  dataQualityIssues: 3,
  missingFromBank: 4,
  missingFromGL: 5,
  duplicates: 6,
  unresolvedExposure: 42,
});

const hasLoggedAction = (calls: unknown, action: string): boolean => {
  if (!Array.isArray(calls)) {
    return false;
  }

  const callList = calls as unknown[];

  return callList.some((entry) => {
    if (!Array.isArray(entry) || entry.length === 0) {
      return false;
    }

    const payload = (entry as unknown[])[0];
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }

    return (payload as { action?: unknown }).action === action;
  });
};

type MockLogger = {
  info: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

let childLogger: MockLogger;
const originalEnv = { ...process.env };

const arrangeHappyMocks = (): void => {
  parseWorkbookMock
    .mockResolvedValueOnce(makeParseResult('bank', 'bank.xlsx'))
    .mockResolvedValueOnce(makeParseResult('gl', 'gl.xlsx'));
  normalizeTransactionsMock.mockReturnValue([
    { id: 'normalized-1', dataQualityIssues: [], isExcluded: false },
  ]);
  reconcileMatchesMock.mockReturnValue(makeMatchingOutput());
  classifyExceptionsMock.mockReturnValue({
    exceptions: [{ id: 'exception-1' }],
    reviewerObservations: [{ id: 'observation-1' }],
  });
  buildSummaryMetricsMock.mockReturnValue(makeSummary());
  exportWorkbookMock.mockResolvedValue({
    fileName: 'reconciliation.xlsx',
    generatedAt: '2026-06-18T00:00:00.000Z',
    tabNames: ['Summary'],
    binary: new Uint8Array([1, 2, 3]),
  });
};

const importService = async () => {
  const module = await import('../src/services/reconciliationService');
  return module.executeReconciliation;
};

describe('executeReconciliation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    childLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    pinoMock.mockReturnValue({
      child: vi.fn(() => childLogger),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    });

    resolveReconciliationConfigMock.mockReturnValue(defaultConfig);
    arrangeHappyMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('completes a run and persists reconciliation artifacts when a lifecycle store is provided', async () => {
    const lifecycleStore = {
      persistParsedRows: vi.fn().mockResolvedValue(undefined),
      persistNormalizedRows: vi.fn().mockResolvedValue(undefined),
      persistMatchingArtifacts: vi.fn().mockResolvedValue(undefined),
      persistReviewArtifacts: vi.fn().mockResolvedValue(undefined),
      persistExportAndFinalize: vi.fn().mockResolvedValue(undefined),
    };

    const executeReconciliation = await importService();
    const run = await executeReconciliation({
      correlationId: 'corr-1',
      runId: 'provided-run-id',
      organizationId: 'org-1',
      lifecycleStore: lifecycleStore as never,
      sourceFileIds: { bank: 'bank-source-id', gl: 'gl-source-id' },
      bankFile: makeUploadedFile('bank.xlsx'),
      glFile: makeUploadedFile('gl.xlsx'),
      accountIdentifier: 'OPERATING-001',
      reconciliationFrequency: 'Monthly',
      periodLabel: '2026-01',
      aliases: [],
    });

    expect(run.id).toBe('provided-run-id');
    expect(randomUUIDMock).not.toHaveBeenCalled();

    expect(parseWorkbookMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        source: 'bank',
        sourceFileId: 'bank-source-id',
        fileName: 'bank.xlsx',
      }),
    );
    expect(parseWorkbookMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        source: 'gl',
        sourceFileId: 'gl-source-id',
        fileName: 'gl.xlsx',
      }),
    );

    expect(classifyExceptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'provided-run-id',
        groupedMatchResults: [{ id: 'grouped-1' }],
        reconciliationFrequency: 'Monthly',
      }),
    );

    expect(lifecycleStore.persistParsedRows).toHaveBeenCalledTimes(1);
    expect(lifecycleStore.persistNormalizedRows).toHaveBeenCalledTimes(1);
    expect(lifecycleStore.persistMatchingArtifacts).toHaveBeenCalledTimes(1);
    expect(lifecycleStore.persistReviewArtifacts).toHaveBeenCalledTimes(1);
    expect(lifecycleStore.persistExportAndFinalize).toHaveBeenCalledTimes(1);
    expect(run.outputWorkbook?.fileName).toBe('reconciliation.xlsx');
  });

  it('uses default config, generated run id, and debug parse samples when debug mode is enabled', async () => {
    resolveReconciliationConfigMock.mockReturnValue(undefined);
    process.env.DEBUG_RECONCILIATION = 'true';

    const executeReconciliation = await importService();
    const run = await executeReconciliation({
      correlationId: 'corr-2',
      organizationId: 'org-1',
      bankFile: makeUploadedFile('bank-debug.xlsx'),
      glFile: makeUploadedFile('gl-debug.xlsx'),
    });

    expect(run.id).toBe('generated-run-id');
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);

    expect(parseWorkbookMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ config: defaultConfig.bank }),
    );
    expect(parseWorkbookMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ config: defaultConfig.gl }),
    );

    expect(hasLoggedAction(childLogger.debug.mock.calls, 'service.parse.bank.sample')).toBe(true);
    expect(hasLoggedAction(childLogger.debug.mock.calls, 'service.parse.gl.sample')).toBe(true);
  });

  it('logs and rethrows parse failures', async () => {
    parseWorkbookMock.mockReset();
    parseWorkbookMock.mockRejectedValue(new Error('parse exploded'));

    const executeReconciliation = await importService();
    await expect(
      executeReconciliation({
        correlationId: 'corr-3',
        organizationId: 'org-1',
        bankFile: makeUploadedFile('bank-bad.xlsx'),
        glFile: makeUploadedFile('gl-bad.xlsx'),
      }),
    ).rejects.toThrow('parse exploded');

    expect(hasLoggedAction(childLogger.error.mock.calls, 'service.parse.error')).toBe(true);
  });

  it('logs and rethrows reconciliation pipeline failures', async () => {
    normalizeTransactionsMock.mockImplementation(() => {
      throw new Error('normalize exploded');
    });

    const executeReconciliation = await importService();
    await expect(
      executeReconciliation({
        correlationId: 'corr-4',
        organizationId: 'org-1',
        bankFile: makeUploadedFile('bank-fail.xlsx'),
        glFile: makeUploadedFile('gl-fail.xlsx'),
      }),
    ).rejects.toThrow('normalize exploded');

    expect(
      hasLoggedAction(childLogger.error.mock.calls, 'service.reconciliation.pipeline.error'),
    ).toBe(true);
  });
});
