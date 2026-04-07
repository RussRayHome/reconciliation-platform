import {
  exportStates,
  importBatchStates,
  reconciliationJobStates,
  reconciliationSourceFormats,
  resultBuckets,
} from './stateMachine';

const asSqlStringList = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(', ');

export type SqlMigration = {
  version: number;
  name: string;
  sql: string;
};

export const postgresMigrations: readonly SqlMigration[] = [
  {
    version: 1,
    name: 'create_reconciliation_persistence_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reconciliation_job (
        id UUID PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        account_identifier TEXT,
        period_label TEXT,
        reconciliation_frequency TEXT CHECK (reconciliation_frequency IN ('Monthly', 'Annual')),
        current_state TEXT NOT NULL CHECK (current_state IN (${asSqlStringList(reconciliationJobStates)})),
        input_fingerprint TEXT,
        schema_version INTEGER NOT NULL DEFAULT 1,
        rulepack_version TEXT NOT NULL,
        record_version INTEGER NOT NULL DEFAULT 1,
        retry_count INTEGER NOT NULL DEFAULT 0,
        failure_code TEXT,
        failure_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS reconciliation_job_state_idx
        ON reconciliation_job (current_state, updated_at DESC);

      CREATE INDEX IF NOT EXISTS reconciliation_job_fingerprint_idx
        ON reconciliation_job (input_fingerprint);

      CREATE TABLE IF NOT EXISTS reconciliation_source_file (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        source_system TEXT NOT NULL CHECK (source_system IN ('bank', 'qbo')),
        source_format TEXT NOT NULL CHECK (source_format IN (${asSqlStringList(reconciliationSourceFormats)})),
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
        sha256 TEXT NOT NULL,
        storage_uri TEXT,
        worksheet_name TEXT,
        header_row INTEGER,
        transaction_start_row INTEGER,
        excluded_row_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
        imported_row_count INTEGER,
        uploaded_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (job_id, source_system)
      );

      CREATE INDEX IF NOT EXISTS reconciliation_source_file_job_idx
        ON reconciliation_source_file (job_id, source_system);

      CREATE INDEX IF NOT EXISTS reconciliation_source_file_sha_idx
        ON reconciliation_source_file (sha256);

      CREATE TABLE IF NOT EXISTS reconciliation_import_batch (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        source_file_id UUID NOT NULL REFERENCES reconciliation_source_file(id) ON DELETE CASCADE,
        batch_number INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN (${asSqlStringList(importBatchStates)})),
        row_start_number INTEGER NOT NULL,
        row_end_number INTEGER NOT NULL,
        row_count INTEGER NOT NULL CHECK (row_count >= 0),
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (source_file_id, batch_number)
      );

      CREATE INDEX IF NOT EXISTS reconciliation_import_batch_job_idx
        ON reconciliation_import_batch (job_id, source_file_id, batch_number);

      CREATE TABLE IF NOT EXISTS reconciliation_raw_row (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        source_file_id UUID NOT NULL REFERENCES reconciliation_source_file(id) ON DELETE CASCADE,
        import_batch_id UUID NOT NULL REFERENCES reconciliation_import_batch(id) ON DELETE CASCADE,
        source_system TEXT NOT NULL CHECK (source_system IN ('bank', 'qbo')),
        line_number INTEGER NOT NULL,
        row_hash TEXT NOT NULL,
        raw_values_json JSONB NOT NULL,
        transaction_date_raw TEXT,
        posting_date_raw TEXT,
        transaction_type_raw TEXT,
        check_number_raw TEXT,
        serial_number_raw TEXT,
        reference_number_raw TEXT,
        description_raw TEXT,
        merchant_name_raw TEXT,
        payee_name_raw TEXT,
        amount_raw TEXT,
        debit_raw TEXT,
        credit_raw TEXT,
        running_balance_raw TEXT,
        excluded BOOLEAN NOT NULL DEFAULT FALSE,
        exclusion_reason TEXT,
        parsing_issues_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (source_file_id, line_number)
      );

      CREATE INDEX IF NOT EXISTS reconciliation_raw_row_job_idx
        ON reconciliation_raw_row (job_id, source_system, line_number);

      CREATE TABLE IF NOT EXISTS reconciliation_canonical_row (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        raw_row_id UUID NOT NULL REFERENCES reconciliation_raw_row(id) ON DELETE CASCADE,
        source_file_id UUID NOT NULL REFERENCES reconciliation_source_file(id) ON DELETE CASCADE,
        source_system TEXT NOT NULL CHECK (source_system IN ('bank', 'qbo')),
        spreadsheet_file_name TEXT NOT NULL,
        worksheet_name TEXT NOT NULL,
        line_number INTEGER NOT NULL,
        transaction_date DATE,
        posting_date DATE,
        transaction_type TEXT,
        check_number TEXT,
        serial_number TEXT,
        reference_number TEXT,
        description TEXT,
        merchant_name TEXT,
        payee_name TEXT,
        amount NUMERIC(18, 2),
        debit NUMERIC(18, 2),
        credit NUMERIC(18, 2),
        running_balance NUMERIC(18, 2),
        normalized_comparison_text TEXT NOT NULL,
        normalized_comparison_tokens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        normalized_reference_tokens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        raw_source_values_json JSONB NOT NULL,
        data_quality_issues_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_excluded BOOLEAN NOT NULL,
        exclusion_reason TEXT,
        is_zero_amount BOOLEAN NOT NULL,
        context_fingerprint TEXT NOT NULL,
        account_identifier TEXT,
        reviewer_notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (raw_row_id)
      );

      CREATE INDEX IF NOT EXISTS reconciliation_canonical_row_job_idx
        ON reconciliation_canonical_row (job_id, source_system, line_number);

      CREATE INDEX IF NOT EXISTS reconciliation_canonical_row_fingerprint_idx
        ON reconciliation_canonical_row (job_id, context_fingerprint);

      CREATE INDEX IF NOT EXISTS reconciliation_canonical_row_amount_date_idx
        ON reconciliation_canonical_row (job_id, amount, transaction_date);

      CREATE TABLE IF NOT EXISTS reconciliation_match_group (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        disposition TEXT NOT NULL,
        confidence TEXT NOT NULL,
        category TEXT,
        bank_transaction_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
        qbo_transaction_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
        bank_members_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        qbo_members_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        total_amount NUMERIC(18, 2) NOT NULL,
        date_difference_days INTEGER,
        score DOUBLE PRECISION NOT NULL,
        rule_id TEXT NOT NULL,
        rule_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS reconciliation_match_group_job_idx
        ON reconciliation_match_group (job_id, disposition);

      CREATE TABLE IF NOT EXISTS reconciliation_match_result (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        result_bucket TEXT NOT NULL CHECK (result_bucket IN (${asSqlStringList(resultBuckets)})),
        bank_transaction_id UUID,
        qbo_transaction_id UUID,
        disposition TEXT NOT NULL,
        confidence TEXT NOT NULL,
        rule_id TEXT,
        rule_name TEXT NOT NULL,
        reason TEXT,
        score DOUBLE PRECISION NOT NULL,
        amount_difference NUMERIC(18, 2) NOT NULL,
        date_difference_days INTEGER,
        evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        likely_matching_reference TEXT,
        exception_category TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS reconciliation_match_result_job_idx
        ON reconciliation_match_result (job_id, result_bucket, disposition);

      CREATE TABLE IF NOT EXISTS reconciliation_rule_result (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('MATCH_RESULT', 'MATCH_GROUP', 'EXCEPTION_ITEM')),
        target_id UUID NOT NULL,
        rule_id TEXT NOT NULL,
        rule_name TEXT NOT NULL,
        passed BOOLEAN NOT NULL,
        score DOUBLE PRECISION NOT NULL,
        reason TEXT NOT NULL,
        evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        candidate_transaction_id UUID,
        evaluation_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS reconciliation_rule_result_target_idx
        ON reconciliation_rule_result (job_id, target_kind, target_id);

      CREATE TABLE IF NOT EXISTS reconciliation_exception (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        canonical_row_id UUID,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        source_system TEXT NOT NULL CHECK (source_system IN ('bank', 'qbo')),
        spreadsheet_file_name TEXT NOT NULL,
        line_number INTEGER NOT NULL,
        transaction_date DATE,
        amount NUMERIC(18, 2),
        error_message TEXT NOT NULL,
        rule_trace_json JSONB,
        prior_rule_traces_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        recommended_next_actions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        likely_matching_reference TEXT,
        reviewer_notes TEXT,
        match_confidence TEXT,
        normalized_comparison_tokens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        related_transaction_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS reconciliation_exception_job_idx
        ON reconciliation_exception (job_id, category, severity, line_number);

      CREATE TABLE IF NOT EXISTS reconciliation_review_observation (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL,
        related_transaction_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
        created_at TIMESTAMPTZ NOT NULL,
        persisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS reconciliation_review_observation_job_idx
        ON reconciliation_review_observation (job_id, severity);

      CREATE TABLE IF NOT EXISTS reconciliation_job_summary (
        job_id UUID PRIMARY KEY REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        total_records_reviewed INTEGER NOT NULL,
        bank_records INTEGER NOT NULL,
        qbo_records INTEGER NOT NULL,
        exact_matches INTEGER NOT NULL,
        probable_matches INTEGER NOT NULL,
        unmatched_items INTEGER NOT NULL,
        duplicates INTEGER NOT NULL,
        bank_duplicates INTEGER NOT NULL,
        qbo_duplicates INTEGER NOT NULL,
        date_variances INTEGER NOT NULL,
        timing_differences INTEGER NOT NULL,
        data_quality_issues INTEGER NOT NULL,
        amount_mismatches INTEGER NOT NULL,
        missing_from_bank INTEGER NOT NULL,
        missing_from_qbo INTEGER NOT NULL,
        unmatched_bank_net_amount NUMERIC(18, 2) NOT NULL,
        unmatched_qbo_net_amount NUMERIC(18, 2) NOT NULL,
        clean_matched_amount NUMERIC(18, 2) NOT NULL,
        unresolved_exposure NUMERIC(18, 2) NOT NULL,
        counts_by_category_json JSONB NOT NULL,
        amount_by_category_json JSONB NOT NULL,
        charts_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reconciliation_export (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        export_type TEXT NOT NULL CHECK (export_type IN ('workbook', 'json')),
        state TEXT NOT NULL CHECK (state IN (${asSqlStringList(exportStates)})),
        file_name TEXT NOT NULL,
        storage_uri TEXT,
        checksum_sha256 TEXT NOT NULL,
        byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
        tab_names_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        generated_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (job_id, export_type)
      );

      CREATE TABLE IF NOT EXISTS reconciliation_review_decision (
        id UUID PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_id UUID NOT NULL,
        outcome TEXT NOT NULL,
        final_category TEXT,
        notes TEXT,
        reviewer_id TEXT,
        reviewer_name TEXT,
        record_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE (job_id, target_type, target_id)
      );

      CREATE INDEX IF NOT EXISTS reconciliation_review_decision_job_idx
        ON reconciliation_review_decision (job_id, target_type);

      CREATE TABLE IF NOT EXISTS reconciliation_audit_event (
        event_id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES reconciliation_job(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT,
        actor TEXT,
        details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS reconciliation_audit_event_job_idx
        ON reconciliation_audit_event (job_id, created_at);
    `,
  },
  {
    version: 2,
    name: 'add_foreign_keys_for_scalar_transaction_references',
    sql: `
      ALTER TABLE reconciliation_match_result
        ADD CONSTRAINT reconciliation_match_result_bank_transaction_fk
        FOREIGN KEY (bank_transaction_id)
        REFERENCES reconciliation_canonical_row(id)
        ON DELETE SET NULL;

      ALTER TABLE reconciliation_match_result
        ADD CONSTRAINT reconciliation_match_result_qbo_transaction_fk
        FOREIGN KEY (qbo_transaction_id)
        REFERENCES reconciliation_canonical_row(id)
        ON DELETE SET NULL;

      ALTER TABLE reconciliation_rule_result
        ADD CONSTRAINT reconciliation_rule_result_candidate_transaction_fk
        FOREIGN KEY (candidate_transaction_id)
        REFERENCES reconciliation_canonical_row(id)
        ON DELETE SET NULL;

      ALTER TABLE reconciliation_exception
        ADD CONSTRAINT reconciliation_exception_canonical_row_fk
        FOREIGN KEY (canonical_row_id)
        REFERENCES reconciliation_canonical_row(id)
        ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS reconciliation_match_result_bank_transaction_idx
        ON reconciliation_match_result (bank_transaction_id)
        WHERE bank_transaction_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS reconciliation_match_result_qbo_transaction_idx
        ON reconciliation_match_result (qbo_transaction_id)
        WHERE qbo_transaction_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS reconciliation_rule_result_candidate_transaction_idx
        ON reconciliation_rule_result (candidate_transaction_id)
        WHERE candidate_transaction_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS reconciliation_exception_canonical_row_idx
        ON reconciliation_exception (canonical_row_id)
        WHERE canonical_row_id IS NOT NULL;
    `,
  },
  {
    version: 3,
    name: 'add_read_model_access_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS reconciliation_job_completed_report_idx
        ON reconciliation_job (completed_at DESC, created_at DESC)
        WHERE completed_at IS NOT NULL;

      CREATE INDEX IF NOT EXISTS reconciliation_match_result_job_result_bucket_created_idx
        ON reconciliation_match_result (job_id, result_bucket, created_at ASC, id ASC);

      CREATE INDEX IF NOT EXISTS reconciliation_match_result_job_bank_transaction_lookup_idx
        ON reconciliation_match_result (job_id, bank_transaction_id)
        WHERE bank_transaction_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS reconciliation_match_result_job_qbo_transaction_lookup_idx
        ON reconciliation_match_result (job_id, qbo_transaction_id)
        WHERE qbo_transaction_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS reconciliation_exception_job_line_order_idx
        ON reconciliation_exception (job_id, line_number ASC, id ASC);

      CREATE INDEX IF NOT EXISTS reconciliation_exception_job_category_line_order_idx
        ON reconciliation_exception (job_id, category, line_number ASC, id ASC);

      CREATE INDEX IF NOT EXISTS reconciliation_review_decision_job_created_idx
        ON reconciliation_review_decision (job_id, created_at ASC, id ASC);

      CREATE INDEX IF NOT EXISTS reconciliation_review_observation_job_created_idx
        ON reconciliation_review_observation (job_id, created_at ASC, id ASC);
    `,
  },
];
