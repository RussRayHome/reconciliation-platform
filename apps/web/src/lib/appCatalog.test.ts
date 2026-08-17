import { describe, expect, it } from 'vitest';

import { buildTabNavigationItems, summaryStatDefinitions } from './appCatalog';

describe('buildTabNavigationItems', () => {
  it('shows the exception count in the Review tab description once a run exists', () => {
    const items = buildTabNavigationItems({ exceptionCount: 7, hasRun: true });
    const review = items.find((item) => item.id === 'review');

    expect(review?.description).toBe('7 exceptions to review');
  });

  it('shows a generic Review tab description before any run has completed', () => {
    const items = buildTabNavigationItems({ exceptionCount: 0, hasRun: false });
    const review = items.find((item) => item.id === 'review');

    expect(review?.description).toBe('Summary, matches, exceptions');
  });
});

describe('summaryStatDefinitions', () => {
  it('derives each stat card value from the run summary', () => {
    const summary = {
      totalRecordsReviewed: 10,
      bankRecords: 5,
      glRecords: 5,
      exactMatches: 3,
      probableMatches: 2,
      unmatchedItems: 1,
      duplicates: 0,
      bankDuplicates: 1,
      glDuplicates: 1,
      dateVariances: 1,
      timingDifferences: 1,
      dataQualityIssues: 1,
      amountMismatches: 0,
      missingFromBank: 1,
      missingFromGL: 1,
      unmatchedBankNetAmount: 0,
      unmatchedGlNetAmount: 0,
      cleanMatchedAmount: 0,
      unresolvedExposure: 1234,
      countsByCategory: {},
      amountByCategory: {},
      charts: [],
    };

    const values = Object.fromEntries(
      summaryStatDefinitions.map((definition) => [definition.id, definition.value(summary)]),
    );

    expect(values['total-reviewed']).toBe(10);
    expect(values['exact-matches']).toBe(3);
    expect(values['exception-exposure']).toBe('$1,234');
  });
});
