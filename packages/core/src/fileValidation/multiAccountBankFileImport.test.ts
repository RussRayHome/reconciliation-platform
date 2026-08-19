import {
  createWorkbookFromRows,
  multiAccountBankRowsAccountA,
  multiAccountBankRowsAccountB,
  multiAccountGlRows,
} from '../../../test-fixtures/src/sampleRows';
import { describe, expect, it } from 'vitest';

import { mergeBankFiles } from './bankFileMerge';
import { validateFile } from './fileValidationEngine';

/**
 * End-to-end coverage for Issue #141: two real per-account bank workbooks, merged via the real
 * `mergeBankFiles`, then validated through the real, unchanged `validateFile` -- no mocks. Proves
 * the merge step's output is genuinely File-Validation-compliant, not just structurally plausible.
 */
describe('multi-account bank file import (Issue #141)', () => {
  it('merges two account workbooks and validates cleanly with composite record IDs and no duplicate-sequence issues', async () => {
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

    expect(bankOutcome.ok).toBe(true);
    expect(glOutcome.ok).toBe(true);

    expect(bankOutcome.normalized).toHaveLength(30);
    expect(glOutcome.normalized).toHaveLength(30);

    const recordIds = bankOutcome.normalized.map((record) => record.recordId);
    expect(recordIds).toContain('1234-000001');
    expect(recordIds).toContain('5678-000001');

    expect(bankOutcome.issues.filter((issue) => issue.code === 'BANK_SEQUENCE_DUPLICATE')).toEqual(
      [],
    );
  });
});
