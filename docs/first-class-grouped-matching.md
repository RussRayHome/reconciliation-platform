# First-Class Grouped Matching Plan

## Purpose

This document defines the planned transition from grouped matching as a residual exception heuristic to grouped matching as a first-class engine result.

Today the platform can recognize grouped one-to-many and many-to-one patterns, but it does so in two indirect ways:

- the matcher reserves grouped candidates so one-to-one advisory review items do not consume them
- the exception classifier re-discovers grouped patterns in the residual pool and records them as `DepositGroupingIssue` or `LikelySplitCombineIssue`

That design is useful as a safe intermediate state, but it leaves grouped relationships outside the main match model.

## Current State

Grouped logic currently lives in two separate places:

1. `packages/core/src/matching/groupedReservations.ts`
   - identifies grouped combinations
   - reserves transaction IDs to prevent one-to-one advisory outcomes from consuming them
   - does not emit a match result

2. `packages/core/src/reporting/exceptionClassifier.ts`
   - rebuilds grouped combinations from unmatched residual transactions
   - emits grouped exceptions rather than grouped matches
   - duplicates combination generation, compatibility checks, and scoring concepts already present in the matcher

As a result:

- grouped relationships are not visible in `matchResults`
- grouped outcomes are treated as exception categories instead of a native reconciliation result
- matching and reporting maintain partially duplicated grouped logic
- reviewer workflows cannot approve or reject grouped candidates as a first-class decision type

## Problems With The Current Model

### Split Logic

Grouped detection is duplicated across matching and reporting, which increases drift risk.

### Audit Shape

The system can explain grouped residuals after classification, but it cannot present them as primary match outcomes alongside exact, probable, date-variance, or timing-difference results.

### Review Workflow Limitations

Grouped outcomes are not a native reviewable artifact. They surface as exceptions rather than structured grouped candidates with explicit member sets.

### Export/UI Limitations

Exports and UI views can describe grouped issues, but they cannot render grouped matches as a dedicated review surface with member-level lineage and approval state.

## Target State

Grouped matching should become a primary matcher output with explicit grouped result records.

The target architecture is:

1. Matching identifies grouped candidates directly.
2. Matching emits grouped results with member sets and evidence.
3. Residual classification consumes those grouped results as settled or reviewable outcomes rather than re-deriving them from scratch.
4. Reporting keeps grouped issue categories only where the grouped result is itself a follow-up condition rather than a fallback discovery.

## Proposed Domain Additions

Introduce a grouped match model in the shared domain package.

```ts
export type GroupedMatchDisposition =
  | 'GroupedExactMatch'
  | 'GroupedReviewMatch';

export interface GroupedMatchMember {
  transactionId: string;
  source: SourceSystem;
  spreadsheetFileName: string;
  lineNumber: number;
  amount: number;
}

export interface GroupedMatchResult {
  id: string;
  disposition: GroupedMatchDisposition;
  confidence: MatchConfidence;
  category?: 'DepositGroupingIssue' | 'LikelySplitCombineIssue';
  bankTransactionIds: string[];
  qboTransactionIds: string[];
  bankMembers: GroupedMatchMember[];
  qboMembers: GroupedMatchMember[];
  totalAmount: number;
  dateDifferenceDays: number | null;
  score: number;
  ruleId: string;
  ruleName: string;
  reason: string;
  evidence: string[];
}
```

Add `groupedMatchResults: GroupedMatchResult[]` to:

- `ReconciliationOutput`
- `ReconciliationRun`

## Matching-Layer Refactor

### Step 1: Unify Grouped Candidate Construction

Move the shared grouped-combination logic into a single matcher-owned module that produces candidate objects reusable by both reservation and final grouped result emission.

This should replace the current parallel candidate builders in:

- `matching/groupedReservations.ts`
- `reporting/exceptionClassifier.ts`

### Step 2: Emit Grouped Results

After exact-match consumption and before one-to-one advisory review handling, the matcher should:

