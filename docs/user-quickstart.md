# User Quick Start

This guide is for analysts and reviewers who need to run reconciliation and review outcomes without working in code.

## 1. What you need before you start

Prepare these items first:

- a bank workbook in `.xlsx` format
- a GL workbook in `.xlsx` format
- files that cover the same account and period
- access to the reconciliation web app

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

1. Go to the Upload workspace.
2. Select the bank workbook as `bankFile`.
3. Select the GL workbook as `qboFile`.
4. Enter optional context fields (account, frequency, period).
5. Run reconciliation and wait for processing to finish.

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

- Confirm each file is `.xlsx`.
- Re-export from source system if the workbook is corrupted or password-protected.

### Results do not look right

- Verify both files are for the same account and period.
- Confirm you did not swap bank and GL files.

### Too many data-quality exceptions

- Check date and amount columns in source exports.
- Re-run with clean source files before reviewer sign-off.

## 9. When to use deeper docs

Use these references when you need more detail:

- `docs/reconciliation-rules.md` for matching and exception logic
- `docs/api.md` for endpoint and payload contracts
- `docs/developer-setup.md` for environment and troubleshooting runbooks
