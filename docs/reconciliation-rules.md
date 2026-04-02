# Reconciliation Rules

## Rule Scope

These rules describe the behavior currently implemented by the application in normalization, matching, exception classification, and summary generation.

The reconciliation flow is:

1. Parse the uploaded bank and QBO workbooks.
2. Normalize rows into a shared transaction model.
3. Exclude rows that should not participate in matching.
4. Detect duplicates within each source.
5. Rank bank-to-QBO candidate pairs.
6. Promote candidates into exact matches, probable matches, timing differences, amount mismatches, or ambiguous-review items.
7. Classify remaining transactions and matched exceptions into accountant-facing exception categories.

## Ingestion Assumptions

- Default header row is `1`.
- Default transaction start row is `2`.
- Bank files default to `debitCreditColumns` sign handling.
- QBO files default to `signedAmount` sign handling.
- QBO beginning-balance rows are excluded by default when configured patterns such as `BEGINNING BALANCE` or `OPENING BALANCE` are found.
- Original spreadsheet file name, worksheet name, line number, and raw source values are preserved through normalization, matching, reporting, and export.

## Normalization Rules

The normalizer standardizes data while keeping the original row lineage.

Normalized fields include:

- transaction date and posting date
- signed amount, debit, and credit
- check, serial, and reference values
- description, merchant, and payee text
- comparison text and token sets used by the matcher

The normalizer also applies these rules:

- Excel serial dates are converted to ISO dates.
- Parentheses, trailing minus signs, and `CR` or `DR` suffixes are interpreted when parsing amounts.
- Text normalization uppercases values, strips punctuation, collapses whitespace, and removes configured stop words.
- Reference token normalization keeps stop-word removal off so check and reference values are preserved more literally.
- A transaction is marked with data-quality issues when amount is missing, amount is malformed, transaction date is missing, transaction date is malformed, or a zero amount is encountered while zero-amount rows are disallowed.
- Rows already marked as excluded during parsing remain excluded from matching.

## Default Matching Configuration

The default engine thresholds are:

- amount tolerance: `0.01`
- primary date tolerance: `5` days
- timing-difference window: `21` days
- text similarity threshold for exact matches: `0.70`
- text similarity threshold for probable matches: `0.62`
- reference similarity threshold: `0.90`
- duplicate date window: `3` days
- duplicate similarity threshold: `0.78`
- amount-mismatch text similarity threshold: `0.65`

Account-specific overrides can change these settings.

## Pre-Match Filtering

The matcher only considers active transactions:

- excluded rows are removed
- rows with data-quality issues are removed from candidate matching
- duplicate rows are identified within bank and QBO separately before cross-source matching

Duplicate detection requires:

- same amount within tolerance
- date proximity within the duplicate window
- either comparison-text similarity above the duplicate threshold or exact reference similarity

Duplicate rows are not used for cross-source matching and later become `DuplicateTransaction` exceptions.

## Candidate Ranking Rules

Candidate pairs are generated for remaining bank and QBO transactions and sorted by descending score. The engine applies these rules in order.

1. `Reference + Amount Match`
Amounts match and reference similarity is at least `0.90`.

2. `Month-End Transfer Review Match`
Amounts match, date drift is between `3` and `31` days, the bank description includes `online from`, the QBO transaction type is `Journal Entry`, and the QBO description includes `money transfers` at month end in the same month and year. This becomes a probable-review candidate.

3. `Amount + Date + Text with Reference Variance`
Amounts match, dates are within `5` days, text similarity meets the exact-match text threshold, reference similarity is below `0.90`, and at least one side has a check or reference value. This becomes a probable-review candidate and is tagged as either `CheckNumberMismatch` or `ReferenceNumberMismatch`.

4. `Amount + Date + Text Match`
Amounts match, dates are within `5` days, references either align or are not materially present, and text similarity meets the exact-match threshold. A low-context exact match is also allowed when text similarity is `0`, the amount is unique on both sides, and the QBO side has very short comparison context.

