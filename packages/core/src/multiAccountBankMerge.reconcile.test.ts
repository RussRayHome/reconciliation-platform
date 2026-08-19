import { randomUUID } from 'node:crypto';

import {
  createWorkbookFromRows,
  multiAccountBankRowsAccountA,
  multiAccountBankRowsAccountB,
  multiAccountGlRows,
} from '../../test-fixtures/src/sampleRows';
import { describe, expect, it } from 'vitest';

import { defaultReconciliationConfig } from '@recon/config';

import { mergeBankFiles } from './fileValidation/bankFileMerge';
import { validateFile } from './fileValidation';
import { toRawTransactionRows } from './fileValidation/toNormalizedTransactions';
import { runReconciliation } from './reconcile';

/**
 * End-to-end coverage for Issue #141's matching/exceptions boundary: two real per-account bank
 * workbooks -> real `mergeBankFiles` -> real `validateFile` -> the same
 * File-Validation-to-Matching-Engine bridge `reconcile.test.ts` uses -> real `runReconciliation`.
 * No mocks anywhere in the pipeline.
 *
 * The fixture deliberately has same-day, same-description transaction pairs across the two
 * accounts -- "PAYROLL ACH BATCH" and "INTEREST EARNED" both land on the same date in both
 * accounts, but at different amounts, with the GL memo disambiguated "(acct 1234)"/"(acct 5678)".
 * This proves the merge doesn't cross-wire same-day, same-description transactions from
 * different accounts -- each bank row still finds its own account's GL counterpart by amount,
 * not some other account's same-day lookalike.
 */
