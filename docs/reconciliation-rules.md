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

1. Parse bank and GL workbooks into raw rows.
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
- GL beginning-balance patterns (`BEGINNING BALANCE`, `OPENING BALANCE` by default) are excluded when enabled.
- Source lineage is preserved: file name, worksheet, source file id, and spreadsheet line number.

### Normalization

- Amount parsing supports currency symbols, commas, parentheses negatives, trailing minus, and `CR`/`DR` suffixes.
- `splitAmount` is parsed from a dedicated column (default aliases: `split amount`, `split amt`, `line amount`, `line amt`, `distribution amount`) and stored as a signed number on `NormalizedTransaction`. It represents the individual line amount on a GL split transaction, as distinct from the parent transaction `amount`. When no split column is present, `splitAmount` is `null`.
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

| Setting                                   | Default     |
| ----------------------------------------- | ----------- |
| amount tolerance                          | `0.01`      |
| primary date tolerance                    | `5` days    |
| timing-difference window                  | `21` days   |
| stale outstanding check threshold         | `45` days   |
| reversal detection window                 | `7` days    |
| deposit-in-transit window                 | `7` days    |
| partial payment window                    | `90` days   |
| wire fee tolerance                        | `500.00`    |
| credit card fee tolerance                 | `0.03` (3%) |
| exact text similarity threshold           | `0.70`      |
| probable text similarity threshold        | `0.62`      |
| reference similarity threshold            | `0.90`      |
| distinctive amount max occurrences        | `1`         |
| grouped candidate pool size               | `6`         |
| grouped match max size                    | `3`         |
| duplicate date window                     | `3` days    |
| duplicate similarity threshold            | `0.78`      |
| amount-mismatch text similarity threshold | `0.65`      |

Account-specific overrides can change source parsing options, matching thresholds, and severity mapping.

## 5. Matching engine behavior

### Pre-match filtering and duplicate detection

The matcher starts from active transactions only:

- `isExcluded === false`
- `dataQualityIssues.length === 0`

Duplicate detection runs inside each source independently (bank and GL) and requires:

- same amount within tolerance
- date difference within duplicate window
- either description similarity above threshold or exact reference similarity

Duplicate rows are removed from cross-source matching and later classified as `DuplicateInBank` or `DuplicateInGL`.

### One-to-one candidate ranking order

For each remaining bank/GL pair, the primary pass (`rankCandidates`) evaluates rules in this order;
the first rule whose conditions hold wins and the pair moves on (`continue`), so placement order
only matters between rules whose conditions can both be true for the same pair:

1. `Check Number Amount Mismatch` -> amount-mismatch candidate (`CheckNumberMismatch`) when both sides carry a matching check number but amounts differ
2. `Check Number Date Variance` -> date-variance candidate when both sides carry a matching check number, amounts agree, but the date falls outside the primary tolerance and inside the extended timing window
3. `Reference + Amount Match` -> exact candidate
4. `Reference Match with Amount Variance` -> amount-mismatch candidate when reference/document numbers align strongly but amounts differ
5. `Historical Pattern Match` -> exact or date-variance candidate via a learned payee alias
6. `Month-End Transfer Review Match` -> probable timing-review candidate
7. `Amount + Date + Text with Reference Variance` -> probable review candidate (`CheckNumberMismatch` or `ReferenceNumberMismatch`)
8. `Amount + Date + Text Match` -> exact candidate (includes low-context exact shortcut)
9. `Amount + Date with Description Variance` -> probable review candidate (`DescriptionMerchantVariance`)
10. `Amount + Extended Date Window Match` -> date-variance candidate
11. `Wire Correspondent Fee Deduction` -> amount-mismatch candidate; requires wire evidence (transaction type or narrative text) on one side, an absolute difference within `wireFeeTolerance`, and that difference also within a 5% sanity ceiling
12. `Credit Card Service Fee Deduction` -> amount-mismatch candidate; requires card evidence (transaction type or narrative text) on one side and a percentage difference between a 0.1% floor and `creditCardFeeTolerance`
13. `FX Rate Variance` -> amount-mismatch candidate; percentage difference between 0.5% and 15%, no instrument evidence required
14. `Possible Amount Mismatch` -> amount-mismatch candidate; the catch-all when no more specific rule applies

