-- =============================================================================
-- DEV AND STAGE ENVIRONMENTS ONLY — DO NOT RUN IN PRODUCTION.
--
-- Inserts a representative baseline dataset for development and testing.
-- Idempotent: safe to run multiple times (ON CONFLICT DO NOTHING).
--
-- Contains:
--   Job A — FINALIZED: 2 bank + 2 QBO transactions, 1 match, 1 exception
--   Job B — FAILED:    file registration only, simulates pipeline failure
--
-- How to run:
--   bash scripts/db/run-seed.sh dev
--   npm run db:seed:dev
-- =============================================================================

-- ─── Job A — FINALIZED ───────────────────────────────────────────────────────

INSERT INTO reconciliation_job (
  id, correlation_id, account_identifier, period_label,
  reconciliation_frequency, current_state, input_fingerprint,
  schema_version, rulepack_version, record_version, retry_count,
  created_at, updated_at, started_at, completed_at
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'seed-corr-job-a', 'ACCT-1001', 'April 2026',
  'Monthly', 'FINALIZED', 'seed-fingerprint-a',
  1, '1.0.0', 1, 0,
  '2026-04-01 09:00:00+00', '2026-04-01 09:05:00+00',
  '2026-04-01 09:00:00+00', '2026-04-01 09:05:00+00'
) ON CONFLICT DO NOTHING;

-- Source files
INSERT INTO reconciliation_source_file (
  id, job_id, source_system, source_format, file_name, mime_type,
  size_bytes, sha256, worksheet_name, header_row, transaction_start_row,
  excluded_row_numbers, imported_row_count, uploaded_at, created_at, updated_at
) VALUES
(
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'bank', 'xlsx', 'bank-april-2026.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  20480, 'seed-sha256-bank-a', 'Transactions', 1, 2,
  '[]', 2, '2026-04-01 09:00:00+00', '2026-04-01 09:00:00+00', '2026-04-01 09:00:00+00'
),
(
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000001',
  'qbo', 'xlsx', 'qbo-april-2026.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  18432, 'seed-sha256-qbo-a', 'Sheet1', 1, 2,
  '[]', 2, '2026-04-01 09:00:00+00', '2026-04-01 09:00:00+00', '2026-04-01 09:00:00+00'
) ON CONFLICT DO NOTHING;

-- Import batches
INSERT INTO reconciliation_import_batch (
  id, job_id, source_file_id, batch_number, state,
  row_start_number, row_end_number, row_count, started_at, completed_at, created_at
) VALUES
(
  'a0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  1, 'IMPORTED', 2, 3, 2,
  '2026-04-01 09:00:30+00', '2026-04-01 09:00:45+00', '2026-04-01 09:00:30+00'
),
(
  'a0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000003',
  1, 'IMPORTED', 2, 3, 2,
  '2026-04-01 09:00:30+00', '2026-04-01 09:00:45+00', '2026-04-01 09:00:30+00'
) ON CONFLICT DO NOTHING;

-- Raw rows — bank
INSERT INTO reconciliation_raw_row (
  id, job_id, source_file_id, import_batch_id, source_system, line_number,
  row_hash, raw_values_json, description_raw, amount_raw, created_at
) VALUES
(
  'a0000000-0000-0000-0000-000000000006',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000004',
  'bank', 2, 'seed-hash-bank-1',
  '{"date":"04/03/2026","description":"ACME SOFTWARE","amount":"-250.00"}',
  'ACME SOFTWARE', '-250.00', '2026-04-01 09:00:45+00'
),
(
  'a0000000-0000-0000-0000-000000000007',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000004',
  'bank', 3, 'seed-hash-bank-2',
  '{"date":"04/10/2026","description":"OFFICE DEPOT","amount":"-89.47"}',
  'OFFICE DEPOT', '-89.47', '2026-04-01 09:00:45+00'
) ON CONFLICT DO NOTHING;