describe('multi-account bank merge -> matching engine (Issue #141)', () => {
  it('matches every bank row to its own account GL line, including the same-day PAYROLL/INTEREST pairs, with no unmatched rows', async () => {
    const [bankBufferA, bankBufferB, glBuffer] = await Promise.all([
      createWorkbookFromRows(multiAccountBankRowsAccountA),
      createWorkbookFromRows(multiAccountBankRowsAccountB),
      createWorkbookFromRows(multiAccountGlRows),
    ]);

    const merged = await mergeBankFiles([
      { bytes: bankBufferA, fileFormat: 'XLSX', originalFilename: '1234_bank-export.xlsx' },
      { bytes: bankBufferB, fileFormat: 'XLSX', originalFilename: '5678_bank-export.xlsx' },
    ]);

    const [bankOutcome, glOutcome] = await Promise.all([
      validateFile({ bytes: merged.bytes, fileFormat: merged.fileFormat, fileType: 'BANK' }),
      validateFile({ bytes: glBuffer, fileFormat: 'XLSX', fileType: 'GL' }),
    ]);

    if (!bankOutcome.ok || !glOutcome.ok) {
      throw new Error(
        `Fixture failed File Validation -- bank issues: ${JSON.stringify(bankOutcome.issues)}, gl issues: ${JSON.stringify(glOutcome.issues)}`,
      );
    }

    const bankSourceFileId = randomUUID();
    const glSourceFileId = randomUUID();
    const bankContext = {
      runId: 'unused',
      sourceFileId: bankSourceFileId,
      spreadsheetFileName: '1234_5678_bank-merged.csv',
      config: defaultReconciliationConfig,
    };
    const glContext = {
      runId: 'unused',
      sourceFileId: glSourceFileId,
      spreadsheetFileName: 'gl.xlsx',
      config: defaultReconciliationConfig,
    };

    const sourceFiles = [
      {
        id: bankSourceFileId,
        source: 'bank' as const,
        fileName: '1234_5678_bank-merged.csv',
        mimeType: 'text/csv',
        sizeBytes: merged.bytes.length,
        worksheetName: '',
        headerRow: 1,
        transactionStartRow: 2,
        excludedRowNumbers: [],
        uploadedAt: new Date(0).toISOString(),
      },
      {
        id: glSourceFileId,
        source: 'gl' as const,
        fileName: 'gl.xlsx',
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

    const output = await runReconciliation({
      runId: randomUUID(),
      correlationId: 'test-correlation',
      sourceFiles,
      rawRows,
      config: defaultReconciliationConfig,
      accountIdentifier: 'MULTI-ACCT',
      periodLabel: 'February 2026',
    });

    const byDescriptionAndAmount = (
      source: 'bank' | 'gl',
      description: string,
      amount: number,
    ) =>
      output.normalizedTransactions.filter(
        (transaction) =>
          transaction.source === source &&
          transaction.description?.toUpperCase().includes(description) &&
          transaction.amount !== null &&
          Math.abs(transaction.amount - amount) < 0.005,
      );

    const findMatchFor = (transactionId: string) =>
      output.matchResults.find(
        (match) =>
          match.bankTransactionId === transactionId || match.glTransactionId === transactionId,
      );

    // Same-day, same-description pair across accounts: PAYROLL ACH BATCH, 2026-02-09.
    const payrollAcct1234 = byDescriptionAndAmount('bank', 'PAYROLL ACH BATCH', -6400);
    const payrollAcct5678 = byDescriptionAndAmount('bank', 'PAYROLL ACH BATCH', -4100);
    expect(payrollAcct1234).toHaveLength(1);
    expect(payrollAcct5678).toHaveLength(1);

    const payrollMatch1234 = findMatchFor(payrollAcct1234[0]!.id);
    const payrollMatch5678 = findMatchFor(payrollAcct5678[0]!.id);
    // The GL memo's "(acct 1234)"/"(acct 5678)" suffix (added specifically to disambiguate the
    // two accounts for a human reader) makes the bank/GL description text a near- but not
    // exact-match, so this lands as ProbableMatch rather than ExactMatch -- still a genuine,
    // correctly-paired match, not an exception.
    expect(payrollMatch1234?.disposition).toBe('ProbableMatch');
    expect(payrollMatch5678?.disposition).toBe('ProbableMatch');
    // Each bank transaction matched its own account's GL line, not the other account's.
    expect(payrollMatch1234?.id).not.toBe(payrollMatch5678?.id);
    expect(payrollMatch1234?.glTransactionId).not.toBe(payrollMatch5678?.glTransactionId);

    // Same-day, same-description pair across accounts: INTEREST EARNED, 2026-02-26.
    const interestAcct1234 = byDescriptionAndAmount('bank', 'INTEREST EARNED', 14.2);
    const interestAcct5678 = byDescriptionAndAmount('bank', 'INTEREST EARNED', 9.6);
    expect(interestAcct1234).toHaveLength(1);
    expect(interestAcct5678).toHaveLength(1);

    const interestMatch1234 = findMatchFor(interestAcct1234[0]!.id);
    const interestMatch5678 = findMatchFor(interestAcct5678[0]!.id);
    expect(interestMatch1234?.disposition).toBe('ProbableMatch');
    expect(interestMatch5678?.disposition).toBe('ProbableMatch');
    expect(interestMatch1234?.id).not.toBe(interestMatch5678?.id);
    expect(interestMatch1234?.glTransactionId).not.toBe(interestMatch5678?.glTransactionId);

    // The fixture was built as a fully-reconciling 30-bank/30-GL set (every row has a designed
    // counterpart) -- confirms the merge didn't drop, duplicate, or cross-wire any row overall.
    expect(output.normalizedTransactions).toHaveLength(60);
    expect(
      output.matchResults.filter(
        (match) => match.disposition === 'ExactMatch' || match.disposition === 'ProbableMatch',
      ),
    ).toHaveLength(30);

    // Every one of the 30 designed pairs was found (nothing landed as truly unmatched/missing --
    // no MissingFromBank/MissingFromGL/AmountMismatch/etc.). The 8 exceptions present are all
    // review-style flags on otherwise-successful ProbableMatch pairs: 4 ReferenceNumberMismatch
    // (this fixture's GL "Reference" column isn't one of GL_HEADERS' recognized columns, so it
    // never maps to `referenceNumber` -- the 4 wire-transfer rows' bank-side reference then has no
    // GL-side counterpart to compare against) and 4 DescriptionMerchantVariance (the PAYROLL/
    // INTEREST pairs above, whose GL memo's "(acct 1234)"/"(acct 5678)" suffix reads as
    // description drift, not a missing description).
    expect(output.exceptions).toHaveLength(8);
    expect(
      output.exceptions.every(
        (exception) =>
          exception.category === 'ReferenceNumberMismatch' ||
          exception.category === 'DescriptionMerchantVariance',
      ),
    ).toBe(true);
  });
});
