-- GENERATED FILE — do not edit by hand.
--
-- pgTap baseline for the Liquibase-managed schema. Regenerate after an intentional schema
-- change with:
--
--   npm run test:postgres:update-baseline
--
-- and review the diff: every line that moves is a schema change someone is shipping.
SELECT plan(829);

SELECT tables_are('public', ARRAY['databasechangelog', 'databasechangeloglock', 'reconciliation_approval_history', 'reconciliation_audit_event', 'reconciliation_canonical_row', 'reconciliation_exception', 'reconciliation_export', 'reconciliation_import_approval', 'reconciliation_import_batch', 'reconciliation_job', 'reconciliation_job_summary', 'reconciliation_mapping_profile', 'reconciliation_mapping_profile_version', 'reconciliation_match_group', 'reconciliation_match_result', 'reconciliation_organization', 'reconciliation_payee_alias', 'reconciliation_raw_row', 'reconciliation_review_decision', 'reconciliation_review_observation', 'reconciliation_rule_result', 'reconciliation_source_file', 'reconciliation_source_file_content', 'reconciliation_staged_transaction', 'reconciliation_template_definition', 'reconciliation_user', 'reconciliation_validation_result', 'reconciliation_validation_rule_version']::name[], 'public schema contains exactly the expected tables');
SELECT columns_are('public', 'reconciliation_approval_history', ARRAY['id', 'approval_id', 'from_status', 'to_status', 'actor', 'note', 'created_at']::name[], 'reconciliation_approval_history has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_approval_history', ARRAY['id']::name[], 'reconciliation_approval_history primary key');
SELECT indexes_are('public', 'reconciliation_approval_history', ARRAY['reconciliation_approval_history_approval_idx', 'reconciliation_approval_history_pkey']::name[], 'reconciliation_approval_history has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_approval_history', 'id', 'uuid', 'reconciliation_approval_history.id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_history', 'id', 'reconciliation_approval_history.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_approval_history', 'approval_id', 'uuid', 'reconciliation_approval_history.approval_id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_history', 'approval_id', 'reconciliation_approval_history.approval_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_approval_history', 'from_status', 'text', 'reconciliation_approval_history.from_status is text');
SELECT col_is_null('public', 'reconciliation_approval_history', 'from_status', 'reconciliation_approval_history.from_status is nullable');
SELECT col_type_is('public', 'reconciliation_approval_history', 'to_status', 'text', 'reconciliation_approval_history.to_status is text');
SELECT col_not_null('public', 'reconciliation_approval_history', 'to_status', 'reconciliation_approval_history.to_status is NOT NULL');
SELECT col_type_is('public', 'reconciliation_approval_history', 'actor', 'text', 'reconciliation_approval_history.actor is text');
SELECT col_not_null('public', 'reconciliation_approval_history', 'actor', 'reconciliation_approval_history.actor is NOT NULL');
SELECT col_type_is('public', 'reconciliation_approval_history', 'note', 'text', 'reconciliation_approval_history.note is text');
SELECT col_is_null('public', 'reconciliation_approval_history', 'note', 'reconciliation_approval_history.note is nullable');
SELECT col_type_is('public', 'reconciliation_approval_history', 'created_at', 'timestamp with time zone', 'reconciliation_approval_history.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_approval_history', 'created_at', 'reconciliation_approval_history.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_approval_history'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$$chk$,
  'reconciliation_approval_history check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_audit_event', ARRAY['event_id', 'job_id', 'event_type', 'from_state', 'to_state', 'actor', 'details_json', 'created_at', 'id']::name[], 'reconciliation_audit_event has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_audit_event', ARRAY['event_id']::name[], 'reconciliation_audit_event primary key');
SELECT indexes_are('public', 'reconciliation_audit_event', ARRAY['reconciliation_audit_event_id_key', 'reconciliation_audit_event_job_idx', 'reconciliation_audit_event_pkey']::name[], 'reconciliation_audit_event has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_audit_event', 'event_id', 'bigint', 'reconciliation_audit_event.event_id is bigint');
SELECT col_not_null('public', 'reconciliation_audit_event', 'event_id', 'reconciliation_audit_event.event_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_audit_event', 'job_id', 'uuid', 'reconciliation_audit_event.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_audit_event', 'job_id', 'reconciliation_audit_event.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_audit_event', 'event_type', 'text', 'reconciliation_audit_event.event_type is text');
SELECT col_not_null('public', 'reconciliation_audit_event', 'event_type', 'reconciliation_audit_event.event_type is NOT NULL');
SELECT col_type_is('public', 'reconciliation_audit_event', 'from_state', 'text', 'reconciliation_audit_event.from_state is text');
SELECT col_is_null('public', 'reconciliation_audit_event', 'from_state', 'reconciliation_audit_event.from_state is nullable');
SELECT col_type_is('public', 'reconciliation_audit_event', 'to_state', 'text', 'reconciliation_audit_event.to_state is text');
SELECT col_is_null('public', 'reconciliation_audit_event', 'to_state', 'reconciliation_audit_event.to_state is nullable');
SELECT col_type_is('public', 'reconciliation_audit_event', 'actor', 'text', 'reconciliation_audit_event.actor is text');
SELECT col_is_null('public', 'reconciliation_audit_event', 'actor', 'reconciliation_audit_event.actor is nullable');
SELECT col_type_is('public', 'reconciliation_audit_event', 'details_json', 'jsonb', 'reconciliation_audit_event.details_json is jsonb');
SELECT col_not_null('public', 'reconciliation_audit_event', 'details_json', 'reconciliation_audit_event.details_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_audit_event', 'created_at', 'timestamp with time zone', 'reconciliation_audit_event.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_audit_event', 'created_at', 'reconciliation_audit_event.created_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_audit_event', 'id', 'uuid', 'reconciliation_audit_event.id is uuid');
SELECT col_not_null('public', 'reconciliation_audit_event', 'id', 'reconciliation_audit_event.id is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_audit_event'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_audit_event_id_key => UNIQUE (id)$chk$,
  'reconciliation_audit_event check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_canonical_row', ARRAY['id', 'job_id', 'raw_row_id', 'source_file_id', 'source_system', 'spreadsheet_file_name', 'worksheet_name', 'line_number', 'transaction_date', 'posting_date', 'transaction_type', 'check_number', 'serial_number', 'reference_number', 'description', 'merchant_name', 'payee_name', 'amount', 'debit', 'credit', 'running_balance', 'normalized_comparison_text', 'normalized_comparison_tokens', 'normalized_reference_tokens', 'raw_source_values_json', 'data_quality_issues_json', 'is_excluded', 'exclusion_reason', 'is_zero_amount', 'context_fingerprint', 'account_identifier', 'reviewer_notes', 'created_at', 'staged_transaction_id']::name[], 'reconciliation_canonical_row has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_canonical_row', ARRAY['id']::name[], 'reconciliation_canonical_row primary key');
SELECT indexes_are('public', 'reconciliation_canonical_row', ARRAY['reconciliation_canonical_row_amount_date_idx', 'reconciliation_canonical_row_fingerprint_idx', 'reconciliation_canonical_row_job_idx', 'reconciliation_canonical_row_pkey', 'reconciliation_canonical_row_raw_row_id_key', 'reconciliation_canonical_row_staged_transaction_key']::name[], 'reconciliation_canonical_row has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'id', 'uuid', 'reconciliation_canonical_row.id is uuid');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'id', 'reconciliation_canonical_row.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'job_id', 'uuid', 'reconciliation_canonical_row.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'job_id', 'reconciliation_canonical_row.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'raw_row_id', 'uuid', 'reconciliation_canonical_row.raw_row_id is uuid');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'raw_row_id', 'reconciliation_canonical_row.raw_row_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'source_file_id', 'uuid', 'reconciliation_canonical_row.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'source_file_id', 'reconciliation_canonical_row.source_file_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'source_system', 'text', 'reconciliation_canonical_row.source_system is text');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'source_system', 'reconciliation_canonical_row.source_system is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'spreadsheet_file_name', 'text', 'reconciliation_canonical_row.spreadsheet_file_name is text');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'spreadsheet_file_name', 'reconciliation_canonical_row.spreadsheet_file_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'worksheet_name', 'text', 'reconciliation_canonical_row.worksheet_name is text');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'worksheet_name', 'reconciliation_canonical_row.worksheet_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'line_number', 'integer', 'reconciliation_canonical_row.line_number is integer');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'line_number', 'reconciliation_canonical_row.line_number is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'transaction_date', 'date', 'reconciliation_canonical_row.transaction_date is date');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'transaction_date', 'reconciliation_canonical_row.transaction_date is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'posting_date', 'date', 'reconciliation_canonical_row.posting_date is date');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'posting_date', 'reconciliation_canonical_row.posting_date is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'transaction_type', 'text', 'reconciliation_canonical_row.transaction_type is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'transaction_type', 'reconciliation_canonical_row.transaction_type is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'check_number', 'text', 'reconciliation_canonical_row.check_number is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'check_number', 'reconciliation_canonical_row.check_number is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'serial_number', 'text', 'reconciliation_canonical_row.serial_number is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'serial_number', 'reconciliation_canonical_row.serial_number is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'reference_number', 'text', 'reconciliation_canonical_row.reference_number is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'reference_number', 'reconciliation_canonical_row.reference_number is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'description', 'text', 'reconciliation_canonical_row.description is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'description', 'reconciliation_canonical_row.description is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'merchant_name', 'text', 'reconciliation_canonical_row.merchant_name is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'merchant_name', 'reconciliation_canonical_row.merchant_name is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'payee_name', 'text', 'reconciliation_canonical_row.payee_name is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'payee_name', 'reconciliation_canonical_row.payee_name is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'amount', 'numeric(18,2)', 'reconciliation_canonical_row.amount is numeric(18,2)');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'amount', 'reconciliation_canonical_row.amount is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'debit', 'numeric(18,2)', 'reconciliation_canonical_row.debit is numeric(18,2)');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'debit', 'reconciliation_canonical_row.debit is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'credit', 'numeric(18,2)', 'reconciliation_canonical_row.credit is numeric(18,2)');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'credit', 'reconciliation_canonical_row.credit is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'running_balance', 'numeric(18,2)', 'reconciliation_canonical_row.running_balance is numeric(18,2)');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'running_balance', 'reconciliation_canonical_row.running_balance is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'normalized_comparison_text', 'text', 'reconciliation_canonical_row.normalized_comparison_text is text');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'normalized_comparison_text', 'reconciliation_canonical_row.normalized_comparison_text is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'normalized_comparison_tokens', 'text[]', 'reconciliation_canonical_row.normalized_comparison_tokens is text[]');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'normalized_comparison_tokens', 'reconciliation_canonical_row.normalized_comparison_tokens is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'normalized_reference_tokens', 'text[]', 'reconciliation_canonical_row.normalized_reference_tokens is text[]');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'normalized_reference_tokens', 'reconciliation_canonical_row.normalized_reference_tokens is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'raw_source_values_json', 'jsonb', 'reconciliation_canonical_row.raw_source_values_json is jsonb');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'raw_source_values_json', 'reconciliation_canonical_row.raw_source_values_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'data_quality_issues_json', 'jsonb', 'reconciliation_canonical_row.data_quality_issues_json is jsonb');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'data_quality_issues_json', 'reconciliation_canonical_row.data_quality_issues_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'is_excluded', 'boolean', 'reconciliation_canonical_row.is_excluded is boolean');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'is_excluded', 'reconciliation_canonical_row.is_excluded is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'exclusion_reason', 'text', 'reconciliation_canonical_row.exclusion_reason is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'exclusion_reason', 'reconciliation_canonical_row.exclusion_reason is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'is_zero_amount', 'boolean', 'reconciliation_canonical_row.is_zero_amount is boolean');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'is_zero_amount', 'reconciliation_canonical_row.is_zero_amount is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'context_fingerprint', 'text', 'reconciliation_canonical_row.context_fingerprint is text');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'context_fingerprint', 'reconciliation_canonical_row.context_fingerprint is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'account_identifier', 'text', 'reconciliation_canonical_row.account_identifier is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'account_identifier', 'reconciliation_canonical_row.account_identifier is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'reviewer_notes', 'text', 'reconciliation_canonical_row.reviewer_notes is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'reviewer_notes', 'reconciliation_canonical_row.reviewer_notes is nullable');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'created_at', 'timestamp with time zone', 'reconciliation_canonical_row.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'created_at', 'reconciliation_canonical_row.created_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_canonical_row', 'staged_transaction_id', 'uuid', 'reconciliation_canonical_row.staged_transaction_id is uuid');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'staged_transaction_id', 'reconciliation_canonical_row.staged_transaction_id is nullable');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_canonical_row'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_canonical_row_raw_row_id_key => UNIQUE (raw_row_id)
reconciliation_canonical_row_source_system_check => CHECK ((source_system = ANY (ARRAY['bank'::text, 'gl'::text])))$chk$,
  'reconciliation_canonical_row check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_exception', ARRAY['id', 'job_id', 'canonical_row_id', 'category', 'severity', 'source_system', 'spreadsheet_file_name', 'line_number', 'transaction_date', 'amount', 'error_message', 'rule_trace_json', 'prior_rule_traces_json', 'recommended_next_actions', 'likely_matching_reference', 'reviewer_notes', 'match_confidence', 'normalized_comparison_tokens', 'related_transaction_ids', 'created_at']::name[], 'reconciliation_exception has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_exception', ARRAY['id']::name[], 'reconciliation_exception primary key');
