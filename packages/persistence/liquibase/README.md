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
