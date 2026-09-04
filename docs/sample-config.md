# Sample Configuration

The reconciliation engine is configuration-driven. Default values live in `packages/config/src/default-config.ts`, and sample account overrides live in `packages/config/src/sample-config.ts`.

## Config Areas

### Source parsing

- `headerRow`
- `transactionStartRow`
- `excludedRows`
- `excludeBeginningBalance`
- `beginningBalancePatterns`
- `amountSignConvention`
- `allowZeroAmount`
- `columnAliases`

### Text normalization

- `uppercase`
- `stripPunctuation`
- `collapseWhitespace`
- `removeStopWords`
- `stopWords`

### Matching

- `amountTolerance`
- `dateToleranceDays`
- `timingDifferenceDays`
- `staleOutstandingCheckDays`
- `textSimilarityThreshold`
- `probableTextSimilarityThreshold`
- `referenceSimilarityThreshold`
- `distinctiveAmountMaxOccurrences`
- `groupedCandidatePoolSize`
- `groupedMatchMaxSize`
- `duplicateDateWindowDays`
- `duplicateSimilarityThreshold`
- `amountMismatchTextSimilarityThreshold`

### Reporting

- `exceptionSortOrder`
- `severityByCategory`

## Example Override

```ts
export const sampleAccountOverrides = [
  {
    accountIdentifier: 'OPERATING-001',
    gl: {
      excludeBeginningBalance: true,
      beginningBalancePatterns: ['BEGINNING BALANCE', 'OPENING BALANCE'],
    },
    matching: {
      dateToleranceDays: 2,
      timingDifferenceDays: 5,
      staleOutstandingCheckDays: 30,
      groupedCandidatePoolSize: 8,
      groupedMatchMaxSize: 4,
    },
  },
];
```

## Guidance

- Keep parser settings account-specific when source exports differ by institution.
- Tighten timing windows for payroll or controlled disbursement accounts.
- Increase grouped search bounds only when grouped deposit or split/combine scenarios are common enough to justify the added search cost.
- Increase duplicate sensitivity only when duplicate false positives are operationally acceptable.
- Do not loosen probable-match thresholds without accountant review.
- Keep stale-check aging explicit per account when operational policy differs across check-heavy and receipt-heavy ledgers.
