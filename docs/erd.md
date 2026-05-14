# Entity Relationship Diagram — PostgreSQL Schema

Generated from `packages/persistence/src/schema.ts`.

## Diagram

```mermaid
erDiagram

    reconciliation_job {
        uuid        id                      PK
        text        correlation_id
        text        account_identifier
        text        period_label
        text        reconciliation_frequency
        text        current_state
        text        input_fingerprint
        int         schema_version
        text        rulepack_version
        int         record_version
        int         retry_count
        text        failure_code
        text        failure_message
        timestamptz started_at
        timestamptz completed_at
        timestamptz created_at
        timestamptz updated_at
    }

    reconciliation_source_file {
        uuid        id                      PK
        uuid        job_id                  FK
        text        source_system
        text        source_format
        text        file_name
        text        mime_type
        bigint      size_bytes
        text        sha256
        text        storage_uri
        text        worksheet_name
        int         header_row
        int         transaction_start_row
        jsonb       excluded_row_numbers
        int         imported_row_count
        timestamptz uploaded_at
        timestamptz created_at
        timestamptz updated_at
    }

    reconciliation_import_batch {
        uuid        id                      PK
        uuid        job_id                  FK
        uuid        source_file_id          FK
        int         batch_number
        text        state
        int         row_start_number
        int         row_end_number
        int         row_count
        timestamptz started_at
        timestamptz completed_at
        text        error_message
        timestamptz created_at
    }

    reconciliation_raw_row {
        uuid        id                      PK
        uuid        job_id                  FK
        uuid        source_file_id          FK
        uuid        import_batch_id         FK
        text        source_system
        int         line_number
        text        row_hash
        jsonb       raw_values_json
        text        description_raw
        text        amount_raw
        boolean     excluded
        text        exclusion_reason
        jsonb       parsing_issues_json
        timestamptz created_at
    }

    reconciliation_canonical_row {
        uuid        id                      PK
        uuid        job_id                  FK
        uuid        raw_row_id              FK
        uuid        source_file_id          FK
        text        source_system
        int         line_number
        date        transaction_date
        date        posting_date
        text        description
        numeric     amount
        numeric     debit
        numeric     credit
        text        normalized_comparison_text
        text[]      normalized_comparison_tokens
        jsonb       raw_source_values_json
        boolean     is_excluded
        boolean     is_zero_amount
        text        context_fingerprint
        text        account_identifier
        text        reviewer_notes
        timestamptz created_at
    }

    reconciliation_match_group {
        uuid        id                      PK
        uuid        job_id                  FK
        text        disposition
        text        confidence
        text        category
        uuid[]      bank_transaction_ids
        uuid[]      qbo_transaction_ids
        jsonb       bank_members_json
        jsonb       qbo_members_json
        numeric     total_amount
        int         date_difference_days
        float       score
        text        rule_id
        text        rule_name
        text        reason
        jsonb       evidence_json
        timestamptz created_at
    }

    reconciliation_match_result {
        uuid        id                      PK
        uuid        job_id                  FK
        text        result_bucket
        uuid        bank_transaction_id     FK
        uuid        qbo_transaction_id      FK
        text        disposition
        text        confidence
        text        rule_id
        text        rule_name
        text        reason
        float       score
        numeric     amount_difference
        int         date_difference_days
        jsonb       evidence_json
        text        likely_matching_reference
        text        exception_category
        timestamptz created_at
    }

    reconciliation_rule_result {
        uuid        id                      PK
        uuid        job_id                  FK
        text        target_kind
        uuid        target_id
        text        rule_id
        text        rule_name
        boolean     passed
        float       score
        text        reason
        jsonb       evidence_json
        uuid        candidate_transaction_id FK
        int         evaluation_order
        timestamptz created_at
    }

    reconciliation_exception {
        uuid        id                      PK
        uuid        job_id                  FK
        uuid        canonical_row_id        FK
        text        category
        text        severity
        text        source_system
        text        spreadsheet_file_name
        int         line_number
        date        transaction_date
        numeric     amount
        text        error_message
        jsonb       rule_trace_json
        text[]      recommended_next_actions
        text        likely_matching_reference
        text        reviewer_notes
        text        match_confidence
        text[]      normalized_comparison_tokens
        uuid[]      related_transaction_ids
        timestamptz created_at
    }

    reconciliation_review_observation {
        uuid        id                      PK
        uuid        job_id                  FK
        text        category
        text        title
        text        message
        text        severity
        uuid[]      related_transaction_ids
        timestamptz created_at
        timestamptz persisted_at
    }

    reconciliation_job_summary {
        uuid        job_id                  PK "FK → reconciliation_job"
        int         total_records_reviewed
        int         bank_records
        int         qbo_records
        int         exact_matches
        int         probable_matches
        int         unmatched_items
        int         duplicates
        int         date_variances
        int         timing_differences
        int         data_quality_issues
        int         amount_mismatches
        int         missing_from_bank
        int         missing_from_qbo
        numeric     unmatched_bank_net_amount
        numeric     unmatched_qbo_net_amount
        numeric     clean_matched_amount
        numeric     unresolved_exposure
        jsonb       counts_by_category_json
        jsonb       amount_by_category_json
        jsonb       charts_json
        timestamptz created_at
        timestamptz updated_at
    }

    reconciliation_export {
        uuid        id                      PK
        uuid        job_id                  FK
        text        export_type
        text        state
        text        file_name
        text        storage_uri
        text        checksum_sha256
        bigint      byte_size
        jsonb       tab_names_json
        timestamptz generated_at
        timestamptz created_at
    }

    reconciliation_review_decision {
        uuid        id                      PK
        uuid        job_id                  FK
        text        target_type
        uuid        target_id
        text        outcome
        text        final_category
        text        notes
        text        reviewer_id
        text        reviewer_name
        int         record_version
        timestamptz created_at
        timestamptz updated_at
    }

    reconciliation_audit_event {
        bigserial   event_id                PK
        uuid        job_id                  FK
        text        event_type
        text        from_state
        text        to_state
        text        actor
        jsonb       details_json
        timestamptz created_at
    }

    schema_migrations {
        int         version                 PK
        text        name
        timestamptz applied_at
    }

    %% ── Core job relationships ──────────────────────────────────────────────
    reconciliation_job          ||--o{ reconciliation_source_file        : "has (bank + qbo)"
    reconciliation_job          ||--o{ reconciliation_import_batch       : "has"
    reconciliation_job          ||--o{ reconciliation_raw_row            : "has"
    reconciliation_job          ||--o{ reconciliation_canonical_row      : "has"
    reconciliation_job          ||--o{ reconciliation_match_group        : "has"
    reconciliation_job          ||--o{ reconciliation_match_result       : "has"
    reconciliation_job          ||--o{ reconciliation_rule_result        : "has"
    reconciliation_job          ||--o{ reconciliation_exception          : "has"
    reconciliation_job          ||--o{ reconciliation_review_observation : "has"
    reconciliation_job          ||--o| reconciliation_job_summary        : "has"
    reconciliation_job          ||--o{ reconciliation_export             : "has"
    reconciliation_job          ||--o{ reconciliation_review_decision    : "has"
    reconciliation_job          ||--o{ reconciliation_audit_event        : "logs"

    %% ── Ingestion chain ─────────────────────────────────────────────────────
    reconciliation_source_file  ||--|{ reconciliation_import_batch       : "split into"
    reconciliation_source_file  ||--|{ reconciliation_raw_row            : "contains"
    reconciliation_import_batch ||--|{ reconciliation_raw_row            : "groups"
    reconciliation_raw_row      ||--|| reconciliation_canonical_row      : "normalized to"

    %% ── Matching references (nullable FKs, ON DELETE SET NULL) ───────────────
    reconciliation_canonical_row |o--o{ reconciliation_match_result     : "bank side"
    reconciliation_canonical_row |o--o{ reconciliation_match_result     : "qbo side"
    reconciliation_canonical_row |o--o{ reconciliation_rule_result      : "candidate"
    reconciliation_canonical_row |o--o{ reconciliation_exception        : "references"
```