If no rule applies, the pair remains unmatched by the primary pass. A second pass
(`Amount + Date Match, Weak Description`) then runs only against whatever the primary pass and
grouped-reservation stage left unmatched — same-day, same-amount pairs with little vocabulary
overlap, gated on the amount being distinctive enough (`distinctiveAmountMaxOccurrences`) to trust
without narrative confirmation.

Rules 11 and 12 (Wire, Credit Card) are deliberately disjoint by instrument evidence rather than by
evaluation order: a pair with the right amount shape but no evidence for either instrument falls
through to `Possible Amount Mismatch` instead of being claimed by whichever rule happens to run
first. If a pair somehow satisfies both instruments' evidence, Wire wins purely because it is
checked first — no tie-break logic beyond that placement.

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

The reservation stage currently emits both general grouped and specialized grouped review categories:

- general grouped: `LikelySplitCombineIssue`, `DepositGroupingIssue`
- specialized grouped: `FeeNettingMatch`, `PartialPaymentMatch`, `PayrollBatchMatch`, `BankServiceChargeAmortization`, `LoanPaymentSplit`

`LoanPaymentSplit` matches a single bank loan or mortgage debit against two to three GL debits (principal reduction and interest expense) whose amounts sum to the bank total within the primary date tolerance window. Subset combination search is used so additional GL debits in the date window do not prevent a valid match.

Because grouped candidates reserve overlapping members, one selected grouped candidate can suppress another candidate that shares the same bank/GL lines.

### Match result consumption rules

- Exact matches consume both sides and are removed from unmatched pools.
- Advisory/probable one-to-one results are retained for review but do not count as clean exact matches.
- Unmatched sets are built after exact consumption only, then refined by classifier stage logic.

## 6. Exception classification behavior

Classification combines unmatched transactions, duplicate flags, and advisory match results.

### Stage order

Residual staging currently executes in this order:

1. stale outstanding check detection
2. outstanding check detection
3. ACH return detection
4. NSF returned deposit detection
5. reversal/void pair detection
6. chargeback return detection
7. interest income detection
8. intercompany mismatch detection
9. likely miscoding detection
10. engine-reserved grouped category projection (`FeeNettingMatch`, `PartialPaymentMatch`, `PayrollBatchMatch`, `BankServiceChargeAmortization`, `LoanPaymentSplit`)
11. grouped residual detection
12. timing difference detection
13. voided check cleared detection
14. missing-item fallback (`MissingFromGL` / `MissingFromBank` / `DepositInTransit`)

### Advisory-protected categories

Transactions tied to these advisory categories are removed from residual missing-stage fallback:

- `AmountMismatch`
- `CheckNumberMismatch`
- `ReferenceNumberMismatch`
- `DescriptionMerchantVariance`
- `AmbiguousMatchRequiringReview`

### Category generation highlights

