import { describe, expect, it } from 'vitest';

import type { ExceptionItem } from '@recon/domain';

import {
  buildComparisonDelta,
  buildComparisonSides,
  buildFacetOptions,
  buildRuleLineage,
  emptyFacetSelection,
  matchesFacets,
  matchesQuery,
  resolveAmountBand,
  sortDisplays,
  toExceptionDisplay,
} from './exceptionTriage';

const makeException = (
  overrides: Partial<ExceptionItem> & Pick<ExceptionItem, 'id'>,
): ExceptionItem => ({
  runId: 'run-1',
  category: 'MissingFromGL',
  severity: 'High',
  source: 'bank',
  spreadsheetFileName: 'bank.xlsx',
  lineNumber: 1,
  transactionDate: '2026-03-31',
  amount: 100,
  errorMessage: 'Error',
  ruleTrace: {
    ruleId: 'rule',
    ruleName: 'Rule',
    reason: 'Reason',
    evidence: ['Evidence line'],
  },
  recommendedNextActions: ['Do the thing'],
  normalizedComparisonTokens: ['TOKEN'],
  relatedTransactionIds: [],
  ...overrides,
});

describe('resolveAmountBand', () => {
  it('classifies each numeric band and treats negatives by absolute value', () => {
    expect(resolveAmountBand(50)).toBe('band-0-100');
    expect(resolveAmountBand(500)).toBe('band-100-1k');
    expect(resolveAmountBand(5000)).toBe('band-1k-10k');
    expect(resolveAmountBand(50000)).toBe('band-10k-plus');
    expect(resolveAmountBand(-50)).toBe('band-0-100');
  });

  it('returns band-unknown for null and NaN amounts', () => {
    expect(resolveAmountBand(null)).toBe('band-unknown');
    expect(resolveAmountBand(Number.NaN)).toBe('band-unknown');
  });
});

describe('toExceptionDisplay', () => {
  it('derives display fields and falls back to a derived rule label without a rule trace', () => {
    const display = toExceptionDisplay(
      makeException({ id: 'e1', ruleTrace: undefined, amount: 2500, source: 'gl' }),
    );

    expect(display.ruleLabel).toBe('Derived classification');
    expect(display.sourceLabel).toBe('GL');
    expect(display.amountBand).toBe('band-1k-10k');
    expect(display.fileLineLabel).toBe('bank.xlsx / 1');
  });

  it('uses the likely matching reference when there is no counterpart', () => {
    const display = toExceptionDisplay(
      makeException({
        id: 'e2',
        ruleTrace: { ruleId: 'r', ruleName: 'R', reason: '', evidence: [] },
        likelyMatchingReference: 'INV-42',
      }),
    );

    expect(display.counterpartLabel).toBe('INV-42');
  });

  it('reports no counterpart when neither counterpart nor reference exists', () => {
    const display = toExceptionDisplay(
      makeException({
        id: 'e3',
        ruleTrace: { ruleId: 'r', ruleName: 'R', reason: '', evidence: [] },
      }),
    );

    expect(display.counterpartLabel).toBe('No counterpart');
  });

  it('formats a single counterpart trace with file and line', () => {
    const display = toExceptionDisplay(
      makeException({
        id: 'e4',
        ruleTrace: {
          ruleId: 'r',
          ruleName: 'R',
          reason: '',
          evidence: [],
          counterpart: { source: 'gl', spreadsheetFileName: 'gl.xlsx', lineNumber: 9 },
        },
      }),
    );

    expect(display.counterpartLabel).toBe('GL gl.xlsx / 9');
  });

  it('falls back to transaction id when a counterpart has no spreadsheet file', () => {
    const display = toExceptionDisplay(
      makeException({
        id: 'e5',
        ruleTrace: {
          ruleId: 'r',
          ruleName: 'R',
          reason: '',
          evidence: [],
          counterparts: [{ transactionId: 'txn-7' }, { lineNumber: 4 }],
        },
      }),
    );

    expect(display.counterpartLabel).toBe('txn-7 | N/A');
  });

  it('omits the source prefix and shows N/A for a line-less, source-less counterpart', () => {
    const display = toExceptionDisplay(
      makeException({
        id: 'e6',
        ruleTrace: {
          ruleId: 'r',
          ruleName: 'R',
          reason: '',
          evidence: [],
          counterpart: { spreadsheetFileName: 'x.xlsx' },
        },
      }),
    );

    expect(display.counterpartLabel).toBe('x.xlsx / N/A');
  });
});