SELECT indexes_are('public', 'reconciliation_exception', ARRAY['reconciliation_exception_canonical_row_idx', 'reconciliation_exception_job_category_line_order_idx', 'reconciliation_exception_job_idx', 'reconciliation_exception_job_line_order_idx', 'reconciliation_exception_pkey']::name[], 'reconciliation_exception has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_exception', 'id', 'uuid', 'reconciliation_exception.id is uuid');
SELECT col_not_null('public', 'reconciliation_exception', 'id', 'reconciliation_exception.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'job_id', 'uuid', 'reconciliation_exception.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_exception', 'job_id', 'reconciliation_exception.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'canonical_row_id', 'uuid', 'reconciliation_exception.canonical_row_id is uuid');
SELECT col_is_null('public', 'reconciliation_exception', 'canonical_row_id', 'reconciliation_exception.canonical_row_id is nullable');
SELECT col_type_is('public', 'reconciliation_exception', 'category', 'text', 'reconciliation_exception.category is text');
SELECT col_not_null('public', 'reconciliation_exception', 'category', 'reconciliation_exception.category is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'severity', 'text', 'reconciliation_exception.severity is text');
SELECT col_not_null('public', 'reconciliation_exception', 'severity', 'reconciliation_exception.severity is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'source_system', 'text', 'reconciliation_exception.source_system is text');
SELECT col_not_null('public', 'reconciliation_exception', 'source_system', 'reconciliation_exception.source_system is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'spreadsheet_file_name', 'text', 'reconciliation_exception.spreadsheet_file_name is text');
SELECT col_not_null('public', 'reconciliation_exception', 'spreadsheet_file_name', 'reconciliation_exception.spreadsheet_file_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'line_number', 'integer', 'reconciliation_exception.line_number is integer');
SELECT col_not_null('public', 'reconciliation_exception', 'line_number', 'reconciliation_exception.line_number is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'transaction_date', 'date', 'reconciliation_exception.transaction_date is date');
SELECT col_is_null('public', 'reconciliation_exception', 'transaction_date', 'reconciliation_exception.transaction_date is nullable');
SELECT col_type_is('public', 'reconciliation_exception', 'amount', 'numeric(18,2)', 'reconciliation_exception.amount is numeric(18,2)');
SELECT col_is_null('public', 'reconciliation_exception', 'amount', 'reconciliation_exception.amount is nullable');
SELECT col_type_is('public', 'reconciliation_exception', 'error_message', 'text', 'reconciliation_exception.error_message is text');
SELECT col_not_null('public', 'reconciliation_exception', 'error_message', 'reconciliation_exception.error_message is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'rule_trace_json', 'jsonb', 'reconciliation_exception.rule_trace_json is jsonb');
SELECT col_is_null('public', 'reconciliation_exception', 'rule_trace_json', 'reconciliation_exception.rule_trace_json is nullable');
SELECT col_type_is('public', 'reconciliation_exception', 'prior_rule_traces_json', 'jsonb', 'reconciliation_exception.prior_rule_traces_json is jsonb');
SELECT col_not_null('public', 'reconciliation_exception', 'prior_rule_traces_json', 'reconciliation_exception.prior_rule_traces_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'recommended_next_actions', 'text[]', 'reconciliation_exception.recommended_next_actions is text[]');
SELECT col_not_null('public', 'reconciliation_exception', 'recommended_next_actions', 'reconciliation_exception.recommended_next_actions is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'likely_matching_reference', 'text', 'reconciliation_exception.likely_matching_reference is text');
SELECT col_is_null('public', 'reconciliation_exception', 'likely_matching_reference', 'reconciliation_exception.likely_matching_reference is nullable');
SELECT col_type_is('public', 'reconciliation_exception', 'reviewer_notes', 'text', 'reconciliation_exception.reviewer_notes is text');
SELECT col_is_null('public', 'reconciliation_exception', 'reviewer_notes', 'reconciliation_exception.reviewer_notes is nullable');
SELECT col_type_is('public', 'reconciliation_exception', 'match_confidence', 'text', 'reconciliation_exception.match_confidence is text');
SELECT col_is_null('public', 'reconciliation_exception', 'match_confidence', 'reconciliation_exception.match_confidence is nullable');
SELECT col_type_is('public', 'reconciliation_exception', 'normalized_comparison_tokens', 'text[]', 'reconciliation_exception.normalized_comparison_tokens is text[]');
SELECT col_not_null('public', 'reconciliation_exception', 'normalized_comparison_tokens', 'reconciliation_exception.normalized_comparison_tokens is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'related_transaction_ids', 'uuid[]', 'reconciliation_exception.related_transaction_ids is uuid[]');
SELECT col_not_null('public', 'reconciliation_exception', 'related_transaction_ids', 'reconciliation_exception.related_transaction_ids is NOT NULL');
SELECT col_type_is('public', 'reconciliation_exception', 'created_at', 'timestamp with time zone', 'reconciliation_exception.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_exception', 'created_at', 'reconciliation_exception.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_exception'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_exception_category_check => CHECK ((category = ANY (ARRAY['MissingFromBank'::text, 'MissingFromGL'::text, 'AmountMismatch'::text, 'DuplicateInBank'::text, 'DuplicateInGL'::text, 'LikelySplitCombineIssue'::text, 'DepositGroupingIssue'::text, 'LikelyMiscoding'::text, 'DateVariance'::text, 'TimingDifference'::text, 'CheckNumberMismatch'::text, 'ReferenceNumberMismatch'::text, 'DescriptionMerchantVariance'::text, 'StaleOutstandingCheck'::text, 'OutstandingCheck'::text, 'FeeNettingMatch'::text, 'PartialPaymentMatch'::text, 'PayrollBatchMatch'::text, 'BankServiceChargeAmortization'::text, 'LoanPaymentSplit'::text, 'NSFReturnedDeposit'::text, 'VoidedCheckCleared'::text, 'InvalidOrMissingData'::text, 'AmbiguousMatchRequiringReview'::text, 'ReversalVoid'::text, 'ACHReturn'::text, 'DepositInTransit'::text, 'ChargebackReturn'::text, 'InterestIncome'::text, 'IntercompanyMismatch'::text])))
reconciliation_exception_source_system_check => CHECK ((source_system = ANY (ARRAY['bank'::text, 'gl'::text])))$chk$,
  'reconciliation_exception check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_export', ARRAY['id', 'job_id', 'export_type', 'state', 'file_name', 'storage_uri', 'checksum_sha256', 'byte_size', 'tab_names_json', 'generated_at', 'created_at']::name[], 'reconciliation_export has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_export', ARRAY['id']::name[], 'reconciliation_export primary key');
SELECT indexes_are('public', 'reconciliation_export', ARRAY['reconciliation_export_job_id_export_type_key', 'reconciliation_export_pkey']::name[], 'reconciliation_export has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_export', 'id', 'uuid', 'reconciliation_export.id is uuid');
SELECT col_not_null('public', 'reconciliation_export', 'id', 'reconciliation_export.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_export', 'job_id', 'uuid', 'reconciliation_export.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_export', 'job_id', 'reconciliation_export.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_export', 'export_type', 'text', 'reconciliation_export.export_type is text');
SELECT col_not_null('public', 'reconciliation_export', 'export_type', 'reconciliation_export.export_type is NOT NULL');
SELECT col_type_is('public', 'reconciliation_export', 'state', 'text', 'reconciliation_export.state is text');
SELECT col_not_null('public', 'reconciliation_export', 'state', 'reconciliation_export.state is NOT NULL');
SELECT col_type_is('public', 'reconciliation_export', 'file_name', 'text', 'reconciliation_export.file_name is text');
SELECT col_not_null('public', 'reconciliation_export', 'file_name', 'reconciliation_export.file_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_export', 'storage_uri', 'text', 'reconciliation_export.storage_uri is text');
SELECT col_is_null('public', 'reconciliation_export', 'storage_uri', 'reconciliation_export.storage_uri is nullable');
SELECT col_type_is('public', 'reconciliation_export', 'checksum_sha256', 'text', 'reconciliation_export.checksum_sha256 is text');
SELECT col_not_null('public', 'reconciliation_export', 'checksum_sha256', 'reconciliation_export.checksum_sha256 is NOT NULL');
SELECT col_type_is('public', 'reconciliation_export', 'byte_size', 'bigint', 'reconciliation_export.byte_size is bigint');
SELECT col_not_null('public', 'reconciliation_export', 'byte_size', 'reconciliation_export.byte_size is NOT NULL');
SELECT col_type_is('public', 'reconciliation_export', 'tab_names_json', 'jsonb', 'reconciliation_export.tab_names_json is jsonb');
SELECT col_not_null('public', 'reconciliation_export', 'tab_names_json', 'reconciliation_export.tab_names_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_export', 'generated_at', 'timestamp with time zone', 'reconciliation_export.generated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_export', 'generated_at', 'reconciliation_export.generated_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_export', 'created_at', 'timestamp with time zone', 'reconciliation_export.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_export', 'created_at', 'reconciliation_export.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_export'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_export_byte_size_check => CHECK ((byte_size >= 0))
reconciliation_export_export_type_check => CHECK ((export_type = ANY (ARRAY['workbook'::text, 'json'::text])))
reconciliation_export_job_id_export_type_key => UNIQUE (job_id, export_type)
reconciliation_export_state_check => CHECK ((state = ANY (ARRAY['READY'::text, 'FAILED'::text])))$chk$,
  'reconciliation_export check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_import_approval', ARRAY['id', 'source_file_id', 'status', 'uploaded_by', 'approved_by', 'rationale', 'requested_at', 'decided_at', 'created_at']::name[], 'reconciliation_import_approval has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_import_approval', ARRAY['id']::name[], 'reconciliation_import_approval primary key');
SELECT indexes_are('public', 'reconciliation_import_approval', ARRAY['reconciliation_import_approval_approved_by_idx', 'reconciliation_import_approval_pkey', 'reconciliation_import_approval_source_file_key', 'reconciliation_import_approval_status_idx', 'reconciliation_import_approval_uploaded_by_idx']::name[], 'reconciliation_import_approval has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_import_approval', 'id', 'uuid', 'reconciliation_import_approval.id is uuid');
SELECT col_not_null('public', 'reconciliation_import_approval', 'id', 'reconciliation_import_approval.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_approval', 'source_file_id', 'uuid', 'reconciliation_import_approval.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_import_approval', 'source_file_id', 'reconciliation_import_approval.source_file_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_approval', 'status', 'text', 'reconciliation_import_approval.status is text');
SELECT col_not_null('public', 'reconciliation_import_approval', 'status', 'reconciliation_import_approval.status is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_approval', 'uploaded_by', 'text', 'reconciliation_import_approval.uploaded_by is text');
SELECT col_not_null('public', 'reconciliation_import_approval', 'uploaded_by', 'reconciliation_import_approval.uploaded_by is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_approval', 'approved_by', 'text', 'reconciliation_import_approval.approved_by is text');
SELECT col_is_null('public', 'reconciliation_import_approval', 'approved_by', 'reconciliation_import_approval.approved_by is nullable');
SELECT col_type_is('public', 'reconciliation_import_approval', 'rationale', 'text', 'reconciliation_import_approval.rationale is text');
SELECT col_is_null('public', 'reconciliation_import_approval', 'rationale', 'reconciliation_import_approval.rationale is nullable');
SELECT col_type_is('public', 'reconciliation_import_approval', 'requested_at', 'timestamp with time zone', 'reconciliation_import_approval.requested_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_import_approval', 'requested_at', 'reconciliation_import_approval.requested_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_approval', 'decided_at', 'timestamp with time zone', 'reconciliation_import_approval.decided_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_import_approval', 'decided_at', 'reconciliation_import_approval.decided_at is nullable');
SELECT col_type_is('public', 'reconciliation_import_approval', 'created_at', 'timestamp with time zone', 'reconciliation_import_approval.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_import_approval', 'created_at', 'reconciliation_import_approval.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_import_approval'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_import_approval_source_file_key => UNIQUE (source_file_id)
reconciliation_import_approval_status_check => CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'OVERRIDDEN'::text])))$chk$,
  'reconciliation_import_approval check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_import_batch', ARRAY['id', 'job_id', 'source_file_id', 'batch_number', 'state', 'row_start_number', 'row_end_number', 'row_count', 'started_at', 'completed_at', 'error_message', 'created_at']::name[], 'reconciliation_import_batch has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_import_batch', ARRAY['id']::name[], 'reconciliation_import_batch primary key');
SELECT indexes_are('public', 'reconciliation_import_batch', ARRAY['reconciliation_import_batch_job_idx', 'reconciliation_import_batch_pkey', 'reconciliation_import_batch_source_file_id_batch_number_key']::name[], 'reconciliation_import_batch has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_import_batch', 'id', 'uuid', 'reconciliation_import_batch.id is uuid');
SELECT col_not_null('public', 'reconciliation_import_batch', 'id', 'reconciliation_import_batch.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_batch', 'job_id', 'uuid', 'reconciliation_import_batch.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_import_batch', 'job_id', 'reconciliation_import_batch.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_batch', 'source_file_id', 'uuid', 'reconciliation_import_batch.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_import_batch', 'source_file_id', 'reconciliation_import_batch.source_file_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_batch', 'batch_number', 'integer', 'reconciliation_import_batch.batch_number is integer');
SELECT col_not_null('public', 'reconciliation_import_batch', 'batch_number', 'reconciliation_import_batch.batch_number is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_batch', 'state', 'text', 'reconciliation_import_batch.state is text');
SELECT col_not_null('public', 'reconciliation_import_batch', 'state', 'reconciliation_import_batch.state is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_batch', 'row_start_number', 'integer', 'reconciliation_import_batch.row_start_number is integer');
SELECT col_not_null('public', 'reconciliation_import_batch', 'row_start_number', 'reconciliation_import_batch.row_start_number is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_batch', 'row_end_number', 'integer', 'reconciliation_import_batch.row_end_number is integer');
SELECT col_not_null('public', 'reconciliation_import_batch', 'row_end_number', 'reconciliation_import_batch.row_end_number is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_batch', 'row_count', 'integer', 'reconciliation_import_batch.row_count is integer');
SELECT col_not_null('public', 'reconciliation_import_batch', 'row_count', 'reconciliation_import_batch.row_count is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_batch', 'started_at', 'timestamp with time zone', 'reconciliation_import_batch.started_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_import_batch', 'started_at', 'reconciliation_import_batch.started_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_import_batch', 'completed_at', 'timestamp with time zone', 'reconciliation_import_batch.completed_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_import_batch', 'completed_at', 'reconciliation_import_batch.completed_at is nullable');
SELECT col_type_is('public', 'reconciliation_import_batch', 'error_message', 'text', 'reconciliation_import_batch.error_message is text');
SELECT col_is_null('public', 'reconciliation_import_batch', 'error_message', 'reconciliation_import_batch.error_message is nullable');
SELECT col_type_is('public', 'reconciliation_import_batch', 'created_at', 'timestamp with time zone', 'reconciliation_import_batch.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_import_batch', 'created_at', 'reconciliation_import_batch.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_import_batch'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_import_batch_row_count_check => CHECK ((row_count >= 0))
reconciliation_import_batch_source_file_id_batch_number_key => UNIQUE (source_file_id, batch_number)
reconciliation_import_batch_state_check => CHECK ((state = ANY (ARRAY['PENDING'::text, 'IMPORTING'::text, 'IMPORTED'::text, 'FAILED'::text])))$chk$,
  'reconciliation_import_batch check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_job', ARRAY['id', 'correlation_id', 'account_identifier', 'period_label', 'reconciliation_frequency', 'current_state', 'input_fingerprint', 'schema_version', 'rulepack_version', 'record_version', 'retry_count', 'failure_code', 'failure_message', 'created_at', 'updated_at', 'started_at', 'completed_at']::name[], 'reconciliation_job has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_job', ARRAY['id']::name[], 'reconciliation_job primary key');
SELECT indexes_are('public', 'reconciliation_job', ARRAY['reconciliation_job_completed_report_idx', 'reconciliation_job_fingerprint_idx', 'reconciliation_job_pkey', 'reconciliation_job_state_idx']::name[], 'reconciliation_job has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_job', 'id', 'uuid', 'reconciliation_job.id is uuid');
SELECT col_not_null('public', 'reconciliation_job', 'id', 'reconciliation_job.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job', 'correlation_id', 'text', 'reconciliation_job.correlation_id is text');
SELECT col_not_null('public', 'reconciliation_job', 'correlation_id', 'reconciliation_job.correlation_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job', 'account_identifier', 'text', 'reconciliation_job.account_identifier is text');
SELECT col_is_null('public', 'reconciliation_job', 'account_identifier', 'reconciliation_job.account_identifier is nullable');
SELECT col_type_is('public', 'reconciliation_job', 'period_label', 'text', 'reconciliation_job.period_label is text');
SELECT col_is_null('public', 'reconciliation_job', 'period_label', 'reconciliation_job.period_label is nullable');
SELECT col_type_is('public', 'reconciliation_job', 'reconciliation_frequency', 'text', 'reconciliation_job.reconciliation_frequency is text');
SELECT col_is_null('public', 'reconciliation_job', 'reconciliation_frequency', 'reconciliation_job.reconciliation_frequency is nullable');
SELECT col_type_is('public', 'reconciliation_job', 'current_state', 'text', 'reconciliation_job.current_state is text');
SELECT col_not_null('public', 'reconciliation_job', 'current_state', 'reconciliation_job.current_state is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job', 'input_fingerprint', 'text', 'reconciliation_job.input_fingerprint is text');
SELECT col_is_null('public', 'reconciliation_job', 'input_fingerprint', 'reconciliation_job.input_fingerprint is nullable');
SELECT col_type_is('public', 'reconciliation_job', 'schema_version', 'integer', 'reconciliation_job.schema_version is integer');
SELECT col_not_null('public', 'reconciliation_job', 'schema_version', 'reconciliation_job.schema_version is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job', 'rulepack_version', 'text', 'reconciliation_job.rulepack_version is text');
SELECT col_not_null('public', 'reconciliation_job', 'rulepack_version', 'reconciliation_job.rulepack_version is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job', 'record_version', 'integer', 'reconciliation_job.record_version is integer');
SELECT col_not_null('public', 'reconciliation_job', 'record_version', 'reconciliation_job.record_version is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job', 'retry_count', 'integer', 'reconciliation_job.retry_count is integer');
SELECT col_not_null('public', 'reconciliation_job', 'retry_count', 'reconciliation_job.retry_count is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job', 'failure_code', 'text', 'reconciliation_job.failure_code is text');
SELECT col_is_null('public', 'reconciliation_job', 'failure_code', 'reconciliation_job.failure_code is nullable');
SELECT col_type_is('public', 'reconciliation_job', 'failure_message', 'text', 'reconciliation_job.failure_message is text');
SELECT col_is_null('public', 'reconciliation_job', 'failure_message', 'reconciliation_job.failure_message is nullable');
SELECT col_type_is('public', 'reconciliation_job', 'created_at', 'timestamp with time zone', 'reconciliation_job.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_job', 'created_at', 'reconciliation_job.created_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job', 'updated_at', 'timestamp with time zone', 'reconciliation_job.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_job', 'updated_at', 'reconciliation_job.updated_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job', 'started_at', 'timestamp with time zone', 'reconciliation_job.started_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_job', 'started_at', 'reconciliation_job.started_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job', 'completed_at', 'timestamp with time zone', 'reconciliation_job.completed_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_job', 'completed_at', 'reconciliation_job.completed_at is nullable');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_job'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_job_current_state_check => CHECK ((current_state = ANY (ARRAY['CREATED'::text, 'FILE_REGISTERED'::text, 'IMPORTING'::text, 'IMPORTED'::text, 'NORMALIZING'::text, 'NORMALIZED'::text, 'MATCHING'::text, 'MATCHED'::text, 'EXCEPTIONS_IDENTIFIED'::text, 'REVIEW_READY'::text, 'FINALIZED'::text, 'FAILED'::text, 'RETRY_PENDING'::text, 'CANCELLED'::text])))
reconciliation_job_reconciliation_frequency_check => CHECK ((reconciliation_frequency = ANY (ARRAY['Monthly'::text, 'Annual'::text])))$chk$,
  'reconciliation_job check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_job_summary', ARRAY['job_id', 'total_records_reviewed', 'bank_records', 'gl_records', 'exact_matches', 'probable_matches', 'unmatched_items', 'duplicates', 'bank_duplicates', 'gl_duplicates', 'date_variances', 'timing_differences', 'data_quality_issues', 'amount_mismatches', 'missing_from_bank', 'missing_from_gl', 'unmatched_bank_net_amount', 'unmatched_gl_net_amount', 'clean_matched_amount', 'unresolved_exposure', 'counts_by_category_json', 'amount_by_category_json', 'charts_json', 'created_at', 'updated_at', 'id']::name[], 'reconciliation_job_summary has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_job_summary', ARRAY['job_id']::name[], 'reconciliation_job_summary primary key');
SELECT indexes_are('public', 'reconciliation_job_summary', ARRAY['reconciliation_job_summary_id_key', 'reconciliation_job_summary_pkey']::name[], 'reconciliation_job_summary has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_job_summary', 'job_id', 'uuid', 'reconciliation_job_summary.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_job_summary', 'job_id', 'reconciliation_job_summary.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'total_records_reviewed', 'integer', 'reconciliation_job_summary.total_records_reviewed is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'total_records_reviewed', 'reconciliation_job_summary.total_records_reviewed is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'bank_records', 'integer', 'reconciliation_job_summary.bank_records is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'bank_records', 'reconciliation_job_summary.bank_records is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'gl_records', 'integer', 'reconciliation_job_summary.gl_records is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'gl_records', 'reconciliation_job_summary.gl_records is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'exact_matches', 'integer', 'reconciliation_job_summary.exact_matches is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'exact_matches', 'reconciliation_job_summary.exact_matches is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'probable_matches', 'integer', 'reconciliation_job_summary.probable_matches is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'probable_matches', 'reconciliation_job_summary.probable_matches is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'unmatched_items', 'integer', 'reconciliation_job_summary.unmatched_items is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'unmatched_items', 'reconciliation_job_summary.unmatched_items is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'duplicates', 'integer', 'reconciliation_job_summary.duplicates is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'duplicates', 'reconciliation_job_summary.duplicates is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'bank_duplicates', 'integer', 'reconciliation_job_summary.bank_duplicates is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'bank_duplicates', 'reconciliation_job_summary.bank_duplicates is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'gl_duplicates', 'integer', 'reconciliation_job_summary.gl_duplicates is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'gl_duplicates', 'reconciliation_job_summary.gl_duplicates is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'date_variances', 'integer', 'reconciliation_job_summary.date_variances is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'date_variances', 'reconciliation_job_summary.date_variances is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'timing_differences', 'integer', 'reconciliation_job_summary.timing_differences is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'timing_differences', 'reconciliation_job_summary.timing_differences is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'data_quality_issues', 'integer', 'reconciliation_job_summary.data_quality_issues is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'data_quality_issues', 'reconciliation_job_summary.data_quality_issues is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'amount_mismatches', 'integer', 'reconciliation_job_summary.amount_mismatches is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'amount_mismatches', 'reconciliation_job_summary.amount_mismatches is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'missing_from_bank', 'integer', 'reconciliation_job_summary.missing_from_bank is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'missing_from_bank', 'reconciliation_job_summary.missing_from_bank is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'missing_from_gl', 'integer', 'reconciliation_job_summary.missing_from_gl is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'missing_from_gl', 'reconciliation_job_summary.missing_from_gl is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'unmatched_bank_net_amount', 'numeric(18,2)', 'reconciliation_job_summary.unmatched_bank_net_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_job_summary', 'unmatched_bank_net_amount', 'reconciliation_job_summary.unmatched_bank_net_amount is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'unmatched_gl_net_amount', 'numeric(18,2)', 'reconciliation_job_summary.unmatched_gl_net_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_job_summary', 'unmatched_gl_net_amount', 'reconciliation_job_summary.unmatched_gl_net_amount is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'clean_matched_amount', 'numeric(18,2)', 'reconciliation_job_summary.clean_matched_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_job_summary', 'clean_matched_amount', 'reconciliation_job_summary.clean_matched_amount is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'unresolved_exposure', 'numeric(18,2)', 'reconciliation_job_summary.unresolved_exposure is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_job_summary', 'unresolved_exposure', 'reconciliation_job_summary.unresolved_exposure is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'counts_by_category_json', 'jsonb', 'reconciliation_job_summary.counts_by_category_json is jsonb');
SELECT col_not_null('public', 'reconciliation_job_summary', 'counts_by_category_json', 'reconciliation_job_summary.counts_by_category_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'amount_by_category_json', 'jsonb', 'reconciliation_job_summary.amount_by_category_json is jsonb');
SELECT col_not_null('public', 'reconciliation_job_summary', 'amount_by_category_json', 'reconciliation_job_summary.amount_by_category_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'charts_json', 'jsonb', 'reconciliation_job_summary.charts_json is jsonb');
SELECT col_not_null('public', 'reconciliation_job_summary', 'charts_json', 'reconciliation_job_summary.charts_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'created_at', 'timestamp with time zone', 'reconciliation_job_summary.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_job_summary', 'created_at', 'reconciliation_job_summary.created_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'updated_at', 'timestamp with time zone', 'reconciliation_job_summary.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_job_summary', 'updated_at', 'reconciliation_job_summary.updated_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_job_summary', 'id', 'uuid', 'reconciliation_job_summary.id is uuid');
SELECT col_not_null('public', 'reconciliation_job_summary', 'id', 'reconciliation_job_summary.id is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_job_summary'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_job_summary_id_key => UNIQUE (id)$chk$,
  'reconciliation_job_summary check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_mapping_profile', ARRAY['id', 'organization_id', 'name', 'source_type', 'status', 'created_at']::name[], 'reconciliation_mapping_profile has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_mapping_profile', ARRAY['id']::name[], 'reconciliation_mapping_profile primary key');
SELECT indexes_are('public', 'reconciliation_mapping_profile', ARRAY['reconciliation_mapping_profile_org_name_key', 'reconciliation_mapping_profile_organization_idx', 'reconciliation_mapping_profile_pkey']::name[], 'reconciliation_mapping_profile has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'id', 'uuid', 'reconciliation_mapping_profile.id is uuid');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'id', 'reconciliation_mapping_profile.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'organization_id', 'uuid', 'reconciliation_mapping_profile.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'organization_id', 'reconciliation_mapping_profile.organization_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'name', 'text', 'reconciliation_mapping_profile.name is text');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'name', 'reconciliation_mapping_profile.name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'source_type', 'text', 'reconciliation_mapping_profile.source_type is text');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'source_type', 'reconciliation_mapping_profile.source_type is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'status', 'text', 'reconciliation_mapping_profile.status is text');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'status', 'reconciliation_mapping_profile.status is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'created_at', 'timestamp with time zone', 'reconciliation_mapping_profile.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'created_at', 'reconciliation_mapping_profile.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_mapping_profile'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_mapping_profile_org_name_key => UNIQUE (organization_id, name, source_type)
reconciliation_mapping_profile_source_type_check => CHECK ((source_type = ANY (ARRAY['bank'::text, 'gl'::text])))
reconciliation_mapping_profile_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))$chk$,
  'reconciliation_mapping_profile check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_mapping_profile_version', ARRAY['id', 'profile_id', 'version_number', 'column_mapping', 'transformation_rules', 'status', 'created_by', 'created_at']::name[], 'reconciliation_mapping_profile_version has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_mapping_profile_version', ARRAY['id']::name[], 'reconciliation_mapping_profile_version primary key');
SELECT indexes_are('public', 'reconciliation_mapping_profile_version', ARRAY['reconciliation_mapping_profile_version_key', 'reconciliation_mapping_profile_version_pkey', 'reconciliation_mapping_profile_version_profile_idx']::name[], 'reconciliation_mapping_profile_version has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'id', 'uuid', 'reconciliation_mapping_profile_version.id is uuid');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'id', 'reconciliation_mapping_profile_version.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'profile_id', 'uuid', 'reconciliation_mapping_profile_version.profile_id is uuid');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'profile_id', 'reconciliation_mapping_profile_version.profile_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'version_number', 'integer', 'reconciliation_mapping_profile_version.version_number is integer');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'version_number', 'reconciliation_mapping_profile_version.version_number is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'column_mapping', 'jsonb', 'reconciliation_mapping_profile_version.column_mapping is jsonb');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'column_mapping', 'reconciliation_mapping_profile_version.column_mapping is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'transformation_rules', 'jsonb', 'reconciliation_mapping_profile_version.transformation_rules is jsonb');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'transformation_rules', 'reconciliation_mapping_profile_version.transformation_rules is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'status', 'text', 'reconciliation_mapping_profile_version.status is text');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'status', 'reconciliation_mapping_profile_version.status is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'created_by', 'text', 'reconciliation_mapping_profile_version.created_by is text');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'created_by', 'reconciliation_mapping_profile_version.created_by is NOT NULL');
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'created_at', 'timestamp with time zone', 'reconciliation_mapping_profile_version.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'created_at', 'reconciliation_mapping_profile_version.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_mapping_profile_version'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_mapping_profile_version_key => UNIQUE (profile_id, version_number)
reconciliation_mapping_profile_version_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))
reconciliation_mapping_profile_version_version_number_check => CHECK ((version_number > 0))$chk$,
  'reconciliation_mapping_profile_version check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_match_group', ARRAY['id', 'job_id', 'disposition', 'confidence', 'category', 'bank_transaction_ids', 'gl_transaction_ids', 'bank_members_json', 'gl_members_json', 'total_amount', 'date_difference_days', 'score', 'rule_id', 'rule_name', 'reason', 'evidence_json', 'created_at']::name[], 'reconciliation_match_group has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_match_group', ARRAY['id']::name[], 'reconciliation_match_group primary key');