## Table reference

| Table | Purpose | Key constraints |
|---|---|---|
| `reconciliation_job` | Root entity — lifecycle state, period context, retry/failure metadata | — |
| `reconciliation_source_file` | Bank or QBO file registration and import metadata | UNIQUE `(job_id, source_system)` |
| `reconciliation_import_batch` | Ingest batching ledger with row-range tracking | UNIQUE `(source_file_id, batch_number)` |
| `reconciliation_raw_row` | Raw source rows exactly as parsed | UNIQUE `(source_file_id, line_number)` |
| `reconciliation_canonical_row` | Normalized rows with computed fields | UNIQUE `(raw_row_id)` |
| `reconciliation_match_group` | Grouped multi-transaction match candidates | — |
| `reconciliation_match_result` | One-to-one match/probable pairs with `MATCH` or `PROBABLE` bucket | — |
| `reconciliation_rule_result` | Traceable rule lineage per match result, match group, or exception | `target_kind` ∈ `MATCH_RESULT`, `MATCH_GROUP`, `EXCEPTION_ITEM` |
| `reconciliation_exception` | Final exception records with rule traces | — |
| `reconciliation_review_observation` | Generated high-level review notes | — |
| `reconciliation_job_summary` | Aggregate metrics and chart payloads | PK is also FK (1-to-1 with job) |
| `reconciliation_export` | Workbook/JSON export metadata | UNIQUE `(job_id, export_type)` |
| `reconciliation_review_decision` | Durable reviewer outcomes per target | UNIQUE `(job_id, target_type, target_id)` |
| `reconciliation_audit_event` | Full audit trail of every state transition and operation | BIGSERIAL PK for insertion order |
| `schema_migrations` | Migration version tracking | — |

## Cascade and nullability notes

- `reconciliation_source_file`, `reconciliation_import_batch`, `reconciliation_raw_row`, `reconciliation_canonical_row`, `reconciliation_match_group`, `reconciliation_match_result`, `reconciliation_rule_result`, `reconciliation_exception`, `reconciliation_review_observation`, `reconciliation_job_summary`, `reconciliation_export`, `reconciliation_review_decision`, `reconciliation_audit_event` all cascade delete from `reconciliation_job` (`ON DELETE CASCADE`).
- `reconciliation_match_result.bank_transaction_id`, `reconciliation_match_result.qbo_transaction_id`, `reconciliation_rule_result.candidate_transaction_id`, and `reconciliation_exception.canonical_row_id` are nullable with `ON DELETE SET NULL` — exception and match records survive canonical row deletion.
- `reconciliation_rule_result.target_id` and `reconciliation_review_decision.target_id` are polymorphic references (no enforced FK) — `target_kind` / `target_type` discriminates the referenced table.

## Migration history

| Version | Name |
|---|---|
| 1 | `create_reconciliation_persistence_tables` |
| 2 | `add_foreign_keys_for_scalar_transaction_references` |
| 3 | `add_read_model_access_indexes` |
| 4 | `enable_pgaudit_extension_when_preloaded` |