describe('buildFacetOptions and matchesFacets', () => {
  const displays = [
    toExceptionDisplay(
      makeException({
        id: 'a',
        severity: 'Critical',
        category: 'AmountMismatch',
        source: 'bank',
        amount: 5000,
      }),
    ),
    toExceptionDisplay(
      makeException({
        id: 'b',
        severity: 'High',
        category: 'MissingFromGL',
        source: 'gl',
        amount: 50,
      }),
    ),
    toExceptionDisplay(
      makeException({
        id: 'c',
        severity: 'High',
        category: 'MissingFromGL',
        source: 'gl',
        amount: 50,
      }),
    ),
  ];

  it('counts severity facet options and sorts by count then label', () => {
    const options = buildFacetOptions(displays, 'severity', emptyFacetSelection());

    expect(options).toEqual([
      { value: 'High', label: 'High', count: 2 },
      { value: 'Critical', label: 'Critical', count: 1 },
    ]);
  });

  it('labels category, source, and amount-band facet values', () => {
    expect(buildFacetOptions(displays, 'category', emptyFacetSelection())[0]?.label).not.toBe('');
    expect(buildFacetOptions(displays, 'source', emptyFacetSelection())[0]?.label).toMatch(
      /BANK|GL/,
    );
    expect(
      buildFacetOptions(displays, 'amountBand', emptyFacetSelection()).map((o) => o.label),
    ).toContain('Under $100');
    expect(buildFacetOptions(displays, 'rule', emptyFacetSelection())[0]?.value).toBe('Rule');
  });

  it('honors other active facet selections while building a dimension', () => {
    const selection = { ...emptyFacetSelection(), source: ['bank'] };
    const options = buildFacetOptions(displays, 'category', selection);

    expect(options).toEqual([{ value: 'AmountMismatch', label: expect.any(String), count: 1 }]);
  });

  it('matches facets with excludeKey, empty selection, and explicit membership', () => {
    const critical = displays[0]!;

    expect(matchesFacets(critical, emptyFacetSelection())).toBe(true);
    expect(matchesFacets(critical, { ...emptyFacetSelection(), severity: ['Critical'] })).toBe(
      true,
    );
    expect(matchesFacets(critical, { ...emptyFacetSelection(), severity: ['Low'] })).toBe(false);
    expect(
      matchesFacets(critical, { ...emptyFacetSelection(), severity: ['Low'] }, 'severity'),
    ).toBe(true);
  });
});

describe('matchesQuery', () => {
  const display = toExceptionDisplay(
    makeException({
      id: 'q',
      errorMessage: 'Amount mismatch detected',
      spreadsheetFileName: 'ledger.xlsx',
      normalizedComparisonTokens: ['ACME', 'PAYMENT'],
    }),
  );

  it('returns true for an empty query', () => {
    expect(matchesQuery(display, '')).toBe(true);
  });

  it('matches error message, file name, rule label, and tokens', () => {
    expect(matchesQuery(display, 'MISMATCH')).toBe(true);
    expect(matchesQuery(display, 'LEDGER')).toBe(true);
    expect(matchesQuery(display, 'RULE')).toBe(true);
    expect(matchesQuery(display, 'PAYMENT')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesQuery(display, 'ZZZNOPE')).toBe(false);
  });
});

describe('sortDisplays', () => {
  const displays = [
    toExceptionDisplay(
      makeException({ id: 's1', severity: 'High', amount: 100, transactionDate: '2026-01-01' }),
    ),
    toExceptionDisplay(
      makeException({ id: 's2', severity: 'Critical', amount: 900, transactionDate: '2026-05-01' }),
    ),
    toExceptionDisplay(
      makeException({ id: 's3', severity: 'High', amount: 300, transactionDate: undefined }),
    ),
  ];

  it('sorts by amount descending', () => {
    expect(sortDisplays(displays, 'amount').map((d) => d.item.id)).toEqual(['s2', 's3', 's1']);
  });

  it('sorts by date descending with missing dates last', () => {
    expect(sortDisplays(displays, 'date').map((d) => d.item.id)).toEqual(['s2', 's1', 's3']);
  });

  it('sorts by severity then amount as a tie-break', () => {
    expect(sortDisplays(displays, 'severity').map((d) => d.item.id)).toEqual(['s2', 's3', 's1']);
  });

  it('reverses order when the direction is ascending', () => {
    expect(sortDisplays(displays, 'amount', 'asc').map((d) => d.item.id)).toEqual([
      's1',
      's3',
      's2',
    ]);
  });
});