- `InvalidOrMissingData`: rows with missing or malformed amount, date, or other data-quality failures.
- `DuplicateInBank` / `DuplicateInGL`: same-source duplicates detected by amount equality, date proximity, and description similarity.
- `StaleOutstandingCheck`: unmatched, check-like, negative GL items older than the stale outstanding threshold (default 45 days).
- `OutstandingCheck`: unmatched, check-like, negative GL items within the stale threshold but not yet cleared in bank.
- `ACHReturn`: paired bank debit and credit that net to zero within the reversal window, with ACH or NSF indicators in the description; both sides are classified.
- `NSFReturnedDeposit`: unmatched bank debit containing NSF or returned-check keywords (`nsf`, `returned check`, `insufficient funds`, etc.) with no corresponding pair; runs after ACH return detection so paired NSF credits are not double-classified.
- `ReversalVoid`: unmatched bank debit paired with a same-amount bank credit within the reversal window, indicating a reversal or void; both sides are classified.
- `ChargebackReturn`: unmatched bank debit with chargeback keywords paired with a same-amount bank credit within the reversal window.
- `InterestIncome`: unmatched bank credit with interest-income keywords and no GL counterpart.
- `IntercompanyMismatch`: unmatched bank or GL transaction with intercompany, entity-transfer, due-to/due-from, or subsidiary keywords and no counterpart.
- `FeeNettingMatch`: a bank credit equals GL revenue net of a GL fee line.
- `PartialPaymentMatch`: multiple bank debits accumulate to one GL payable amount.
- `PayrollBatchMatch`: one payroll bank debit equals multiple GL payroll expense lines.
- `BankServiceChargeAmortization`: one service-charge bank debit equals multiple GL fee allocations.
- `LoanPaymentSplit`: a single bank loan or mortgage debit matches two to three GL debits (principal reduction and interest expense) whose amounts sum to the bank total.
- `LikelyMiscoding`: distinctive same-amount near-date pairs with strong narrative/reference conflict suggesting an account miscoding.
- `LikelySplitCombineIssue` / `DepositGroupingIssue`: balanced residual grouped sets where amounts match but split or combined posting is suspected.
- `TimingDifference`: residual timing-compatible same-amount pairs in the extended window (default 21 days).
- `VoidedCheckCleared`: unmatched bank debit identified as check-like (check number present, `serialNumber` set, or description contains `check`/`chk`) with no GL counterpart; runs after all other stages so legitimate matches are not misclassified.
- `DepositInTransit`: unmatched GL credit recorded near the statement period end (within the deposit-in-transit window, default 7 days) with no bank counterpart; not check-like.
- `MissingFromGL` / `MissingFromBank`: final unmatched fallback after all prior stages have been applied.
- Match-result-derived categories: `DateVariance`, `TimingDifference`, `AmountMismatch`, `CheckNumberMismatch`, `ReferenceNumberMismatch`, `DescriptionMerchantVariance`, `AmbiguousMatchRequiringReview`.

For `DateVariance` match results, classifier post-processing can upgrade the category to `LikelyMiscoding` or `TimingDifference` when evidence supports the stronger interpretation.

### Category precedence

When more than one category could apply to the same transaction key, the lower precedence number wins:

| Level | Categories                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `InvalidOrMissingData`                                                                                                                                                                                        |
| 2     | `DuplicateInBank`, `DuplicateInGL`                                                                                                                                                                           |
| 3     | `AmountMismatch`, `ACHReturn`, `NSFReturnedDeposit`, `ChargebackReturn`                                                                                                                                       |
| 4     | `FeeNettingMatch`, `PartialPaymentMatch`, `PayrollBatchMatch`, `BankServiceChargeAmortization`, `LoanPaymentSplit`, `LikelySplitCombineIssue`, `DepositGroupingIssue`, `ReversalVoid`, `IntercompanyMismatch` |
| 5     | `LikelyMiscoding`                                                                                                                                                                                             |
| 6     | `CheckNumberMismatch`, `ReferenceNumberMismatch`                                                                                                                                                              |
| 7     | `DateVariance`                                                                                                                                                                                                |
| 8     | `TimingDifference`                                                                                                                                                                                            |
| 9     | `DescriptionMerchantVariance`                                                                                                                                                                                 |
| 10    | `AmbiguousMatchRequiringReview`                                                                                                                                                                               |
| 11    | `StaleOutstandingCheck`                                                                                                                                                                                       |
| 12    | `OutstandingCheck`, `DepositInTransit`, `VoidedCheckCleared`                                                                                                                                                  |
| 13    | `MissingFromGL`, `MissingFromBank`, `InterestIncome`                                                                                                                                                         |

## 7. Severity, messaging, and sort order

Default severity mapping is supplied by `reporting.severityByCategory` in config.

Default severity groups:

