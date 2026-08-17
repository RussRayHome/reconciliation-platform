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

1. **Merge is a pre-validation ingestion step, not part of File Validation itself.** The two raw
   per-account bank files are combined into one unified bank transaction listing **before** the
   File Validation Engine ever runs. File Validation keeps its existing one-bank-file : one-GL-file
   contract unchanged — it is simply handed the merged output in place of a raw upload, and never
   has visibility into there having been two source files. Concretely, the merge step:
   1. parses the account number out of each raw bank file's name (see point 3),
   2. parses each raw file's rows,
   3. applies the composite sequence-number prefix (see point 2) to every row,
   4. concatenates both accounts' rows into a single unified bank transaction dataset,
   5. hands that single merged dataset to the File Validation Engine exactly as a single bank file
      is handled today.
2. **Composite sequence number**: as part of the merge, each transaction's sequence number is
   prefixed with the last four digits of its originating bank account number —
   `<last-4-of-account>-<sequence-number>`, e.g. account `...4321`, sequence `000512` becomes
   `4321-000512`. This prevents sequence-number collisions between the two accounts once their
   listings are combined.
3. **Account number source**: the account number is not a column in the bank transaction file
   itself. It is embedded in the **uploaded file's name** and must be parsed out of the file name
   by the merge step, before File Validation runs.
4. **Upload cardinality**: an import run moves from one bank file + one GL file to **two bank
   files + one GL file** at the upload boundary. Downstream of the merge step, the pipeline still
   only ever deals with one bank dataset + one GL dataset, matching today's shape.

## Consequences

- **Upload API** (`POST /api/imports/runs`, `apps/api/src/app.ts`) must accept two bank files
  instead of one. The merge step runs server-side after both raw files are received, before
  either is handed to File Validation.
- **Schema**: `import_file` / `run_source_file` (changesets 0044-0046) already generalized away
  from a fixed bank/GL FK pair to a join table, specifically to allow more than one file per role
  on a run — this should not need further structural changes to hold three files per run. The two
  *raw* bank uploads should still be persisted/retained individually (for audit/re-download), even
  though only the merged dataset flows into File Validation; needs a way to distinguish "bank file
  A" from "bank file B" and to carry each one's parsed account number as file metadata.
- **Parsing/normalization**: per #137, two disconnected parsing pipelines currently exist (the
  old alias-based parser that actually feeds the matching engine, and the newer File Validation
  Engine that only feeds `canonical_record` for audit). Because the merge step sits *upstream* of
  File Validation, it needs to produce output in whichever raw format (CSV/XLSX bytes, or an
  in-memory row set) the canonical pipeline expects as its File Validation input, once #137 decides
  which pipeline that is — the merge step itself should not need to duplicate either pipeline's own
  parsing/validation logic, only read rows out of two files and re-emit one.
- **Frontend**: the Screen 01 upload flow (`SourceDropZone`) has exactly one bank slot and one GL
  slot today; needs a second bank file slot.
- **Templates**: the downloadable bank template and the account-number-in-filename convention need
  to be documented so uploaded files are reliably parseable by the merge step.
- **Matching engine**: needs confirmation of whether the composite sequence key reaches any
  existing rule that reads `serialNumber` / `referenceNumber` on `NormalizedTransaction`, or stays
  a purely ingestion-time disambiguator that File Validation/matching never need to know about.

## Open questions

- Exact file name pattern for extracting the account number (prefix vs. suffix, delimiter,
  fixed-width vs. variable-width).
- Behavior if both accounts happen to share the same last four digits.
- Whether this generalizes to N accounts, or is deliberately scoped to exactly two.
