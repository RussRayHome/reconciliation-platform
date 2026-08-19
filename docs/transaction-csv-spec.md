# Transaction CSV Spec

The canonical Bank/GL file schema the File Validation Engine (`packages/core/src/fileValidation/`)
validates against, and the Matching Engine (`packages/core/src/matching/`) ultimately consumes via
the adapter in `fileValidation/toNormalizedTransactions.ts`. This is the single source of truth for
required columns — it is also, verbatim, what `apps/web/public/templates/bank-template.csv`/
`gl-template.csv` ship to users. If a column is added here, the downloadable templates change too;
if the Matching Engine needs a new field, it gets added here first, not invented as a parallel
schema.

Superseded 2026-08 (Issue #137): this file previously did not exist — the File Validation Engine
had been validating against an invented snake_case schema with no source spec anywhere in the repo,
which shared zero header overlap with the actual downloadable templates. Every uploaded file that
followed the app's own template failed validation immediately. This doc, and the code changes it
describes, fix that by making the human-readable template the one real schema.

## §1. Design principles

- The template is the single source of truth. Column requirements are driven by what the Matching
  Engine actually reads (verified against `matching/engine.ts`/`groupedReservations.ts`), not by
  invention.
- Header matching is **exact**, not fuzzy. A column must be named precisely as listed below — no
  alias resolution, no fuzzy scoring. (Contrast with the old, now-retired `excelParser.ts` pathway,
  which used fuzzy alias matching; File Validation deliberately does not reintroduce that.)
- Dates are strict ISO-8601 (`YYYY-MM-DD`) only.
- Amounts recognize standard, unambiguous accounting notation — currency symbols, thousands-comma
  separators, parentheses-negatives, trailing minus, `CR`/`DR` suffixes — the same rigor as strict
  dates applied to a well-defined format, not the opposite of it.
- Single currency: USD, assumed system-wide for now. No currency column exists in either format.
  Revisit if/when multi-currency becomes a real requirement.

## §2. Bank file schema

Headers, in required order: `Date, Description, Sequence Number, Check Number, Reference, Debit, Credit, Balance`

| Column | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `Date` | Yes | `date` | ISO-8601. |
| `Description` | Yes | `description` | Also the source of `merchantName`/`payeeName` text for matching — no separate merchant column exists; the Matching Engine unions description/merchant/payee for text similarity and never requires merchant standalone. |
| `Sequence Number` | Yes | `recordId` | Per-file transaction identity. Must be unique within its own file (`BANK_SEQUENCE_DUPLICATE` if not). For a two-account run, every value File Validation actually sees already carries Issue #141's account-derived composite prefix (`<last-4-of-account>-<sequence>`, e.g. `4321-000512`) — that prefixing happens in the merge step (`mergeBankFiles`) *before* File Validation runs, so this column's contract here is unchanged; File Validation is never aware two source files existed. |
| `Check Number` | No | `checkNumber` | |
| `Reference` | No | `referenceNumber` | Newly added — the old template had no column mapping to `referenceNumber` at all, so `ReferenceNumberMismatch` and the top-priority "Reference + Amount Match" rule could never fire against a real uploaded file. |
| `Debit` | One of Debit/Credit required per row | — | |
| `Credit` | One of Debit/Credit required per row | — | |
| `Balance` | No | `runningBalance` | Used only for the file-level running-balance continuity check. |

**Derivations** (not columns, computed during validation):
- `signedAmount = credit column populated ? +credit : -debit`.
- `transactionType = signedAmount > 0 ? 'credit' : 'debit'` — positive amounts are credits,
  negative are debits. No `Type` column exists for Bank; this is inferred entirely from which of
  Debit/Credit is populated.
- `account`: not a CSV column, and not a File Validation concept at all. Per ADR-0003, each raw
  bank file's account number is parsed from its **filename** (last four digits) by the merge step
  (`mergeBankFiles`, upstream of File Validation) solely to build the composite `Sequence Number`
  prefix described above — the account identifier itself never becomes a row field or reaches
  `NormalizedRecord`. By the time File Validation runs, the two accounts' rows are already
  concatenated into one file with no per-row account marker beyond that prefix.

## §3. GL file schema

Headers, in required order: `Date, Type, Num, Name, Memo, Amount`

| Column | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `Date` | Yes | `date` | ISO-8601. |
| `Type` | No | — | Free-text transaction type label (e.g. "Check", "Deposit", "Expense"), display-only; not validated against an enum. |
| `Num` | No | `referenceNumber` | |
| `Name` | No | `payeeName` | |
| `Memo` | Yes | `description` | |
| `Amount` | Yes | `signedAmount` | Single signed value — positive increases cash (inflow), negative decreases it (outflow). Already in the same sign convention as Bank's derived `signedAmount`; no sign-flipping needed between formats. |

The GL file is a **flat, already-signed register** — it has no journal-entry grouping
(`entry_id`/`line_number`) and no split debit/credit columns. The Matching Engine has no
journal-entry-balancing concept either; split/grouped transaction detection
(`LikelySplitCombineIssue`, `PartialPaymentMatch`, `LoanPaymentSplit`,
`BankServiceChargeAmortization`, `PayrollBatchMatch`, `FeeNettingMatch`) is an entirely separate,
unaffected Matching Engine capability that operates on these flat rows directly — it does not
depend on any structural "does this entry balance" pre-check.

`account` (GL side): same treatment as Bank — no CSV column, sourced elsewhere, pre-existing gap
not solved by this schema.

## §4. Validation order

1. **HEADER** — is row 1 recognizable as a header at all (`STRUCT_HEADER_MISSING` if not).
2. **COLUMN_ORDER** — required columns present (`STRUCT_COLUMN_MISSING`) and in relative order
   (`STRUCT_COLUMN_ORDER`); unrecognized columns warned, not rejected (`STRUCT_COLUMN_UNKNOWN`).
3. **CELL_VALUES** — per-row and file-level checks (rowValidators.ts). A gate failure at step 1/2
   stops further checks for that file; step 3 findings don't retroactively exclude rows that
   individually passed (this is what makes partial import possible).

## §5. Traceability

Every validation issue already carries enough to answer "which user, which file, which row" without
any new schema:
- **Row**: `row_number`/`sourceLineNumber`, stamped by the pipeline as it reads the file —
  independent of any input column.
- **File**: `validation_issue.import_file_id` (FK, indexed) — for a bank run this always points at
  the single `BANK_MERGED` file (Issue #141's merge step produces one unified bank dataset before
  File Validation ever runs), never at either raw per-account upload, since only the merged file
  and the GL file are individually validated. Per-row account attribution for a bank issue instead
  comes from the composite `Sequence Number` prefix (`<last-4-of-account>-<sequence>`) on the row
  itself, not from which raw file was validated — the two raw uploads (`BANK_ACCOUNT_A`/
  `BANK_ACCOUNT_B`) are retained only for audit/re-download and never individually validated.
- **User**: `reconciliation_run.submitted_by`, traced via `import_job.reconciliation_run_id`.

## §6. Not solved here

Neither format carries a `Serial Number` column, so `serialNumber`-dependent matching stays
under-served — a follow-up product question (what source document would even carry one), not part
of this schema.
