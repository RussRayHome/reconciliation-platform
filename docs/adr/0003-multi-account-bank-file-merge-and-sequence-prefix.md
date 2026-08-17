# ADR-0003: Multi-Account Bank File Merge & Composite Sequence Numbering

**Status:** Accepted
**Date:** 2026-08-17
**Deciders:** Repository owner
**Related:** [Issue #141](https://github.com/RussRayHome/reconciliation-platform/issues/141),
[Issue #137](https://github.com/RussRayHome/reconciliation-platform/issues/137) — this decision
assumes #137's parsing-pipeline unification lands first, since the merge/prefix logic below must
live in whichever pipeline ends up canonical, not be built twice.

## Context

The File Imports & Validation feature (`feature/file-imports-validation`) was built assuming a
1:1 pairing — one bank transaction file matched against one GL file per import run. That
assumption doesn't hold for this business:

- **Bank transactions are issued per account.** Each bank account produces its own transaction
  export file.
- **The GL export spans all accounts.** A single GL file covers transactions across both bank
  accounts together.

An import run therefore needs to accept **two bank files and one GL file**, and the two
per-account bank listings need to become a single unified bank transaction set before matching
against the GL.

## Decision

1. **Merge**: the two per-account bank files are combined into one unified bank transaction
   listing prior to matching against the single GL file.
2. **Composite sequence number**: after merging, each transaction's sequence number is prefixed
   with the last four digits of its originating bank account number —
   `<last-4-of-account>-<sequence-number>`, e.g. account `...4321`, sequence `000512` becomes
   `4321-000512`. This prevents sequence-number collisions between the two accounts once their
   listings are combined.
3. **Account number source**: the account number is not a column in the bank transaction file
   itself. It is embedded in the **uploaded file's name** and must be parsed out of the file name
   during ingestion to build the composite prefix.
4. **Upload cardinality**: an import run moves from one bank file + one GL file to **two bank
   files + one GL file**.

## Consequences

- **Upload API** (`POST /api/imports/runs`, `apps/api/src/app.ts`) must accept two bank files
  instead of one.
- **Schema**: `import_file` / `run_source_file` (changesets 0044-0046) already generalized away
  from a fixed bank/GL FK pair to a join table, specifically to allow more than one file per role
  on a run — this should not need further structural changes to hold three files per run, but
  needs a way to distinguish "bank file A" from "bank file B" and to carry the parsed account
  number as file metadata.
- **Parsing/normalization**: per #137, two disconnected parsing pipelines currently exist (the
  old alias-based parser that actually feeds the matching engine, and the newer File Validation
  Engine that only feeds `canonical_record` for audit). The merge + sequence-prefix step belongs
  in whichever pipeline is canonical once #137 lands.
- **Frontend**: the Screen 01 upload flow (`SourceDropZone`) has exactly one bank slot and one GL
  slot today; needs a second bank file slot.
- **Templates**: the downloadable bank template and the account-number-in-filename convention need
  to be documented so uploaded files are reliably parseable.
- **Matching engine**: needs confirmation of whether the composite sequence key reaches any
  existing rule that reads `serialNumber` / `referenceNumber` on `NormalizedTransaction`, or stays
  a purely ingestion-time disambiguator.

## Open questions

- Exact file name pattern for extracting the account number (prefix vs. suffix, delimiter,
  fixed-width vs. variable-width).
- Behavior if both accounts happen to share the same last four digits.
- Whether this generalizes to N accounts, or is deliberately scoped to exactly two.
