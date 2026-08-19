# User Quick Start

This guide is for analysts and reviewers who need to run reconciliation and review outcomes without working in code.

## 1. What you need before you start

Prepare these items first:

- two bank workbooks, one per account, each in `.csv` or `.xlsx` format (max 50 MB) -- each bank
  file's name must start with its account number (or the last 4 digits of it) followed by `-` or
  `_`, for example `4321_bank-export.csv` or `12345-checking.xlsx`. This is how the app tells the
  two accounts apart; a file that doesn't follow this pattern is rejected at upload.
- a GL workbook in `.csv` or `.xlsx` format (max 50 MB), covering both accounts
- files that cover the same accounts and period
- access to the reconciliation web app
- a senior analyst, admin, or superuser account -- other roles can view results but cannot submit an import run

Optional but helpful:

- account identifier used by your team
- reconciliation frequency (`Monthly` or `Annual`)
- period label (for example `2026-04`)

## 2. Open the application

Use the URL provided by your team.

Common local URLs:

- local development web app: `http://localhost:5173`
- docker gateway web app: `https://127.0.0.1:4174` (locally-trusted mkcert cert)

If the page does not load, ask a maintainer to start or verify the environment.

## 3. Run a reconciliation

1. Go to the **Import Files** workspace.
2. Drag all three workbooks onto the drop zone, or browse and select them. The two bank files fill
   Account A then Account B in the order they're dropped, and GL is detected from its file name;
   use the slot pickers to override if detection guesses wrong.
3. Enter optional context fields (account identifier, frequency, period, label).
4. Select **Submit run** and wait for processing to finish.

If either file fails validation, you land on a review screen instead of the results:

- **Structural failure** -- the header row doesn't match the expected columns. Fix the export and
  re-upload.
- **Partial import** -- some rows failed validation but others are usable. Review the flagged
  rows, then choose to import the valid rows and skip the rest, or fix and re-upload the whole
  file.
- **All rows invalid** -- nothing in the file is usable. Fix the export and re-upload.

A **Download error report** button is available on every validation-failure screen.

## 4. Read the output quickly

After a successful run, review in this order:

1. Run summary: confirm totals, probable matches, exception count, and unresolved exposure.
2. Probable match review: review non-exact candidates that need human confirmation.
3. Exceptions: work through prioritized accounting exceptions.
4. Grouped matches (when present): review one-to-many or many-to-one patterns.

## 5. Understand exception priority and actions

Exception rows include:

- category and severity
- source file and line
- traceable rule context
- recommended next actions

Work highest severity first, then move to medium and low severity items.

## 6. Capture reviewer decisions

Reviewer decisions are supported per run and target item.

Typical outcomes include:

- approved match
- rejected match
- confirmed exception
- reclassified exception

When reclassifying an exception, include the final category and a short note.

## 7. Export for handoff and audit

Download the workbook export from the run view after review.

The export normally includes tabs such as:

- Summary
- Exceptions
- Probable Matches Review
- Reviewer Observations

Use this workbook for downstream approval, handoff, and audit evidence.

## 8. Common issues and fixes

### Upload is rejected

- Confirm each file is `.csv` or `.xlsx` and under 50 MB.
- For a bank file specifically, confirm its name starts with the account number (or its last 4
  digits) followed by `-` or `_`, for example `4321_bank-export.csv` -- a file that doesn't follow
  this pattern is rejected before it's even sent to the server.
- Re-export from source system if the workbook is corrupted or password-protected.

### Submit run is disabled or "Only a senior analyst may create an import run"

- All three files (both bank workbooks and GL) must be selected and the reconciliation label must
  be filled in before Submit run enables.
- Submitting an import run requires a senior analyst, admin, or superuser account -- ask a
  maintainer to change your role if you need to submit runs regularly.

### Results do not look right

- Verify all three files are for the same accounts and period.
- Confirm you did not swap bank and GL files, or upload the same bank file twice instead of one
  per account.

### Too many data-quality exceptions

- Check date and amount columns in source exports.
- Re-run with clean source files before reviewer sign-off.

## 9. When to use deeper docs

Use these references when you need more detail:

- `docs/reconciliation-rules.md` for matching and exception logic
- `docs/api.md` for endpoint and payload contracts
- `docs/developer-setup.md` for environment and troubleshooting runbooks
