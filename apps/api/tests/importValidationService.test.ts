import type {
  BlobStorage,
  FileValidationStatus,
  ImportRunSummary,
  RecordFileValidationOutcomeInput,
} from '@recon/persistence';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import {
  runImportValidationWorkflow,
  type ImportRunSummaryReader,
  type ImportValidationWriter,
} from '../src/services/importValidationService';

const silentLogger = pino({ level: 'silent' });

const bankCsv = Buffer.from(
  'transaction_id,account_id,posted_date,amount,currency_code,transaction_type,description\n' +
    'TXN-1,ACCT-1,2026-08-01,100.00,USD,CREDIT,Deposit\n',
  'utf8',
);

const glCsv = Buffer.from(
  'entry_id,line_number,transaction_date,account_code,description,debit_amount,credit_amount,currency_code\n' +
    'JE-1,1,2026-08-01,1000,Deposit,100.00,,USD\n' +
    'JE-1,2,2026-08-01,2000,Deposit,,100.00,USD\n',
  'utf8',
);

const invalidBankCsv = Buffer.from('not,a,recognizable,header\n1,2,3,4\n', 'utf8');

const baseRun = (): ImportRunSummary => ({
  id: 'run-1',
  organizationId: 'org-1',
  label: 'Test Run',
  accountIdentifier: null,
  frequency: 'MONTHLY',
  periodYear: 2026,
  periodMonth: 8,
  status: 'VALIDATING',
  createdAt: '2026-08-01T00:00:00.000Z',
  files: [
    {
      importFileId: 'file-bank',
      role: 'BANK',
      sourceType: 'BANK',
      originalFilename: 'bank.csv',
      fileFormat: 'CSV',
      validationStatus: 'PENDING',
      byteSize: bankCsv.byteLength,
      contentSha256: 'sha-bank',
    },
    {
      importFileId: 'file-gl',
      role: 'GL',
      sourceType: 'GL',
      originalFilename: 'gl.csv',
      fileFormat: 'CSV',
      validationStatus: 'PENDING',
      byteSize: glCsv.byteLength,
      contentSha256: 'sha-gl',
    },
  ],
});

const createFakeBlobStorage = (bytesByFileId: Record<string, Buffer>): BlobStorage => ({
  put: vi.fn(),
  get: vi.fn((importFileId: string) => {
    const bytes = bytesByFileId[importFileId];
    if (!bytes) return Promise.reject(new Error(`no fake bytes for ${importFileId}`));
    return Promise.resolve(bytes);
  }),
});

const createFakeImportRunStore = (run: ImportRunSummary | null): ImportRunSummaryReader => ({
  getRunSummary: vi.fn(() => Promise.resolve(run)),
});

const ruleVersionIds = new Map<string, string>([
  ['BANK_ID_REQUIRED', 'rule-1'],
  ['STRUCT_HEADER_MISSING', 'rule-2'],
]);

const createFakeImportValidationWriter = (): ImportValidationWriter & {
  recordedOutcomes: Array<{ importFileId: string }>;
} => {
  const recordedOutcomes: Array<{ importFileId: string }> = [];

  return {
    markJobRunning: vi.fn(() => Promise.resolve(undefined)),
    loadActiveValidationRuleVersionIds: vi.fn(() => Promise.resolve(ruleVersionIds)),
    recordFileValidationOutcome: vi.fn(
      (_organizationId: string, input: RecordFileValidationOutcomeInput) => {
        recordedOutcomes.push({ importFileId: input.importFileId });
        const errorCount = input.issues.filter((issue) => issue.severity === 'ERROR').length;
        const warningCount = input.issues.filter((issue) => issue.severity === 'WARNING').length;
        const validationStatus: FileValidationStatus =
          errorCount > 0 ? 'INVALID' : warningCount > 0 ? 'VALID_WITH_WARNINGS' : 'VALID';
        return Promise.resolve({ validationStatus, errorCount, warningCount });
      },
    ),
    finalizeRun: vi.fn(() => Promise.resolve(undefined)),
    recordMatchingJobId: vi.fn(() => Promise.resolve(undefined)),
    recordedOutcomes,
  };
};

