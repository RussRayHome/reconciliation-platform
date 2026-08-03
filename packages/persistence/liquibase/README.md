# Liquibase changelogs

This directory is the source of truth for the reconciliation platform's Postgres
schema, replacing the old `postgresMigrations` array in
`packages/persistence/src/schema.ts`.

- `changelog-master.yaml` includes every file in `changesets/` in filename order.
- `changesets/0001` through `0009` are a verbatim, changeset-per-file port of the
  9 migrations that previously lived in `schema.ts`, each with an authored
  `--rollback` block (the old mechanism had none).
- `changesets/0010` drops the old `schema_migrations` tracking table. It is the
  convergence point: whether a database got here via a fresh `update` or via
  `changelog-sync` (see below), it ends up in the same state afterward.
- `changesets/0011` through `0018` add the approval-pipeline tables (organization,
  mapping profiles, staged transactions, validation, import approvals,
  templates) — see the numbered files for details.
- `changesets/0019` through `0021` complete the canonical pipeline: durable
  preservation of uploaded file bytes, the staging-to-canonical linkage, and the
  recovery/lineage views. See "Canonical pipeline" below.
- `changesets/0022` through `0024` retire the legacy "qbo" vocabulary and
  standardize table conventions. See "The qbo → gl rename" and "Table
  conventions" below.

## The qbo → gl rename

The product renamed the QuickBooks Online side to the general ledger some time
ago — `packages/domain/src/messages.ts` has long mapped `MissingFromQBO` to the
display string "Missing from GL" — but only the display layer followed. Changesets
0022 and 0023 retire the old vocabulary everywhere else:

- **0022** renames the seven `qbo_*` columns to `gl_*`, plus the one index whose
  _name_ embedded the old term (renaming a column does not rename its indexes).
- **0023** migrates stored enum values: `source_system`/`source_type`/
  `template_type` `'qbo'` → `'gl'`, `source_direction` `'bank_to_qbo'` →
  `'bank_to_gl'`, and the two `ErrorCategory` values `MissingFromQBO` /
  `DuplicateInQBO` → `MissingFromGL` / `DuplicateInGL`, across nine CHECK
  constraints, the category keys inside the summary JSONB, and `rule_id`.

Because the display strings were already correct, this rename is invisible to
users; it only removes the split between what the UI says and what the database
stores.