- `Critical`: `InvalidOrMissingData`
- `High`: `MissingFromBank`, `MissingFromGL`, `AmountMismatch`, `DuplicateInBank`, `DuplicateInGL`, `LikelySplitCombineIssue`, `DepositGroupingIssue`, `LikelyMiscoding`, `FeeNettingMatch`, `PartialPaymentMatch`, `PayrollBatchMatch`, `BankServiceChargeAmortization`, `LoanPaymentSplit`, `NSFReturnedDeposit`, `VoidedCheckCleared`, `ACHReturn`, `ChargebackReturn`, `IntercompanyMismatch`
- `Medium`: `DateVariance`, `TimingDifference`, `CheckNumberMismatch`, `ReferenceNumberMismatch`, `StaleOutstandingCheck`, `AmbiguousMatchRequiringReview`, `ReversalVoid`
- `Low`: `DescriptionMerchantVariance`, `OutstandingCheck`, `DepositInTransit`, `InterestIncome`

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

## 9. GAAP alignment and bank reconciliation standard coverage

Bank-to-GL reconciliation is governed primarily by **ASC 305 (Cash and Cash Equivalents)** and **ASC 230 (Statement of Cash Flows)**. A complete bank reconciliation under GAAP requires that every difference between the bank statement balance and the general-ledger book balance is identified, explained, and resolved before period close.

### Standard bank reconciliation items — full coverage map

| Standard reconciling item                   | GAAP basis | System category                                   | How detected                                                                                                         |
| ------------------------------------------- | ---------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Outstanding checks — normal clearing window | ASC 305-10 | `OutstandingCheck`                                | Unmatched negative GL check items within the stale threshold                                                         |
| Outstanding checks — aged beyond policy     | ASC 305-10 | `StaleOutstandingCheck`                           | Same as above, age exceeds `staleOutstandingCheckDays` (default 45 d)                                                |
| Deposits in transit                         | ASC 305-10 | `DepositInTransit`                                | Unmatched GL credit near period end within `depositInTransitDays` (default 7 d), not check-like                      |
| NSF / returned checks                       | ASC 310-10 | `NSFReturnedDeposit`                              | Bank debit with NSF or returned-check keywords, no paired bank credit                                                |
| Bank service charges and fees               | ASC 305-10 | `BankServiceChargeAmortization`                   | Bank debit with service-charge keywords equals sum of 2–6 GL fee lines                                               |
| Interest income credited by bank            | ASC 305-10 | `InterestIncome`                                  | Bank credit with interest keywords, no GL counterpart                                                                |
| ACH / EFT returns                           | ASC 310-10 | `ACHReturn`                                       | Paired same-amount bank debit and credit (net zero) with ACH or NSF indicators within reversal window                |
| Reversed or voided entries                  | ASC 305-10 | `ReversalVoid`                                    | Paired same-amount bank debit and credit with no ACH indicators, within reversal window                              |
| Check voided in books but cleared bank      | ASC 305-10 | `VoidedCheckCleared`                              | Bank check debit (check number or “check”/”chk” description) with no GL counterpart                                  |
| Chargeback / disputed item returned         | ASC 606-10 | `ChargebackReturn`                                | Bank debit with chargeback keywords paired with same-amount bank credit                                              |
| Loan payment — principal + interest split   | ASC 470-10 | `LoanPaymentSplit`                                | Single bank loan debit matched against 2–3 GL debits (principal + interest) summing to bank total                    |
| Intercompany / entity transfer              | ASC 810-10 | `IntercompanyMismatch`                            | Bank or GL item with intercompany, due-to/from, or subsidiary keywords and no counterpart                            |
| Payroll batch posting                       | ASC 718-10 | `PayrollBatchMatch`                               | Single bank payroll debit equals sum of multiple GL payroll expense lines                                            |
| Fee netting (revenue net of bank fee)       | ASC 606-10 | `FeeNettingMatch`                                 | Bank credit equals GL revenue line minus GL fee line                                                                 |
| Partial payment accumulation                | ASC 310-10 | `PartialPaymentMatch`                             | Multiple bank debits accumulate to a single GL payable amount                                                        |
| Timing difference (posting-date lag)        | ASC 230-10 | `TimingDifference`                                | Same-amount pair within the extended timing window (`timingDifferenceDays`, default 21 d) but outside primary window |
| Date variance (extended window match)       | ASC 230-10 | `DateVariance`                                    | Matched pair with date difference exceeding primary tolerance but within timing window                               |
| Amount mismatch                             | ASC 305-10 | `AmountMismatch`                                  | Matched pair where amounts differ beyond `amountTolerance` with high description similarity                          |
| Likely miscoding                            | ASC 820-10 | `LikelyMiscoding`                                 | Distinctive same-amount near-date pair where description/reference conflict suggests wrong account                   |
| Duplicate bank posting                      | ASC 305-10 | `DuplicateInBank`                                 | Same-source same-amount duplicate within `duplicateDateWindowDays`                                                   |
| Duplicate book entry                        | ASC 305-10 | `DuplicateInGL`                                  | Same-source same-amount duplicate in GL within duplicate window                                                      |
| Split transaction / grouped deposit         | ASC 230-10 | `LikelySplitCombineIssue`, `DepositGroupingIssue` | Balanced residual grouped sets where split or batched posting is likely                                              |
| Check number mismatch                       | ASC 305-10 | `CheckNumberMismatch`                             | Amount and text align but check numbers differ                                                                       |
| Reference number mismatch                   | ASC 305-10 | `ReferenceNumberMismatch`                         | Amount and text align but reference numbers differ                                                                   |
| Description / merchant variance             | ASC 305-10 | `DescriptionMerchantVariance`                     | Amount and date match but description similarity is in the grey zone                                                 |
| Ambiguous match requiring review            | ASC 305-10 | `AmbiguousMatchRequiringReview`                   | Multiple near-equal candidates exist for the same transaction                                                        |
| Missing from GL (book)                      | ASC 305-10 | `MissingFromGL`                                  | Bank transaction has no book counterpart after all other stages                                                      |
| Missing from bank                           | ASC 305-10 | `MissingFromBank`                                 | GL transaction has no bank counterpart after all other stages                                                        |
| Invalid or missing data                     | ASC 855-10 | `InvalidOrMissingData`                            | Amount, date, or other required field is absent or malformed                                                         |

