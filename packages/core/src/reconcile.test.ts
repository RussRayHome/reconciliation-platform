import {
  allExceptionCategories,
  buildAllExceptionsCombinedRows,
  exceptionEdgeCaseFixtures,
  exceptionPrecedenceFixtures,
  exceptionScenarioFixtures,
} from '../../test-fixtures/src/exceptionScenarios';
import {
  ambiguousBankRows,
  ambiguousGlRows,
  amountMismatchBankRows,
  amountMismatchGlRows,
  createSampleBankWorkbook,
  createSampleGlWorkbook,
  createWorkbookFromRows,
  depositGroupingBankRows,
  depositGroupingOversizedBankRows,
  depositGroupingOversizedGlRows,
  depositGroupingGlRows,
  referenceMismatchBankRows,
  referenceMismatchGlRows,
  splitCombineBankRows,
  splitCombineNearMissBankRows,
  splitCombineNearMissGlRows,
  splitCombineGlRows,
  staleOutstandingMixedResidualBankRows,
  staleOutstandingMixedResidualGlRows,
  timingDifferenceBankRows,
  timingDifferenceGlRows,
} from '../../test-fixtures/src/sampleRows';
import { describe, expect, it } from 'vitest';

import ExcelJS from 'exceljs';
import { defaultReconciliationConfig } from '@recon/config';
import type { ReconciliationConfig } from '@recon/domain';
import { errorCategories } from '@recon/domain';
import { validateFile } from './fileValidation';
import { toRawTransactionRows } from './fileValidation/toNormalizedTransactions';
import { randomUUID } from 'node:crypto';
import { runReconciliation } from './reconcile';

/** Bridges row-array fixtures into `runReconciliation`'s `rawRows` input via the File Validation
 * Engine + its adapter (Issue #137) -- replaces the old `parseWorkbook`/excelParser.ts bridge,
 * which no longer exists. `toRawTransactionRows` repackages File Validation's already-captured
 * raw cell values into the shape `normalizeTransactions` (called inside `runReconciliation`)
 * expects, so this is a real re-derivation, not synthetic data. */
const buildRawRowsFromBuffers = async (
  bankBuffer: Buffer,
  glBuffer: Buffer,
  bankFileName: string,
  glFileName: string,
) => {
  const bankSourceFileId = randomUUID();
  const glSourceFileId = randomUUID();

  const [bankOutcome, glOutcome] = await Promise.all([
    validateFile({ bytes: bankBuffer, fileFormat: 'XLSX', fileType: 'BANK' }),
    validateFile({ bytes: glBuffer, fileFormat: 'XLSX', fileType: 'GL' }),
  ]);

  // Many of these fixtures deliberately exercise invalid/malformed rows (blank dates, balance
  // breaks, etc.) -- that's the whole point of the test, matching this codebase's own partial-
  // import philosophy (a Step 3 finding excludes only the offending row, not the whole file). Only
  // treat a genuine STRUCTURAL failure (never reaching CELL_VALUES at all) as a fixture bug worth
  // failing loudly on -- that would mean the row-array's headers themselves are wrong.
  for (const [label, outcome] of [
    ['bank', bankOutcome],
    ['gl', glOutcome],
  ] as const) {
    if (!outcome.gatesRun.includes('CELL_VALUES')) {
      throw new Error(
        `Fixture's ${label} rows failed structural validation -- issues: ${JSON.stringify(outcome.issues)}`,
      );
    }
  }

  const bankContext = {
    runId: 'unused',
    sourceFileId: bankSourceFileId,
    spreadsheetFileName: bankFileName,
    config: defaultReconciliationConfig,
  };
  const glContext = {
    runId: 'unused',
    sourceFileId: glSourceFileId,
    spreadsheetFileName: glFileName,
    config: defaultReconciliationConfig,
  };

  const sourceFiles = [
    {
      id: bankSourceFileId,
      source: 'bank' as const,
      fileName: bankFileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: bankBuffer.length,
      worksheetName: '',
      headerRow: 1,
      transactionStartRow: 2,
      excludedRowNumbers: [],
      uploadedAt: new Date(0).toISOString(),
    },
    {
      id: glSourceFileId,
      source: 'gl' as const,
      fileName: glFileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: glBuffer.length,
      worksheetName: '',
      headerRow: 1,
      transactionStartRow: 2,
      excludedRowNumbers: [],
      uploadedAt: new Date(0).toISOString(),
    },
  ];

  const rawRows = [
    ...toRawTransactionRows(bankOutcome.normalized, bankContext),
    ...toRawTransactionRows(glOutcome.normalized, glContext),
  ];

  return { sourceFiles, rawRows };
};

