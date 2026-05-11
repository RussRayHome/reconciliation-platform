# Reconciliation Rules

This document defines the reconciliation behavior currently implemented across parsing, normalization, matching, exception classification, summary generation, and reviewer-facing outputs.

## 1. Scope and source of truth

This reference is intentionally implementation-driven.

- Pipeline orchestration: `packages/core/src/reconcile.ts`
- Matching engine and grouped reservation logic: `packages/core/src/matching/engine.ts`, `packages/core/src/matching/groupedReservations.ts`
- Exception and observation classification: `packages/core/src/reporting/exceptionClassifier.ts`
- Default configuration and severity mapping: `packages/config/src/default-config.ts`
- Shared enums, message catalog, and output types: `packages/domain/src/enums.ts`, `packages/domain/src/messages.ts`, `packages/domain/src/types.ts`

## 2. End-to-end rule pipeline

The application executes reconciliation in this order:

1. Parse bank and QBO workbooks into raw rows.
2. Normalize rows into a shared transaction shape.
3. Run duplicate detection and one-to-one candidate ranking.
4. Reserve grouped residual candidates.
5. Produce exact and advisory match results.
6. Classify unmatched and advisory outcomes into exception categories.
7. Build summary metrics.
8. Generate workbook export.
9. Emit audit events and reviewer observations.

## 3. Ingestion and normalization assumptions

### Workbook parsing

- The first worksheet is used.
- Default header row is `1`; transaction start row is `2`.
- Column mapping is alias-based with fuzzy header matching.
- Rows configured in `excludedRows` are marked excluded.
- QBO beginning-balance patterns (`BEGINNING BALANCE`, `OPENING BALANCE` by default) are excluded when enabled.
- Source lineage is preserved: file name, worksheet, source file id, and spreadsheet line number.

### Normalization

- Amount parsing supports currency symbols, commas, parentheses negatives, trailing minus, and `CR`/`DR` suffixes.
- Date parsing supports standard date strings and Excel serial values.
- Signed amount behavior depends on source config (`signedAmount` vs `debitCreditColumns`).
- Comparison tokens use text normalization and stop-word removal.
- Reference tokens keep stop-word removal disabled so reference/check context remains literal.

### Data quality and exclusion behavior

A row is marked with data-quality issues when any of the following applies:

- amount is missing or malformed
- transaction date is missing or malformed
- amount is zero while `allowZeroAmount` is disabled
- parser issues are present

Rows marked excluded or with data-quality issues are not eligible for matching.

## 4. Default configuration values

The default matching and reporting profile is defined in `packages/config/src/default-config.ts`.

| Setting                                   | Default   |
|-------------------------------------------|-----------|
| amount tolerance                          | `0.01`    |
| primary date tolerance                    | `5` days  |
| timing-difference window                  | `21` days |
| stale outstanding check threshold         | `45` days |
| exact text similarity threshold           | `0.70`    |
| probable text similarity threshold        | `0.62`    |
| reference similarity threshold            | `0.90`    |
| distinctive amount max occurrences        | `1`       |
| grouped candidate pool size               | `6`       |
| grouped match max size                    | `3`       |
| duplicate date window                     | `3` days  |
| duplicate similarity threshold            | `0.78`    |
| amount-mismatch text similarity threshold | `0.65`    |

Account-specific overrides can change source parsing options, matching thresholds, and severity mapping.

## 5. Matching engine behavior

### Pre-match filtering and duplicate detection

The matcher starts from active transactions only:

- `isExcluded === false`
- `dataQualityIssues.length === 0`

Duplicate detection runs inside each source independently (bank and QBO) and requires:

- same amount within tolerance
- date difference within duplicate window
- either description similarity above threshold or exact reference similarity

Duplicate rows are removed from cross-source matching and later classified as `DuplicateInBank` or `DuplicateInQBO`.

### One-to-one candidate ranking order

For each remaining bank/QBO pair, the engine evaluates rules in this order:

1. `Reference + Amount Match` -> exact candidate
2. `Month-End Transfer Review Match` -> probable timing-review candidate
3. `Amount + Date + Text with Reference Variance` -> probable review candidate (`CheckNumberMismatch` or `ReferenceNumberMismatch`)
4. `Amount + Date + Text Match` -> exact candidate (includes low-context exact shortcut)
5. `Amount + Date with Description Variance` -> probable review candidate (`DescriptionMerchantVariance`)
6. `Amount + Extended Date Window Match` -> date-variance candidate
7. `Possible Amount Mismatch` -> amount-mismatch candidate

If no rule applies, the pair remains unmatched.

### Amount-driven mode

When `textSimilarityThreshold <= 0.12`, the matcher enters an amount-driven mode. In this mode:

- some narrative-heavy review rules are bypassed
- ambiguous-review detection is suppressed