-- Raw rows — qbo
INSERT INTO reconciliation_raw_row (
  id, job_id, source_file_id, import_batch_id, source_system, line_number,
  row_hash, raw_values_json, description_raw, amount_raw, created_at
) VALUES
(
  'a0000000-0000-0000-0000-000000000008',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000005',
  'qbo', 2, 'seed-hash-qbo-1',
  '{"date":"04/03/2026","description":"Acme Software Inc","amount":"250.00"}',
  'Acme Software Inc', '250.00', '2026-04-01 09:00:45+00'
),
(
  'a0000000-0000-0000-0000-000000000009',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000005',
  'qbo', 3, 'seed-hash-qbo-2',
  '{"date":"04/15/2026","description":"MISSING FROM BANK","amount":"500.00"}',
  'MISSING FROM BANK', '500.00', '2026-04-01 09:00:45+00'
) ON CONFLICT DO NOTHING;

-- Canonical rows — bank
INSERT INTO reconciliation_canonical_row (
  id, job_id, raw_row_id, source_file_id, source_system,
  spreadsheet_file_name, worksheet_name, line_number,
  transaction_date, amount, description,
  normalized_comparison_text, normalized_comparison_tokens,
  raw_source_values_json, data_quality_issues_json,
  is_excluded, is_zero_amount, context_fingerprint, created_at
) VALUES
(
  'a0000000-0000-0000-0000-000000000010',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000006',
  'a0000000-0000-0000-0000-000000000002',
  'bank', 'bank-april-2026.xlsx', 'Transactions', 2,
  '2026-04-03', -250.00, 'ACME SOFTWARE',
  'acme software', ARRAY['acme','software'],
  '{"date":"04/03/2026","description":"ACME SOFTWARE","amount":"-250.00"}',
  '[]', false, false, 'seed-ctx-bank-1', '2026-04-01 09:01:00+00'
),
(
  'a0000000-0000-0000-0000-000000000011',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000007',
  'a0000000-0000-0000-0000-000000000002',
  'bank', 'bank-april-2026.xlsx', 'Transactions', 3,
  '2026-04-10', -89.47, 'OFFICE DEPOT',
  'office depot', ARRAY['office','depot'],
  '{"date":"04/10/2026","description":"OFFICE DEPOT","amount":"-89.47"}',
  '[]', false, false, 'seed-ctx-bank-2', '2026-04-01 09:01:00+00'
) ON CONFLICT DO NOTHING;

-- Canonical rows — qbo
INSERT INTO reconciliation_canonical_row (
  id, job_id, raw_row_id, source_file_id, source_system,
  spreadsheet_file_name, worksheet_name, line_number,
  transaction_date, amount, description,
  normalized_comparison_text, normalized_comparison_tokens,
  raw_source_values_json, data_quality_issues_json,
  is_excluded, is_zero_amount, context_fingerprint, created_at
) VALUES
(
  'a0000000-0000-0000-0000-000000000012',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000008',
  'a0000000-0000-0000-0000-000000000003',
  'qbo', 'qbo-april-2026.xlsx', 'Sheet1', 2,
  '2026-04-03', 250.00, 'Acme Software Inc',
  'acme software inc', ARRAY['acme','software','inc'],
  '{"date":"04/03/2026","description":"Acme Software Inc","amount":"250.00"}',
  '[]', false, false, 'seed-ctx-qbo-1', '2026-04-01 09:01:00+00'
),
(
  'a0000000-0000-0000-0000-000000000013',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000009',
  'a0000000-0000-0000-0000-000000000003',
  'qbo', 'qbo-april-2026.xlsx', 'Sheet1', 3,
  '2026-04-15', 500.00, 'MISSING FROM BANK',
  'missing from bank', ARRAY['missing','from','bank'],
  '{"date":"04/15/2026","description":"MISSING FROM BANK","amount":"500.00"}',
  '[]', false, false, 'seed-ctx-qbo-2', '2026-04-01 09:01:00+00'
) ON CONFLICT DO NOTHING;

-- Match group
INSERT INTO reconciliation_match_group (
  id, job_id, disposition, confidence, category,
  bank_transaction_ids, qbo_transaction_ids,
  bank_members_json, qbo_members_json,
  total_amount, date_difference_days,
  score, rule_id, rule_name, reason, evidence_json, created_at
) VALUES (
  'a0000000-0000-0000-0000-000000000014',
  'a0000000-0000-0000-0000-000000000001',
  'MATCHED', 'HIGH', 'ExactMatch',
  ARRAY['a0000000-0000-0000-0000-000000000010']::UUID[],
  ARRAY['a0000000-0000-0000-0000-000000000012']::UUID[],
  '[{"id":"a0000000-0000-0000-0000-000000000010","amount":-250.00}]',
  '[{"id":"a0000000-0000-0000-0000-000000000012","amount":250.00}]',
  250.00, 0, 1.0, 'RULE_EXACT_AMOUNT_DATE', 'Exact Amount + Date Match',
  'Amount and date match exactly', '[]', '2026-04-01 09:02:00+00'
) ON CONFLICT DO NOTHING;