SELECT indexes_are('public', 'reconciliation_match_group', ARRAY['reconciliation_match_group_job_idx', 'reconciliation_match_group_pkey']::name[], 'reconciliation_match_group has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_match_group', 'id', 'uuid', 'reconciliation_match_group.id is uuid');
SELECT col_not_null('public', 'reconciliation_match_group', 'id', 'reconciliation_match_group.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'job_id', 'uuid', 'reconciliation_match_group.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_match_group', 'job_id', 'reconciliation_match_group.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'disposition', 'text', 'reconciliation_match_group.disposition is text');
SELECT col_not_null('public', 'reconciliation_match_group', 'disposition', 'reconciliation_match_group.disposition is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'confidence', 'text', 'reconciliation_match_group.confidence is text');
SELECT col_not_null('public', 'reconciliation_match_group', 'confidence', 'reconciliation_match_group.confidence is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'category', 'text', 'reconciliation_match_group.category is text');
SELECT col_is_null('public', 'reconciliation_match_group', 'category', 'reconciliation_match_group.category is nullable');
SELECT col_type_is('public', 'reconciliation_match_group', 'bank_transaction_ids', 'uuid[]', 'reconciliation_match_group.bank_transaction_ids is uuid[]');
SELECT col_not_null('public', 'reconciliation_match_group', 'bank_transaction_ids', 'reconciliation_match_group.bank_transaction_ids is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'gl_transaction_ids', 'uuid[]', 'reconciliation_match_group.gl_transaction_ids is uuid[]');
SELECT col_not_null('public', 'reconciliation_match_group', 'gl_transaction_ids', 'reconciliation_match_group.gl_transaction_ids is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'bank_members_json', 'jsonb', 'reconciliation_match_group.bank_members_json is jsonb');
SELECT col_not_null('public', 'reconciliation_match_group', 'bank_members_json', 'reconciliation_match_group.bank_members_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'gl_members_json', 'jsonb', 'reconciliation_match_group.gl_members_json is jsonb');
SELECT col_not_null('public', 'reconciliation_match_group', 'gl_members_json', 'reconciliation_match_group.gl_members_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'total_amount', 'numeric(18,2)', 'reconciliation_match_group.total_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_match_group', 'total_amount', 'reconciliation_match_group.total_amount is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'date_difference_days', 'integer', 'reconciliation_match_group.date_difference_days is integer');
SELECT col_is_null('public', 'reconciliation_match_group', 'date_difference_days', 'reconciliation_match_group.date_difference_days is nullable');
SELECT col_type_is('public', 'reconciliation_match_group', 'score', 'double precision', 'reconciliation_match_group.score is double precision');
SELECT col_not_null('public', 'reconciliation_match_group', 'score', 'reconciliation_match_group.score is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'rule_id', 'text', 'reconciliation_match_group.rule_id is text');
SELECT col_not_null('public', 'reconciliation_match_group', 'rule_id', 'reconciliation_match_group.rule_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'rule_name', 'text', 'reconciliation_match_group.rule_name is text');
SELECT col_not_null('public', 'reconciliation_match_group', 'rule_name', 'reconciliation_match_group.rule_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'reason', 'text', 'reconciliation_match_group.reason is text');
SELECT col_not_null('public', 'reconciliation_match_group', 'reason', 'reconciliation_match_group.reason is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'evidence_json', 'jsonb', 'reconciliation_match_group.evidence_json is jsonb');
SELECT col_not_null('public', 'reconciliation_match_group', 'evidence_json', 'reconciliation_match_group.evidence_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_group', 'created_at', 'timestamp with time zone', 'reconciliation_match_group.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_match_group', 'created_at', 'reconciliation_match_group.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_match_group'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$$chk$,
  'reconciliation_match_group check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_match_result', ARRAY['id', 'job_id', 'result_bucket', 'bank_transaction_id', 'gl_transaction_id', 'disposition', 'confidence', 'rule_id', 'rule_name', 'reason', 'score', 'amount_difference', 'date_difference_days', 'evidence_json', 'likely_matching_reference', 'exception_category', 'created_at']::name[], 'reconciliation_match_result has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_match_result', ARRAY['id']::name[], 'reconciliation_match_result primary key');
SELECT indexes_are('public', 'reconciliation_match_result', ARRAY['reconciliation_match_result_bank_transaction_idx', 'reconciliation_match_result_job_bank_transaction_lookup_idx', 'reconciliation_match_result_job_gl_transaction_lookup_idx', 'reconciliation_match_result_job_idx', 'reconciliation_match_result_job_result_bucket_created_idx', 'reconciliation_match_result_pkey', 'reconciliation_match_result_qbo_transaction_idx']::name[], 'reconciliation_match_result has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_match_result', 'id', 'uuid', 'reconciliation_match_result.id is uuid');
SELECT col_not_null('public', 'reconciliation_match_result', 'id', 'reconciliation_match_result.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_result', 'job_id', 'uuid', 'reconciliation_match_result.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_match_result', 'job_id', 'reconciliation_match_result.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_result', 'result_bucket', 'text', 'reconciliation_match_result.result_bucket is text');
SELECT col_not_null('public', 'reconciliation_match_result', 'result_bucket', 'reconciliation_match_result.result_bucket is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_result', 'bank_transaction_id', 'uuid', 'reconciliation_match_result.bank_transaction_id is uuid');
SELECT col_is_null('public', 'reconciliation_match_result', 'bank_transaction_id', 'reconciliation_match_result.bank_transaction_id is nullable');
SELECT col_type_is('public', 'reconciliation_match_result', 'gl_transaction_id', 'uuid', 'reconciliation_match_result.gl_transaction_id is uuid');
SELECT col_is_null('public', 'reconciliation_match_result', 'gl_transaction_id', 'reconciliation_match_result.gl_transaction_id is nullable');
SELECT col_type_is('public', 'reconciliation_match_result', 'disposition', 'text', 'reconciliation_match_result.disposition is text');
SELECT col_not_null('public', 'reconciliation_match_result', 'disposition', 'reconciliation_match_result.disposition is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_result', 'confidence', 'text', 'reconciliation_match_result.confidence is text');
SELECT col_not_null('public', 'reconciliation_match_result', 'confidence', 'reconciliation_match_result.confidence is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_result', 'rule_id', 'text', 'reconciliation_match_result.rule_id is text');
SELECT col_is_null('public', 'reconciliation_match_result', 'rule_id', 'reconciliation_match_result.rule_id is nullable');
SELECT col_type_is('public', 'reconciliation_match_result', 'rule_name', 'text', 'reconciliation_match_result.rule_name is text');
SELECT col_not_null('public', 'reconciliation_match_result', 'rule_name', 'reconciliation_match_result.rule_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_result', 'reason', 'text', 'reconciliation_match_result.reason is text');
SELECT col_is_null('public', 'reconciliation_match_result', 'reason', 'reconciliation_match_result.reason is nullable');
SELECT col_type_is('public', 'reconciliation_match_result', 'score', 'double precision', 'reconciliation_match_result.score is double precision');
SELECT col_not_null('public', 'reconciliation_match_result', 'score', 'reconciliation_match_result.score is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_result', 'amount_difference', 'numeric(18,2)', 'reconciliation_match_result.amount_difference is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_match_result', 'amount_difference', 'reconciliation_match_result.amount_difference is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_result', 'date_difference_days', 'integer', 'reconciliation_match_result.date_difference_days is integer');
SELECT col_is_null('public', 'reconciliation_match_result', 'date_difference_days', 'reconciliation_match_result.date_difference_days is nullable');
SELECT col_type_is('public', 'reconciliation_match_result', 'evidence_json', 'jsonb', 'reconciliation_match_result.evidence_json is jsonb');
SELECT col_not_null('public', 'reconciliation_match_result', 'evidence_json', 'reconciliation_match_result.evidence_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_match_result', 'likely_matching_reference', 'text', 'reconciliation_match_result.likely_matching_reference is text');
SELECT col_is_null('public', 'reconciliation_match_result', 'likely_matching_reference', 'reconciliation_match_result.likely_matching_reference is nullable');
SELECT col_type_is('public', 'reconciliation_match_result', 'exception_category', 'text', 'reconciliation_match_result.exception_category is text');
SELECT col_is_null('public', 'reconciliation_match_result', 'exception_category', 'reconciliation_match_result.exception_category is nullable');
SELECT col_type_is('public', 'reconciliation_match_result', 'created_at', 'timestamp with time zone', 'reconciliation_match_result.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_match_result', 'created_at', 'reconciliation_match_result.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_match_result'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_match_result_exception_category_check => CHECK (((exception_category IS NULL) OR (exception_category = ANY (ARRAY['MissingFromBank'::text, 'MissingFromGL'::text, 'AmountMismatch'::text, 'DuplicateInBank'::text, 'DuplicateInGL'::text, 'LikelySplitCombineIssue'::text, 'DepositGroupingIssue'::text, 'LikelyMiscoding'::text, 'DateVariance'::text, 'TimingDifference'::text, 'CheckNumberMismatch'::text, 'ReferenceNumberMismatch'::text, 'DescriptionMerchantVariance'::text, 'StaleOutstandingCheck'::text, 'OutstandingCheck'::text, 'FeeNettingMatch'::text, 'PartialPaymentMatch'::text, 'PayrollBatchMatch'::text, 'BankServiceChargeAmortization'::text, 'LoanPaymentSplit'::text, 'NSFReturnedDeposit'::text, 'VoidedCheckCleared'::text, 'InvalidOrMissingData'::text, 'AmbiguousMatchRequiringReview'::text, 'ReversalVoid'::text, 'ACHReturn'::text, 'DepositInTransit'::text, 'ChargebackReturn'::text, 'InterestIncome'::text, 'IntercompanyMismatch'::text]))))
reconciliation_match_result_result_bucket_check => CHECK ((result_bucket = ANY (ARRAY['MATCH'::text, 'PROBABLE'::text])))$chk$,
  'reconciliation_match_result check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_organization', ARRAY['id', 'name', 'status', 'created_at']::name[], 'reconciliation_organization has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_organization', ARRAY['id']::name[], 'reconciliation_organization primary key');
SELECT indexes_are('public', 'reconciliation_organization', ARRAY['reconciliation_organization_name_key', 'reconciliation_organization_pkey']::name[], 'reconciliation_organization has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_organization', 'id', 'uuid', 'reconciliation_organization.id is uuid');
SELECT col_not_null('public', 'reconciliation_organization', 'id', 'reconciliation_organization.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_organization', 'name', 'text', 'reconciliation_organization.name is text');
SELECT col_not_null('public', 'reconciliation_organization', 'name', 'reconciliation_organization.name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_organization', 'status', 'text', 'reconciliation_organization.status is text');
SELECT col_not_null('public', 'reconciliation_organization', 'status', 'reconciliation_organization.status is NOT NULL');
SELECT col_type_is('public', 'reconciliation_organization', 'created_at', 'timestamp with time zone', 'reconciliation_organization.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_organization', 'created_at', 'reconciliation_organization.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_organization'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_organization_name_key => UNIQUE (name)
reconciliation_organization_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])))$chk$,
  'reconciliation_organization check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_payee_alias', ARRAY['id', 'account_identifier', 'bank_pattern', 'canonical_payee_name', 'normalized_tokens', 'source_direction', 'match_confidence', 'is_active', 'created_at', 'updated_at']::name[], 'reconciliation_payee_alias has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_payee_alias', ARRAY['id']::name[], 'reconciliation_payee_alias primary key');
SELECT indexes_are('public', 'reconciliation_payee_alias', ARRAY['reconciliation_payee_alias_account_idx', 'reconciliation_payee_alias_active_idx', 'reconciliation_payee_alias_canonical_payee_idx', 'reconciliation_payee_alias_pkey', 'reconciliation_payee_alias_tokens_idx']::name[], 'reconciliation_payee_alias has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_payee_alias', 'id', 'uuid', 'reconciliation_payee_alias.id is uuid');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'id', 'reconciliation_payee_alias.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_payee_alias', 'account_identifier', 'text', 'reconciliation_payee_alias.account_identifier is text');
SELECT col_is_null('public', 'reconciliation_payee_alias', 'account_identifier', 'reconciliation_payee_alias.account_identifier is nullable');
SELECT col_type_is('public', 'reconciliation_payee_alias', 'bank_pattern', 'text', 'reconciliation_payee_alias.bank_pattern is text');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'bank_pattern', 'reconciliation_payee_alias.bank_pattern is NOT NULL');
SELECT col_type_is('public', 'reconciliation_payee_alias', 'canonical_payee_name', 'text', 'reconciliation_payee_alias.canonical_payee_name is text');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'canonical_payee_name', 'reconciliation_payee_alias.canonical_payee_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_payee_alias', 'normalized_tokens', 'text[]', 'reconciliation_payee_alias.normalized_tokens is text[]');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'normalized_tokens', 'reconciliation_payee_alias.normalized_tokens is NOT NULL');
SELECT col_type_is('public', 'reconciliation_payee_alias', 'source_direction', 'text', 'reconciliation_payee_alias.source_direction is text');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'source_direction', 'reconciliation_payee_alias.source_direction is NOT NULL');
SELECT col_type_is('public', 'reconciliation_payee_alias', 'match_confidence', 'double precision', 'reconciliation_payee_alias.match_confidence is double precision');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'match_confidence', 'reconciliation_payee_alias.match_confidence is NOT NULL');
SELECT col_type_is('public', 'reconciliation_payee_alias', 'is_active', 'boolean', 'reconciliation_payee_alias.is_active is boolean');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'is_active', 'reconciliation_payee_alias.is_active is NOT NULL');
SELECT col_type_is('public', 'reconciliation_payee_alias', 'created_at', 'timestamp with time zone', 'reconciliation_payee_alias.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'created_at', 'reconciliation_payee_alias.created_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_payee_alias', 'updated_at', 'timestamp with time zone', 'reconciliation_payee_alias.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'updated_at', 'reconciliation_payee_alias.updated_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_payee_alias'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$payee_alias_match_confidence_check => CHECK (((match_confidence >= (0)::double precision) AND (match_confidence <= (1)::double precision)))
payee_alias_source_direction_check => CHECK ((source_direction = ANY (ARRAY['bank_to_gl'::text, 'bidirectional'::text])))$chk$,
  'reconciliation_payee_alias check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_raw_row', ARRAY['id', 'job_id', 'source_file_id', 'import_batch_id', 'source_system', 'line_number', 'row_hash', 'raw_values_json', 'transaction_date_raw', 'posting_date_raw', 'transaction_type_raw', 'check_number_raw', 'serial_number_raw', 'reference_number_raw', 'description_raw', 'merchant_name_raw', 'payee_name_raw', 'amount_raw', 'debit_raw', 'credit_raw', 'running_balance_raw', 'excluded', 'exclusion_reason', 'parsing_issues_json', 'created_at']::name[], 'reconciliation_raw_row has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_raw_row', ARRAY['id']::name[], 'reconciliation_raw_row primary key');