This mode is used by selected account override profiles.

### Ambiguous review handling

A candidate is converted to `AmbiguousReview` with category `AmbiguousMatchRequiringReview` when:

- multiple close alternatives exist (within `0.1` score of the top candidate)
- candidate score is below `0.95`
- reference similarity is below the configured threshold
- amount-driven mode is not active

### Grouped reservation behavior

Before finalizing advisory one-to-one results, the engine reserves grouped candidates:

- one-to-many and many-to-one combinations are evaluated
- combinations must balance amounts within tolerance
- sign and transaction-kind compatibility must hold
- maximum cross-source date spread must fit the timing window

Selected grouped candidates are emitted as `groupedMatchResults` and their member ids are reserved so lower-confidence one-to-one candidates do not consume them.

### Match result consumption rules

- Exact matches consume both sides and are removed from unmatched pools.
- Advisory/probable one-to-one results are retained for review but do not count as clean exact matches.
- Unmatched sets are built after exact consumption only, then refined by classifier stage logic.

## 6. Exception classification behavior

Classification combines unmatched transactions, duplicate flags, and advisory match results.

### Stage order

Residual staging currently executes in this order:

1. stale outstanding check detection
2. likely miscoding detection
3. grouped residual detection
4. timing difference detection
5. missing-item fallback (`MissingFromQBO` / `MissingFromBank`)

### Advisory-protected categories

Transactions tied to these advisory categories are removed from residual missing-stage fallback:

- `AmountMismatch`
- `CheckNumberMismatch`
- `ReferenceNumberMismatch`
- `DescriptionMerchantVariance`
- `AmbiguousMatchRequiringReview`

### Category generation highlights

- `InvalidOrMissingData`: data-quality issue rows.
- `DuplicateInBank` / `DuplicateInQBO`: same-source duplicates.
- `StaleOutstandingCheck`: unmatched, check-like, negative QBO items older than stale threshold.
- `LikelyMiscoding`: distinctive same-amount near-date pairs with strong narrative/reference conflict.
- `LikelySplitCombineIssue` / `DepositGroupingIssue`: balanced residual grouped sets.
- `TimingDifference`: residual timing-compatible same-amount pairs in the extended window.
- `MissingFromQBO` / `MissingFromBank`: final unmatched fallback.
- Match-result-derived categories: `DateVariance`, `TimingDifference`, `AmountMismatch`, `CheckNumberMismatch`, `ReferenceNumberMismatch`, `DescriptionMerchantVariance`, `AmbiguousMatchRequiringReview`.

For `DateVariance` match results, classifier post-processing can upgrade category to `LikelyMiscoding` or `TimingDifference` when evidence supports the stronger interpretation.

### Category precedence

When more than one category could apply to the same transaction key, precedence is:

1. `InvalidOrMissingData`
2. `DuplicateInBank`, `DuplicateInQBO`
3. `AmountMismatch`
4. `LikelySplitCombineIssue`, `DepositGroupingIssue`
5. `LikelyMiscoding`
6. `CheckNumberMismatch`, `ReferenceNumberMismatch`
7. `DateVariance`
8. `TimingDifference`
9. `DescriptionMerchantVariance`
10. `AmbiguousMatchRequiringReview`
11. `StaleOutstandingCheck`
12. `MissingFromQBO`, `MissingFromBank`

## 7. Severity, messaging, and sort order

Default severity mapping is supplied by `reporting.severityByCategory` in config.

Default severity groups:

- `Critical`: `InvalidOrMissingData`
- `High`: missing items, duplicates, amount mismatch, grouped categories, likely miscoding
- `Medium`: date/timing/reference/check/ambiguous/stale-outstanding
- `Low`: `DescriptionMerchantVariance`

User-facing exception text and recommended follow-up actions are sourced from:

- `professionalErrorMessages`
- `recommendedNextActionsByCategory`

Exceptions are sorted by:

1. severity
2. source
3. transaction date
4. line number

## 8. Summary and reviewer outputs

Summary metrics are built from normalized transactions, match results, and final exceptions. The summary includes:

- exact/probable/date-variance/timing counts
- duplicate and data-quality counts
- amount mismatch and missing-item counts
- clean matched amount and unresolved exposure
- counts and amounts by exception category

Reviewer observations are also generated for:

- exception-report creation
- timing-difference detection
- annual mode month-coverage gaps by source file

## 9. Change management guidance

When rule behavior changes, update these artifacts together:

1. matching/classification implementation and tests in `packages/core`
2. config defaults and overrides in `packages/config`
3. shared category/messages/types in `packages/domain`
4. API contract docs in `docs/api.md`
5. test strategy and fixtures in `docs/test-strategy.md` and `packages/test-fixtures`

Implementation-level class and method details are maintained in `docs/class-method-reference.md`.
