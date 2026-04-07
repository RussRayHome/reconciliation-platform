# Reviewer Decision Persistence Design

## Purpose

This document defines the next-step design for persisting reviewer decisions on probable matches and review-oriented exception items.

The current application already produces:

- exact matches
- probable matches
- ambiguous review items
- typed exceptions with rule traces, prior lineage, counterparts, and recommended next actions

What it does not yet persist is the reviewer's final decision after inspecting those items.

## Current State

Today the system stores a completed reconciliation run as a single payload via the run repository.

The stored run contains:

- `matchResults`
- `probableMatches`
- `exceptions`
- `summary`
- `reviewerObservations`
- exported workbook metadata and binary

The API exposes the run read-only through:

- `GET /api/reconciliation/latest`
- `GET /api/reconciliation/:id`
- `GET /api/reconciliation/:id/summary`
- `GET /api/reconciliation/:id/exceptions`

There is currently no persisted write path for:

- approving a probable match
- rejecting a probable match
- manually classifying a review item into a specific exception category
- attaching reviewer rationale as durable decision history

## Design Goals

1. Preserve the current deterministic engine output as the system-generated baseline.
2. Store reviewer decisions separately from the original engine result so the audit trail remains intact.
3. Support restart-safe persistence with the current file-backed repository model.
4. Keep the design compatible with a future database-backed repository.
5. Allow the UI and exports to distinguish between engine-generated status and reviewer-finalized status.

## Non-Goals

- Recomputing reconciliation results in place during the first persistence iteration
- Multi-user locking or concurrent conflict resolution
- Full workflow orchestration with assignment, SLA, or notification features

## Proposed Data Model

Add a reviewer-decision model at the domain layer.

### Decision Scope

A reviewer decision should attach to a review target, not directly overwrite raw engine output.

The initial supported target types should be:

- probable match result
- ambiguous review result
- exception item requiring manual override

### Proposed Types

```ts
export type ReviewerDecisionTargetType =
  | 'ProbableMatch'
  | 'AmbiguousReview'
  | 'ExceptionItem';

export type ReviewerDecisionOutcome =
  | 'ApprovedMatch'
  | 'RejectedMatch'
  | 'ConfirmedException'
  | 'ReclassifiedException';

export interface ReviewerDecision {
  id: string;
  runId: string;
  targetType: ReviewerDecisionTargetType;
  targetId: string;
  outcome: ReviewerDecisionOutcome;
  finalCategory?: ErrorCategory;
  notes?: string;
  reviewerId?: string;
  reviewerName?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Reconciliation Run Extension

Extend `ReconciliationRun` with:

```ts
reviewerDecisions: ReviewerDecision[];
```

This keeps decisions co-located with a stored run while still preserving a clean repository seam.

## Repository Changes

The `RunRepository` interface should gain explicit mutation methods rather than overloading `save`:

```ts
save(run: ReconciliationRun): ReconciliationRun;
findById(id: string): ReconciliationRun | undefined;
findLatest(): ReconciliationRun | undefined;
saveReviewerDecision(runId: string, decision: ReviewerDecision): ReviewerDecision;
listReviewerDecisions(runId: string): ReviewerDecision[];
```

### File-Backed Persistence

For the current `FileBackedRunRepository`, decisions should be serialized inside the same persisted latest-run snapshot.

That keeps the first implementation simple:

- no new storage file format
- no extra hydration flow
- no detached consistency problem between runs and decisions

## API Design

### New Endpoints

Add the following endpoints:

- `GET /api/reconciliation/:id/reviewer-decisions`
- `POST /api/reconciliation/:id/reviewer-decisions`

### POST Payload

```json
{
  "targetType": "ProbableMatch",
  "targetId": "probable-1",
  "outcome": "ApprovedMatch",
  "finalCategory": null,
  "notes": "Approved after invoice and settlement review.",
  "reviewerName": "Controller"
}
```

### Validation Rules

- `runId` must exist
- `targetId` must exist within the specified run and match the declared `targetType`
- `finalCategory` is required only when `outcome` is `ReclassifiedException`
- `finalCategory` must be a valid `ErrorCategory`
- notes should be optional but strongly encouraged for reject or reclassify actions

## UI Design

### Probable Match Review

The probable match table should support at minimum:

- approve match
- reject match
- add reviewer note

### Exception Report

The exception table should support at minimum:

- confirm exception
- reclassify exception
- add reviewer note

### Display Behavior

Once decisions exist, the UI should show:

- current review status
- reviewer note summary
- whether the visible state is engine-generated or reviewer-finalized

## Reporting and Export Behavior

The first persistence iteration should not rewrite the original engine output. Instead:

- preserve engine-generated `probableMatches` and `exceptions`
- attach reviewer decisions alongside them
- allow workbook and JSON exports to include a new `Reviewer Decisions` section or sheet

This keeps the original model auditable while still surfacing reviewed outcomes.

## Suggested Workbook Export Addition

Add a `Reviewer Decisions` worksheet with columns:

- target type
- target id
- outcome
- final category
- notes
- reviewer
- created at
- updated at

## Implementation Sequence

1. Extend domain types with `ReviewerDecision` and `reviewerDecisions`.
2. Extend repository interfaces and file-backed serialization.
3. Add API endpoints and validation.
4. Add UI controls for probable-match and exception review decisions.
5. Add workbook export support for reviewer decisions.
6. Add regression tests across domain, API, UI, and export paths.

## Acceptance Criteria

The design should be considered implemented when:

1. A reviewer can approve or reject a probable match and see that decision after API restart.
2. A reviewer can confirm or reclassify an exception and see that decision after reload.
3. The original engine-generated output remains preserved for audit comparison.
4. JSON responses include reviewer decisions for a run.
5. Workbook export includes a reviewer-decision section or worksheet.
6. API and UI tests cover at least one approve, reject, and reclassify path.

## Open Questions

1. Should approved probable matches remain in `probableMatches`, move into a separate reviewed collection, or be reflected as synthetic exact matches in a derived view?
2. Should reviewer identity be free text for now or tied to authentication once auth exists?
3. Should reclassification allow any `ErrorCategory`, or only a limited set based on target type?
