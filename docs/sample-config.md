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
- `textSimilarityThreshold`
- `probableTextSimilarityThreshold`
- `referenceSimilarityThreshold`
- `distinctiveAmountMaxOccurrences`
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
    qbo: {
      excludeBeginningBalance: true,
      beginningBalancePatterns: ['BEGINNING BALANCE', 'OPENING BALANCE'],
    },
    matching: {
      dateToleranceDays: 2,
      timingDifferenceDays: 5,
    },
  },
];
```

## Guidance

- Keep parser settings account-specific when source exports differ by institution.
- Tighten timing windows for payroll or controlled disbursement accounts.
- Increase duplicate sensitivity only when duplicate false positives are operationally acceptable.
- Do not loosen probable-match thresholds without accountant review.

## Class and Method Documentation

Configuration method behavior is documented in `docs/class-method-reference.md`, including inputs, outputs, and before/after state objects for `resolveReconciliationConfig`.