describe('buildComparisonSides', () => {
  it('places the primary line on the bank side and routes counterparts by explicit source', () => {
    const { bank, gl } = buildComparisonSides(
      makeException({
        id: 'c1',
        source: 'bank',
        ruleTrace: {
          ruleId: 'r',
          ruleName: 'R',
          reason: '',
          evidence: [],
          counterparts: [{ source: 'gl', spreadsheetFileName: 'gl.xlsx', lineNumber: 2 }],
        },
      }),
    );

    expect(bank).toHaveLength(1);
    expect(bank[0]?.isPrimary).toBe(true);
    expect(gl).toHaveLength(1);
    expect(gl[0]?.fileName).toBe('gl.xlsx');
  });

  it('infers counterpart source and uses transaction id when file name is absent', () => {
    const { bank, gl } = buildComparisonSides(
      makeException({
        id: 'c2',
        source: 'gl',
        ruleTrace: {
          ruleId: 'r',
          ruleName: 'R',
          reason: '',
          evidence: [],
          counterpart: { transactionId: 'txn-9' },
        },
      }),
    );

    expect(gl[0]?.isPrimary).toBe(true);
    expect(bank).toHaveLength(1);
    expect(bank[0]?.fileName).toBe('txn-9');
  });

  it('infers the counterpart as GL when the primary side is bank and no source is given', () => {
    const { bank, gl } = buildComparisonSides(
      makeException({
        id: 'c3',
        source: 'bank',
        ruleTrace: {
          ruleId: 'r',
          ruleName: 'R',
          reason: '',
          evidence: [],
          counterpart: { transactionId: 'txn-11' },
        },
      }),
    );

    expect(bank[0]?.isPrimary).toBe(true);
    expect(gl).toHaveLength(1);
    expect(gl[0]?.fileName).toBe('txn-11');
  });
});

describe('buildComparisonDelta', () => {
  it('renders amount and date drift against the primary counterpart', () => {
    const delta = buildComparisonDelta(
      makeException({
        id: 'd1',
        source: 'bank',
        amount: 3118.42,
        transactionDate: '2026-03-31',
        ruleTrace: {
          ruleId: 'r',
          ruleName: 'R',
          reason: '',
          evidence: [],
          counterpart: { source: 'gl', amount: 3118.24, transactionDate: '2026-03-29' },
        },
      }),
    );

    expect(delta.amountLabel).toBe('$3,118.42 vs $3,118.24 · $0.18');
    expect(delta.dateLabel).toBe('2026-03-31 vs 2026-03-29 · 2 days');
  });

  it('returns null labels when the counterpart lacks amount and date', () => {
    const delta = buildComparisonDelta(
      makeException({
        id: 'd2',
        ruleTrace: {
          ruleId: 'r',
          ruleName: 'R',
          reason: '',
          evidence: [],
          counterpart: { transactionId: 'x' },
        },
      }),
    );

    expect(delta.amountLabel).toBeNull();
    expect(delta.dateLabel).toBeNull();
  });

  it('uses the singular "day" when the drift is exactly one day', () => {
    const delta = buildComparisonDelta(
      makeException({
        id: 'd3',
        transactionDate: '2026-03-31',
        ruleTrace: {
          ruleId: 'r',
          ruleName: 'R',
          reason: '',
          evidence: [],
          counterpart: { transactionDate: '2026-03-30' },
        },
      }),
    );

    expect(delta.dateLabel).toContain('1 day');
    expect(delta.dateLabel).not.toContain('1 days');
  });

  it('omits the date label when either date is unparseable', () => {
    const delta = buildComparisonDelta(
      makeException({
        id: 'd4',
        transactionDate: 'not-a-date',
        ruleTrace: {
          ruleId: 'r',
          ruleName: 'R',
          reason: '',
          evidence: [],
          counterpart: { transactionDate: '2026-03-30' },
        },
      }),
    );

    expect(delta.dateLabel).toBeNull();
  });
});

describe('buildRuleLineage', () => {
  it('labels the last trace Final and prior traces Prior', () => {
    const lineage = buildRuleLineage(
      makeException({
        id: 'l1',
        priorRuleTraces: [{ ruleId: 'p', ruleName: 'Prior rule', reason: '', evidence: [] }],
        ruleTrace: { ruleId: 'f', ruleName: 'Final rule', reason: '', evidence: [] },
      }),
    );

    expect(lineage).toEqual([
      { label: 'Prior', ruleName: 'Prior rule' },
      { label: 'Final', ruleName: 'Final rule' },
    ]);
  });

  it('returns an empty lineage when there are no traces', () => {
    expect(
      buildRuleLineage(
        makeException({ id: 'l2', ruleTrace: undefined, priorRuleTraces: undefined }),
      ),
    ).toEqual([]);
  });
});