const buildRun = async () => {
  const [bankBuffer, glBuffer] = await Promise.all([
    createSampleBankWorkbook(),
    createSampleGlWorkbook(),
  ]);

  const { sourceFiles, rawRows } = await buildRawRowsFromBuffers(
    bankBuffer,
    glBuffer,
    'bank.xlsx',
    'gl.xlsx',
  );

  return runReconciliation({
    runId: randomUUID(),
    correlationId: 'test-correlation',
    sourceFiles,
    rawRows,
    config: defaultReconciliationConfig,
    accountIdentifier: 'OPERATING-001',
    periodLabel: 'January 2025',
  });
};

const buildRunFromRows = async (
  bankRows: Array<Array<string | number>>,
  glRows: Array<Array<string | number>>,
  options?: {
    reconciliationFrequency?: 'Monthly' | 'Annual';
    config?: ReconciliationConfig;
  },
) => {
  const config = options?.config ?? defaultReconciliationConfig;
  const [bankBuffer, glBuffer] = await Promise.all([
    createWorkbookFromRows(bankRows),
    createWorkbookFromRows(glRows),
  ]);

  const { sourceFiles, rawRows } = await buildRawRowsFromBuffers(
    bankBuffer,
    glBuffer,
    'bank-edge.xlsx',
    'gl-edge.xlsx',
  );

  return runReconciliation({
    runId: randomUUID(),
    correlationId: 'edge-case-correlation',
    sourceFiles,
    rawRows,
    config,
    accountIdentifier: 'OPERATING-001',
    reconciliationFrequency: options?.reconciliationFrequency,
    periodLabel: 'Edge Case Period',
  });
};

const splitCombineNearMissBankFixture = splitCombineNearMissBankRows as Array<
  Array<string | number>
>;
const splitCombineNearMissGlFixture = splitCombineNearMissGlRows as Array<Array<string | number>>;
const depositGroupingOversizedBankFixture = depositGroupingOversizedBankRows as Array<
  Array<string | number>
>;
const depositGroupingOversizedGlFixture = depositGroupingOversizedGlRows as Array<
  Array<string | number>
>;
const staleOutstandingMixedResidualBankFixture = staleOutstandingMixedResidualBankRows as Array<
  Array<string | number>
>;
const staleOutstandingMixedResidualGlFixture = staleOutstandingMixedResidualGlRows as Array<
  Array<string | number>
>;

const countExceptionsByCategory = (
  output: Awaited<ReturnType<typeof buildRunFromRows>>,
  category: (typeof errorCategories)[number],
): number => output.exceptions.filter((item) => item.category === category).length;