-- Match result
INSERT INTO reconciliation_match_result (
  id, job_id, result_bucket,
  bank_transaction_id, qbo_transaction_id,
  disposition, confidence, rule_id, rule_name, reason,
  score, amount_difference, date_difference_days, evidence_json, created_at
) VALUES (
  'a0000000-0000-0000-0000-000000000015',
  'a0000000-0000-0000-0000-000000000001',
  'MATCH',
  'a0000000-0000-0000-0000-000000000010',
  'a0000000-0000-0000-0000-000000000012',
  'MATCHED', 'HIGH', 'RULE_EXACT_AMOUNT_DATE', 'Exact Amount + Date Match',
  'Amount and date match exactly',
  1.0, 0.00, 0, '[]', '2026-04-01 09:02:00+00'
) ON CONFLICT DO NOTHING;

-- Rule result
INSERT INTO reconciliation_rule_result (
  id, job_id, target_kind, target_id,
  rule_id, rule_name, passed, score, reason, evidence_json, evaluation_order, created_at
) VALUES (
  'a0000000-0000-0000-0000-000000000016',
  'a0000000-0000-0000-0000-000000000001',
  'MATCH_RESULT', 'a0000000-0000-0000-0000-000000000015',
  'RULE_EXACT_AMOUNT_DATE', 'Exact Amount + Date Match',
  true, 1.0, 'Amount $250.00 and date 2026-04-03 match exactly',
  '[]', 1, '2026-04-01 09:02:00+00'
) ON CONFLICT DO NOTHING;

-- Exception — qbo item with no bank match
INSERT INTO reconciliation_exception (
  id, job_id, canonical_row_id, category, severity, source_system,
  spreadsheet_file_name, line_number, transaction_date, amount,
  error_message, recommended_next_actions,
  normalized_comparison_tokens, related_transaction_ids, created_at
) VALUES (
  'a0000000-0000-0000-0000-000000000017',
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000013',
  'MISSING_FROM_BANK', 'HIGH', 'qbo',
  'qbo-april-2026.xlsx', 3, '2026-04-15', 500.00,
  'No matching bank transaction found for QBO entry of $500.00',
  ARRAY['Verify bank statement for April 15', 'Contact bank if transaction is missing'],
  ARRAY['missing','from','bank'], ARRAY[]::UUID[], '2026-04-01 09:02:00+00'
) ON CONFLICT DO NOTHING;

-- Review observation
INSERT INTO reconciliation_review_observation (
  id, job_id, category, title, message, severity,
  related_transaction_ids, created_at, persisted_at
) VALUES (
  'a0000000-0000-0000-0000-000000000018',
  'a0000000-0000-0000-0000-000000000001',
  'UNMATCHED_EXPOSURE', 'Unmatched QBO Items Require Attention',
  '1 QBO transaction totalling $500.00 has no corresponding bank entry.',
  'HIGH', ARRAY[]::UUID[],
  '2026-04-01 09:02:00+00', '2026-04-01 09:02:00+00'
) ON CONFLICT DO NOTHING;

-- Job summary
INSERT INTO reconciliation_job_summary (
  job_id, total_records_reviewed, bank_records, qbo_records,
  exact_matches, probable_matches, unmatched_items, duplicates,
  bank_duplicates, qbo_duplicates, date_variances, timing_differences,
  data_quality_issues, amount_mismatches, missing_from_bank, missing_from_qbo,
  unmatched_bank_net_amount, unmatched_qbo_net_amount,
  clean_matched_amount, unresolved_exposure,
  counts_by_category_json, amount_by_category_json, charts_json,
  created_at, updated_at
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  4, 2, 2, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  0.00, 500.00, 250.00, 500.00,
  '{"MISSING_FROM_BANK":1}',
  '{"MISSING_FROM_BANK":500.00}',
  '{}',
  '2026-04-01 09:02:00+00', '2026-04-01 09:02:00+00'
) ON CONFLICT DO NOTHING;

