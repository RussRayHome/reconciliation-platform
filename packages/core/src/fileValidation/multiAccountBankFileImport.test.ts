import {
  createWorkbookFromRows,
  multiAccountBankRowsAccountA,
  multiAccountBankRowsAccountB,
  multiAccountGlRows,
} from '../../../test-fixtures/src/sampleRows';
import { describe, expect, it } from 'vitest';

import { mergeBankFiles } from './bankFileMerge';
import { validateFile } from './fileValidationEngine';

/** Stand-ins for `reconciliation_account.id` -- the assignment the operator makes before upload. */
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

/**
 * End-to-end coverage for Issue #141: two real per-account bank workbooks, merged via the real
 * `mergeBankFiles`, then validated through the real, unchanged `validateFile` -- no mocks. Proves
 * the merge step's output is genuinely File-Validation-compliant, not just structurally plausible.
 *
 * Since A-D1 (Issue #338) that output also carries account identity, so this covers the part the
 * roll-forward chain was silently missing: every normalized record arriving with a real account.
 */
describe('multi-account bank file import (Issue #141)', () => {
  it('merges two account workbooks and validates cleanly with composite record IDs and no duplicate-sequence issues', async () => {
    const [bankBufferA, bankBufferB, glBuffer] = await Promise.all([
      createWorkbookFromRows(multiAccountBankRowsAccountA),
      createWorkbookFromRows(multiAccountBankRowsAccountB),
      createWorkbookFromRows(multiAccountGlRows),
    ]);

    const merged = await mergeBankFiles([
      {
        bytes: bankBufferA,
        fileFormat: 'XLSX',
        originalFilename: '1234_bank-export.xlsx',
        accountId: ACCOUNT_A,
      },
      {
        bytes: bankBufferB,
        fileFormat: 'XLSX',
        originalFilename: '5678_bank-export.xlsx',
        accountId: ACCOUNT_B,
      },
    ]);

    const [bankOutcome, glOutcome] = await Promise.all([
      validateFile({ bytes: merged.bytes, fileFormat: merged.fileFormat, fileType: 'BANK' }),
      validateFile({ bytes: glBuffer, fileFormat: 'XLSX', fileType: 'GL' }),
    ]);

    expect(bankOutcome.ok).toBe(true);
    expect(glOutcome.ok).toBe(true);

    expect(bankOutcome.normalized).toHaveLength(30);
    expect(glOutcome.normalized).toHaveLength(30);

    const recordIds = bankOutcome.normalized.map((record) => record.recordId);
    expect(recordIds).toContain(`${ACCOUNT_A}-000001`);
    expect(recordIds).toContain(`${ACCOUNT_B}-000001`);

    // A-D1: the keystone assertion. `account` was undefined on every record before this landed,
    // which is what left run-account linking, open-item carry-forward and per-account tie-out all
    // inert behind a field nothing populated.
    expect(bankOutcome.normalized.every((record) => Boolean(record.account))).toBe(true);
    expect(new Set(bankOutcome.normalized.map((record) => record.account))).toEqual(
      new Set([ACCOUNT_A, ACCOUNT_B]),
    );

    expect(bankOutcome.issues.filter((issue) => issue.code === 'BANK_SEQUENCE_DUPLICATE')).toEqual(
      [],
    );
  });
});