describe('runReconciliation', () => {
  it('keeps fixture coverage aligned with the full domain exception taxonomy', () => {
    // 'InvalidOrMissingData' is exempted (Issue #137): it previously depended on hard-invalid rows
    // (blank date, unparseable amount) reaching the Matching Engine with `dataQualityIssues`
    // populated by the old alias-based pathway's lenient normalizer. Under the File-Validation-
    // based pathway, such rows are rejected upstream (BANK_DATE_REQUIRED/GL_TXN_DATE_REQUIRED,
    // etc.) and never reach `toNormalizedTransactions` at all -- and that adapter deliberately
    // never populates `dataQualityIssues` for the WARNING-level issues that DO still pass through
    // (e.g. GL_AMOUNT_ZERO), since a File-Validation-sourced run's issue list is already the
    // source of truth for those. This category has no current producer in the real pipeline; see
    // transaction-csv-spec.md §1.
    const categoriesRequiringFixtureCoverage = errorCategories.filter(
      (category) => category !== 'InvalidOrMissingData',
    );
    expect(new Set(exceptionScenarioFixtures.map((fixture) => fixture.expectedCategory))).toEqual(
      new Set(categoriesRequiringFixtureCoverage),
    );
  });

  it.each(exceptionScenarioFixtures)(
    'produces $expectedCategory from the $name fixture',
    async (fixture) => {
      const output = await buildRunFromRows(fixture.bankRows, fixture.glRows);

      expect(countExceptionsByCategory(output, fixture.expectedCategory)).toBe(
        fixture.expectedCount,
      );
    },
  );

  it.each(exceptionEdgeCaseFixtures)(
    'keeps the $name edge case on the intended fallback path',
    async (fixture) => {
      const output = await buildRunFromRows(fixture.bankRows, fixture.glRows);

      fixture.expectedPresent.forEach(({ category, count }) => {
        expect(countExceptionsByCategory(output, category)).toBe(count);
      });

      fixture.expectedAbsent.forEach((category) => {
        expect(countExceptionsByCategory(output, category)).toBe(0);
      });
    },
  );

  it.each(exceptionPrecedenceFixtures)(
    'applies precedence so that $name keeps only the winning categories',
    async (fixture) => {
      const output = await buildRunFromRows(fixture.bankRows, fixture.glRows);

      fixture.expectedPresent.forEach(({ category, count }) => {
        expect(countExceptionsByCategory(output, category)).toBe(count);
      });

      fixture.expectedAbsent.forEach((category) => {
        expect(countExceptionsByCategory(output, category)).toBe(0);
      });
    },
  );

  it('triggers the full exception taxonomy from a single combined workbook pair', async () => {
    const combinedRows = buildAllExceptionsCombinedRows();
    const output = await buildRunFromRows(combinedRows.bankRows, combinedRows.glRows);

    allExceptionCategories.forEach((category) => {
      expect(countExceptionsByCategory(output, category)).toBeGreaterThan(0);
    });
  });

  it('keeps stale outstanding precedence over missing fallback in a mixed residual run', async () => {
    const output = await buildRunFromRows(
      staleOutstandingMixedResidualBankFixture,
      staleOutstandingMixedResidualGlFixture,
    );

    expect(
      output.exceptions.filter((item) => item.category === 'StaleOutstandingCheck'),
    ).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromGL')).toHaveLength(2);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('lets grouped residual classification outrank advisory one-to-one review matches', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-10-01', 'CARD SETTLEMENT BATCH', '1', '', '', '300.00', '5300.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-10-01', 'Deposit', '', 'Customer A', 'Card settlement alpha', '100.00'],
        ['2025-10-02', 'Deposit', '', 'Customer B', 'Card settlement beta', '200.00'],
        ['2025-10-08', 'Deposit', '', 'Customer C', 'Card settlement batch', '300.00'],
      ],
    );

    expect(
      output.exceptions.filter((item) => item.category === 'DepositGroupingIssue'),
    ).toHaveLength(3);
    expect(
      output.exceptions.some((item) => item.category === 'AmbiguousMatchRequiringReview'),
    ).toBe(false);
    expect(
      output.probableMatches.some(
        (item) => item.exceptionCategory === 'AmbiguousMatchRequiringReview',
      ),
    ).toBe(false);
  });

  it('prefers the closest grouped batch when overlapping grouped candidates compete for the same gl transactions', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-10-01', 'CARD SETTLEMENT CLOSE BATCH', '1', '', '', '300.00', '5300.00'],
        ['2025-10-03', 'CARD SETTLEMENT LATE BATCH', '2', '', '', '300.00', '5600.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-10-01', 'Deposit', '', 'Customer A', 'Card settlement alpha', '100.00'],
        ['2025-10-02', 'Deposit', '', 'Customer B', 'Card settlement beta', '200.00'],
      ],
    );

    const groupedItems = output.exceptions.filter(
      (item) => item.category === 'DepositGroupingIssue',
    );

    expect(groupedItems).toHaveLength(3);
    expect(
      groupedItems.every((item) => item.ruleTrace?.ruleId === 'grouped-deposit-residual'),
    ).toBe(true);
    expect(groupedItems.some((item) => item.source === 'bank' && item.lineNumber === 1)).toBe(true);
    expect(groupedItems.some((item) => item.source === 'bank' && item.lineNumber === 2)).toBe(
      false,
    );
    expect(output.exceptions.filter((item) => item.category === 'MissingFromGL')).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromBank')).toHaveLength(0);
  });

  it('excludes GL beginning balance rows and creates workbook tabs', async () => {
    const output = await buildRun();

    expect(
      output.normalizedTransactions.some((item) =>
        item.exclusionReason?.includes('Beginning balance'),
      ),
    ).toBe(true);
    expect(output.outputWorkbook.tabNames).toEqual(
      expect.arrayContaining([
        'Summary',
        'Mapping and Assumptions',
        'Error Report',
        'Probable Matches Review',
        'Reviewer Observations',
      ]),
    );
    expect(output.outputWorkbook.binary.byteLength).toBeGreaterThan(1000);
  });

  it('classifies duplicates and missing items from fixture rows', async () => {
    const output = await buildRun();

    expect(
      output.exceptions.some(
        (item) => item.category === 'DuplicateInBank' || item.category === 'DuplicateInGL',
      ),
    ).toBe(true);
    expect(output.summary.exactMatches).toBeGreaterThanOrEqual(1);
    expect(output.summary.probableMatches).toBeGreaterThanOrEqual(1);
    expect(output.summary.duplicates).toBeGreaterThanOrEqual(1);
  });

  it('embeds the two summary chart images in the exported workbook', async () => {
    const output = await buildRun();
    const workbook = new ExcelJS.Workbook();
    const workbookPayload = Buffer.from(output.outputWorkbook.binary);

    await workbook.xlsx.load(
      workbookPayload as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );

    const summarySheet = workbook.getWorksheet('Summary');

    expect(summarySheet).toBeDefined();
    expect(summarySheet?.getImages().length).toBeGreaterThanOrEqual(2);
    expect((workbook.model.media ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('includes the detailed bank and GL breakout rows on the Summary sheet', async () => {
    const output = await buildRun();
    const workbook = new ExcelJS.Workbook();
    const workbookPayload = Buffer.from(output.outputWorkbook.binary);

    await workbook.xlsx.load(
      workbookPayload as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );

    const summarySheet = workbook.getWorksheet('Summary');
    const summaryLabels = summarySheet
      ?.getColumn(1)
      .values.filter((value) => typeof value === 'string') as string[];

    expect(summaryLabels).toEqual(
      expect.arrayContaining([
        'Total bank transactions reviewed',
        'Total GL transactions reviewed',
        'Total duplicates in bank',
        'Total duplicates in GL',
        'Total date variances',
        'Net amount of items missing in GL',
        'Net amount of items missing in bank',
        'Narrative Summary',
      ]),
    );

    const narrativeValues = summarySheet?.getColumn(1).values ?? [];
    const narrativeText = narrativeValues.find(
      (value) => typeof value === 'string' && value.includes('The reconciliation'),
    );

    expect(narrativeText).toEqual(expect.stringContaining('The reconciliation'));
    expect(narrativeText).toEqual(expect.stringContaining('OPERATING-001'));
  });

  it('processes a medium workbook within a practical local threshold', async () => {
    const start = performance.now();
    await buildRun();
    const durationMs = performance.now() - start;

    expect(durationMs).toBeLessThan(5000);
  });

  it('classifies timing differences when timing-compatible items fall outside primary tolerance but inside the timing window', async () => {
    const output = await buildRunFromRows(timingDifferenceBankRows, timingDifferenceGlRows);

    const timingItems = output.exceptions.filter((item) => item.category === 'TimingDifference');

    expect(timingItems).toHaveLength(2);
    expect(
      timingItems.every((item) => item.ruleTrace?.ruleId === 'residual-timing-difference'),
    ).toBe(true);
    expect(
      timingItems.every(
        (item) => item.priorRuleTraces?.[0]?.ruleName === 'Amount + Extended Date Window Match',
      ),
    ).toBe(true);
    expect(output.matchResults.some((item) => item.disposition === 'DateVariance')).toBe(true);
    expect(output.summary.timingDifferences).toBe(1);
    expect(output.summary.dateVariances).toBe(0);
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies one-to-many residual expense groupings as likely split/combine issues', async () => {
    const output = await buildRunFromRows(splitCombineBankRows, splitCombineGlRows);

    const groupedItems = output.exceptions.filter(
      (item) => item.category === 'LikelySplitCombineIssue',
    );

    expect(groupedItems).toHaveLength(3);
    expect(
      groupedItems.every((item) => item.ruleTrace?.ruleId === 'grouped-split-combine-residual'),
    ).toBe(true);
    expect(
      groupedItems.every((item) =>
        item.ruleTrace?.evidence.some((entry) => entry.includes('bank=withdrawal')),
      ),
    ).toBe(true);
    expect(groupedItems.some((item) => (item.ruleTrace?.counterparts?.length ?? 0) > 1)).toBe(true);
    expect(output.groupedMatchResults).toHaveLength(1);
    expect(output.groupedMatchResults[0]?.category).toBe('LikelySplitCombineIssue');
    expect(output.summary.countsByCategory.LikelySplitCombineIssue).toBe(3);
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('classifies grouped receipt batches as deposit grouping issues', async () => {
    const output = await buildRunFromRows(depositGroupingBankRows, depositGroupingGlRows);

    const groupedItems = output.exceptions.filter(
      (item) => item.category === 'DepositGroupingIssue',
    );

    expect(groupedItems).toHaveLength(3);
    expect(
      groupedItems.every((item) => item.ruleTrace?.ruleId === 'grouped-deposit-residual'),
    ).toBe(true);
    expect(
      groupedItems.every((item) =>
        item.ruleTrace?.evidence.some((entry) => entry.includes('bank=deposit')),
      ),
    ).toBe(true);
    expect(groupedItems.some((item) => (item.ruleTrace?.counterparts?.length ?? 0) > 1)).toBe(true);
    expect(output.groupedMatchResults).toHaveLength(1);
    expect(output.groupedMatchResults[0]?.category).toBe('DepositGroupingIssue');
    expect(output.summary.countsByCategory.DepositGroupingIssue).toBe(3);
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('does not classify grouped near-miss totals as split/combine issues', async () => {
    const output = await buildRunFromRows(
      splitCombineNearMissBankFixture,
      splitCombineNearMissGlFixture,
    );

    expect(output.exceptions.some((item) => item.category === 'LikelySplitCombineIssue')).toBe(
      false,
    );
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(true);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromBank')).toHaveLength(2);
  });

  it('does not classify grouped deposits when the grouped side exceeds the supported residual limit', async () => {
    const output = await buildRunFromRows(
      depositGroupingOversizedBankFixture,
      depositGroupingOversizedGlFixture,
    );

    expect(output.exceptions.some((item) => item.category === 'DepositGroupingIssue')).toBe(false);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromGL')).toHaveLength(1);
    expect(output.exceptions.filter((item) => item.category === 'MissingFromBank')).toHaveLength(4);
  });

  it('lets account-level grouped overrides classify larger grouped residual sets', async () => {
    const output = await buildRunFromRows(
      depositGroupingOversizedBankFixture,
      depositGroupingOversizedGlFixture,
      {
        config: {
          ...defaultReconciliationConfig,
          matching: {
            ...defaultReconciliationConfig.matching,
            groupedCandidatePoolSize: 8,
            groupedMatchMaxSize: 4,
          },
        },
      },
    );

    expect(
      output.exceptions.filter((item) => item.category === 'DepositGroupingIssue'),
    ).toHaveLength(5);
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
  });

  it('preserves date variance when extended-window matches are not timing-compatible', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-04-01', 'CLIENT BATCH DEPOSIT', '1', '', '', '3200.00', '8200.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-04-15', 'Journal Entry', '', 'Client Batch', 'Deposit clearing entry', '3200.00'],
      ],
    );

    const dateVariance = output.exceptions.filter((item) => item.category === 'DateVariance');

    expect(dateVariance).toHaveLength(1);
    expect(output.summary.dateVariances).toBe(1);
    expect(output.summary.timingDifferences).toBe(0);
  });

  it('classifies likely amount mismatch pairs with linked counterpart references', async () => {
    const output = await buildRunFromRows(amountMismatchBankRows, amountMismatchGlRows);

    const mismatch = output.exceptions.find((item) => item.category === 'AmountMismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch?.likelyMatchingReference).toBeTruthy();
    expect(output.summary.amountMismatches).toBeGreaterThanOrEqual(1);
  });

  it('surfaces check or reference number variance as review exceptions instead of clean matches', async () => {
    const output = await buildRunFromRows(referenceMismatchBankRows, referenceMismatchGlRows);

    expect(
      output.exceptions.some(
        (item) =>
          item.category === 'CheckNumberMismatch' || item.category === 'ReferenceNumberMismatch',
      ),
    ).toBe(true);
    expect(output.summary.exactMatches).toBe(0);
  });

  it('marks near-equal competing candidates as ambiguous review items', async () => {
    const output = await buildRunFromRows(ambiguousBankRows, ambiguousGlRows);

    expect(
      output.exceptions.some((item) => item.category === 'AmbiguousMatchRequiringReview'),
    ).toBe(true);
    expect(output.probableMatches.some((item) => item.disposition === 'AmbiguousReview')).toBe(
      true,
    );
  });

  // 'keeps exception categories mutually exclusive for invalid rows' and 'surfaces invalid GL
  // rows as data-quality exceptions' are retired (Issue #137): both exercised a blank-date row
  // reaching the Matching Engine and getting classified as 'InvalidOrMissingData' there. Under
  // the File-Validation-based pathway, a blank Date is a hard BANK_DATE_REQUIRED/
  // GL_TXN_DATE_REQUIRED error (rowValidators.test.ts) -- the row is excluded from
  // `outcome.normalized` entirely and never reaches the Matching Engine at all, per the design
  // principle in transaction-csv-spec.md §1 ("the Rules Engine assumes the file is already in
  // good order"). The underlying behavior these tests cared about (invalid data gets flagged, not
  // silently matched) is still covered -- just one layer earlier, in rowValidators.test.ts.

  it('classifies stale outstanding checks for aged unmatched GL check disbursements', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-03-31', 'OPERATING ACTIVITY', '1', '', '200.00', '', '800.00'],
        ['2025-04-30', 'MONTH-END ACTIVITY', '2', '', '100.00', '', '700.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-02-10', 'Check', '1124', 'Vendor A', 'Uncleared check', '-150.00'],
      ],
    );

    const staleCheck = output.exceptions.find((item) => item.category === 'StaleOutstandingCheck');

    expect(staleCheck).toBeDefined();
    expect(staleCheck?.source).toBe('gl');
    expect(staleCheck?.ruleTrace?.ruleId).toBe('stale-outstanding-check');
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
    expect(output.summary.countsByCategory.StaleOutstandingCheck).toBe(1);
  });

  it('lets account-level stale-check overrides shorten aging policy', async () => {
    const bankRows = [
      ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
      ['2025-02-15', 'STATEMENT ANCHOR DEPOSIT', '1', '', '', '900.00', '900.00'],
    ] as Array<Array<string | number>>;
    const glRows = [
      ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
      ['2025-01-10', 'Check', '1201', 'Vendor', 'Older but not default-stale check', '-900.00'],
    ] as Array<Array<string | number>>;

    const defaultOutput = await buildRunFromRows(bankRows, glRows);
    const overrideOutput = await buildRunFromRows(bankRows, glRows, {
      config: {
        ...defaultReconciliationConfig,
        matching: {
          ...defaultReconciliationConfig.matching,
          staleOutstandingCheckDays: 30,
        },
      },
    });

    expect(defaultOutput.exceptions.some((item) => item.category === 'StaleOutstandingCheck')).toBe(
      false,
    );
    expect(
      defaultOutput.exceptions.filter((item) => item.category === 'OutstandingCheck'),
    ).toHaveLength(1);
    expect(
      overrideOutput.exceptions.filter((item) => item.category === 'StaleOutstandingCheck'),
    ).toHaveLength(1);
    expect(overrideOutput.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(
      false,
    );
  });

  it('classifies likely miscoding when same-amount near-date transactions conflict on context', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-03-10', 'ACME PAYROLL', '1', '', '500.00', '', '9500.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-03-11', 'Expense', '', 'Office Depot', 'Office supplies', '-500.00'],
      ],
    );

    const miscodingItems = output.exceptions.filter((item) => item.category === 'LikelyMiscoding');

    expect(miscodingItems).toHaveLength(2);
    expect(miscodingItems.every((item) => item.ruleTrace?.ruleId === 'likely-miscoding')).toBe(
      true,
    );
    expect(
      miscodingItems.every(
        (item) =>
          item.ruleTrace?.counterpart?.spreadsheetFileName === 'gl-edge.xlsx' ||
          item.ruleTrace?.counterpart?.spreadsheetFileName === 'bank-edge.xlsx',
      ),
    ).toBe(true);
    expect(output.exceptions.some((item) => item.category === 'MissingFromGL')).toBe(false);
    expect(output.exceptions.some((item) => item.category === 'MissingFromBank')).toBe(false);
    expect(output.summary.countsByCategory.LikelyMiscoding).toBe(2);
  });

  it('adds reviewer observations for missing months when annual reconciliation is selected', async () => {
    const output = await buildRunFromRows(
      [
        ['Date', 'Description', 'Sequence Number', 'Check Number', 'Debit', 'Credit', 'Balance'],
        ['2025-01-15', 'JAN ENTRY', '1', '', '100.00', '', '900.00'],
        ['2025-03-15', 'MAR ENTRY', '2', '', '200.00', '', '700.00'],
      ],
      [
        ['Date', 'Type', 'Num', 'Name', 'Memo', 'Amount'],
        ['2025-02-20', 'Expense', '', 'Vendor A', 'FEB ENTRY', '-150.00'],
        ['2025-04-20', 'Expense', '', 'Vendor B', 'APR ENTRY', '-175.00'],
      ],
      { reconciliationFrequency: 'Annual' },
    );

    const annualCoverageObservations = output.reviewerObservations.filter(
      (item) => item.title === 'Annual month coverage gap detected',
    );

    expect(annualCoverageObservations.length).toBeGreaterThanOrEqual(2);
    expect(
      annualCoverageObservations.some(
        (item) => item.message.includes('bank-edge.xlsx') && item.message.includes('Feb'),
      ),
    ).toBe(true);
    expect(
      annualCoverageObservations.some(
        (item) => item.message.includes('gl-edge.xlsx') && item.message.includes('Jan'),
      ),
    ).toBe(true);
  });
});