-- Export
INSERT INTO reconciliation_export (
  id, job_id, export_type, state, file_name,
  checksum_sha256, byte_size, tab_names_json, generated_at, created_at
) VALUES (
  'a0000000-0000-0000-0000-000000000019',
  'a0000000-0000-0000-0000-000000000001',
  'workbook', 'READY', 'reconciliation-report-april-2026.xlsx',
  'seed-checksum-export-a', 51200,
  '["Summary","Exact Matches","Exceptions"]',
  '2026-04-01 09:04:00+00', '2026-04-01 09:04:00+00'
) ON CONFLICT DO NOTHING;

-- Audit events
INSERT INTO reconciliation_audit_event (
  job_id, event_type, from_state, to_state, actor, details_json, created_at
) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', NULL,              'CREATED',               'system', '{}', '2026-04-01 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'CREATED',          'FILE_REGISTERED',       'system', '{}', '2026-04-01 09:00:05+00'),
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'FILE_REGISTERED',  'IMPORTING',             'system', '{}', '2026-04-01 09:00:10+00'),
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'IMPORTING',        'IMPORTED',              'system', '{}', '2026-04-01 09:00:50+00'),
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'IMPORTED',         'NORMALIZING',           'system', '{}', '2026-04-01 09:01:00+00'),
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'NORMALIZING',      'NORMALIZED',            'system', '{}', '2026-04-01 09:01:30+00'),
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'NORMALIZED',       'MATCHING',              'system', '{}', '2026-04-01 09:01:30+00'),
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'MATCHING',         'MATCHED',               'system', '{}', '2026-04-01 09:02:00+00'),
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'MATCHED',          'EXCEPTIONS_IDENTIFIED', 'system', '{}', '2026-04-01 09:02:00+00'),
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'EXCEPTIONS_IDENTIFIED', 'REVIEW_READY',     'system', '{}', '2026-04-01 09:03:00+00'),
  ('a0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'REVIEW_READY',     'FINALIZED',             'rray',   '{}', '2026-04-01 09:05:00+00');

-- ─── Job B — FAILED ──────────────────────────────────────────────────────────

INSERT INTO reconciliation_job (
  id, correlation_id, account_identifier, period_label,
  reconciliation_frequency, current_state, input_fingerprint,
  schema_version, rulepack_version, record_version, retry_count,
  failure_code, failure_message,
  created_at, updated_at, started_at
) VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'seed-corr-job-b', 'ACCT-1001', 'March 2026',
  'Monthly', 'FAILED', 'seed-fingerprint-b',
  1, '1.0.0', 1, 0,
  'IMPORT_PARSE_ERROR', 'Column header "Amount" not found in row 1.',
  '2026-03-15 14:00:00+00', '2026-03-15 14:00:30+00', '2026-03-15 14:00:00+00'
) ON CONFLICT DO NOTHING;

INSERT INTO reconciliation_source_file (
  id, job_id, source_system, source_format, file_name, mime_type,
  size_bytes, sha256, header_row, transaction_start_row,
  excluded_row_numbers, uploaded_at, created_at, updated_at
) VALUES (
  'b0000000-0000-0000-0000-000000000002',
  'b0000000-0000-0000-0000-000000000001',
  'bank', 'xlsx', 'bank-march-2026-corrupt.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  8192, 'seed-sha256-corrupt-b', 1, 2,
  '[]', '2026-03-15 14:00:00+00', '2026-03-15 14:00:00+00', '2026-03-15 14:00:00+00'
) ON CONFLICT DO NOTHING;

INSERT INTO reconciliation_audit_event (
  job_id, event_type, from_state, to_state, actor, details_json, created_at
) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', NULL,             'CREATED',         'system', '{}',                                          '2026-03-15 14:00:00+00'),
  ('b0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'CREATED',        'FILE_REGISTERED', 'system', '{}',                                          '2026-03-15 14:00:05+00'),
  ('b0000000-0000-0000-0000-000000000001', 'STATE_TRANSITION', 'FILE_REGISTERED','FAILED',          'system', '{"code":"IMPORT_PARSE_ERROR","row":1}',        '2026-03-15 14:00:30+00');
