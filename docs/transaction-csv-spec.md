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

The **merged** bank dataset carries one further column the raw upload template does not:
`Interface ID`. It is written by the merge step, never by the uploader, and is listed in the table
below for completeness.

| Column | Required | Maps to | Notes |
| --- | --- | --- | --- |
| `Date` | Yes | `date` | ISO-8601. |
| `Description` | Yes | `description` | Also the source of `merchantName`/`payeeName` text for matching — no separate merchant column exists; the Matching Engine unions description/merchant/payee for text similarity and never requires merchant standalone. |
| `Sequence Number` | Yes | `recordId` | Per-file transaction identity. Must be unique within its own file (`BANK_SEQUENCE_DUPLICATE` if not). For a multi-account run, every value File Validation actually sees already carries a composite prefix — `<account-uuid>-<sequence>` since A-D1 (Issue #338), previously the account's last four digits. The prefix changed because two registered accounts may legitimately share a last four, which made the old prefix collide and reported two genuinely distinct rows as duplicates. Prefixing happens in the merge step (`mergeBankFiles`) *before* File Validation runs, so this column's contract here is unchanged; File Validation is never aware several source files existed. |
| `Check Number` | No | `checkNumber` | |
| `Reference` | No | `referenceNumber` | Newly added — the old template had no column mapping to `referenceNumber` at all, so `ReferenceNumberMismatch` and the top-priority "Reference + Amount Match" rule could never fire against a real uploaded file. |
| `Debit` | One of Debit/Credit required per row | — | |
| `Credit` | One of Debit/Credit required per row | — | |
| `Balance` | No | `runningBalance` | Used only for the file-level running-balance continuity check. |
| `Interface ID` | Merged dataset only | `account` | The `reconciliation_account.id` UUID of the account the statement was explicitly assigned to (A-D1, Issue #338). Written onto every row by `mergeBankFiles`; absent from the raw per-account upload template, and never filled in by hand. |

**Derivations** (not columns, computed during validation):
- `signedAmount = credit column populated ? +credit : -debit`.
- `transactionType = signedAmount > 0 ? 'credit' : 'debit'` — positive amounts are credits,
  negative are debits. No `Type` column exists for Bank; this is inferred entirely from which of
  Debit/Credit is populated.
- `account`: sourced from the merged dataset's `Interface ID` column, which carries the
  `reconciliation_account.id` of the account the operator explicitly assigned the statement to
  before upload (A-D1, Issue #338). It reaches `NormalizedRecord.account` and from there
  `canonical_record.account` and `NormalizedTransaction.accountIdentifier`.

  This reverses the previous behaviour, which is worth stating plainly because a good deal of the
  system was built around it: each raw bank file's account used to be parsed from its **filename**
  (last four digits) purely to build the `Sequence Number` prefix, and the account itself never
  became a row field. Because nothing populated `account`, `NormalizedTransaction.accountIdentifier`
  was `undefined` on every transaction, and everything keyed to it — run-account linking, open-item
  carry-forward, per-account tie-out — was inert. A filename may still *suggest* an account during
  upload, but it cannot establish identity, override an assignment, or select configuration.

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

### The subledger schemas are not documented here yet

A third header set ships in code but has no section above: `BILLING_HEADERS`
(`fileValidation/types.ts:36-49`, twelve columns) plus fourteen `AP_*` validation rules seeded by
changeset 0071. It is deliberately unreachable today —
`apps/api/src/services/importValidationService.ts:104-115` refuses any source type other than
BANK or GL — so documenting it as a live schema would overstate what the platform accepts.

Two decisions govern what lands here, and both are recorded outside this repository in
`design/adr/`:

- **Names — decided.** ADR-0007 names the AP subledger source type `VENDOR_BILL`; ADR-0014 names
  the AR side `CUSTOMER_INVOICE`, establishing the convention `<COUNTERPARTY>_<DOCUMENT>`.
  `BILLING` is retired rather than repurposed — it has already been read in opposite directions by
  two documents in this project. Both renames land in one changeset; no state exists in which
  `BILLING` and `VENDOR_BILL` are simultaneously valid.
- **Columns — open.** ADR-0008 is Blocked pending a decision on GL account identity. The shipped
  `BILLING_HEADERS` carries a `GL Account` column; the proposed `VENDOR_BILL` column set does not,
  while the GL schema in §3 carries no account column on either side. Until that resolves, the
  control-account tie-out is not derivable from the shipped file contract.

When the AP schema lands (senior-plan task A4), it becomes a §-level section here on the same terms
as §2 and §3 — the template is the single source of truth, and
`apps/web/public/templates/` gains a matching downloadable file. The generator's contract binding
in `recon-test-data/src/emit/generated/contract.ts` must change in the same commit: the two
repositories are contract-bound, and a one-sided column change drifts silently.
