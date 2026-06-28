import { describe, expect, it } from 'vitest';

import {
  buildAllExceptionsCombinedRows,
  exceptionScenarioFixtures,
  type ExceptionScenarioFixture,
} from './exceptionScenarios';

const addTemporaryFixture = (fixture: ExceptionScenarioFixture): (() => void) => {
  exceptionScenarioFixtures.push(fixture);

  return () => {
    const fixtureIndex = exceptionScenarioFixtures.indexOf(fixture);
    if (fixtureIndex >= 0) {
      exceptionScenarioFixtures.splice(fixtureIndex, 1);
    }
  };
};

describe('exception scenario combined rows', () => {
  it('skips fixtures with empty row sets', () => {
    const baseline = buildAllExceptionsCombinedRows();

    const restoreFixture = addTemporaryFixture({
      name: 'coverage-empty-rows',
      expectedCategory: 'MissingFromQBO',
      expectedCount: 1,
      bankRows: [],
      qboRows: [],
    });

    try {
      const combined = buildAllExceptionsCombinedRows();

      expect(combined.bankRows).toHaveLength(baseline.bankRows.length);
      expect(combined.qboRows).toHaveLength(baseline.qboRows.length);
    } finally {
      restoreFixture();
    }
  });

  it('ignores unmapped columns while preserving mapped values', () => {
    const restoreFixture = addTemporaryFixture({
      name: 'coverage-unmapped-header',
      expectedCategory: 'MissingFromQBO',
      expectedCount: 1,
      bankRows: [
        ['Unknown Header', 'Date'],
        ['ignored-bank-value', '2026-06-01'],
      ],
      qboRows: [
        ['Unknown Header', 'Amount'],
        ['ignored-qbo-value', 123.45],
      ],
    });

    try {
      const combined = buildAllExceptionsCombinedRows();
      const bankRow = combined.bankRows.at(-1);
      const qboRow = combined.qboRows.at(-1);

      expect(bankRow).toEqual(['2026-06-01', '', '', '', '', '', '']);
      expect(qboRow).toEqual(['', '', '', '', '', '', 123.45]);
    } finally {
      restoreFixture();
    }
  });
});