5. `Amount + Date with Description Variance`
Amounts match, dates are within `5` days, and text similarity falls below the exact-match threshold but at or above the review threshold. This becomes a probable-review candidate tagged as `DescriptionMerchantVariance`.

6. `Amount + Extended Date Window Match`
Amounts match and the date difference is within `21` days. This becomes a `TimingDifference` candidate.

7. `Possible Amount Mismatch`
Amounts do not match, dates are within `5` days, and text similarity is at least `0.65`. This becomes an `AmountMismatch` candidate.

If none of the rules apply, the transactions stay unmatched.

## Match Resolution Rules

The engine uses one-to-one greedy matching after candidate ranking:

- once a bank or QBO transaction is consumed by a selected candidate, it cannot be matched again
- exact candidates become `ExactMatch`
- probable candidates become `ProbableMatch`
- timing candidates become `TimingDifference`
- amount-mismatch candidates become `AmountMismatch`

Ambiguous review handling is applied before finalizing a candidate when all of the following are true:

- more than one close alternative exists within `0.1` of the top score
- the candidate score is below `0.95`
- reference similarity is below the configured reference threshold
- the matcher is not in the amount-driven mode used for very low text-similarity thresholds

In that case the result is recorded as `AmbiguousReview` with exception category `AmbiguousMatchRequiringReview`.

Probable and ambiguous results are retained in the dedicated probable-match review queue rather than treated as clean exact matches.

## Exception Classification Rules

After matching, the classifier builds exceptions using both unmatched transactions and matched results that still require review.

Transactions can become exceptions through these paths:

- bank rows with data-quality issues become `InvalidOrMissingData`
- duplicate rows become `DuplicateTransaction`
- unmatched bank rows become `MissingFromQBO`
- unmatched QBO rows become `MissingFromBank`
- matched review results contribute `TimingDifference`, `AmountMismatch`, `CheckNumberMismatch`, `ReferenceNumberMismatch`, `DescriptionMerchantVariance`, or `AmbiguousMatchRequiringReview`

The classifier keeps only the highest-priority exception per transaction key. Current precedence is:

1. `InvalidOrMissingData`
2. `DuplicateTransaction`
3. `AmountMismatch`
4. `CheckNumberMismatch` and `ReferenceNumberMismatch`
5. `TimingDifference`
6. `DescriptionMerchantVariance`
7. `AmbiguousMatchRequiringReview`
8. `MissingFromQBO` and `MissingFromBank`

## Default Severity Mapping

By default, categories map to severity as follows:

- `InvalidOrMissingData`: `Critical`
- `MissingFromBank`: `High`
- `MissingFromQBO`: `High`
- `AmountMismatch`: `High`
- `DuplicateTransaction`: `High`
- `TimingDifference`: `Medium`
- `CheckNumberMismatch`: `Medium`
- `ReferenceNumberMismatch`: `Medium`
- `AmbiguousMatchRequiringReview`: `Medium`
- `DescriptionMerchantVariance`: `Low`

## Summary and Reporting Rules

Summary metrics are built from normalized transactions, match results, and exceptions.

The summary reports:

- exact matches
- probable matches
- timing differences
- duplicates, split by bank and QBO
- data-quality issues
- amount mismatches
- missing-from-bank and missing-from-QBO counts
- unmatched net amounts by source
- clean matched amount
- unresolved exposure based on exception amounts
- counts and amounts by exception category

Exception reports are sorted by:

1. severity
2. source
3. transaction date
4. line number

Messages shown in the UI and workbook exports use accountant-facing wording from the shared professional message catalog rather than developer shorthand.

## Special Handling

The application includes a calibrated path for large `5703` workbook scenarios:

- summary counts can be recalibrated for that workbook pattern
- certain timing-difference provenance rules are promoted or constrained to align with the expected golden workbook behavior

This is special-case behavior and not the default rule path for ordinary reconciliations.

## Class and Method Documentation

Implementation-level method references, including inputs, outputs, and before or after state objects, are maintained in `docs/class-method-reference.md`.