- build grouped candidates
- sort them by score
- greedily consume non-overlapping grouped candidates
- emit `GroupedMatchResult` records
- mark all consumed member transactions as no longer available for one-to-one matching

### Step 3: Reframe Reservation

Once grouped results are emitted directly, reservation becomes an implementation detail of grouped result selection rather than a separate public matcher stage.

`groupedReservations.ts` can either be deleted or reduced to an internal helper used only inside grouped result selection.

## Reporting-Layer Refactor

The exception classifier should stop rediscovering grouped candidates from residual transactions once grouped results exist.

Instead it should:

- exclude grouped-result member transactions from residual missing fallback
- optionally derive grouped follow-up exceptions only when the grouped result disposition indicates review is still required
- reuse grouped result evidence rather than recomputing it

## Disposition Strategy

The first implementation should keep grouped outcomes review-oriented, not silently settled.

Recommended initial mapping:

- `GroupedReviewMatch` for grouped one-to-many and many-to-one results
- keep `DepositGroupingIssue` and `LikelySplitCombineIssue` as reporting labels derived from grouped review matches, not independently discovered residual categories

Later, if business rules justify it, a stricter `GroupedExactMatch` can be introduced for low-risk grouped scenarios.

## UI Plan

Add a dedicated grouped-review surface alongside probable matches.

That view should show:

- grouped disposition
- total grouped amount
- bank member rows
- QBO member rows
- evidence and rationale
- reviewer decision controls once grouped reviewer decisions are implemented

## Export Plan

Workbook export should add a `Grouped Matches Review` sheet with:

- grouped result id
- grouped category/label
- disposition
- member counts by side
- total amount
- date difference
- evidence summary
- bank member detail
- QBO member detail

The current grouped exception labels can remain in the Summary sheet during transition, but they should eventually be derived from grouped results rather than residual exception discovery.

## API Plan

Run payloads should eventually include `groupedMatchResults`.

No separate grouped endpoint is required initially if grouped results are already present on `GET /api/reconciliation/:id` and latest-run payloads.

## Reviewer Decision Alignment

Once grouped matches are first-class, reviewer decision targets should extend to support grouped results explicitly.

Recommended future addition:

```ts
type ReviewerDecisionTargetType =
  | 'ProbableMatch'
  | 'AmbiguousReview'
  | 'ExceptionItem'
  | 'GroupedMatch';
```

## Migration Sequence

1. Add shared grouped result types to `packages/domain`.
2. Extract one grouped candidate builder owned by the matcher.
3. Emit `groupedMatchResults` directly from `reconcileMatches`.
4. Thread grouped results through `runReconciliation`, API responses, and stored runs.
5. Remove grouped rediscovery from the exception classifier and derive any grouped follow-up reporting from grouped results.
6. Add workbook and UI grouped review surfaces.
7. Extend reviewer-decision persistence to grouped results.

## Acceptance Criteria

The plan should be considered implemented when:

1. Grouped candidates are emitted as native matcher outputs rather than inferred only from residual exceptions.
2. Grouped member transactions no longer require duplicated grouped discovery in the exception classifier.
3. Run payloads expose grouped results directly.
4. Workbook export and UI each show a dedicated grouped review surface.
5. Existing grouped precedence behavior remains covered by regression tests.

## Risks

### Behavior Drift

Moving grouped logic earlier in the pipeline can change residual classification counts if member consumption differs from the current reservation-plus-classifier flow.

### Export Semantics

Some current charts and summaries treat grouped scenarios as categorized exceptions. Those semantics will need a deliberate transition so dashboards do not silently change meaning.

### Review UX Complexity

Grouped review surfaces are inherently more complex than one-to-one review rows because each decision applies to multiple line items.

## Recommended Next Implementation Cut

The safest next code change is to add `GroupedMatchResult` and emit grouped results from the matcher while leaving the exception classifier behavior intact behind a compatibility bridge. That allows side-by-side verification before deleting residual grouped rediscovery.