### GAAP assertion coverage

| GAAP assertion (ASC 315-10 / PCAOB AS 2315) | Coverage status   | Supporting categories                                                                                                                            |
| ------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existence — recorded cash events occurred   | Covered           | `ExactMatch`, `ProbableMatch`, all grouped categories                                                                                            |
| Completeness — all cash events are recorded | Covered           | `MissingFromGL`, `MissingFromBank`, `DepositInTransit`, `OutstandingCheck`, `StaleOutstandingCheck`                                             |
| Accuracy — amounts and periods are correct  | Covered           | `AmountMismatch`, `DateVariance`, `TimingDifference`, `InvalidOrMissingData`, `DuplicateInBank`, `DuplicateInGL`                                |
| Cutoff — transactions in the right period   | Covered           | `DateVariance`, `TimingDifference`, `DepositInTransit`, `OutstandingCheck`, `StaleOutstandingCheck`                                              |
| Classification — correct account assignment | Partially covered | `LikelyMiscoding`, `IntercompanyMismatch`, `LoanPaymentSplit`, `BankServiceChargeAmortization`, `CheckNumberMismatch`, `ReferenceNumberMismatch` |
| Presentation — output is auditable          | Partially covered | Summary metrics, exception export workbook, reviewer observations, rule traces stored per exception                                              |
| Rights and obligations                      | Not covered       | Requires legal-entity and policy controls outside pattern matching                                                                               |

**Scope boundary:** this engine fully covers the transaction-level detection tier for bank-to-GL cash reconciliation (all 30 categories map to a standard reconciling item above). Full period-close GAAP compliance also requires chart-of-accounts governance, management review sign-off, journal entry controls, and external audit procedures that are outside the scope of automated matching.

## 10. Change management guidance

When rule behavior changes, update these artifacts together:

1. matching/classification implementation and tests in `packages/core`
2. config defaults and overrides in `packages/config`
3. shared category/messages/types in `packages/domain`
4. database schema migration in `packages/persistence/src/schema.ts` (new migration to update the `reconciliation_exception_category_check` constraint)
5. API contract docs in `docs/api.md`
6. test strategy and fixtures in `docs/test-strategy.md` and `packages/test-fixtures`

Implementation-level class and method details are maintained in `docs/class-method-reference.md`.
