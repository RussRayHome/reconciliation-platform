# Reconciliation Rules

## Ingestion Assumptions

- Header rows begin at row 1 by default.
- Transaction rows begin at row 2 by default.
- QBO beginning-balance rows are excluded when configured patterns match the description or related text fields.
- Original spreadsheet file names and row numbers are preserved through normalization, matching, reporting, and workbook export.

## Normalization

The engine standardizes the following while retaining original source values:

- transaction date
- posting date
- signed amount
- debit and credit columns
- merchant, payee, and description text
- reference, check, and serial fields
- whitespace and punctuation differences
- comparison tokens used for matching confidence

## Matching Priority

1. Reference or check number plus amount.
2. Amount plus date window plus strong merchant, payee, or description similarity.
3. Amount plus extended date window plus adequate text similarity, classified as probable or timing difference depending on date drift.
4. Amount mismatch detection when narrative context and dates suggest a likely counterpart.
5. Distinctive amount-only match only when the amount is unique enough across both sources.
6. Otherwise leave unmatched.

## Accounting-Aware Behaviors

- Beginning balance rows are excluded from matching.
- Weak matches are not forced.
- Timing differences are distinct from missing or mismatched transactions.
- Duplicate detection runs inside each source using amount, date proximity, and text/reference similarity.
- Zero-amount and malformed rows are treated as data-quality issues unless configuration explicitly allows them.
- Probable matches remain in a dedicated review queue rather than the clean exact-match population.

## Exception Categories

- `MissingFromBank`
- `MissingFromQBO`
- `AmountMismatch`
- `DuplicateTransaction`
- `TimingDifference`
- `CheckNumberMismatch`
- `ReferenceNumberMismatch`
- `DescriptionMerchantVariance`
- `InvalidOrMissingData`
- `AmbiguousMatchRequiringReview`

## Default Sorting

Exception reports are sorted by:

1. severity
2. source
3. transaction date
4. line number

## Professional Messaging

The platform uses accountant-facing messages rather than developer shorthand so exported workpapers can be used directly in close-support documentation and audit review.

## Class and Method Documentation

Rule execution methods and their state transitions are documented in `docs/class-method-reference.md`.

This includes inputs, outputs, and before/after state objects for:

- parsing (`parseWorkbook`)
- normalization (`normalizeTransactions`)
- matching (`reconcileMatches`)
- exception classification (`classifyExceptions`)
- summary generation (`buildSummaryMetrics`)
- workbook export (`exportWorkbook`)
- pipeline orchestration (`runReconciliation`)
