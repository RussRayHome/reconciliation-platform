# Release Notes and Change Management

This project does not yet use formal semantic versioning or an automated release pipeline. Until that changes, release documentation should still be produced in a consistent way so changes can be validated, audited, and handed off safely.

## Release Goals

Every release note or milestone summary should help an engineer answer:

- What changed?
- Why did it change?
- What should be validated after deployment?
- What risks or rollback considerations exist?

## Minimum Release Checklist

Before considering a release note complete, capture:

1. Scope summary
2. User-facing changes
3. API or contract changes
4. Configuration or environment changes
5. Documentation updates included in the change set
6. Validation evidence
7. Known risks
8. Rollback considerations

## Validation Evidence Template

Record the quality checks that were executed for the release candidate.

```text
Validation run:
- npm run lint
- npm run typecheck
- npm run test
- npm run test:e2e
- npm run coverage
- npm run build
- npm run security:scan

Result summary:
- lint: pass/fail
- typecheck: pass/fail
- unit/integration: pass/fail
- e2e: pass/fail
- coverage: include headline percentages
- build: pass/fail
- security: pass/fail
```

## Release Note Template

```md
## [Release Date or Milestone Name]

### Summary
- Brief description of the release scope.

### User-Facing Changes
- UI, workflow, export, or API changes visible to users.

### Internal Changes
- Refactors, diagnostics, maintainability work, tooling changes.

### Configuration Changes
- New env vars, changed defaults, removed settings.

### Validation Evidence
- Commands run and pass/fail summary.

### Risks and Follow-Up
- Known limitations, monitoring expectations, deferred work.

### Rollback Notes
- What to revert, disable, or validate if the change must be backed out.
```

## Rollback Metadata to Capture

Even before a formal deployment process exists, release documentation should note:

- commit hash or range
- any dependent config changes
- whether data or workbook output shape changed
- whether rollback can be done by code revert alone
- which smoke checks confirm rollback success

## Relationship to `CHANGELOG.md`

- `CHANGELOG.md` is the concise ledger of noteworthy changes.
- `RELEASE.md` defines the standard for writing higher-signal release notes and validation summaries.

Use both together: update the changelog when behavior changes, and use this file when preparing a release or milestone handoff.
