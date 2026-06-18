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
- npm run docs:api:check
- npm run test
- npm run test:e2e
- npm run coverage
- npm run build
- npm run security:scan

Result summary:
- lint: pass/fail
- typecheck: pass/fail
- docs-api-check: pass/fail
- unit/integration: pass/fail
- e2e: pass/fail
- coverage: include headline percentages
- build: pass/fail
- security: pass/fail
```

## FIXME Notation for Production Gating

Use a structured FIXME marker for unresolved items that must be checked before production:

- `FIXME(prod-gate): <summary> | owner=<name-or-team> | tracking=<ticket-or-link> | exit=<clear-remediation-criteria>`

Use this marker only when all of the following are true:

1. The item is unresolved.
2. The item has production relevance (security, data integrity, reliability, or operational risk).
3. The item must be explicitly resolved or waived before release.

Pre-production scan command:

```bash
rg --no-heading --line-number --glob '!node_modules/**' --glob '!coverage/**' 'FIXME\(prod-gate\):' .
```

Optional blocking check (fails when markers exist):

```bash
if rg --no-heading --line-number --glob '!node_modules/**' --glob '!coverage/**' 'FIXME\(prod-gate\):' .; then
  echo "Release blocked: unresolved FIXME(prod-gate) markers found."
  exit 1
else
  echo "OK: no FIXME(prod-gate) markers found."
fi
```

If any marker remains, capture the decision in release notes under Risks and Follow-Up with approver and timeline.

Current production gate reminder:

- `FIXME(prod-gate): Remove temporary DB CVE allowlist entries in scripts/ops/db-cve-allowlist.txt (CVE-2025-68121 and CVE-2026-33845) once upstream fixed packages are available or a formal waiver is approved | owner=platform-security | tracking=CVE-2025-68121,CVE-2026-33845 | exit=Remove allowlist entries and verify npm run docker:db:preflight:test-stage reports CRITICAL=0 with ALLOWLISTED=0`.

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

Promote `Unreleased` notes into a dated changelog section with:

```bash
npm run changelog:promote -- --date YYYY-MM-DD
```

Generate and enforce implementation API docs coverage for exported classes with:

```bash
npm run docs:api:generate
npm run docs:api:check
```
