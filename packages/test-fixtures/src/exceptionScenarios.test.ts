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
      expectedCategory: 'MissingFromGL',
      expectedCount: 1,
      bankRows: [],
      glRows: [],
    });

    try {
      const combined = buildAllExceptionsCombinedRows();

      expect(combined.bankRows).toHaveLength(baseline.bankRows.length);
      expect(combined.glRows).toHaveLength(baseline.glRows.length);
    } finally {
      restoreFixture();
    }
  });

  it('ignores unmapped columns while preserving mapped values', () => {
    const restoreFixture = addTemporaryFixture({
      name: 'coverage-unmapped-header',
      expectedCategory: 'MissingFromGL',
      expectedCount: 1,
      bankRows: [
        ['Unknown Header', 'Date'],
        ['ignored-bank-value', '2026-06-01'],
      ],
      glRows: [
        ['Unknown Header', 'Amount'],
        ['ignored-gl-value', 123.45],
      ],
    });

    try {
      const combined = buildAllExceptionsCombinedRows();
      const bankRow = combined.bankRows.at(-1);
      const glRow = combined.glRows.at(-1);

      expect(bankRow).toEqual(['2026-06-01', '', '', '', '', '', '']);
      expect(glRow).toEqual(['', '', '', '', '', '', 123.45]);
    } finally {
      restoreFixture();
    }
  });
});
