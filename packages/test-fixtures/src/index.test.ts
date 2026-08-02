import { describe, expect, it } from 'vitest';

import * as fixtures from './index';

describe('@recon/test-fixtures index exports', () => {
  it('re-exports workbook fixture builders and scenario metadata', () => {
    expect(typeof fixtures.createSampleBankWorkbook).toBe('function');
    expect(typeof fixtures.createSampleGlWorkbook).toBe('function');
    expect(typeof fixtures.createWorkbookFromRows).toBe('function');
    expect(typeof fixtures.createAllExceptionsBankWorkbook).toBe('function');
    expect(Array.isArray(fixtures.exceptionScenarioFixtures)).toBe(true);
  });
});