**What 0023 deliberately does not touch.** Uploaded file names
(`reconciliation_source_file.file_name`, `..._content.original_file_name`,
`..._row/exception.spreadsheet_file_name`) keep values like `qbo.xlsx`. Those
record the file a user actually uploaded — rewriting them would fabricate audit
history and contradict the preserved bytes from 0019. Free text quoting those
names (for example a review observation reading "qbo.xlsx is missing transactions
for: Feb, Mar…") is left alone for the same reason: it stays accurate only
because the name it cites is unchanged. This is why the JSONB rewrites match the
quote-delimited token `"qbo"` rather than a bare `qbo` — the quoted form matches a
complete JSON string and cannot match inside `"qbo.xlsx"`.

Two parser traps worth knowing if you extend 0023:

- A comment line must never _begin_ with the word `changeset` or `rollback`.
  Liquibase's formatted-SQL parser matches `--\s*changeset`, so ordinary prose
  starting with that word is read as a malformed directive.
- Use `jsonb_exists_any(col, ARRAY[…])` rather than the equivalent JSONB
  key-existence operator. Liquibase sends SQL through JDBC, which reads that
  operator's leading question mark as a bind placeholder.

## Table conventions

Changeset 0024 brings every application table to the house convention: a UUID
`id` and `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. Liquibase's own
`databasechangelog` / `databasechangeloglock` are excluded — they belong to the
migration tool.

Four tables had a meaningful natural primary key and gained `id` as a UNIQUE
surrogate rather than a replacement PK:

| Table                                | Retained PK      | Why it was not replaced                      |
| ------------------------------------ | ---------------- | -------------------------------------------- |
| `reconciliation_job_summary`         | `job_id`         | enforces one summary per job                 |
| `reconciliation_source_file_content` | `source_file_id` | enforces one preserved copy per file         |
| `reconciliation_user`                | `user_name`      | five foreign keys reference it               |
| `reconciliation_audit_event`         | `event_id`       | BIGSERIAL carries append order a UUID cannot |

Promoting `id` to PK on the first two would silently allow duplicates the schema
currently prevents structurally, so the natural keys stay.

## Canonical pipeline

The intended path for a transaction is
**import → stage → map → approve → canonical**, spread across these tables:

| Stage     | Tables                                                                                                                      | Notes                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Import    | `reconciliation_source_file`, `reconciliation_source_file_content`, `reconciliation_import_batch`, `reconciliation_raw_row` | `_content` holds the uploaded bytes verbatim (0019)          |
| Stage     | `reconciliation_staged_transaction`                                                                                         | one row per raw row                                          |
| Map       | `reconciliation_mapping_profile`, `..._version`                                                                             | optional — `ingestion_mode = 'DIRECT'` skips it              |
| Validate  | `reconciliation_validation_rule_version`, `reconciliation_validation_result`                                                |                                                              |
| Approve   | `reconciliation_import_approval`, `reconciliation_approval_history`                                                         | gate is per source file                                      |
| Canonical | `reconciliation_canonical_row`                                                                                              | `staged_transaction_id` links back to the whole chain (0020) |

Two ingestion modes are enforced by CHECK constraints rather than convention:

- **`DIRECT`** — the file is parsed with the built-in column configuration and no
  mapping profile, so `reconciliation_staged_transaction.mapping_profile_version_id`
  is NULL. The uploaded bytes in `reconciliation_source_file_content` are the
  reference copy if the direct parse later proves wrong.
- **`MAPPED`** — normalized through a specific mapping profile version, which the
  staged row must name.

`reconciliation_staged_transaction_mapping_pairing_check` rejects any other
combination, so a DIRECT row cannot claim a profile it never used and a MAPPED
row cannot hide which profile produced it.

### Recovering an original file

`reconciliation_source_file_recovery` reports, per source file, whether the
original bytes survive and whether they still match the hash recorded at
registration (`VERIFIED` / `MISSING` / `HASH_MISMATCH` / `SIZE_MISMATCH`). It
deliberately does **not** expose the `content` column, so `SELECT *` against it
is always cheap. Once a row reads `VERIFIED`, extract the file with:

```
\copy (SELECT content FROM reconciliation_source_file_content \
       WHERE source_file_id = '<uuid>') TO 'recovered.xlsx' WITH (FORMAT binary)
```

Bytes are stored with no application-level compression precisely so this works
when the application is the thing that is broken — psql and a hex editor are
enough. Postgres still compresses/out-of-lines the column via TOAST.

`reconciliation_canonical_lineage` flattens the full provenance of one canonical
row (source file → staging → mapping version → approval → whether bytes survive)
into a single row for audit questions like "which approval authorized this?".

### Known gap: no write path yet

As of changeset 0021 the tables from 0011–0021 are schema only — the live
reconciliation pipeline still writes `source_file → raw_row → canonical_row`
directly and never populates staging, mapping, validation, or approval.
`createImportApproval`/`recordApprovalDecision`/`createMappingProfileVersion` exist
in `readModelStore.ts` but no API route calls them. Wiring the pipeline is
application work tracked separately; the schema is ready for it.

Liquibase creates its own bookkeeping tables (`databasechangelog`,
`databasechangeloglock`) automatically on first run; nothing here creates them
by hand.

## Cutover procedure

**Fresh or empty databases (local dev reset, CI, a new environment):**

```
liquibase update
```

Applies every changeset from 0001 onward for real.

**Already-migrated databases (existing dev/stage/prod that ran the old
`runPostgresMigrations` mechanism and already have `schema_migrations` rows
1-9):**

One-time, per environment:

```
liquibase changelog-sync --to-tag=v1-v9-baseline
liquibase tag v1-v9-baseline   # only if the tag wasn't already applied
liquibase update
```

`changelog-sync` marks changesets 0001-0009 as already applied _without_
re-running their SQL (the tables already exist). `update` then runs 0010
onward for real. After this one-time step, every environment runs plain
`liquibase update` going forward, converging on the same schema as a fresh
`update` run — verified by `packages/persistence/tests/liquibase-migrations.test.ts`.

## A note on the ported CHECK constraints

The original migrations built several `CHECK (... IN (...))` constraint lists
dynamically from TypeScript const-arrays (`reconciliationJobStates`,
`errorCategories`, etc. in `packages/persistence/src/stateMachine.ts` and
`packages/domain/src/enums.ts`). Liquibase changesets are static SQL, so
those lists were inlined as literals in `0001` and `0006`. If those enums
change in the future, a **new** changeset must add/alter the constraint —
editing the TS enum alone no longer changes the database.
