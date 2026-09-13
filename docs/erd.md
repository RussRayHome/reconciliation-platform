# Entity Relationship Diagram — PostgreSQL Schema

The schema is defined by Liquibase formatted-SQL changesets under `packages/persistence/liquibase/changesets/`; the committed pgTap baseline `packages/persistence/tests/schema/schema-baseline.sql` is the authoritative snapshot of the current structure. The diagram and table below describe the original fourteen-table reconciliation-job schema and are retained as orientation; tables added since (import runs and files, canonical records, accounts, open items, roll-forward, approvals, matching-config versions, saved views, subledger entities, replay estimates) appear in the baseline, not here.

## Diagram

![PostgreSQL entity relationship diagram](images/erd-schema.svg)

_Rendered ERD of the original job-centred schema. Regenerate from the pgTap baseline, not from a TypeScript schema module; `packages/persistence/src/schema.ts` no longer exists._

## Table reference

| Table                               | Purpose                                                               | Key constraints                                                 |
| ----------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `reconciliation_job`                | Root entity — lifecycle state, period context, retry/failure metadata | —                                                               |
| `reconciliation_source_file`        | Bank or GL file registration and import metadata                      | UNIQUE `(job_id, source_system)`                                |
| `reconciliation_import_batch`       | Ingest batching ledger with row-range tracking                        | UNIQUE `(source_file_id, batch_number)`                         |
| `reconciliation_raw_row`            | Raw source rows exactly as parsed                                     | UNIQUE `(source_file_id, line_number)`                          |
| `reconciliation_canonical_row`      | Normalized rows with computed fields                                  | UNIQUE `(raw_row_id)`                                           |
| `reconciliation_match_group`        | Grouped multi-transaction match candidates                            | —                                                               |
| `reconciliation_match_result`       | One-to-one match/probable pairs with `MATCH` or `PROBABLE` bucket     | —                                                               |
| `reconciliation_rule_result`        | Traceable rule lineage per match result, match group, or exception    | `target_kind` ∈ `MATCH_RESULT`, `MATCH_GROUP`, `EXCEPTION_ITEM` |
| `reconciliation_exception`          | Final exception records with rule traces                              | —                                                               |
| `reconciliation_review_observation` | Generated high-level review notes                                     | —                                                               |
| `reconciliation_job_summary`        | Aggregate metrics and chart payloads                                  | PK is also FK (1-to-1 with job)                                 |
| `reconciliation_export`             | Workbook/JSON export metadata                                         | UNIQUE `(job_id, export_type)`                                  |
| `reconciliation_review_decision`    | Durable reviewer outcomes per target                                  | UNIQUE `(job_id, target_type, target_id)`                       |
| `reconciliation_audit_event`        | Full audit trail of every state transition and operation              | BIGSERIAL PK for insertion order                                |
| `databasechangelog`                 | Liquibase changeset tracking                                          | —                                                               |

## Cascade and nullability notes

- `reconciliation_source_file`, `reconciliation_import_batch`, `reconciliation_raw_row`, `reconciliation_canonical_row`, `reconciliation_match_group`, `reconciliation_match_result`, `reconciliation_rule_result`, `reconciliation_exception`, `reconciliation_review_observation`, `reconciliation_job_summary`, `reconciliation_export`, `reconciliation_review_decision`, `reconciliation_audit_event` all cascade delete from `reconciliation_job` (`ON DELETE CASCADE`).
- `reconciliation_match_result.bank_transaction_id`, `reconciliation_match_result.gl_transaction_id`, `reconciliation_rule_result.candidate_transaction_id`, and `reconciliation_exception.canonical_row_id` are nullable with `ON DELETE SET NULL` — exception and match records survive canonical row deletion.
- `reconciliation_rule_result.target_id` and `reconciliation_review_decision.target_id` are polymorphic references (no enforced FK) — `target_kind` / `target_type` discriminates the referenced table.

## Migrations

Every schema change is one numbered changeset file under `packages/persistence/liquibase/changesets/` (`0001_…` onward), applied by the `migrate` compose service and tracked in `databasechangelog`. `scripts/pre-flight/db-preflight-checks.sh` (check DB6) verifies that every declared changeset id has been applied. Rules that bite: never edit an applied changeset, even a comment; `--rollback` blocks need their own statements; every new changeset moves the rollback-count tests and the pgTap baseline (`npm run test:postgres:update-baseline`).