SELECT indexes_are('public', 'reconciliation_raw_row', ARRAY['reconciliation_raw_row_job_idx', 'reconciliation_raw_row_pkey', 'reconciliation_raw_row_source_file_id_line_number_key']::name[], 'reconciliation_raw_row has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_raw_row', 'id', 'uuid', 'reconciliation_raw_row.id is uuid');
SELECT col_not_null('public', 'reconciliation_raw_row', 'id', 'reconciliation_raw_row.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_raw_row', 'job_id', 'uuid', 'reconciliation_raw_row.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_raw_row', 'job_id', 'reconciliation_raw_row.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_raw_row', 'source_file_id', 'uuid', 'reconciliation_raw_row.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_raw_row', 'source_file_id', 'reconciliation_raw_row.source_file_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_raw_row', 'import_batch_id', 'uuid', 'reconciliation_raw_row.import_batch_id is uuid');
SELECT col_not_null('public', 'reconciliation_raw_row', 'import_batch_id', 'reconciliation_raw_row.import_batch_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_raw_row', 'source_system', 'text', 'reconciliation_raw_row.source_system is text');
SELECT col_not_null('public', 'reconciliation_raw_row', 'source_system', 'reconciliation_raw_row.source_system is NOT NULL');
SELECT col_type_is('public', 'reconciliation_raw_row', 'line_number', 'integer', 'reconciliation_raw_row.line_number is integer');
SELECT col_not_null('public', 'reconciliation_raw_row', 'line_number', 'reconciliation_raw_row.line_number is NOT NULL');
SELECT col_type_is('public', 'reconciliation_raw_row', 'row_hash', 'text', 'reconciliation_raw_row.row_hash is text');
SELECT col_not_null('public', 'reconciliation_raw_row', 'row_hash', 'reconciliation_raw_row.row_hash is NOT NULL');
SELECT col_type_is('public', 'reconciliation_raw_row', 'raw_values_json', 'jsonb', 'reconciliation_raw_row.raw_values_json is jsonb');
SELECT col_not_null('public', 'reconciliation_raw_row', 'raw_values_json', 'reconciliation_raw_row.raw_values_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_raw_row', 'transaction_date_raw', 'text', 'reconciliation_raw_row.transaction_date_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'transaction_date_raw', 'reconciliation_raw_row.transaction_date_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'posting_date_raw', 'text', 'reconciliation_raw_row.posting_date_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'posting_date_raw', 'reconciliation_raw_row.posting_date_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'transaction_type_raw', 'text', 'reconciliation_raw_row.transaction_type_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'transaction_type_raw', 'reconciliation_raw_row.transaction_type_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'check_number_raw', 'text', 'reconciliation_raw_row.check_number_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'check_number_raw', 'reconciliation_raw_row.check_number_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'serial_number_raw', 'text', 'reconciliation_raw_row.serial_number_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'serial_number_raw', 'reconciliation_raw_row.serial_number_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'reference_number_raw', 'text', 'reconciliation_raw_row.reference_number_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'reference_number_raw', 'reconciliation_raw_row.reference_number_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'description_raw', 'text', 'reconciliation_raw_row.description_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'description_raw', 'reconciliation_raw_row.description_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'merchant_name_raw', 'text', 'reconciliation_raw_row.merchant_name_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'merchant_name_raw', 'reconciliation_raw_row.merchant_name_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'payee_name_raw', 'text', 'reconciliation_raw_row.payee_name_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'payee_name_raw', 'reconciliation_raw_row.payee_name_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'amount_raw', 'text', 'reconciliation_raw_row.amount_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'amount_raw', 'reconciliation_raw_row.amount_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'debit_raw', 'text', 'reconciliation_raw_row.debit_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'debit_raw', 'reconciliation_raw_row.debit_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'credit_raw', 'text', 'reconciliation_raw_row.credit_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'credit_raw', 'reconciliation_raw_row.credit_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'running_balance_raw', 'text', 'reconciliation_raw_row.running_balance_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'running_balance_raw', 'reconciliation_raw_row.running_balance_raw is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'excluded', 'boolean', 'reconciliation_raw_row.excluded is boolean');
SELECT col_not_null('public', 'reconciliation_raw_row', 'excluded', 'reconciliation_raw_row.excluded is NOT NULL');
SELECT col_type_is('public', 'reconciliation_raw_row', 'exclusion_reason', 'text', 'reconciliation_raw_row.exclusion_reason is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'exclusion_reason', 'reconciliation_raw_row.exclusion_reason is nullable');
SELECT col_type_is('public', 'reconciliation_raw_row', 'parsing_issues_json', 'jsonb', 'reconciliation_raw_row.parsing_issues_json is jsonb');
SELECT col_not_null('public', 'reconciliation_raw_row', 'parsing_issues_json', 'reconciliation_raw_row.parsing_issues_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_raw_row', 'created_at', 'timestamp with time zone', 'reconciliation_raw_row.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_raw_row', 'created_at', 'reconciliation_raw_row.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_raw_row'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_raw_row_source_file_id_line_number_key => UNIQUE (source_file_id, line_number)
reconciliation_raw_row_source_system_check => CHECK ((source_system = ANY (ARRAY['bank'::text, 'gl'::text])))$chk$,
  'reconciliation_raw_row check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_review_decision', ARRAY['id', 'job_id', 'target_type', 'target_id', 'outcome', 'final_category', 'notes', 'reviewer_id', 'reviewer_name', 'record_version', 'created_at', 'updated_at']::name[], 'reconciliation_review_decision has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_review_decision', ARRAY['id']::name[], 'reconciliation_review_decision primary key');
SELECT indexes_are('public', 'reconciliation_review_decision', ARRAY['reconciliation_review_decision_job_created_idx', 'reconciliation_review_decision_job_id_target_type_target_id_key', 'reconciliation_review_decision_job_idx', 'reconciliation_review_decision_pkey']::name[], 'reconciliation_review_decision has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_review_decision', 'id', 'uuid', 'reconciliation_review_decision.id is uuid');
SELECT col_not_null('public', 'reconciliation_review_decision', 'id', 'reconciliation_review_decision.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_decision', 'job_id', 'uuid', 'reconciliation_review_decision.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_review_decision', 'job_id', 'reconciliation_review_decision.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_decision', 'target_type', 'text', 'reconciliation_review_decision.target_type is text');
SELECT col_not_null('public', 'reconciliation_review_decision', 'target_type', 'reconciliation_review_decision.target_type is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_decision', 'target_id', 'uuid', 'reconciliation_review_decision.target_id is uuid');
SELECT col_not_null('public', 'reconciliation_review_decision', 'target_id', 'reconciliation_review_decision.target_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_decision', 'outcome', 'text', 'reconciliation_review_decision.outcome is text');
SELECT col_not_null('public', 'reconciliation_review_decision', 'outcome', 'reconciliation_review_decision.outcome is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_decision', 'final_category', 'text', 'reconciliation_review_decision.final_category is text');
SELECT col_is_null('public', 'reconciliation_review_decision', 'final_category', 'reconciliation_review_decision.final_category is nullable');
SELECT col_type_is('public', 'reconciliation_review_decision', 'notes', 'text', 'reconciliation_review_decision.notes is text');
SELECT col_is_null('public', 'reconciliation_review_decision', 'notes', 'reconciliation_review_decision.notes is nullable');
SELECT col_type_is('public', 'reconciliation_review_decision', 'reviewer_id', 'text', 'reconciliation_review_decision.reviewer_id is text');
SELECT col_is_null('public', 'reconciliation_review_decision', 'reviewer_id', 'reconciliation_review_decision.reviewer_id is nullable');
SELECT col_type_is('public', 'reconciliation_review_decision', 'reviewer_name', 'text', 'reconciliation_review_decision.reviewer_name is text');
SELECT col_is_null('public', 'reconciliation_review_decision', 'reviewer_name', 'reconciliation_review_decision.reviewer_name is nullable');
SELECT col_type_is('public', 'reconciliation_review_decision', 'record_version', 'integer', 'reconciliation_review_decision.record_version is integer');
SELECT col_not_null('public', 'reconciliation_review_decision', 'record_version', 'reconciliation_review_decision.record_version is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_decision', 'created_at', 'timestamp with time zone', 'reconciliation_review_decision.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_review_decision', 'created_at', 'reconciliation_review_decision.created_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_decision', 'updated_at', 'timestamp with time zone', 'reconciliation_review_decision.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_review_decision', 'updated_at', 'reconciliation_review_decision.updated_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_review_decision'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_review_decision_job_id_target_type_target_id_key => UNIQUE (job_id, target_type, target_id)$chk$,
  'reconciliation_review_decision check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_review_observation', ARRAY['id', 'job_id', 'category', 'title', 'message', 'severity', 'related_transaction_ids', 'created_at', 'persisted_at']::name[], 'reconciliation_review_observation has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_review_observation', ARRAY['id']::name[], 'reconciliation_review_observation primary key');
SELECT indexes_are('public', 'reconciliation_review_observation', ARRAY['reconciliation_review_observation_job_created_idx', 'reconciliation_review_observation_job_idx', 'reconciliation_review_observation_pkey']::name[], 'reconciliation_review_observation has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_review_observation', 'id', 'uuid', 'reconciliation_review_observation.id is uuid');
SELECT col_not_null('public', 'reconciliation_review_observation', 'id', 'reconciliation_review_observation.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_observation', 'job_id', 'uuid', 'reconciliation_review_observation.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_review_observation', 'job_id', 'reconciliation_review_observation.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_observation', 'category', 'text', 'reconciliation_review_observation.category is text');
SELECT col_not_null('public', 'reconciliation_review_observation', 'category', 'reconciliation_review_observation.category is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_observation', 'title', 'text', 'reconciliation_review_observation.title is text');
SELECT col_not_null('public', 'reconciliation_review_observation', 'title', 'reconciliation_review_observation.title is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_observation', 'message', 'text', 'reconciliation_review_observation.message is text');
SELECT col_not_null('public', 'reconciliation_review_observation', 'message', 'reconciliation_review_observation.message is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_observation', 'severity', 'text', 'reconciliation_review_observation.severity is text');
SELECT col_not_null('public', 'reconciliation_review_observation', 'severity', 'reconciliation_review_observation.severity is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_observation', 'related_transaction_ids', 'uuid[]', 'reconciliation_review_observation.related_transaction_ids is uuid[]');
SELECT col_not_null('public', 'reconciliation_review_observation', 'related_transaction_ids', 'reconciliation_review_observation.related_transaction_ids is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_observation', 'created_at', 'timestamp with time zone', 'reconciliation_review_observation.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_review_observation', 'created_at', 'reconciliation_review_observation.created_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_review_observation', 'persisted_at', 'timestamp with time zone', 'reconciliation_review_observation.persisted_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_review_observation', 'persisted_at', 'reconciliation_review_observation.persisted_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_review_observation'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$$chk$,
  'reconciliation_review_observation check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_rule_result', ARRAY['id', 'job_id', 'target_kind', 'target_id', 'rule_id', 'rule_name', 'passed', 'score', 'reason', 'evidence_json', 'candidate_transaction_id', 'evaluation_order', 'created_at']::name[], 'reconciliation_rule_result has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_rule_result', ARRAY['id']::name[], 'reconciliation_rule_result primary key');
SELECT indexes_are('public', 'reconciliation_rule_result', ARRAY['reconciliation_rule_result_candidate_transaction_idx', 'reconciliation_rule_result_pkey', 'reconciliation_rule_result_target_idx']::name[], 'reconciliation_rule_result has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_rule_result', 'id', 'uuid', 'reconciliation_rule_result.id is uuid');
SELECT col_not_null('public', 'reconciliation_rule_result', 'id', 'reconciliation_rule_result.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'job_id', 'uuid', 'reconciliation_rule_result.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_rule_result', 'job_id', 'reconciliation_rule_result.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'target_kind', 'text', 'reconciliation_rule_result.target_kind is text');
SELECT col_not_null('public', 'reconciliation_rule_result', 'target_kind', 'reconciliation_rule_result.target_kind is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'target_id', 'uuid', 'reconciliation_rule_result.target_id is uuid');
SELECT col_not_null('public', 'reconciliation_rule_result', 'target_id', 'reconciliation_rule_result.target_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'rule_id', 'text', 'reconciliation_rule_result.rule_id is text');
SELECT col_not_null('public', 'reconciliation_rule_result', 'rule_id', 'reconciliation_rule_result.rule_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'rule_name', 'text', 'reconciliation_rule_result.rule_name is text');
SELECT col_not_null('public', 'reconciliation_rule_result', 'rule_name', 'reconciliation_rule_result.rule_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'passed', 'boolean', 'reconciliation_rule_result.passed is boolean');
SELECT col_not_null('public', 'reconciliation_rule_result', 'passed', 'reconciliation_rule_result.passed is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'score', 'double precision', 'reconciliation_rule_result.score is double precision');
SELECT col_not_null('public', 'reconciliation_rule_result', 'score', 'reconciliation_rule_result.score is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'reason', 'text', 'reconciliation_rule_result.reason is text');
SELECT col_not_null('public', 'reconciliation_rule_result', 'reason', 'reconciliation_rule_result.reason is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'evidence_json', 'jsonb', 'reconciliation_rule_result.evidence_json is jsonb');
SELECT col_not_null('public', 'reconciliation_rule_result', 'evidence_json', 'reconciliation_rule_result.evidence_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'candidate_transaction_id', 'uuid', 'reconciliation_rule_result.candidate_transaction_id is uuid');
SELECT col_is_null('public', 'reconciliation_rule_result', 'candidate_transaction_id', 'reconciliation_rule_result.candidate_transaction_id is nullable');
SELECT col_type_is('public', 'reconciliation_rule_result', 'evaluation_order', 'integer', 'reconciliation_rule_result.evaluation_order is integer');
SELECT col_not_null('public', 'reconciliation_rule_result', 'evaluation_order', 'reconciliation_rule_result.evaluation_order is NOT NULL');
SELECT col_type_is('public', 'reconciliation_rule_result', 'created_at', 'timestamp with time zone', 'reconciliation_rule_result.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_rule_result', 'created_at', 'reconciliation_rule_result.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_rule_result'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_rule_result_target_kind_check => CHECK ((target_kind = ANY (ARRAY['MATCH_RESULT'::text, 'MATCH_GROUP'::text, 'EXCEPTION_ITEM'::text])))$chk$,
  'reconciliation_rule_result check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_source_file', ARRAY['id', 'job_id', 'source_system', 'source_format', 'file_name', 'mime_type', 'size_bytes', 'sha256', 'storage_uri', 'worksheet_name', 'header_row', 'transaction_start_row', 'excluded_row_numbers', 'imported_row_count', 'uploaded_at', 'created_at', 'updated_at', 'organization_id', 'uploaded_by', 'approval_status', 'ingestion_mode']::name[], 'reconciliation_source_file has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_source_file', ARRAY['id']::name[], 'reconciliation_source_file primary key');
SELECT indexes_are('public', 'reconciliation_source_file', ARRAY['reconciliation_source_file_job_id_source_system_key', 'reconciliation_source_file_job_idx', 'reconciliation_source_file_organization_approval_idx', 'reconciliation_source_file_organization_idx', 'reconciliation_source_file_pkey', 'reconciliation_source_file_sha_idx']::name[], 'reconciliation_source_file has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_source_file', 'id', 'uuid', 'reconciliation_source_file.id is uuid');
SELECT col_not_null('public', 'reconciliation_source_file', 'id', 'reconciliation_source_file.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'job_id', 'uuid', 'reconciliation_source_file.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_source_file', 'job_id', 'reconciliation_source_file.job_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'source_system', 'text', 'reconciliation_source_file.source_system is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'source_system', 'reconciliation_source_file.source_system is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'source_format', 'text', 'reconciliation_source_file.source_format is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'source_format', 'reconciliation_source_file.source_format is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'file_name', 'text', 'reconciliation_source_file.file_name is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'file_name', 'reconciliation_source_file.file_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'mime_type', 'text', 'reconciliation_source_file.mime_type is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'mime_type', 'reconciliation_source_file.mime_type is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'size_bytes', 'bigint', 'reconciliation_source_file.size_bytes is bigint');
SELECT col_not_null('public', 'reconciliation_source_file', 'size_bytes', 'reconciliation_source_file.size_bytes is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'sha256', 'text', 'reconciliation_source_file.sha256 is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'sha256', 'reconciliation_source_file.sha256 is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'storage_uri', 'text', 'reconciliation_source_file.storage_uri is text');
SELECT col_is_null('public', 'reconciliation_source_file', 'storage_uri', 'reconciliation_source_file.storage_uri is nullable');
SELECT col_type_is('public', 'reconciliation_source_file', 'worksheet_name', 'text', 'reconciliation_source_file.worksheet_name is text');
SELECT col_is_null('public', 'reconciliation_source_file', 'worksheet_name', 'reconciliation_source_file.worksheet_name is nullable');
SELECT col_type_is('public', 'reconciliation_source_file', 'header_row', 'integer', 'reconciliation_source_file.header_row is integer');
SELECT col_is_null('public', 'reconciliation_source_file', 'header_row', 'reconciliation_source_file.header_row is nullable');
SELECT col_type_is('public', 'reconciliation_source_file', 'transaction_start_row', 'integer', 'reconciliation_source_file.transaction_start_row is integer');
SELECT col_is_null('public', 'reconciliation_source_file', 'transaction_start_row', 'reconciliation_source_file.transaction_start_row is nullable');
SELECT col_type_is('public', 'reconciliation_source_file', 'excluded_row_numbers', 'jsonb', 'reconciliation_source_file.excluded_row_numbers is jsonb');
SELECT col_not_null('public', 'reconciliation_source_file', 'excluded_row_numbers', 'reconciliation_source_file.excluded_row_numbers is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'imported_row_count', 'integer', 'reconciliation_source_file.imported_row_count is integer');
SELECT col_is_null('public', 'reconciliation_source_file', 'imported_row_count', 'reconciliation_source_file.imported_row_count is nullable');
SELECT col_type_is('public', 'reconciliation_source_file', 'uploaded_at', 'timestamp with time zone', 'reconciliation_source_file.uploaded_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_source_file', 'uploaded_at', 'reconciliation_source_file.uploaded_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'created_at', 'timestamp with time zone', 'reconciliation_source_file.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_source_file', 'created_at', 'reconciliation_source_file.created_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'updated_at', 'timestamp with time zone', 'reconciliation_source_file.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_source_file', 'updated_at', 'reconciliation_source_file.updated_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'organization_id', 'uuid', 'reconciliation_source_file.organization_id is uuid');
SELECT col_is_null('public', 'reconciliation_source_file', 'organization_id', 'reconciliation_source_file.organization_id is nullable');
SELECT col_type_is('public', 'reconciliation_source_file', 'uploaded_by', 'text', 'reconciliation_source_file.uploaded_by is text');
SELECT col_is_null('public', 'reconciliation_source_file', 'uploaded_by', 'reconciliation_source_file.uploaded_by is nullable');
SELECT col_type_is('public', 'reconciliation_source_file', 'approval_status', 'text', 'reconciliation_source_file.approval_status is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'approval_status', 'reconciliation_source_file.approval_status is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file', 'ingestion_mode', 'text', 'reconciliation_source_file.ingestion_mode is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'ingestion_mode', 'reconciliation_source_file.ingestion_mode is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_source_file'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_source_file_approval_status_check => CHECK ((approval_status = ANY (ARRAY['NOT_SUBMITTED'::text, 'PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])))
reconciliation_source_file_ingestion_mode_check => CHECK ((ingestion_mode = ANY (ARRAY['DIRECT'::text, 'MAPPED'::text])))
reconciliation_source_file_job_id_source_system_key => UNIQUE (job_id, source_system)
reconciliation_source_file_size_bytes_check => CHECK ((size_bytes >= 0))
reconciliation_source_file_source_format_check => CHECK ((source_format = ANY (ARRAY['xlsx'::text, 'csv'::text])))
reconciliation_source_file_source_system_check => CHECK ((source_system = ANY (ARRAY['bank'::text, 'gl'::text])))$chk$,
  'reconciliation_source_file check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_source_file_content', ARRAY['source_file_id', 'content', 'byte_size', 'sha256', 'original_file_name', 'original_mime_type', 'captured_at', 'retention_expires_at', 'id', 'created_at']::name[], 'reconciliation_source_file_content has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_source_file_content', ARRAY['source_file_id']::name[], 'reconciliation_source_file_content primary key');
SELECT indexes_are('public', 'reconciliation_source_file_content', ARRAY['reconciliation_source_file_content_id_key', 'reconciliation_source_file_content_pkey', 'reconciliation_source_file_content_retention_idx', 'reconciliation_source_file_content_sha_idx']::name[], 'reconciliation_source_file_content has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_source_file_content', 'source_file_id', 'uuid', 'reconciliation_source_file_content.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'source_file_id', 'reconciliation_source_file_content.source_file_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file_content', 'content', 'bytea', 'reconciliation_source_file_content.content is bytea');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'content', 'reconciliation_source_file_content.content is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file_content', 'byte_size', 'bigint', 'reconciliation_source_file_content.byte_size is bigint');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'byte_size', 'reconciliation_source_file_content.byte_size is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file_content', 'sha256', 'text', 'reconciliation_source_file_content.sha256 is text');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'sha256', 'reconciliation_source_file_content.sha256 is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file_content', 'original_file_name', 'text', 'reconciliation_source_file_content.original_file_name is text');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'original_file_name', 'reconciliation_source_file_content.original_file_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file_content', 'original_mime_type', 'text', 'reconciliation_source_file_content.original_mime_type is text');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'original_mime_type', 'reconciliation_source_file_content.original_mime_type is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file_content', 'captured_at', 'timestamp with time zone', 'reconciliation_source_file_content.captured_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'captured_at', 'reconciliation_source_file_content.captured_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file_content', 'retention_expires_at', 'timestamp with time zone', 'reconciliation_source_file_content.retention_expires_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_source_file_content', 'retention_expires_at', 'reconciliation_source_file_content.retention_expires_at is nullable');
SELECT col_type_is('public', 'reconciliation_source_file_content', 'id', 'uuid', 'reconciliation_source_file_content.id is uuid');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'id', 'reconciliation_source_file_content.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_source_file_content', 'created_at', 'timestamp with time zone', 'reconciliation_source_file_content.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'created_at', 'reconciliation_source_file_content.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_source_file_content'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_source_file_content_byte_size_check => CHECK ((byte_size >= 0))
reconciliation_source_file_content_id_key => UNIQUE (id)
reconciliation_source_file_content_length_matches_check => CHECK ((octet_length(content) = byte_size))$chk$,
  'reconciliation_source_file_content check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_staged_transaction', ARRAY['id', 'raw_row_id', 'source_file_id', 'mapping_profile_version_id', 'status', 'normalized_fields_json', 'validation_summary_json', 'control_total_amount', 'created_at', 'ingestion_mode', 'promoted_at', 'promoted_by']::name[], 'reconciliation_staged_transaction has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_staged_transaction', ARRAY['id']::name[], 'reconciliation_staged_transaction primary key');
SELECT indexes_are('public', 'reconciliation_staged_transaction', ARRAY['reconciliation_staged_transaction_mapping_profile_version_idx', 'reconciliation_staged_transaction_pkey', 'reconciliation_staged_transaction_raw_row_key', 'reconciliation_staged_transaction_source_file_idx']::name[], 'reconciliation_staged_transaction has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'id', 'uuid', 'reconciliation_staged_transaction.id is uuid');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'id', 'reconciliation_staged_transaction.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'raw_row_id', 'uuid', 'reconciliation_staged_transaction.raw_row_id is uuid');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'raw_row_id', 'reconciliation_staged_transaction.raw_row_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'source_file_id', 'uuid', 'reconciliation_staged_transaction.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'source_file_id', 'reconciliation_staged_transaction.source_file_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'mapping_profile_version_id', 'uuid', 'reconciliation_staged_transaction.mapping_profile_version_id is uuid');
SELECT col_is_null('public', 'reconciliation_staged_transaction', 'mapping_profile_version_id', 'reconciliation_staged_transaction.mapping_profile_version_id is nullable');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'status', 'text', 'reconciliation_staged_transaction.status is text');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'status', 'reconciliation_staged_transaction.status is NOT NULL');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'normalized_fields_json', 'jsonb', 'reconciliation_staged_transaction.normalized_fields_json is jsonb');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'normalized_fields_json', 'reconciliation_staged_transaction.normalized_fields_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'validation_summary_json', 'jsonb', 'reconciliation_staged_transaction.validation_summary_json is jsonb');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'validation_summary_json', 'reconciliation_staged_transaction.validation_summary_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'control_total_amount', 'numeric(19,4)', 'reconciliation_staged_transaction.control_total_amount is numeric(19,4)');
SELECT col_is_null('public', 'reconciliation_staged_transaction', 'control_total_amount', 'reconciliation_staged_transaction.control_total_amount is nullable');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'created_at', 'timestamp with time zone', 'reconciliation_staged_transaction.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'created_at', 'reconciliation_staged_transaction.created_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'ingestion_mode', 'text', 'reconciliation_staged_transaction.ingestion_mode is text');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'ingestion_mode', 'reconciliation_staged_transaction.ingestion_mode is NOT NULL');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'promoted_at', 'timestamp with time zone', 'reconciliation_staged_transaction.promoted_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_staged_transaction', 'promoted_at', 'reconciliation_staged_transaction.promoted_at is nullable');
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'promoted_by', 'text', 'reconciliation_staged_transaction.promoted_by is text');
SELECT col_is_null('public', 'reconciliation_staged_transaction', 'promoted_by', 'reconciliation_staged_transaction.promoted_by is nullable');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_staged_transaction'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_staged_transaction_ingestion_mode_check => CHECK ((ingestion_mode = ANY (ARRAY['DIRECT'::text, 'MAPPED'::text])))
reconciliation_staged_transaction_mapping_pairing_check => CHECK ((((ingestion_mode = 'MAPPED'::text) AND (mapping_profile_version_id IS NOT NULL)) OR ((ingestion_mode = 'DIRECT'::text) AND (mapping_profile_version_id IS NULL))))
reconciliation_staged_transaction_promotion_audit_check => CHECK (((status = 'PROMOTED'::text) = (promoted_at IS NOT NULL)))
reconciliation_staged_transaction_raw_row_key => UNIQUE (raw_row_id)
reconciliation_staged_transaction_status_check => CHECK ((status = ANY (ARRAY['PENDING_VALIDATION'::text, 'VALID'::text, 'INVALID'::text, 'PROMOTED'::text])))$chk$,
  'reconciliation_staged_transaction check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_template_definition', ARRAY['id', 'template_type', 'version', 'headers_json', 'instructions', 'status', 'created_at']::name[], 'reconciliation_template_definition has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_template_definition', ARRAY['id']::name[], 'reconciliation_template_definition primary key');
SELECT indexes_are('public', 'reconciliation_template_definition', ARRAY['reconciliation_template_definition_active_idx', 'reconciliation_template_definition_pkey', 'reconciliation_template_definition_type_version_key']::name[], 'reconciliation_template_definition has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_template_definition', 'id', 'uuid', 'reconciliation_template_definition.id is uuid');
SELECT col_not_null('public', 'reconciliation_template_definition', 'id', 'reconciliation_template_definition.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_template_definition', 'template_type', 'text', 'reconciliation_template_definition.template_type is text');
SELECT col_not_null('public', 'reconciliation_template_definition', 'template_type', 'reconciliation_template_definition.template_type is NOT NULL');
SELECT col_type_is('public', 'reconciliation_template_definition', 'version', 'integer', 'reconciliation_template_definition.version is integer');
SELECT col_not_null('public', 'reconciliation_template_definition', 'version', 'reconciliation_template_definition.version is NOT NULL');
SELECT col_type_is('public', 'reconciliation_template_definition', 'headers_json', 'jsonb', 'reconciliation_template_definition.headers_json is jsonb');
SELECT col_not_null('public', 'reconciliation_template_definition', 'headers_json', 'reconciliation_template_definition.headers_json is NOT NULL');
SELECT col_type_is('public', 'reconciliation_template_definition', 'instructions', 'text', 'reconciliation_template_definition.instructions is text');
SELECT col_is_null('public', 'reconciliation_template_definition', 'instructions', 'reconciliation_template_definition.instructions is nullable');
SELECT col_type_is('public', 'reconciliation_template_definition', 'status', 'text', 'reconciliation_template_definition.status is text');
SELECT col_not_null('public', 'reconciliation_template_definition', 'status', 'reconciliation_template_definition.status is NOT NULL');
SELECT col_type_is('public', 'reconciliation_template_definition', 'created_at', 'timestamp with time zone', 'reconciliation_template_definition.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_template_definition', 'created_at', 'reconciliation_template_definition.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_template_definition'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_template_definition_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))
reconciliation_template_definition_template_type_check => CHECK ((template_type = ANY (ARRAY['bank'::text, 'gl'::text])))
reconciliation_template_definition_type_version_key => UNIQUE (template_type, version)
reconciliation_template_definition_version_check => CHECK ((version > 0))$chk$,
  'reconciliation_template_definition check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_user', ARRAY['user_name', 'first_name', 'last_name', 'last_changed', 'id', 'created_at', 'organization_id', 'role', 'password_hash']::name[], 'reconciliation_user has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_user', ARRAY['user_name']::name[], 'reconciliation_user primary key');
SELECT indexes_are('public', 'reconciliation_user', ARRAY['reconciliation_user_id_key', 'reconciliation_user_pkey']::name[], 'reconciliation_user has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_user', 'user_name', 'text', 'reconciliation_user.user_name is text');
SELECT col_not_null('public', 'reconciliation_user', 'user_name', 'reconciliation_user.user_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_user', 'first_name', 'text', 'reconciliation_user.first_name is text');
SELECT col_not_null('public', 'reconciliation_user', 'first_name', 'reconciliation_user.first_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_user', 'last_name', 'text', 'reconciliation_user.last_name is text');
SELECT col_not_null('public', 'reconciliation_user', 'last_name', 'reconciliation_user.last_name is NOT NULL');
SELECT col_type_is('public', 'reconciliation_user', 'last_changed', 'timestamp with time zone', 'reconciliation_user.last_changed is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_user', 'last_changed', 'reconciliation_user.last_changed is NOT NULL');
SELECT col_type_is('public', 'reconciliation_user', 'id', 'uuid', 'reconciliation_user.id is uuid');
SELECT col_not_null('public', 'reconciliation_user', 'id', 'reconciliation_user.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_user', 'created_at', 'timestamp with time zone', 'reconciliation_user.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_user', 'created_at', 'reconciliation_user.created_at is NOT NULL');
SELECT col_type_is('public', 'reconciliation_user', 'organization_id', 'uuid', 'reconciliation_user.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_user', 'organization_id', 'reconciliation_user.organization_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_user', 'role', 'text', 'reconciliation_user.role is text');
SELECT col_not_null('public', 'reconciliation_user', 'role', 'reconciliation_user.role is NOT NULL');
SELECT col_type_is('public', 'reconciliation_user', 'password_hash', 'text', 'reconciliation_user.password_hash is text');
SELECT col_not_null('public', 'reconciliation_user', 'password_hash', 'reconciliation_user.password_hash is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_user'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_user_id_key => UNIQUE (id)
reconciliation_user_role_check => CHECK ((role = ANY (ARRAY['developer'::text, 'financial-analyst'::text, 'admin'::text, 'superuser'::text])))$chk$,
  'reconciliation_user check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_validation_result', ARRAY['id', 'staged_transaction_id', 'source_file_id', 'rule_version_id', 'severity', 'passed', 'message', 'created_at']::name[], 'reconciliation_validation_result has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_validation_result', ARRAY['id']::name[], 'reconciliation_validation_result primary key');
SELECT indexes_are('public', 'reconciliation_validation_result', ARRAY['reconciliation_validation_result_pkey', 'reconciliation_validation_result_severity_idx', 'reconciliation_validation_result_source_file_idx', 'reconciliation_validation_result_staged_transaction_idx']::name[], 'reconciliation_validation_result has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_validation_result', 'id', 'uuid', 'reconciliation_validation_result.id is uuid');
SELECT col_not_null('public', 'reconciliation_validation_result', 'id', 'reconciliation_validation_result.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_result', 'staged_transaction_id', 'uuid', 'reconciliation_validation_result.staged_transaction_id is uuid');
SELECT col_is_null('public', 'reconciliation_validation_result', 'staged_transaction_id', 'reconciliation_validation_result.staged_transaction_id is nullable');
SELECT col_type_is('public', 'reconciliation_validation_result', 'source_file_id', 'uuid', 'reconciliation_validation_result.source_file_id is uuid');
SELECT col_is_null('public', 'reconciliation_validation_result', 'source_file_id', 'reconciliation_validation_result.source_file_id is nullable');
SELECT col_type_is('public', 'reconciliation_validation_result', 'rule_version_id', 'uuid', 'reconciliation_validation_result.rule_version_id is uuid');
SELECT col_not_null('public', 'reconciliation_validation_result', 'rule_version_id', 'reconciliation_validation_result.rule_version_id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_result', 'severity', 'text', 'reconciliation_validation_result.severity is text');
SELECT col_not_null('public', 'reconciliation_validation_result', 'severity', 'reconciliation_validation_result.severity is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_result', 'passed', 'boolean', 'reconciliation_validation_result.passed is boolean');
SELECT col_not_null('public', 'reconciliation_validation_result', 'passed', 'reconciliation_validation_result.passed is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_result', 'message', 'text', 'reconciliation_validation_result.message is text');
SELECT col_not_null('public', 'reconciliation_validation_result', 'message', 'reconciliation_validation_result.message is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_result', 'created_at', 'timestamp with time zone', 'reconciliation_validation_result.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_validation_result', 'created_at', 'reconciliation_validation_result.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_validation_result'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_validation_result_severity_check => CHECK ((severity = ANY (ARRAY['FATAL'::text, 'WARNING'::text, 'INFO'::text])))
reconciliation_validation_result_target_check => CHECK (((staged_transaction_id IS NOT NULL) OR (source_file_id IS NOT NULL)))$chk$,
  'reconciliation_validation_result check/unique/exclusion constraints'
);
SELECT columns_are('public', 'reconciliation_validation_rule_version', ARRAY['id', 'rule_code', 'version_number', 'scope', 'severity', 'description', 'status', 'created_at']::name[], 'reconciliation_validation_rule_version has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_validation_rule_version', ARRAY['id']::name[], 'reconciliation_validation_rule_version primary key');
SELECT indexes_are('public', 'reconciliation_validation_rule_version', ARRAY['reconciliation_validation_rule_version_key', 'reconciliation_validation_rule_version_pkey']::name[], 'reconciliation_validation_rule_version has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'id', 'uuid', 'reconciliation_validation_rule_version.id is uuid');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'id', 'reconciliation_validation_rule_version.id is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'rule_code', 'text', 'reconciliation_validation_rule_version.rule_code is text');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'rule_code', 'reconciliation_validation_rule_version.rule_code is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'version_number', 'integer', 'reconciliation_validation_rule_version.version_number is integer');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'version_number', 'reconciliation_validation_rule_version.version_number is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'scope', 'text', 'reconciliation_validation_rule_version.scope is text');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'scope', 'reconciliation_validation_rule_version.scope is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'severity', 'text', 'reconciliation_validation_rule_version.severity is text');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'severity', 'reconciliation_validation_rule_version.severity is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'description', 'text', 'reconciliation_validation_rule_version.description is text');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'description', 'reconciliation_validation_rule_version.description is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'status', 'text', 'reconciliation_validation_rule_version.status is text');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'status', 'reconciliation_validation_rule_version.status is NOT NULL');
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'created_at', 'timestamp with time zone', 'reconciliation_validation_rule_version.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'created_at', 'reconciliation_validation_rule_version.created_at is NOT NULL');
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_validation_rule_version'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_validation_rule_version_key => UNIQUE (rule_code, version_number)
reconciliation_validation_rule_version_scope_check => CHECK ((scope = ANY (ARRAY['FILE'::text, 'SCHEMA'::text, 'ROW'::text, 'CROSS_ROW'::text, 'PERIOD'::text, 'ACCOUNTING'::text])))
reconciliation_validation_rule_version_severity_check => CHECK ((severity = ANY (ARRAY['FATAL'::text, 'WARNING'::text, 'INFO'::text])))
reconciliation_validation_rule_version_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))
reconciliation_validation_rule_version_version_number_check => CHECK ((version_number > 0))$chk$,
  'reconciliation_validation_rule_version check/unique/exclusion constraints'
);
SELECT fk_ok('public', 'reconciliation_approval_history', ARRAY['actor']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_approval_history', ARRAY['approval_id']::name[], 'public', 'reconciliation_import_approval', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_audit_event', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_canonical_row', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_canonical_row', ARRAY['raw_row_id']::name[], 'public', 'reconciliation_raw_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_canonical_row', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_canonical_row', ARRAY['staged_transaction_id']::name[], 'public', 'reconciliation_staged_transaction', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_exception', ARRAY['canonical_row_id']::name[], 'public', 'reconciliation_canonical_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_exception', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_export', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_import_approval', ARRAY['approved_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_import_approval', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_import_approval', ARRAY['uploaded_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_import_batch', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_import_batch', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_job_summary', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_mapping_profile', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_mapping_profile_version', ARRAY['created_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_mapping_profile_version', ARRAY['profile_id']::name[], 'public', 'reconciliation_mapping_profile', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_group', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_result', ARRAY['bank_transaction_id']::name[], 'public', 'reconciliation_canonical_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_result', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_result', ARRAY['gl_transaction_id']::name[], 'public', 'reconciliation_canonical_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_raw_row', ARRAY['import_batch_id']::name[], 'public', 'reconciliation_import_batch', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_raw_row', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_raw_row', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_review_decision', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_review_observation', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_rule_result', ARRAY['candidate_transaction_id']::name[], 'public', 'reconciliation_canonical_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_rule_result', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_source_file', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_source_file', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_source_file', ARRAY['uploaded_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_source_file_content', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_staged_transaction', ARRAY['mapping_profile_version_id']::name[], 'public', 'reconciliation_mapping_profile_version', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_staged_transaction', ARRAY['promoted_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_staged_transaction', ARRAY['raw_row_id']::name[], 'public', 'reconciliation_raw_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_staged_transaction', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_user', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_validation_result', ARRAY['rule_version_id']::name[], 'public', 'reconciliation_validation_rule_version', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_validation_result', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_validation_result', ARRAY['staged_transaction_id']::name[], 'public', 'reconciliation_staged_transaction', ARRAY['id']::name[]);

SELECT * FROM finish();