describe('runImportValidationWorkflow', () => {
  it('validates both files, finalizes as passed, and triggers matching when both are clean', async () => {
    const importValidationStore = createFakeImportValidationWriter();
    const triggerMatching = vi.fn(() => Promise.resolve({ matchingJobId: 'matching-job-1' }));

    const result = await runImportValidationWorkflow({
      organizationId: 'org-1',
      runId: 'run-1',
      importJobId: 'job-1',
      workerId: 'worker-1',
      logger: silentLogger,
      blobStorage: createFakeBlobStorage({ 'file-bank': bankCsv, 'file-gl': glCsv }),
      importRunStore: createFakeImportRunStore(baseRun()),
      importValidationStore,
      triggerMatching,
    });

    expect(result).toEqual({ passed: true, matchingJobId: 'matching-job-1' });
    expect(importValidationStore.markJobRunning).toHaveBeenCalledWith('org-1', 'job-1', 'worker-1');
    expect(importValidationStore.recordedOutcomes.map((entry) => entry.importFileId)).toEqual([
      'file-bank',
      'file-gl',
    ]);
    expect(importValidationStore.finalizeRun).toHaveBeenCalledWith('org-1', 'run-1', 'job-1', {
      passed: true,
    });
    expect(triggerMatching).toHaveBeenCalledWith({
      bankFile: { buffer: bankCsv, originalname: 'bank.csv' },
      glFile: { buffer: glCsv, originalname: 'gl.csv' },
    });
    expect(importValidationStore.recordMatchingJobId).toHaveBeenCalledWith(
      'org-1',
      'run-1',
      'matching-job-1',
    );
  });

  it('finalizes as failed and never triggers matching when a file is structurally invalid', async () => {
    const importValidationStore = createFakeImportValidationWriter();
    const triggerMatching = vi.fn(() => Promise.resolve({ matchingJobId: 'should-not-be-called' }));

    const result = await runImportValidationWorkflow({
      organizationId: 'org-1',
      runId: 'run-1',
      importJobId: 'job-1',
      workerId: 'worker-1',
      logger: silentLogger,
      blobStorage: createFakeBlobStorage({ 'file-bank': invalidBankCsv, 'file-gl': glCsv }),
      importRunStore: createFakeImportRunStore(baseRun()),
      importValidationStore,
      triggerMatching,
    });

    expect(result).toEqual({ passed: false });
    expect(importValidationStore.finalizeRun).toHaveBeenCalledWith('org-1', 'run-1', 'job-1', {
      passed: false,
    });
    expect(triggerMatching).not.toHaveBeenCalled();
    expect(importValidationStore.recordMatchingJobId).not.toHaveBeenCalled();
  });

  it('throws when the run cannot be found', async () => {
    await expect(
      runImportValidationWorkflow({
        organizationId: 'org-1',
        runId: 'missing-run',
        importJobId: 'job-1',
        workerId: 'worker-1',
        logger: silentLogger,
        blobStorage: createFakeBlobStorage({}),
        importRunStore: createFakeImportRunStore(null),
        importValidationStore: createFakeImportValidationWriter(),
        triggerMatching: vi.fn(),
      }),
    ).rejects.toThrow(/reconciliation_run missing-run not found/);
  });

  it('throws if a file has a source_type outside BANK/GL', async () => {
    const run = baseRun();
    run.files[0]!.sourceType = 'PAYROLL';

    await expect(
      runImportValidationWorkflow({
        organizationId: 'org-1',
        runId: 'run-1',
        importJobId: 'job-1',
        workerId: 'worker-1',
        logger: silentLogger,
        blobStorage: createFakeBlobStorage({ 'file-bank': bankCsv, 'file-gl': glCsv }),
        importRunStore: createFakeImportRunStore(run),
        importValidationStore: createFakeImportValidationWriter(),
        triggerMatching: vi.fn(),
      }),
    ).rejects.toThrow(/only supports BANK\/GL/);
  });
});
