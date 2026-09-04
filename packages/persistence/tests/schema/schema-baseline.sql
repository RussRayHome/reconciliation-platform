-- GENERATED FILE — do not edit by hand.
--
-- pgTap baseline for the Liquibase-managed schema. Regenerate after an intentional schema
-- change with:
--
--   npm run test:postgres:update-baseline
--
-- and review the diff: every line that moves is a schema change someone is shipping.
SELECT plan(2425);

SELECT tables_are('public', ARRAY['canonical_record', 'dashboard_secret_change_log', 'dashboard_secret_finding_snapshot', 'dashboard_secret_scan_run', 'databasechangelog', 'databasechangeloglock', 'import_file', 'import_file_content', 'import_job', 'mapping_rule_version', 'reconciliation_account', 'reconciliation_approval_history', 'reconciliation_approval_request', 'reconciliation_approval_request_history', 'reconciliation_audit_event', 'reconciliation_canonical_row', 'reconciliation_exception', 'reconciliation_export', 'reconciliation_import_approval', 'reconciliation_import_batch', 'reconciliation_job', 'reconciliation_job_summary', 'reconciliation_login_event', 'reconciliation_mapping_profile', 'reconciliation_mapping_profile_version', 'reconciliation_match_group', 'reconciliation_match_result', 'reconciliation_matching_config_version', 'reconciliation_open_item', 'reconciliation_open_item_event', 'reconciliation_organization', 'reconciliation_payee_alias', 'reconciliation_period_rollforward', 'reconciliation_raw_row', 'reconciliation_review_decision', 'reconciliation_review_observation', 'reconciliation_rule_result', 'reconciliation_run', 'reconciliation_run_account', 'reconciliation_run_event', 'reconciliation_source_file', 'reconciliation_source_file_content', 'reconciliation_staged_transaction', 'reconciliation_template_definition', 'reconciliation_user', 'reconciliation_validation_result', 'reconciliation_validation_rule_version', 'run_source_file', 'validation_issue', 'validation_rule_version']::name[], 'public schema contains exactly the expected tables');
SELECT columns_are('public', 'canonical_record', ARRAY['id', 'organization_id', 'import_job_id', 'import_file_id', 'reconciliation_run_id', 'source_type', 'record_id', 'source_line_number', 'account', 'txn_date', 'currency_code', 'signed_amount', 'direction', 'magnitude', 'excluded', 'exclusion_reason', 'description', 'raw', 'created_at', 'reference_ids', 'counterparty_type', 'counterparty_id', 'counterparty_name', 'value_date', 'effective_date', 'evidence']::name[], 'canonical_record has exactly the expected columns');
SELECT col_is_pk('public', 'canonical_record', ARRAY['id']::name[], 'canonical_record primary key');
SELECT indexes_are('public', 'canonical_record', ARRAY['canonical_record_counterparty_id_idx', 'normalized_record_account_txn_date_idx', 'normalized_record_organization_idx', 'normalized_record_pkey', 'normalized_record_reconciliation_run_idx', 'normalized_record_signed_amount_idx']::name[], 'canonical_record has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'canonical_record' AND relnamespace = 'public'::regnamespace),
  true,
  'canonical_record has row-level security enabled'
);
SELECT col_type_is('public', 'canonical_record', 'id', 'bigint', 'canonical_record.id is bigint');
SELECT col_not_null('public', 'canonical_record', 'id', 'canonical_record.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'id'),
  $dflt$nextval('normalized_record_id_seq'::regclass)$dflt$,
  'canonical_record.id default'
);
SELECT col_type_is('public', 'canonical_record', 'organization_id', 'uuid', 'canonical_record.organization_id is uuid');
SELECT col_not_null('public', 'canonical_record', 'organization_id', 'canonical_record.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'organization_id'),
  NULL,
  'canonical_record.organization_id default'
);
SELECT col_type_is('public', 'canonical_record', 'import_job_id', 'uuid', 'canonical_record.import_job_id is uuid');
SELECT col_not_null('public', 'canonical_record', 'import_job_id', 'canonical_record.import_job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'import_job_id'),
  NULL,
  'canonical_record.import_job_id default'
);
SELECT col_type_is('public', 'canonical_record', 'import_file_id', 'uuid', 'canonical_record.import_file_id is uuid');
SELECT col_not_null('public', 'canonical_record', 'import_file_id', 'canonical_record.import_file_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'import_file_id'),
  NULL,
  'canonical_record.import_file_id default'
);
SELECT col_type_is('public', 'canonical_record', 'reconciliation_run_id', 'uuid', 'canonical_record.reconciliation_run_id is uuid');
SELECT col_not_null('public', 'canonical_record', 'reconciliation_run_id', 'canonical_record.reconciliation_run_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'reconciliation_run_id'),
  NULL,
  'canonical_record.reconciliation_run_id default'
);
SELECT col_type_is('public', 'canonical_record', 'source_type', 'text', 'canonical_record.source_type is text');
SELECT col_not_null('public', 'canonical_record', 'source_type', 'canonical_record.source_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'source_type'),
  NULL,
  'canonical_record.source_type default'
);
SELECT col_type_is('public', 'canonical_record', 'record_id', 'text', 'canonical_record.record_id is text');
SELECT col_not_null('public', 'canonical_record', 'record_id', 'canonical_record.record_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'record_id'),
  NULL,
  'canonical_record.record_id default'
);
SELECT col_type_is('public', 'canonical_record', 'source_line_number', 'integer', 'canonical_record.source_line_number is integer');
SELECT col_not_null('public', 'canonical_record', 'source_line_number', 'canonical_record.source_line_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'source_line_number'),
  NULL,
  'canonical_record.source_line_number default'
);
SELECT col_type_is('public', 'canonical_record', 'account', 'text', 'canonical_record.account is text');
SELECT col_not_null('public', 'canonical_record', 'account', 'canonical_record.account is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'account'),
  NULL,
  'canonical_record.account default'
);
SELECT col_type_is('public', 'canonical_record', 'txn_date', 'date', 'canonical_record.txn_date is date');
SELECT col_not_null('public', 'canonical_record', 'txn_date', 'canonical_record.txn_date is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'txn_date'),
  NULL,
  'canonical_record.txn_date default'
);
SELECT col_type_is('public', 'canonical_record', 'currency_code', 'character(3)', 'canonical_record.currency_code is character(3)');
SELECT col_not_null('public', 'canonical_record', 'currency_code', 'canonical_record.currency_code is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'currency_code'),
  NULL,
  'canonical_record.currency_code default'
);
SELECT col_type_is('public', 'canonical_record', 'signed_amount', 'numeric(20,4)', 'canonical_record.signed_amount is numeric(20,4)');
SELECT col_not_null('public', 'canonical_record', 'signed_amount', 'canonical_record.signed_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'signed_amount'),
  NULL,
  'canonical_record.signed_amount default'
);
SELECT col_type_is('public', 'canonical_record', 'direction', 'text', 'canonical_record.direction is text');
SELECT col_not_null('public', 'canonical_record', 'direction', 'canonical_record.direction is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'direction'),
  NULL,
  'canonical_record.direction default'
);
SELECT col_type_is('public', 'canonical_record', 'magnitude', 'numeric(20,4)', 'canonical_record.magnitude is numeric(20,4)');
SELECT col_not_null('public', 'canonical_record', 'magnitude', 'canonical_record.magnitude is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'magnitude'),
  NULL,
  'canonical_record.magnitude default'
);
SELECT col_type_is('public', 'canonical_record', 'excluded', 'boolean', 'canonical_record.excluded is boolean');
SELECT col_not_null('public', 'canonical_record', 'excluded', 'canonical_record.excluded is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'excluded'),
  $dflt$false$dflt$,
  'canonical_record.excluded default'
);
SELECT col_type_is('public', 'canonical_record', 'exclusion_reason', 'text', 'canonical_record.exclusion_reason is text');
SELECT col_is_null('public', 'canonical_record', 'exclusion_reason', 'canonical_record.exclusion_reason is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'exclusion_reason'),
  NULL,
  'canonical_record.exclusion_reason default'
);
SELECT col_type_is('public', 'canonical_record', 'description', 'text', 'canonical_record.description is text');
SELECT col_not_null('public', 'canonical_record', 'description', 'canonical_record.description is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'description'),
  NULL,
  'canonical_record.description default'
);
SELECT col_type_is('public', 'canonical_record', 'raw', 'jsonb', 'canonical_record.raw is jsonb');
SELECT col_not_null('public', 'canonical_record', 'raw', 'canonical_record.raw is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'raw'),
  NULL,
  'canonical_record.raw default'
);
SELECT col_type_is('public', 'canonical_record', 'created_at', 'timestamp with time zone', 'canonical_record.created_at is timestamp with time zone');
SELECT col_not_null('public', 'canonical_record', 'created_at', 'canonical_record.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'canonical_record.created_at default'
);
SELECT col_type_is('public', 'canonical_record', 'reference_ids', 'jsonb', 'canonical_record.reference_ids is jsonb');
SELECT col_is_null('public', 'canonical_record', 'reference_ids', 'canonical_record.reference_ids is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'reference_ids'),
  NULL,
  'canonical_record.reference_ids default'
);
SELECT col_type_is('public', 'canonical_record', 'counterparty_type', 'text', 'canonical_record.counterparty_type is text');
SELECT col_is_null('public', 'canonical_record', 'counterparty_type', 'canonical_record.counterparty_type is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'counterparty_type'),
  NULL,
  'canonical_record.counterparty_type default'
);
SELECT col_type_is('public', 'canonical_record', 'counterparty_id', 'text', 'canonical_record.counterparty_id is text');
SELECT col_is_null('public', 'canonical_record', 'counterparty_id', 'canonical_record.counterparty_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'counterparty_id'),
  NULL,
  'canonical_record.counterparty_id default'
);
SELECT col_type_is('public', 'canonical_record', 'counterparty_name', 'text', 'canonical_record.counterparty_name is text');
SELECT col_is_null('public', 'canonical_record', 'counterparty_name', 'canonical_record.counterparty_name is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'counterparty_name'),
  NULL,
  'canonical_record.counterparty_name default'
);
SELECT col_type_is('public', 'canonical_record', 'value_date', 'date', 'canonical_record.value_date is date');
SELECT col_is_null('public', 'canonical_record', 'value_date', 'canonical_record.value_date is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'value_date'),
  NULL,
  'canonical_record.value_date default'
);
SELECT col_type_is('public', 'canonical_record', 'effective_date', 'date', 'canonical_record.effective_date is date');
SELECT col_is_null('public', 'canonical_record', 'effective_date', 'canonical_record.effective_date is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'effective_date'),
  NULL,
  'canonical_record.effective_date default'
);
SELECT col_type_is('public', 'canonical_record', 'evidence', 'jsonb', 'canonical_record.evidence is jsonb');
SELECT col_is_null('public', 'canonical_record', 'evidence', 'canonical_record.evidence is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.canonical_record'::regclass AND a.attname = 'evidence'),
  NULL,
  'canonical_record.evidence default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.canonical_record'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$normalized_record_direction_check => CHECK ((direction = ANY (ARRAY['INFLOW'::text, 'OUTFLOW'::text])))
normalized_record_source_system_check => CHECK ((source_type = ANY (ARRAY['BANK'::text, 'GL'::text, 'BILLING'::text])))$chk$,
  'canonical_record check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'canonical_record'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'canonical_record' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'canonical_record grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'canonical_record'),
  $policy$normalized_record_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'canonical_record row-level security policies'
);
SELECT triggers_are('public', 'canonical_record', ARRAY[]::name[], 'canonical_record has exactly the expected triggers');
SELECT columns_are('public', 'dashboard_secret_change_log', ARRAY['id', 'fingerprint', 'action', 'actor', 'ticket', 'note', 'created_at']::name[], 'dashboard_secret_change_log has exactly the expected columns');
SELECT col_is_pk('public', 'dashboard_secret_change_log', ARRAY['id']::name[], 'dashboard_secret_change_log primary key');
SELECT indexes_are('public', 'dashboard_secret_change_log', ARRAY['dashboard_secret_change_log_pkey', 'idx_dashboard_secret_change_log_fingerprint']::name[], 'dashboard_secret_change_log has exactly the expected indexes');
SELECT col_type_is('public', 'dashboard_secret_change_log', 'id', 'bigint', 'dashboard_secret_change_log.id is bigint');
SELECT col_not_null('public', 'dashboard_secret_change_log', 'id', 'dashboard_secret_change_log.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_change_log'::regclass AND a.attname = 'id'),
  $dflt$nextval('dashboard_secret_change_log_id_seq'::regclass)$dflt$,
  'dashboard_secret_change_log.id default'
);
SELECT col_type_is('public', 'dashboard_secret_change_log', 'fingerprint', 'text', 'dashboard_secret_change_log.fingerprint is text');
SELECT col_not_null('public', 'dashboard_secret_change_log', 'fingerprint', 'dashboard_secret_change_log.fingerprint is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_change_log'::regclass AND a.attname = 'fingerprint'),
  NULL,
  'dashboard_secret_change_log.fingerprint default'
);
SELECT col_type_is('public', 'dashboard_secret_change_log', 'action', 'text', 'dashboard_secret_change_log.action is text');
SELECT col_not_null('public', 'dashboard_secret_change_log', 'action', 'dashboard_secret_change_log.action is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_change_log'::regclass AND a.attname = 'action'),
  NULL,
  'dashboard_secret_change_log.action default'
);
SELECT col_type_is('public', 'dashboard_secret_change_log', 'actor', 'text', 'dashboard_secret_change_log.actor is text');
SELECT col_not_null('public', 'dashboard_secret_change_log', 'actor', 'dashboard_secret_change_log.actor is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_change_log'::regclass AND a.attname = 'actor'),
  NULL,
  'dashboard_secret_change_log.actor default'
);
SELECT col_type_is('public', 'dashboard_secret_change_log', 'ticket', 'text', 'dashboard_secret_change_log.ticket is text');
SELECT col_is_null('public', 'dashboard_secret_change_log', 'ticket', 'dashboard_secret_change_log.ticket is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_change_log'::regclass AND a.attname = 'ticket'),
  NULL,
  'dashboard_secret_change_log.ticket default'
);
SELECT col_type_is('public', 'dashboard_secret_change_log', 'note', 'text', 'dashboard_secret_change_log.note is text');
SELECT col_is_null('public', 'dashboard_secret_change_log', 'note', 'dashboard_secret_change_log.note is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_change_log'::regclass AND a.attname = 'note'),
  NULL,
  'dashboard_secret_change_log.note default'
);
SELECT col_type_is('public', 'dashboard_secret_change_log', 'created_at', 'timestamp with time zone', 'dashboard_secret_change_log.created_at is timestamp with time zone');
SELECT col_not_null('public', 'dashboard_secret_change_log', 'created_at', 'dashboard_secret_change_log.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_change_log'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'dashboard_secret_change_log.created_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.dashboard_secret_change_log'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$dashboard_secret_change_log_action_check => CHECK ((action = ANY (ARRAY['rotate'::text, 'triage'::text, 'dismiss'::text, 'verify_purge'::text])))$chk$,
  'dashboard_secret_change_log check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'dashboard_secret_change_log'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'dashboard_secret_change_log' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
dashboard_app_runtime => INSERT,SELECT
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'dashboard_secret_change_log grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dashboard_secret_change_log'),
  $policy$$policy$,
  'dashboard_secret_change_log row-level security policies'
);
SELECT triggers_are('public', 'dashboard_secret_change_log', ARRAY[]::name[], 'dashboard_secret_change_log has exactly the expected triggers');
SELECT columns_are('public', 'dashboard_secret_finding_snapshot', ARRAY['id', 'scan_run_id', 'fingerprint', 'masked_secret', 'rule_id', 'description', 'file', 'start_line', 'commit_sha', 'author', 'secret_committed_at', 'present_at_head', 'sources', 'verified']::name[], 'dashboard_secret_finding_snapshot has exactly the expected columns');
SELECT col_is_pk('public', 'dashboard_secret_finding_snapshot', ARRAY['id']::name[], 'dashboard_secret_finding_snapshot primary key');
SELECT indexes_are('public', 'dashboard_secret_finding_snapshot', ARRAY['dashboard_secret_finding_snapshot_pkey', 'idx_dashboard_secret_finding_snapshot_fingerprint', 'idx_dashboard_secret_finding_snapshot_scan_run']::name[], 'dashboard_secret_finding_snapshot has exactly the expected indexes');
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'id', 'bigint', 'dashboard_secret_finding_snapshot.id is bigint');
SELECT col_not_null('public', 'dashboard_secret_finding_snapshot', 'id', 'dashboard_secret_finding_snapshot.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'id'),
  $dflt$nextval('dashboard_secret_finding_snapshot_id_seq'::regclass)$dflt$,
  'dashboard_secret_finding_snapshot.id default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'scan_run_id', 'bigint', 'dashboard_secret_finding_snapshot.scan_run_id is bigint');
SELECT col_not_null('public', 'dashboard_secret_finding_snapshot', 'scan_run_id', 'dashboard_secret_finding_snapshot.scan_run_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'scan_run_id'),
  NULL,
  'dashboard_secret_finding_snapshot.scan_run_id default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'fingerprint', 'text', 'dashboard_secret_finding_snapshot.fingerprint is text');
SELECT col_not_null('public', 'dashboard_secret_finding_snapshot', 'fingerprint', 'dashboard_secret_finding_snapshot.fingerprint is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'fingerprint'),
  NULL,
  'dashboard_secret_finding_snapshot.fingerprint default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'masked_secret', 'text', 'dashboard_secret_finding_snapshot.masked_secret is text');
SELECT col_not_null('public', 'dashboard_secret_finding_snapshot', 'masked_secret', 'dashboard_secret_finding_snapshot.masked_secret is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'masked_secret'),
  NULL,
  'dashboard_secret_finding_snapshot.masked_secret default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'rule_id', 'text', 'dashboard_secret_finding_snapshot.rule_id is text');
SELECT col_not_null('public', 'dashboard_secret_finding_snapshot', 'rule_id', 'dashboard_secret_finding_snapshot.rule_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'rule_id'),
  NULL,
  'dashboard_secret_finding_snapshot.rule_id default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'description', 'text', 'dashboard_secret_finding_snapshot.description is text');
SELECT col_not_null('public', 'dashboard_secret_finding_snapshot', 'description', 'dashboard_secret_finding_snapshot.description is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'description'),
  NULL,
  'dashboard_secret_finding_snapshot.description default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'file', 'text', 'dashboard_secret_finding_snapshot.file is text');
SELECT col_not_null('public', 'dashboard_secret_finding_snapshot', 'file', 'dashboard_secret_finding_snapshot.file is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'file'),
  NULL,
  'dashboard_secret_finding_snapshot.file default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'start_line', 'integer', 'dashboard_secret_finding_snapshot.start_line is integer');
SELECT col_is_null('public', 'dashboard_secret_finding_snapshot', 'start_line', 'dashboard_secret_finding_snapshot.start_line is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'start_line'),
  NULL,
  'dashboard_secret_finding_snapshot.start_line default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'commit_sha', 'text', 'dashboard_secret_finding_snapshot.commit_sha is text');
SELECT col_is_null('public', 'dashboard_secret_finding_snapshot', 'commit_sha', 'dashboard_secret_finding_snapshot.commit_sha is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'commit_sha'),
  NULL,
  'dashboard_secret_finding_snapshot.commit_sha default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'author', 'text', 'dashboard_secret_finding_snapshot.author is text');
SELECT col_is_null('public', 'dashboard_secret_finding_snapshot', 'author', 'dashboard_secret_finding_snapshot.author is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'author'),
  NULL,
  'dashboard_secret_finding_snapshot.author default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'secret_committed_at', 'timestamp with time zone', 'dashboard_secret_finding_snapshot.secret_committed_at is timestamp with time zone');
SELECT col_is_null('public', 'dashboard_secret_finding_snapshot', 'secret_committed_at', 'dashboard_secret_finding_snapshot.secret_committed_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'secret_committed_at'),
  NULL,
  'dashboard_secret_finding_snapshot.secret_committed_at default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'present_at_head', 'boolean', 'dashboard_secret_finding_snapshot.present_at_head is boolean');
SELECT col_not_null('public', 'dashboard_secret_finding_snapshot', 'present_at_head', 'dashboard_secret_finding_snapshot.present_at_head is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'present_at_head'),
  NULL,
  'dashboard_secret_finding_snapshot.present_at_head default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'sources', 'text[]', 'dashboard_secret_finding_snapshot.sources is text[]');
SELECT col_not_null('public', 'dashboard_secret_finding_snapshot', 'sources', 'dashboard_secret_finding_snapshot.sources is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'sources'),
  NULL,
  'dashboard_secret_finding_snapshot.sources default'
);
SELECT col_type_is('public', 'dashboard_secret_finding_snapshot', 'verified', 'boolean', 'dashboard_secret_finding_snapshot.verified is boolean');
SELECT col_is_null('public', 'dashboard_secret_finding_snapshot', 'verified', 'dashboard_secret_finding_snapshot.verified is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND a.attname = 'verified'),
  NULL,
  'dashboard_secret_finding_snapshot.verified default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.dashboard_secret_finding_snapshot'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$$chk$,
  'dashboard_secret_finding_snapshot check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'dashboard_secret_finding_snapshot'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'dashboard_secret_finding_snapshot' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
dashboard_app_runtime => INSERT,SELECT
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'dashboard_secret_finding_snapshot grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dashboard_secret_finding_snapshot'),
  $policy$$policy$,
  'dashboard_secret_finding_snapshot row-level security policies'
);
SELECT triggers_are('public', 'dashboard_secret_finding_snapshot', ARRAY[]::name[], 'dashboard_secret_finding_snapshot has exactly the expected triggers');
SELECT columns_are('public', 'dashboard_secret_scan_run', ARRAY['id', 'environment', 'status_commit_sha', 'generated_at', 'status', 'gitleaks_available', 'trufflehog_available', 'critical_count', 'high_count', 'moderate_count', 'low_count', 'info_count', 'recorded_at']::name[], 'dashboard_secret_scan_run has exactly the expected columns');
SELECT col_is_pk('public', 'dashboard_secret_scan_run', ARRAY['id']::name[], 'dashboard_secret_scan_run primary key');
SELECT indexes_are('public', 'dashboard_secret_scan_run', ARRAY['dashboard_secret_scan_run_environment_status_commit_sha_key', 'dashboard_secret_scan_run_pkey']::name[], 'dashboard_secret_scan_run has exactly the expected indexes');
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'id', 'bigint', 'dashboard_secret_scan_run.id is bigint');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'id', 'dashboard_secret_scan_run.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'id'),
  $dflt$nextval('dashboard_secret_scan_run_id_seq'::regclass)$dflt$,
  'dashboard_secret_scan_run.id default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'environment', 'text', 'dashboard_secret_scan_run.environment is text');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'environment', 'dashboard_secret_scan_run.environment is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'environment'),
  NULL,
  'dashboard_secret_scan_run.environment default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'status_commit_sha', 'text', 'dashboard_secret_scan_run.status_commit_sha is text');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'status_commit_sha', 'dashboard_secret_scan_run.status_commit_sha is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'status_commit_sha'),
  NULL,
  'dashboard_secret_scan_run.status_commit_sha default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'generated_at', 'timestamp with time zone', 'dashboard_secret_scan_run.generated_at is timestamp with time zone');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'generated_at', 'dashboard_secret_scan_run.generated_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'generated_at'),
  NULL,
  'dashboard_secret_scan_run.generated_at default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'status', 'text', 'dashboard_secret_scan_run.status is text');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'status', 'dashboard_secret_scan_run.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'status'),
  NULL,
  'dashboard_secret_scan_run.status default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'gitleaks_available', 'boolean', 'dashboard_secret_scan_run.gitleaks_available is boolean');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'gitleaks_available', 'dashboard_secret_scan_run.gitleaks_available is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'gitleaks_available'),
  NULL,
  'dashboard_secret_scan_run.gitleaks_available default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'trufflehog_available', 'boolean', 'dashboard_secret_scan_run.trufflehog_available is boolean');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'trufflehog_available', 'dashboard_secret_scan_run.trufflehog_available is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'trufflehog_available'),
  NULL,
  'dashboard_secret_scan_run.trufflehog_available default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'critical_count', 'integer', 'dashboard_secret_scan_run.critical_count is integer');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'critical_count', 'dashboard_secret_scan_run.critical_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'critical_count'),
  NULL,
  'dashboard_secret_scan_run.critical_count default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'high_count', 'integer', 'dashboard_secret_scan_run.high_count is integer');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'high_count', 'dashboard_secret_scan_run.high_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'high_count'),
  NULL,
  'dashboard_secret_scan_run.high_count default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'moderate_count', 'integer', 'dashboard_secret_scan_run.moderate_count is integer');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'moderate_count', 'dashboard_secret_scan_run.moderate_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'moderate_count'),
  NULL,
  'dashboard_secret_scan_run.moderate_count default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'low_count', 'integer', 'dashboard_secret_scan_run.low_count is integer');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'low_count', 'dashboard_secret_scan_run.low_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'low_count'),
  NULL,
  'dashboard_secret_scan_run.low_count default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'info_count', 'integer', 'dashboard_secret_scan_run.info_count is integer');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'info_count', 'dashboard_secret_scan_run.info_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'info_count'),
  NULL,
  'dashboard_secret_scan_run.info_count default'
);
SELECT col_type_is('public', 'dashboard_secret_scan_run', 'recorded_at', 'timestamp with time zone', 'dashboard_secret_scan_run.recorded_at is timestamp with time zone');
SELECT col_not_null('public', 'dashboard_secret_scan_run', 'recorded_at', 'dashboard_secret_scan_run.recorded_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.dashboard_secret_scan_run'::regclass AND a.attname = 'recorded_at'),
  $dflt$now()$dflt$,
  'dashboard_secret_scan_run.recorded_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.dashboard_secret_scan_run'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$dashboard_secret_scan_run_environment_status_commit_sha_key => UNIQUE (environment, status_commit_sha)$chk$,
  'dashboard_secret_scan_run check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'dashboard_secret_scan_run'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'dashboard_secret_scan_run' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
dashboard_app_runtime => INSERT,SELECT
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'dashboard_secret_scan_run grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dashboard_secret_scan_run'),
  $policy$$policy$,
  'dashboard_secret_scan_run row-level security policies'
);
SELECT triggers_are('public', 'dashboard_secret_scan_run', ARRAY[]::name[], 'dashboard_secret_scan_run has exactly the expected triggers');
SELECT columns_are('public', 'import_file', ARRAY['id', 'organization_id', 'original_filename', 'file_format', 'source_type', 'content_sha256', 'byte_size', 'validation_status', 'row_count', 'error_count', 'warning_count', 'date_range_start', 'date_range_end', 'created_at']::name[], 'import_file has exactly the expected columns');
SELECT col_is_pk('public', 'import_file', ARRAY['id']::name[], 'import_file primary key');
SELECT indexes_are('public', 'import_file', ARRAY['import_file_content_sha256_idx', 'import_file_organization_idx', 'import_file_pkey']::name[], 'import_file has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'import_file' AND relnamespace = 'public'::regnamespace),
  true,
  'import_file has row-level security enabled'
);
SELECT col_type_is('public', 'import_file', 'id', 'uuid', 'import_file.id is uuid');
SELECT col_not_null('public', 'import_file', 'id', 'import_file.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'id'),
  NULL,
  'import_file.id default'
);
SELECT col_type_is('public', 'import_file', 'organization_id', 'uuid', 'import_file.organization_id is uuid');
SELECT col_not_null('public', 'import_file', 'organization_id', 'import_file.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'organization_id'),
  NULL,
  'import_file.organization_id default'
);
SELECT col_type_is('public', 'import_file', 'original_filename', 'text', 'import_file.original_filename is text');
SELECT col_not_null('public', 'import_file', 'original_filename', 'import_file.original_filename is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'original_filename'),
  NULL,
  'import_file.original_filename default'
);
SELECT col_type_is('public', 'import_file', 'file_format', 'text', 'import_file.file_format is text');
SELECT col_not_null('public', 'import_file', 'file_format', 'import_file.file_format is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'file_format'),
  NULL,
  'import_file.file_format default'
);
SELECT col_type_is('public', 'import_file', 'source_type', 'text', 'import_file.source_type is text');
SELECT col_not_null('public', 'import_file', 'source_type', 'import_file.source_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'source_type'),
  NULL,
  'import_file.source_type default'
);
SELECT col_type_is('public', 'import_file', 'content_sha256', 'character(64)', 'import_file.content_sha256 is character(64)');
SELECT col_not_null('public', 'import_file', 'content_sha256', 'import_file.content_sha256 is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'content_sha256'),
  NULL,
  'import_file.content_sha256 default'
);
SELECT col_type_is('public', 'import_file', 'byte_size', 'bigint', 'import_file.byte_size is bigint');
SELECT col_not_null('public', 'import_file', 'byte_size', 'import_file.byte_size is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'byte_size'),
  NULL,
  'import_file.byte_size default'
);
SELECT col_type_is('public', 'import_file', 'validation_status', 'text', 'import_file.validation_status is text');
SELECT col_not_null('public', 'import_file', 'validation_status', 'import_file.validation_status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'validation_status'),
  $dflt$'PENDING'::text$dflt$,
  'import_file.validation_status default'
);
SELECT col_type_is('public', 'import_file', 'row_count', 'integer', 'import_file.row_count is integer');
SELECT col_is_null('public', 'import_file', 'row_count', 'import_file.row_count is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'row_count'),
  NULL,
  'import_file.row_count default'
);
SELECT col_type_is('public', 'import_file', 'error_count', 'integer', 'import_file.error_count is integer');
SELECT col_is_null('public', 'import_file', 'error_count', 'import_file.error_count is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'error_count'),
  NULL,
  'import_file.error_count default'
);
SELECT col_type_is('public', 'import_file', 'warning_count', 'integer', 'import_file.warning_count is integer');
SELECT col_is_null('public', 'import_file', 'warning_count', 'import_file.warning_count is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'warning_count'),
  NULL,
  'import_file.warning_count default'
);
SELECT col_type_is('public', 'import_file', 'date_range_start', 'date', 'import_file.date_range_start is date');
SELECT col_is_null('public', 'import_file', 'date_range_start', 'import_file.date_range_start is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'date_range_start'),
  NULL,
  'import_file.date_range_start default'
);
SELECT col_type_is('public', 'import_file', 'date_range_end', 'date', 'import_file.date_range_end is date');
SELECT col_is_null('public', 'import_file', 'date_range_end', 'import_file.date_range_end is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'date_range_end'),
  NULL,
  'import_file.date_range_end default'
);
SELECT col_type_is('public', 'import_file', 'created_at', 'timestamp with time zone', 'import_file.created_at is timestamp with time zone');
SELECT col_not_null('public', 'import_file', 'created_at', 'import_file.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'import_file.created_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.import_file'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$import_file_byte_size_check => CHECK ((byte_size >= 0))
import_file_file_format_check => CHECK ((file_format = ANY (ARRAY['CSV'::text, 'XLSX'::text])))
import_file_source_type_check => CHECK ((source_type = ANY (ARRAY['BANK'::text, 'GL'::text, 'PAYROLL'::text, 'RECEIPT'::text, 'REMITTANCE'::text, 'BILLING'::text, 'VMS'::text, 'FACTOR'::text, 'LOC'::text, 'TAX'::text, 'BENEFITS'::text, 'TIMEKEEPING'::text, 'INTERCOMPANY'::text, 'ASSIGNMENT'::text, 'LEGAL_ENTITY'::text])))
import_file_validation_status_check => CHECK ((validation_status = ANY (ARRAY['PENDING'::text, 'VALID'::text, 'VALID_WITH_WARNINGS'::text, 'INVALID'::text])))$chk$,
  'import_file check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'import_file'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'import_file' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'import_file grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'import_file'),
  $policy$import_file_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'import_file row-level security policies'
);
SELECT triggers_are('public', 'import_file', ARRAY[]::name[], 'import_file has exactly the expected triggers');
SELECT columns_are('public', 'import_file_content', ARRAY['import_file_id', 'organization_id', 'content', 'byte_size', 'created_at']::name[], 'import_file_content has exactly the expected columns');
SELECT col_is_pk('public', 'import_file_content', ARRAY['import_file_id']::name[], 'import_file_content primary key');
SELECT indexes_are('public', 'import_file_content', ARRAY['import_file_content_organization_idx', 'import_file_content_pkey']::name[], 'import_file_content has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'import_file_content' AND relnamespace = 'public'::regnamespace),
  true,
  'import_file_content has row-level security enabled'
);
SELECT col_type_is('public', 'import_file_content', 'import_file_id', 'uuid', 'import_file_content.import_file_id is uuid');
SELECT col_not_null('public', 'import_file_content', 'import_file_id', 'import_file_content.import_file_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file_content'::regclass AND a.attname = 'import_file_id'),
  NULL,
  'import_file_content.import_file_id default'
);
SELECT col_type_is('public', 'import_file_content', 'organization_id', 'uuid', 'import_file_content.organization_id is uuid');
SELECT col_not_null('public', 'import_file_content', 'organization_id', 'import_file_content.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file_content'::regclass AND a.attname = 'organization_id'),
  NULL,
  'import_file_content.organization_id default'
);
SELECT col_type_is('public', 'import_file_content', 'content', 'bytea', 'import_file_content.content is bytea');
SELECT col_not_null('public', 'import_file_content', 'content', 'import_file_content.content is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file_content'::regclass AND a.attname = 'content'),
  NULL,
  'import_file_content.content default'
);
SELECT col_type_is('public', 'import_file_content', 'byte_size', 'bigint', 'import_file_content.byte_size is bigint');
SELECT col_not_null('public', 'import_file_content', 'byte_size', 'import_file_content.byte_size is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file_content'::regclass AND a.attname = 'byte_size'),
  NULL,
  'import_file_content.byte_size default'
);
SELECT col_type_is('public', 'import_file_content', 'created_at', 'timestamp with time zone', 'import_file_content.created_at is timestamp with time zone');
SELECT col_not_null('public', 'import_file_content', 'created_at', 'import_file_content.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_file_content'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'import_file_content.created_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.import_file_content'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$import_file_content_byte_size_check => CHECK ((byte_size >= 0))
import_file_content_length_matches_check => CHECK ((octet_length(content) = byte_size))$chk$,
  'import_file_content check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'import_file_content'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'import_file_content' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'import_file_content grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'import_file_content'),
  $policy$import_file_content_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'import_file_content row-level security policies'
);
SELECT triggers_are('public', 'import_file_content', ARRAY[]::name[], 'import_file_content has exactly the expected triggers');
SELECT columns_are('public', 'import_job', ARRAY['id', 'organization_id', 'reconciliation_run_id', 'status', 'attempts', 'worker_id', 'error_summary', 'queued_at', 'started_at', 'finished_at']::name[], 'import_job has exactly the expected columns');
SELECT col_is_pk('public', 'import_job', ARRAY['id']::name[], 'import_job primary key');
SELECT indexes_are('public', 'import_job', ARRAY['import_job_organization_idx', 'import_job_pkey', 'import_job_reconciliation_run_idx']::name[], 'import_job has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'import_job' AND relnamespace = 'public'::regnamespace),
  true,
  'import_job has row-level security enabled'
);
SELECT col_type_is('public', 'import_job', 'id', 'uuid', 'import_job.id is uuid');
SELECT col_not_null('public', 'import_job', 'id', 'import_job.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_job'::regclass AND a.attname = 'id'),
  NULL,
  'import_job.id default'
);
SELECT col_type_is('public', 'import_job', 'organization_id', 'uuid', 'import_job.organization_id is uuid');
SELECT col_not_null('public', 'import_job', 'organization_id', 'import_job.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_job'::regclass AND a.attname = 'organization_id'),
  NULL,
  'import_job.organization_id default'
);
SELECT col_type_is('public', 'import_job', 'reconciliation_run_id', 'uuid', 'import_job.reconciliation_run_id is uuid');
SELECT col_not_null('public', 'import_job', 'reconciliation_run_id', 'import_job.reconciliation_run_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_job'::regclass AND a.attname = 'reconciliation_run_id'),
  NULL,
  'import_job.reconciliation_run_id default'
);
SELECT col_type_is('public', 'import_job', 'status', 'text', 'import_job.status is text');
SELECT col_not_null('public', 'import_job', 'status', 'import_job.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_job'::regclass AND a.attname = 'status'),
  $dflt$'QUEUED'::text$dflt$,
  'import_job.status default'
);
SELECT col_type_is('public', 'import_job', 'attempts', 'integer', 'import_job.attempts is integer');
SELECT col_not_null('public', 'import_job', 'attempts', 'import_job.attempts is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_job'::regclass AND a.attname = 'attempts'),
  $dflt$0$dflt$,
  'import_job.attempts default'
);
SELECT col_type_is('public', 'import_job', 'worker_id', 'text', 'import_job.worker_id is text');
SELECT col_is_null('public', 'import_job', 'worker_id', 'import_job.worker_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_job'::regclass AND a.attname = 'worker_id'),
  NULL,
  'import_job.worker_id default'
);
SELECT col_type_is('public', 'import_job', 'error_summary', 'text', 'import_job.error_summary is text');
SELECT col_is_null('public', 'import_job', 'error_summary', 'import_job.error_summary is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_job'::regclass AND a.attname = 'error_summary'),
  NULL,
  'import_job.error_summary default'
);
SELECT col_type_is('public', 'import_job', 'queued_at', 'timestamp with time zone', 'import_job.queued_at is timestamp with time zone');
SELECT col_not_null('public', 'import_job', 'queued_at', 'import_job.queued_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_job'::regclass AND a.attname = 'queued_at'),
  $dflt$now()$dflt$,
  'import_job.queued_at default'
);
SELECT col_type_is('public', 'import_job', 'started_at', 'timestamp with time zone', 'import_job.started_at is timestamp with time zone');
SELECT col_is_null('public', 'import_job', 'started_at', 'import_job.started_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_job'::regclass AND a.attname = 'started_at'),
  NULL,
  'import_job.started_at default'
);
SELECT col_type_is('public', 'import_job', 'finished_at', 'timestamp with time zone', 'import_job.finished_at is timestamp with time zone');
SELECT col_is_null('public', 'import_job', 'finished_at', 'import_job.finished_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.import_job'::regclass AND a.attname = 'finished_at'),
  NULL,
  'import_job.finished_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.import_job'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$import_job_status_check => CHECK ((status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'SUCCEEDED'::text, 'FAILED'::text])))$chk$,
  'import_job check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'import_job'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'import_job' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'import_job grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'import_job'),
  $policy$import_job_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'import_job row-level security policies'
);
SELECT triggers_are('public', 'import_job', ARRAY[]::name[], 'import_job has exactly the expected triggers');
SELECT columns_are('public', 'mapping_rule_version', ARRAY['id', 'rule_code', 'version_number', 'source_type', 'target_field', 'description', 'status', 'created_at']::name[], 'mapping_rule_version has exactly the expected columns');
SELECT col_is_pk('public', 'mapping_rule_version', ARRAY['id']::name[], 'mapping_rule_version primary key');
SELECT indexes_are('public', 'mapping_rule_version', ARRAY['mapping_rule_version_code_version_key', 'mapping_rule_version_pkey']::name[], 'mapping_rule_version has exactly the expected indexes');
SELECT col_type_is('public', 'mapping_rule_version', 'id', 'uuid', 'mapping_rule_version.id is uuid');
SELECT col_not_null('public', 'mapping_rule_version', 'id', 'mapping_rule_version.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.mapping_rule_version'::regclass AND a.attname = 'id'),
  NULL,
  'mapping_rule_version.id default'
);
SELECT col_type_is('public', 'mapping_rule_version', 'rule_code', 'text', 'mapping_rule_version.rule_code is text');
SELECT col_not_null('public', 'mapping_rule_version', 'rule_code', 'mapping_rule_version.rule_code is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.mapping_rule_version'::regclass AND a.attname = 'rule_code'),
  NULL,
  'mapping_rule_version.rule_code default'
);
SELECT col_type_is('public', 'mapping_rule_version', 'version_number', 'integer', 'mapping_rule_version.version_number is integer');
SELECT col_not_null('public', 'mapping_rule_version', 'version_number', 'mapping_rule_version.version_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.mapping_rule_version'::regclass AND a.attname = 'version_number'),
  NULL,
  'mapping_rule_version.version_number default'
);
SELECT col_type_is('public', 'mapping_rule_version', 'source_type', 'text', 'mapping_rule_version.source_type is text');
SELECT col_is_null('public', 'mapping_rule_version', 'source_type', 'mapping_rule_version.source_type is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.mapping_rule_version'::regclass AND a.attname = 'source_type'),
  NULL,
  'mapping_rule_version.source_type default'
);
SELECT col_type_is('public', 'mapping_rule_version', 'target_field', 'text', 'mapping_rule_version.target_field is text');
SELECT col_is_null('public', 'mapping_rule_version', 'target_field', 'mapping_rule_version.target_field is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.mapping_rule_version'::regclass AND a.attname = 'target_field'),
  NULL,
  'mapping_rule_version.target_field default'
);
SELECT col_type_is('public', 'mapping_rule_version', 'description', 'text', 'mapping_rule_version.description is text');
SELECT col_not_null('public', 'mapping_rule_version', 'description', 'mapping_rule_version.description is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.mapping_rule_version'::regclass AND a.attname = 'description'),
  NULL,
  'mapping_rule_version.description default'
);
SELECT col_type_is('public', 'mapping_rule_version', 'status', 'text', 'mapping_rule_version.status is text');
SELECT col_not_null('public', 'mapping_rule_version', 'status', 'mapping_rule_version.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.mapping_rule_version'::regclass AND a.attname = 'status'),
  $dflt$'ACTIVE'::text$dflt$,
  'mapping_rule_version.status default'
);
SELECT col_type_is('public', 'mapping_rule_version', 'created_at', 'timestamp with time zone', 'mapping_rule_version.created_at is timestamp with time zone');
SELECT col_not_null('public', 'mapping_rule_version', 'created_at', 'mapping_rule_version.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.mapping_rule_version'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'mapping_rule_version.created_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.mapping_rule_version'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$mapping_rule_version_code_version_key => UNIQUE (rule_code, version_number)
mapping_rule_version_source_type_check => CHECK (((source_type IS NULL) OR (source_type = ANY (ARRAY['BANK'::text, 'GL'::text, 'PAYROLL'::text, 'RECEIPT'::text, 'REMITTANCE'::text, 'BILLING'::text, 'VMS'::text, 'FACTOR'::text, 'LOC'::text, 'TAX'::text, 'BENEFITS'::text, 'TIMEKEEPING'::text, 'INTERCOMPANY'::text, 'ASSIGNMENT'::text, 'LEGAL_ENTITY'::text]))))
mapping_rule_version_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))
mapping_rule_version_version_number_check => CHECK ((version_number > 0))$chk$,
  'mapping_rule_version check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'mapping_rule_version'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'mapping_rule_version' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'mapping_rule_version grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mapping_rule_version'),
  $policy$$policy$,
  'mapping_rule_version row-level security policies'
);
SELECT triggers_are('public', 'mapping_rule_version', ARRAY[]::name[], 'mapping_rule_version has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_account', ARRAY['id', 'organization_id', 'account_identifier', 'institution_name', 'display_name', 'currency_code', 'is_active', 'created_at', 'updated_at']::name[], 'reconciliation_account has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_account', ARRAY['id']::name[], 'reconciliation_account primary key');
SELECT indexes_are('public', 'reconciliation_account', ARRAY['reconciliation_account_org_identifier_key', 'reconciliation_account_organization_idx', 'reconciliation_account_pkey']::name[], 'reconciliation_account has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_account' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_account has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_account', 'id', 'uuid', 'reconciliation_account.id is uuid');
SELECT col_not_null('public', 'reconciliation_account', 'id', 'reconciliation_account.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_account'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_account.id default'
);
SELECT col_type_is('public', 'reconciliation_account', 'organization_id', 'uuid', 'reconciliation_account.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_account', 'organization_id', 'reconciliation_account.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_account'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_account.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_account', 'account_identifier', 'text', 'reconciliation_account.account_identifier is text');
SELECT col_not_null('public', 'reconciliation_account', 'account_identifier', 'reconciliation_account.account_identifier is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_account'::regclass AND a.attname = 'account_identifier'),
  NULL,
  'reconciliation_account.account_identifier default'
);
SELECT col_type_is('public', 'reconciliation_account', 'institution_name', 'text', 'reconciliation_account.institution_name is text');
SELECT col_is_null('public', 'reconciliation_account', 'institution_name', 'reconciliation_account.institution_name is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_account'::regclass AND a.attname = 'institution_name'),
  NULL,
  'reconciliation_account.institution_name default'
);
SELECT col_type_is('public', 'reconciliation_account', 'display_name', 'text', 'reconciliation_account.display_name is text');
SELECT col_is_null('public', 'reconciliation_account', 'display_name', 'reconciliation_account.display_name is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_account'::regclass AND a.attname = 'display_name'),
  NULL,
  'reconciliation_account.display_name default'
);
SELECT col_type_is('public', 'reconciliation_account', 'currency_code', 'text', 'reconciliation_account.currency_code is text');
SELECT col_not_null('public', 'reconciliation_account', 'currency_code', 'reconciliation_account.currency_code is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_account'::regclass AND a.attname = 'currency_code'),
  $dflt$'USD'::text$dflt$,
  'reconciliation_account.currency_code default'
);
SELECT col_type_is('public', 'reconciliation_account', 'is_active', 'boolean', 'reconciliation_account.is_active is boolean');
SELECT col_not_null('public', 'reconciliation_account', 'is_active', 'reconciliation_account.is_active is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_account'::regclass AND a.attname = 'is_active'),
  $dflt$true$dflt$,
  'reconciliation_account.is_active default'
);
SELECT col_type_is('public', 'reconciliation_account', 'created_at', 'timestamp with time zone', 'reconciliation_account.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_account', 'created_at', 'reconciliation_account.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_account'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_account.created_at default'
);
SELECT col_type_is('public', 'reconciliation_account', 'updated_at', 'timestamp with time zone', 'reconciliation_account.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_account', 'updated_at', 'reconciliation_account.updated_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_account'::regclass AND a.attname = 'updated_at'),
  $dflt$now()$dflt$,
  'reconciliation_account.updated_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_account'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_account_org_identifier_key => UNIQUE (organization_id, account_identifier)$chk$,
  'reconciliation_account check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_account'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_account' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_account grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_account'),
  $policy$reconciliation_account_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_account row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_account', ARRAY['trg_reconciliation_account_updated_at']::name[], 'reconciliation_account has exactly the expected triggers');
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_reconciliation_account_updated_at' AND tgrelid = 'public.reconciliation_account'::regclass),
  $trig$CREATE TRIGGER trg_reconciliation_account_updated_at BEFORE UPDATE ON public.reconciliation_account FOR EACH ROW EXECUTE FUNCTION set_updated_at()$trig$,
  'reconciliation_account.trg_reconciliation_account_updated_at definition'
);
SELECT columns_are('public', 'reconciliation_approval_history', ARRAY['id', 'approval_id', 'from_status', 'to_status', 'actor', 'note', 'created_at', 'organization_id']::name[], 'reconciliation_approval_history has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_approval_history', ARRAY['id']::name[], 'reconciliation_approval_history primary key');
SELECT indexes_are('public', 'reconciliation_approval_history', ARRAY['reconciliation_approval_history_approval_idx', 'reconciliation_approval_history_organization_idx', 'reconciliation_approval_history_pkey']::name[], 'reconciliation_approval_history has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_approval_history' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_approval_history has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_approval_history', 'id', 'uuid', 'reconciliation_approval_history.id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_history', 'id', 'reconciliation_approval_history.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_history'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_approval_history.id default'
);
SELECT col_type_is('public', 'reconciliation_approval_history', 'approval_id', 'uuid', 'reconciliation_approval_history.approval_id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_history', 'approval_id', 'reconciliation_approval_history.approval_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_history'::regclass AND a.attname = 'approval_id'),
  NULL,
  'reconciliation_approval_history.approval_id default'
);
SELECT col_type_is('public', 'reconciliation_approval_history', 'from_status', 'text', 'reconciliation_approval_history.from_status is text');
SELECT col_is_null('public', 'reconciliation_approval_history', 'from_status', 'reconciliation_approval_history.from_status is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_history'::regclass AND a.attname = 'from_status'),
  NULL,
  'reconciliation_approval_history.from_status default'
);
SELECT col_type_is('public', 'reconciliation_approval_history', 'to_status', 'text', 'reconciliation_approval_history.to_status is text');
SELECT col_not_null('public', 'reconciliation_approval_history', 'to_status', 'reconciliation_approval_history.to_status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_history'::regclass AND a.attname = 'to_status'),
  NULL,
  'reconciliation_approval_history.to_status default'
);
SELECT col_type_is('public', 'reconciliation_approval_history', 'actor', 'text', 'reconciliation_approval_history.actor is text');
SELECT col_not_null('public', 'reconciliation_approval_history', 'actor', 'reconciliation_approval_history.actor is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_history'::regclass AND a.attname = 'actor'),
  NULL,
  'reconciliation_approval_history.actor default'
);
SELECT col_type_is('public', 'reconciliation_approval_history', 'note', 'text', 'reconciliation_approval_history.note is text');
SELECT col_is_null('public', 'reconciliation_approval_history', 'note', 'reconciliation_approval_history.note is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_history'::regclass AND a.attname = 'note'),
  NULL,
  'reconciliation_approval_history.note default'
);
SELECT col_type_is('public', 'reconciliation_approval_history', 'created_at', 'timestamp with time zone', 'reconciliation_approval_history.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_approval_history', 'created_at', 'reconciliation_approval_history.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_history'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_approval_history.created_at default'
);
SELECT col_type_is('public', 'reconciliation_approval_history', 'organization_id', 'uuid', 'reconciliation_approval_history.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_history', 'organization_id', 'reconciliation_approval_history.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_history'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_approval_history.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_approval_history'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$$chk$,
  'reconciliation_approval_history check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_approval_history'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_approval_history' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_approval_history grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_approval_history'),
  $policy$reconciliation_approval_history_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_approval_history row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_approval_history', ARRAY[]::name[], 'reconciliation_approval_history has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_approval_request', ARRAY['id', 'organization_id', 'subject_type', 'subject_id', 'status', 'submitted_by', 'decided_by', 'rationale', 'requested_at', 'decided_at']::name[], 'reconciliation_approval_request has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_approval_request', ARRAY['id']::name[], 'reconciliation_approval_request primary key');
SELECT indexes_are('public', 'reconciliation_approval_request', ARRAY['reconciliation_approval_request_decided_by_idx', 'reconciliation_approval_request_one_pending_idx', 'reconciliation_approval_request_pkey', 'reconciliation_approval_request_status_idx', 'reconciliation_approval_request_subject_idx', 'reconciliation_approval_request_submitted_by_idx']::name[], 'reconciliation_approval_request has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_approval_request' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_approval_request has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_approval_request', 'id', 'uuid', 'reconciliation_approval_request.id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_request', 'id', 'reconciliation_approval_request.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_approval_request.id default'
);
SELECT col_type_is('public', 'reconciliation_approval_request', 'organization_id', 'uuid', 'reconciliation_approval_request.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_request', 'organization_id', 'reconciliation_approval_request.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_approval_request.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_approval_request', 'subject_type', 'text', 'reconciliation_approval_request.subject_type is text');
SELECT col_not_null('public', 'reconciliation_approval_request', 'subject_type', 'reconciliation_approval_request.subject_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request'::regclass AND a.attname = 'subject_type'),
  NULL,
  'reconciliation_approval_request.subject_type default'
);
SELECT col_type_is('public', 'reconciliation_approval_request', 'subject_id', 'uuid', 'reconciliation_approval_request.subject_id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_request', 'subject_id', 'reconciliation_approval_request.subject_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request'::regclass AND a.attname = 'subject_id'),
  NULL,
  'reconciliation_approval_request.subject_id default'
);
SELECT col_type_is('public', 'reconciliation_approval_request', 'status', 'text', 'reconciliation_approval_request.status is text');
SELECT col_not_null('public', 'reconciliation_approval_request', 'status', 'reconciliation_approval_request.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request'::regclass AND a.attname = 'status'),
  $dflt$'PENDING'::text$dflt$,
  'reconciliation_approval_request.status default'
);
SELECT col_type_is('public', 'reconciliation_approval_request', 'submitted_by', 'text', 'reconciliation_approval_request.submitted_by is text');
SELECT col_not_null('public', 'reconciliation_approval_request', 'submitted_by', 'reconciliation_approval_request.submitted_by is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request'::regclass AND a.attname = 'submitted_by'),
  NULL,
  'reconciliation_approval_request.submitted_by default'
);
SELECT col_type_is('public', 'reconciliation_approval_request', 'decided_by', 'text', 'reconciliation_approval_request.decided_by is text');
SELECT col_is_null('public', 'reconciliation_approval_request', 'decided_by', 'reconciliation_approval_request.decided_by is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request'::regclass AND a.attname = 'decided_by'),
  NULL,
  'reconciliation_approval_request.decided_by default'
);
SELECT col_type_is('public', 'reconciliation_approval_request', 'rationale', 'text', 'reconciliation_approval_request.rationale is text');
SELECT col_is_null('public', 'reconciliation_approval_request', 'rationale', 'reconciliation_approval_request.rationale is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request'::regclass AND a.attname = 'rationale'),
  NULL,
  'reconciliation_approval_request.rationale default'
);
SELECT col_type_is('public', 'reconciliation_approval_request', 'requested_at', 'timestamp with time zone', 'reconciliation_approval_request.requested_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_approval_request', 'requested_at', 'reconciliation_approval_request.requested_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request'::regclass AND a.attname = 'requested_at'),
  $dflt$now()$dflt$,
  'reconciliation_approval_request.requested_at default'
);
SELECT col_type_is('public', 'reconciliation_approval_request', 'decided_at', 'timestamp with time zone', 'reconciliation_approval_request.decided_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_approval_request', 'decided_at', 'reconciliation_approval_request.decided_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request'::regclass AND a.attname = 'decided_at'),
  NULL,
  'reconciliation_approval_request.decided_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_approval_request'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_approval_request_status_check => CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'OVERRIDDEN'::text])))
reconciliation_approval_request_subject_type_check => CHECK ((subject_type = ANY (ARRAY['mappingProfile'::text, 'matchingRule'::text, 'varianceThreshold'::text, 'exceptionResolution'::text, 'reportDistribution'::text])))$chk$,
  'reconciliation_approval_request check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_approval_request'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_approval_request' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_approval_request grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_approval_request'),
  $policy$reconciliation_approval_request_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_approval_request row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_approval_request', ARRAY[]::name[], 'reconciliation_approval_request has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_approval_request_history', ARRAY['id', 'approval_request_id', 'organization_id', 'from_status', 'to_status', 'actor', 'note', 'created_at']::name[], 'reconciliation_approval_request_history has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_approval_request_history', ARRAY['id']::name[], 'reconciliation_approval_request_history primary key');
SELECT indexes_are('public', 'reconciliation_approval_request_history', ARRAY['reconciliation_approval_request_history_pkey', 'reconciliation_approval_request_history_request_idx']::name[], 'reconciliation_approval_request_history has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_approval_request_history' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_approval_request_history has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_approval_request_history', 'id', 'uuid', 'reconciliation_approval_request_history.id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_request_history', 'id', 'reconciliation_approval_request_history.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request_history'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_approval_request_history.id default'
);
SELECT col_type_is('public', 'reconciliation_approval_request_history', 'approval_request_id', 'uuid', 'reconciliation_approval_request_history.approval_request_id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_request_history', 'approval_request_id', 'reconciliation_approval_request_history.approval_request_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request_history'::regclass AND a.attname = 'approval_request_id'),
  NULL,
  'reconciliation_approval_request_history.approval_request_id default'
);
SELECT col_type_is('public', 'reconciliation_approval_request_history', 'organization_id', 'uuid', 'reconciliation_approval_request_history.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_approval_request_history', 'organization_id', 'reconciliation_approval_request_history.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request_history'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_approval_request_history.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_approval_request_history', 'from_status', 'text', 'reconciliation_approval_request_history.from_status is text');
SELECT col_is_null('public', 'reconciliation_approval_request_history', 'from_status', 'reconciliation_approval_request_history.from_status is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request_history'::regclass AND a.attname = 'from_status'),
  NULL,
  'reconciliation_approval_request_history.from_status default'
);
SELECT col_type_is('public', 'reconciliation_approval_request_history', 'to_status', 'text', 'reconciliation_approval_request_history.to_status is text');
SELECT col_not_null('public', 'reconciliation_approval_request_history', 'to_status', 'reconciliation_approval_request_history.to_status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request_history'::regclass AND a.attname = 'to_status'),
  NULL,
  'reconciliation_approval_request_history.to_status default'
);
SELECT col_type_is('public', 'reconciliation_approval_request_history', 'actor', 'text', 'reconciliation_approval_request_history.actor is text');
SELECT col_not_null('public', 'reconciliation_approval_request_history', 'actor', 'reconciliation_approval_request_history.actor is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request_history'::regclass AND a.attname = 'actor'),
  NULL,
  'reconciliation_approval_request_history.actor default'
);
SELECT col_type_is('public', 'reconciliation_approval_request_history', 'note', 'text', 'reconciliation_approval_request_history.note is text');
SELECT col_is_null('public', 'reconciliation_approval_request_history', 'note', 'reconciliation_approval_request_history.note is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request_history'::regclass AND a.attname = 'note'),
  NULL,
  'reconciliation_approval_request_history.note default'
);
SELECT col_type_is('public', 'reconciliation_approval_request_history', 'created_at', 'timestamp with time zone', 'reconciliation_approval_request_history.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_approval_request_history', 'created_at', 'reconciliation_approval_request_history.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_approval_request_history'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_approval_request_history.created_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_approval_request_history'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$$chk$,
  'reconciliation_approval_request_history check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_approval_request_history'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_approval_request_history' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_approval_request_history grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_approval_request_history'),
  $policy$reconciliation_approval_request_history_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_approval_request_history row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_approval_request_history', ARRAY[]::name[], 'reconciliation_approval_request_history has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_audit_event', ARRAY['event_id', 'job_id', 'event_type', 'from_state', 'to_state', 'actor', 'details_json', 'created_at', 'id', 'organization_id']::name[], 'reconciliation_audit_event has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_audit_event', ARRAY['event_id']::name[], 'reconciliation_audit_event primary key');
SELECT indexes_are('public', 'reconciliation_audit_event', ARRAY['reconciliation_audit_event_id_key', 'reconciliation_audit_event_job_idx', 'reconciliation_audit_event_organization_idx', 'reconciliation_audit_event_pkey']::name[], 'reconciliation_audit_event has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_audit_event' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_audit_event has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_audit_event', 'event_id', 'bigint', 'reconciliation_audit_event.event_id is bigint');
SELECT col_not_null('public', 'reconciliation_audit_event', 'event_id', 'reconciliation_audit_event.event_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_audit_event'::regclass AND a.attname = 'event_id'),
  $dflt$nextval('reconciliation_audit_event_event_id_seq'::regclass)$dflt$,
  'reconciliation_audit_event.event_id default'
);
SELECT col_type_is('public', 'reconciliation_audit_event', 'job_id', 'uuid', 'reconciliation_audit_event.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_audit_event', 'job_id', 'reconciliation_audit_event.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_audit_event'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_audit_event.job_id default'
);
SELECT col_type_is('public', 'reconciliation_audit_event', 'event_type', 'text', 'reconciliation_audit_event.event_type is text');
SELECT col_not_null('public', 'reconciliation_audit_event', 'event_type', 'reconciliation_audit_event.event_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_audit_event'::regclass AND a.attname = 'event_type'),
  NULL,
  'reconciliation_audit_event.event_type default'
);
SELECT col_type_is('public', 'reconciliation_audit_event', 'from_state', 'text', 'reconciliation_audit_event.from_state is text');
SELECT col_is_null('public', 'reconciliation_audit_event', 'from_state', 'reconciliation_audit_event.from_state is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_audit_event'::regclass AND a.attname = 'from_state'),
  NULL,
  'reconciliation_audit_event.from_state default'
);
SELECT col_type_is('public', 'reconciliation_audit_event', 'to_state', 'text', 'reconciliation_audit_event.to_state is text');
SELECT col_is_null('public', 'reconciliation_audit_event', 'to_state', 'reconciliation_audit_event.to_state is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_audit_event'::regclass AND a.attname = 'to_state'),
  NULL,
  'reconciliation_audit_event.to_state default'
);
SELECT col_type_is('public', 'reconciliation_audit_event', 'actor', 'text', 'reconciliation_audit_event.actor is text');
SELECT col_is_null('public', 'reconciliation_audit_event', 'actor', 'reconciliation_audit_event.actor is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_audit_event'::regclass AND a.attname = 'actor'),
  NULL,
  'reconciliation_audit_event.actor default'
);
SELECT col_type_is('public', 'reconciliation_audit_event', 'details_json', 'jsonb', 'reconciliation_audit_event.details_json is jsonb');
SELECT col_not_null('public', 'reconciliation_audit_event', 'details_json', 'reconciliation_audit_event.details_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_audit_event'::regclass AND a.attname = 'details_json'),
  $dflt$'{}'::jsonb$dflt$,
  'reconciliation_audit_event.details_json default'
);
SELECT col_type_is('public', 'reconciliation_audit_event', 'created_at', 'timestamp with time zone', 'reconciliation_audit_event.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_audit_event', 'created_at', 'reconciliation_audit_event.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_audit_event'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_audit_event.created_at default'
);
SELECT col_type_is('public', 'reconciliation_audit_event', 'id', 'uuid', 'reconciliation_audit_event.id is uuid');
SELECT col_not_null('public', 'reconciliation_audit_event', 'id', 'reconciliation_audit_event.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_audit_event'::regclass AND a.attname = 'id'),
  $dflt$gen_random_uuid()$dflt$,
  'reconciliation_audit_event.id default'
);
SELECT col_type_is('public', 'reconciliation_audit_event', 'organization_id', 'uuid', 'reconciliation_audit_event.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_audit_event', 'organization_id', 'reconciliation_audit_event.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_audit_event'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_audit_event.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_audit_event'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_audit_event_id_key => UNIQUE (id)$chk$,
  'reconciliation_audit_event check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_audit_event'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_audit_event' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_audit_event grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_audit_event'),
  $policy$reconciliation_audit_event_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_audit_event row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_audit_event', ARRAY[]::name[], 'reconciliation_audit_event has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_canonical_row', ARRAY['id', 'job_id', 'raw_row_id', 'source_file_id', 'source_system', 'spreadsheet_file_name', 'worksheet_name', 'line_number', 'transaction_date', 'posting_date', 'transaction_type', 'check_number', 'serial_number', 'reference_number', 'description', 'merchant_name', 'payee_name', 'amount', 'debit', 'credit', 'running_balance', 'normalized_comparison_text', 'normalized_comparison_tokens', 'normalized_reference_tokens', 'raw_source_values_json', 'data_quality_issues_json', 'is_excluded', 'exclusion_reason', 'is_zero_amount', 'context_fingerprint', 'account_identifier', 'reviewer_notes', 'created_at', 'staged_transaction_id', 'organization_id']::name[], 'reconciliation_canonical_row has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_canonical_row', ARRAY['id']::name[], 'reconciliation_canonical_row primary key');
SELECT indexes_are('public', 'reconciliation_canonical_row', ARRAY['reconciliation_canonical_row_amount_date_idx', 'reconciliation_canonical_row_fingerprint_idx', 'reconciliation_canonical_row_job_idx', 'reconciliation_canonical_row_organization_idx', 'reconciliation_canonical_row_pkey', 'reconciliation_canonical_row_raw_row_id_key', 'reconciliation_canonical_row_staged_transaction_key']::name[], 'reconciliation_canonical_row has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_canonical_row' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_canonical_row has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'id', 'uuid', 'reconciliation_canonical_row.id is uuid');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'id', 'reconciliation_canonical_row.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_canonical_row.id default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'job_id', 'uuid', 'reconciliation_canonical_row.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'job_id', 'reconciliation_canonical_row.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_canonical_row.job_id default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'raw_row_id', 'uuid', 'reconciliation_canonical_row.raw_row_id is uuid');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'raw_row_id', 'reconciliation_canonical_row.raw_row_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'raw_row_id'),
  NULL,
  'reconciliation_canonical_row.raw_row_id default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'source_file_id', 'uuid', 'reconciliation_canonical_row.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'source_file_id', 'reconciliation_canonical_row.source_file_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'source_file_id'),
  NULL,
  'reconciliation_canonical_row.source_file_id default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'source_system', 'text', 'reconciliation_canonical_row.source_system is text');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'source_system', 'reconciliation_canonical_row.source_system is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'source_system'),
  NULL,
  'reconciliation_canonical_row.source_system default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'spreadsheet_file_name', 'text', 'reconciliation_canonical_row.spreadsheet_file_name is text');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'spreadsheet_file_name', 'reconciliation_canonical_row.spreadsheet_file_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'spreadsheet_file_name'),
  NULL,
  'reconciliation_canonical_row.spreadsheet_file_name default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'worksheet_name', 'text', 'reconciliation_canonical_row.worksheet_name is text');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'worksheet_name', 'reconciliation_canonical_row.worksheet_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'worksheet_name'),
  NULL,
  'reconciliation_canonical_row.worksheet_name default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'line_number', 'integer', 'reconciliation_canonical_row.line_number is integer');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'line_number', 'reconciliation_canonical_row.line_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'line_number'),
  NULL,
  'reconciliation_canonical_row.line_number default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'transaction_date', 'date', 'reconciliation_canonical_row.transaction_date is date');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'transaction_date', 'reconciliation_canonical_row.transaction_date is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'transaction_date'),
  NULL,
  'reconciliation_canonical_row.transaction_date default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'posting_date', 'date', 'reconciliation_canonical_row.posting_date is date');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'posting_date', 'reconciliation_canonical_row.posting_date is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'posting_date'),
  NULL,
  'reconciliation_canonical_row.posting_date default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'transaction_type', 'text', 'reconciliation_canonical_row.transaction_type is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'transaction_type', 'reconciliation_canonical_row.transaction_type is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'transaction_type'),
  NULL,
  'reconciliation_canonical_row.transaction_type default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'check_number', 'text', 'reconciliation_canonical_row.check_number is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'check_number', 'reconciliation_canonical_row.check_number is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'check_number'),
  NULL,
  'reconciliation_canonical_row.check_number default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'serial_number', 'text', 'reconciliation_canonical_row.serial_number is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'serial_number', 'reconciliation_canonical_row.serial_number is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'serial_number'),
  NULL,
  'reconciliation_canonical_row.serial_number default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'reference_number', 'text', 'reconciliation_canonical_row.reference_number is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'reference_number', 'reconciliation_canonical_row.reference_number is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'reference_number'),
  NULL,
  'reconciliation_canonical_row.reference_number default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'description', 'text', 'reconciliation_canonical_row.description is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'description', 'reconciliation_canonical_row.description is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'description'),
  NULL,
  'reconciliation_canonical_row.description default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'merchant_name', 'text', 'reconciliation_canonical_row.merchant_name is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'merchant_name', 'reconciliation_canonical_row.merchant_name is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'merchant_name'),
  NULL,
  'reconciliation_canonical_row.merchant_name default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'payee_name', 'text', 'reconciliation_canonical_row.payee_name is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'payee_name', 'reconciliation_canonical_row.payee_name is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'payee_name'),
  NULL,
  'reconciliation_canonical_row.payee_name default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'amount', 'numeric(18,2)', 'reconciliation_canonical_row.amount is numeric(18,2)');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'amount', 'reconciliation_canonical_row.amount is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'amount'),
  NULL,
  'reconciliation_canonical_row.amount default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'debit', 'numeric(18,2)', 'reconciliation_canonical_row.debit is numeric(18,2)');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'debit', 'reconciliation_canonical_row.debit is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'debit'),
  NULL,
  'reconciliation_canonical_row.debit default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'credit', 'numeric(18,2)', 'reconciliation_canonical_row.credit is numeric(18,2)');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'credit', 'reconciliation_canonical_row.credit is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'credit'),
  NULL,
  'reconciliation_canonical_row.credit default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'running_balance', 'numeric(18,2)', 'reconciliation_canonical_row.running_balance is numeric(18,2)');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'running_balance', 'reconciliation_canonical_row.running_balance is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'running_balance'),
  NULL,
  'reconciliation_canonical_row.running_balance default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'normalized_comparison_text', 'text', 'reconciliation_canonical_row.normalized_comparison_text is text');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'normalized_comparison_text', 'reconciliation_canonical_row.normalized_comparison_text is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'normalized_comparison_text'),
  NULL,
  'reconciliation_canonical_row.normalized_comparison_text default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'normalized_comparison_tokens', 'text[]', 'reconciliation_canonical_row.normalized_comparison_tokens is text[]');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'normalized_comparison_tokens', 'reconciliation_canonical_row.normalized_comparison_tokens is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'normalized_comparison_tokens'),
  $dflt$ARRAY[]::text[]$dflt$,
  'reconciliation_canonical_row.normalized_comparison_tokens default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'normalized_reference_tokens', 'text[]', 'reconciliation_canonical_row.normalized_reference_tokens is text[]');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'normalized_reference_tokens', 'reconciliation_canonical_row.normalized_reference_tokens is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'normalized_reference_tokens'),
  $dflt$ARRAY[]::text[]$dflt$,
  'reconciliation_canonical_row.normalized_reference_tokens default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'raw_source_values_json', 'jsonb', 'reconciliation_canonical_row.raw_source_values_json is jsonb');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'raw_source_values_json', 'reconciliation_canonical_row.raw_source_values_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'raw_source_values_json'),
  NULL,
  'reconciliation_canonical_row.raw_source_values_json default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'data_quality_issues_json', 'jsonb', 'reconciliation_canonical_row.data_quality_issues_json is jsonb');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'data_quality_issues_json', 'reconciliation_canonical_row.data_quality_issues_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'data_quality_issues_json'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_canonical_row.data_quality_issues_json default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'is_excluded', 'boolean', 'reconciliation_canonical_row.is_excluded is boolean');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'is_excluded', 'reconciliation_canonical_row.is_excluded is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'is_excluded'),
  NULL,
  'reconciliation_canonical_row.is_excluded default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'exclusion_reason', 'text', 'reconciliation_canonical_row.exclusion_reason is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'exclusion_reason', 'reconciliation_canonical_row.exclusion_reason is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'exclusion_reason'),
  NULL,
  'reconciliation_canonical_row.exclusion_reason default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'is_zero_amount', 'boolean', 'reconciliation_canonical_row.is_zero_amount is boolean');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'is_zero_amount', 'reconciliation_canonical_row.is_zero_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'is_zero_amount'),
  NULL,
  'reconciliation_canonical_row.is_zero_amount default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'context_fingerprint', 'text', 'reconciliation_canonical_row.context_fingerprint is text');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'context_fingerprint', 'reconciliation_canonical_row.context_fingerprint is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'context_fingerprint'),
  NULL,
  'reconciliation_canonical_row.context_fingerprint default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'account_identifier', 'text', 'reconciliation_canonical_row.account_identifier is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'account_identifier', 'reconciliation_canonical_row.account_identifier is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'account_identifier'),
  NULL,
  'reconciliation_canonical_row.account_identifier default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'reviewer_notes', 'text', 'reconciliation_canonical_row.reviewer_notes is text');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'reviewer_notes', 'reconciliation_canonical_row.reviewer_notes is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'reviewer_notes'),
  NULL,
  'reconciliation_canonical_row.reviewer_notes default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'created_at', 'timestamp with time zone', 'reconciliation_canonical_row.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'created_at', 'reconciliation_canonical_row.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_canonical_row.created_at default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'staged_transaction_id', 'uuid', 'reconciliation_canonical_row.staged_transaction_id is uuid');
SELECT col_is_null('public', 'reconciliation_canonical_row', 'staged_transaction_id', 'reconciliation_canonical_row.staged_transaction_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'staged_transaction_id'),
  NULL,
  'reconciliation_canonical_row.staged_transaction_id default'
);
SELECT col_type_is('public', 'reconciliation_canonical_row', 'organization_id', 'uuid', 'reconciliation_canonical_row.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_canonical_row', 'organization_id', 'reconciliation_canonical_row.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_canonical_row'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_canonical_row.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_canonical_row'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_canonical_row_raw_row_id_key => UNIQUE (raw_row_id)
reconciliation_canonical_row_source_system_check => CHECK ((source_system = ANY (ARRAY['bank'::text, 'gl'::text])))$chk$,
  'reconciliation_canonical_row check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_canonical_row'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_canonical_row' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_canonical_row grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_canonical_row'),
  $policy$reconciliation_canonical_row_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_canonical_row row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_canonical_row', ARRAY[]::name[], 'reconciliation_canonical_row has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_exception', ARRAY['id', 'job_id', 'canonical_row_id', 'category', 'severity', 'source_system', 'spreadsheet_file_name', 'line_number', 'transaction_date', 'amount', 'error_message', 'rule_trace_json', 'prior_rule_traces_json', 'recommended_next_actions', 'likely_matching_reference', 'reviewer_notes', 'match_confidence', 'normalized_comparison_tokens', 'related_transaction_ids', 'created_at', 'organization_id', 'age_in_days']::name[], 'reconciliation_exception has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_exception', ARRAY['id']::name[], 'reconciliation_exception primary key');
SELECT indexes_are('public', 'reconciliation_exception', ARRAY['reconciliation_exception_canonical_row_idx', 'reconciliation_exception_job_category_line_order_idx', 'reconciliation_exception_job_idx', 'reconciliation_exception_job_line_order_idx', 'reconciliation_exception_organization_idx', 'reconciliation_exception_pkey']::name[], 'reconciliation_exception has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_exception' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_exception has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_exception', 'id', 'uuid', 'reconciliation_exception.id is uuid');
SELECT col_not_null('public', 'reconciliation_exception', 'id', 'reconciliation_exception.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_exception.id default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'job_id', 'uuid', 'reconciliation_exception.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_exception', 'job_id', 'reconciliation_exception.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_exception.job_id default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'canonical_row_id', 'uuid', 'reconciliation_exception.canonical_row_id is uuid');
SELECT col_is_null('public', 'reconciliation_exception', 'canonical_row_id', 'reconciliation_exception.canonical_row_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'canonical_row_id'),
  NULL,
  'reconciliation_exception.canonical_row_id default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'category', 'text', 'reconciliation_exception.category is text');
SELECT col_not_null('public', 'reconciliation_exception', 'category', 'reconciliation_exception.category is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'category'),
  NULL,
  'reconciliation_exception.category default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'severity', 'text', 'reconciliation_exception.severity is text');
SELECT col_not_null('public', 'reconciliation_exception', 'severity', 'reconciliation_exception.severity is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'severity'),
  NULL,
  'reconciliation_exception.severity default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'source_system', 'text', 'reconciliation_exception.source_system is text');
SELECT col_not_null('public', 'reconciliation_exception', 'source_system', 'reconciliation_exception.source_system is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'source_system'),
  NULL,
  'reconciliation_exception.source_system default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'spreadsheet_file_name', 'text', 'reconciliation_exception.spreadsheet_file_name is text');
SELECT col_not_null('public', 'reconciliation_exception', 'spreadsheet_file_name', 'reconciliation_exception.spreadsheet_file_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'spreadsheet_file_name'),
  NULL,
  'reconciliation_exception.spreadsheet_file_name default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'line_number', 'integer', 'reconciliation_exception.line_number is integer');
SELECT col_not_null('public', 'reconciliation_exception', 'line_number', 'reconciliation_exception.line_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'line_number'),
  NULL,
  'reconciliation_exception.line_number default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'transaction_date', 'date', 'reconciliation_exception.transaction_date is date');
SELECT col_is_null('public', 'reconciliation_exception', 'transaction_date', 'reconciliation_exception.transaction_date is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'transaction_date'),
  NULL,
  'reconciliation_exception.transaction_date default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'amount', 'numeric(18,2)', 'reconciliation_exception.amount is numeric(18,2)');
SELECT col_is_null('public', 'reconciliation_exception', 'amount', 'reconciliation_exception.amount is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'amount'),
  NULL,
  'reconciliation_exception.amount default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'error_message', 'text', 'reconciliation_exception.error_message is text');
SELECT col_not_null('public', 'reconciliation_exception', 'error_message', 'reconciliation_exception.error_message is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'error_message'),
  NULL,
  'reconciliation_exception.error_message default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'rule_trace_json', 'jsonb', 'reconciliation_exception.rule_trace_json is jsonb');
SELECT col_is_null('public', 'reconciliation_exception', 'rule_trace_json', 'reconciliation_exception.rule_trace_json is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'rule_trace_json'),
  NULL,
  'reconciliation_exception.rule_trace_json default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'prior_rule_traces_json', 'jsonb', 'reconciliation_exception.prior_rule_traces_json is jsonb');
SELECT col_not_null('public', 'reconciliation_exception', 'prior_rule_traces_json', 'reconciliation_exception.prior_rule_traces_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'prior_rule_traces_json'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_exception.prior_rule_traces_json default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'recommended_next_actions', 'text[]', 'reconciliation_exception.recommended_next_actions is text[]');
SELECT col_not_null('public', 'reconciliation_exception', 'recommended_next_actions', 'reconciliation_exception.recommended_next_actions is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'recommended_next_actions'),
  $dflt$ARRAY[]::text[]$dflt$,
  'reconciliation_exception.recommended_next_actions default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'likely_matching_reference', 'text', 'reconciliation_exception.likely_matching_reference is text');
SELECT col_is_null('public', 'reconciliation_exception', 'likely_matching_reference', 'reconciliation_exception.likely_matching_reference is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'likely_matching_reference'),
  NULL,
  'reconciliation_exception.likely_matching_reference default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'reviewer_notes', 'text', 'reconciliation_exception.reviewer_notes is text');
SELECT col_is_null('public', 'reconciliation_exception', 'reviewer_notes', 'reconciliation_exception.reviewer_notes is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'reviewer_notes'),
  NULL,
  'reconciliation_exception.reviewer_notes default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'match_confidence', 'text', 'reconciliation_exception.match_confidence is text');
SELECT col_is_null('public', 'reconciliation_exception', 'match_confidence', 'reconciliation_exception.match_confidence is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'match_confidence'),
  NULL,
  'reconciliation_exception.match_confidence default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'normalized_comparison_tokens', 'text[]', 'reconciliation_exception.normalized_comparison_tokens is text[]');
SELECT col_not_null('public', 'reconciliation_exception', 'normalized_comparison_tokens', 'reconciliation_exception.normalized_comparison_tokens is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'normalized_comparison_tokens'),
  $dflt$ARRAY[]::text[]$dflt$,
  'reconciliation_exception.normalized_comparison_tokens default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'related_transaction_ids', 'uuid[]', 'reconciliation_exception.related_transaction_ids is uuid[]');
SELECT col_not_null('public', 'reconciliation_exception', 'related_transaction_ids', 'reconciliation_exception.related_transaction_ids is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'related_transaction_ids'),
  $dflt$ARRAY[]::uuid[]$dflt$,
  'reconciliation_exception.related_transaction_ids default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'created_at', 'timestamp with time zone', 'reconciliation_exception.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_exception', 'created_at', 'reconciliation_exception.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_exception.created_at default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'organization_id', 'uuid', 'reconciliation_exception.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_exception', 'organization_id', 'reconciliation_exception.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_exception.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_exception', 'age_in_days', 'integer', 'reconciliation_exception.age_in_days is integer');
SELECT col_is_null('public', 'reconciliation_exception', 'age_in_days', 'reconciliation_exception.age_in_days is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_exception'::regclass AND a.attname = 'age_in_days'),
  NULL,
  'reconciliation_exception.age_in_days default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_exception'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_exception_category_check => CHECK ((category = ANY (ARRAY['MissingFromBank'::text, 'MissingFromGL'::text, 'AmountMismatch'::text, 'DuplicateInBank'::text, 'DuplicateInGL'::text, 'LikelySplitCombineIssue'::text, 'DepositGroupingIssue'::text, 'LikelyMiscoding'::text, 'DateVariance'::text, 'TimingDifference'::text, 'CheckNumberMismatch'::text, 'ReferenceNumberMismatch'::text, 'DescriptionMerchantVariance'::text, 'WeakDescriptionMatch'::text, 'StaleOutstandingCheck'::text, 'OutstandingCheck'::text, 'FeeNettingMatch'::text, 'PartialPaymentMatch'::text, 'PayrollBatchMatch'::text, 'BankServiceChargeAmortization'::text, 'LoanPaymentSplit'::text, 'NSFReturnedDeposit'::text, 'VoidedCheckCleared'::text, 'InvalidOrMissingData'::text, 'AmbiguousMatchRequiringReview'::text, 'ReversalVoid'::text, 'ACHReturn'::text, 'DepositInTransit'::text, 'ChargebackReturn'::text, 'InterestIncome'::text, 'IntercompanyMismatch'::text])))
reconciliation_exception_source_system_check => CHECK ((source_system = ANY (ARRAY['bank'::text, 'gl'::text])))$chk$,
  'reconciliation_exception check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_exception'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_exception' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_exception grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_exception'),
  $policy$reconciliation_exception_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_exception row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_exception', ARRAY[]::name[], 'reconciliation_exception has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_export', ARRAY['id', 'job_id', 'export_type', 'state', 'file_name', 'storage_uri', 'checksum_sha256', 'byte_size', 'tab_names_json', 'generated_at', 'created_at', 'organization_id']::name[], 'reconciliation_export has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_export', ARRAY['id']::name[], 'reconciliation_export primary key');
SELECT indexes_are('public', 'reconciliation_export', ARRAY['reconciliation_export_job_id_export_type_key', 'reconciliation_export_organization_idx', 'reconciliation_export_pkey']::name[], 'reconciliation_export has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_export' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_export has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_export', 'id', 'uuid', 'reconciliation_export.id is uuid');
SELECT col_not_null('public', 'reconciliation_export', 'id', 'reconciliation_export.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_export.id default'
);
SELECT col_type_is('public', 'reconciliation_export', 'job_id', 'uuid', 'reconciliation_export.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_export', 'job_id', 'reconciliation_export.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_export.job_id default'
);
SELECT col_type_is('public', 'reconciliation_export', 'export_type', 'text', 'reconciliation_export.export_type is text');
SELECT col_not_null('public', 'reconciliation_export', 'export_type', 'reconciliation_export.export_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'export_type'),
  NULL,
  'reconciliation_export.export_type default'
);
SELECT col_type_is('public', 'reconciliation_export', 'state', 'text', 'reconciliation_export.state is text');
SELECT col_not_null('public', 'reconciliation_export', 'state', 'reconciliation_export.state is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'state'),
  NULL,
  'reconciliation_export.state default'
);
SELECT col_type_is('public', 'reconciliation_export', 'file_name', 'text', 'reconciliation_export.file_name is text');
SELECT col_not_null('public', 'reconciliation_export', 'file_name', 'reconciliation_export.file_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'file_name'),
  NULL,
  'reconciliation_export.file_name default'
);
SELECT col_type_is('public', 'reconciliation_export', 'storage_uri', 'text', 'reconciliation_export.storage_uri is text');
SELECT col_is_null('public', 'reconciliation_export', 'storage_uri', 'reconciliation_export.storage_uri is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'storage_uri'),
  NULL,
  'reconciliation_export.storage_uri default'
);
SELECT col_type_is('public', 'reconciliation_export', 'checksum_sha256', 'text', 'reconciliation_export.checksum_sha256 is text');
SELECT col_not_null('public', 'reconciliation_export', 'checksum_sha256', 'reconciliation_export.checksum_sha256 is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'checksum_sha256'),
  NULL,
  'reconciliation_export.checksum_sha256 default'
);
SELECT col_type_is('public', 'reconciliation_export', 'byte_size', 'bigint', 'reconciliation_export.byte_size is bigint');
SELECT col_not_null('public', 'reconciliation_export', 'byte_size', 'reconciliation_export.byte_size is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'byte_size'),
  NULL,
  'reconciliation_export.byte_size default'
);
SELECT col_type_is('public', 'reconciliation_export', 'tab_names_json', 'jsonb', 'reconciliation_export.tab_names_json is jsonb');
SELECT col_not_null('public', 'reconciliation_export', 'tab_names_json', 'reconciliation_export.tab_names_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'tab_names_json'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_export.tab_names_json default'
);
SELECT col_type_is('public', 'reconciliation_export', 'generated_at', 'timestamp with time zone', 'reconciliation_export.generated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_export', 'generated_at', 'reconciliation_export.generated_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'generated_at'),
  NULL,
  'reconciliation_export.generated_at default'
);
SELECT col_type_is('public', 'reconciliation_export', 'created_at', 'timestamp with time zone', 'reconciliation_export.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_export', 'created_at', 'reconciliation_export.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_export.created_at default'
);
SELECT col_type_is('public', 'reconciliation_export', 'organization_id', 'uuid', 'reconciliation_export.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_export', 'organization_id', 'reconciliation_export.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_export'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_export.organization_id default'
);
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
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_export'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_export' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_export grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_export'),
  $policy$reconciliation_export_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_export row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_export', ARRAY[]::name[], 'reconciliation_export has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_import_approval', ARRAY['id', 'source_file_id', 'status', 'uploaded_by', 'approved_by', 'rationale', 'requested_at', 'decided_at', 'created_at', 'organization_id']::name[], 'reconciliation_import_approval has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_import_approval', ARRAY['id']::name[], 'reconciliation_import_approval primary key');
SELECT indexes_are('public', 'reconciliation_import_approval', ARRAY['reconciliation_import_approval_approved_by_idx', 'reconciliation_import_approval_organization_idx', 'reconciliation_import_approval_pkey', 'reconciliation_import_approval_source_file_key', 'reconciliation_import_approval_status_idx', 'reconciliation_import_approval_uploaded_by_idx']::name[], 'reconciliation_import_approval has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_import_approval' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_import_approval has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_import_approval', 'id', 'uuid', 'reconciliation_import_approval.id is uuid');
SELECT col_not_null('public', 'reconciliation_import_approval', 'id', 'reconciliation_import_approval.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_approval'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_import_approval.id default'
);
SELECT col_type_is('public', 'reconciliation_import_approval', 'source_file_id', 'uuid', 'reconciliation_import_approval.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_import_approval', 'source_file_id', 'reconciliation_import_approval.source_file_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_approval'::regclass AND a.attname = 'source_file_id'),
  NULL,
  'reconciliation_import_approval.source_file_id default'
);
SELECT col_type_is('public', 'reconciliation_import_approval', 'status', 'text', 'reconciliation_import_approval.status is text');
SELECT col_not_null('public', 'reconciliation_import_approval', 'status', 'reconciliation_import_approval.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_approval'::regclass AND a.attname = 'status'),
  $dflt$'PENDING'::text$dflt$,
  'reconciliation_import_approval.status default'
);
SELECT col_type_is('public', 'reconciliation_import_approval', 'uploaded_by', 'text', 'reconciliation_import_approval.uploaded_by is text');
SELECT col_not_null('public', 'reconciliation_import_approval', 'uploaded_by', 'reconciliation_import_approval.uploaded_by is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_approval'::regclass AND a.attname = 'uploaded_by'),
  NULL,
  'reconciliation_import_approval.uploaded_by default'
);
SELECT col_type_is('public', 'reconciliation_import_approval', 'approved_by', 'text', 'reconciliation_import_approval.approved_by is text');
SELECT col_is_null('public', 'reconciliation_import_approval', 'approved_by', 'reconciliation_import_approval.approved_by is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_approval'::regclass AND a.attname = 'approved_by'),
  NULL,
  'reconciliation_import_approval.approved_by default'
);
SELECT col_type_is('public', 'reconciliation_import_approval', 'rationale', 'text', 'reconciliation_import_approval.rationale is text');
SELECT col_is_null('public', 'reconciliation_import_approval', 'rationale', 'reconciliation_import_approval.rationale is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_approval'::regclass AND a.attname = 'rationale'),
  NULL,
  'reconciliation_import_approval.rationale default'
);
SELECT col_type_is('public', 'reconciliation_import_approval', 'requested_at', 'timestamp with time zone', 'reconciliation_import_approval.requested_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_import_approval', 'requested_at', 'reconciliation_import_approval.requested_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_approval'::regclass AND a.attname = 'requested_at'),
  $dflt$now()$dflt$,
  'reconciliation_import_approval.requested_at default'
);
SELECT col_type_is('public', 'reconciliation_import_approval', 'decided_at', 'timestamp with time zone', 'reconciliation_import_approval.decided_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_import_approval', 'decided_at', 'reconciliation_import_approval.decided_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_approval'::regclass AND a.attname = 'decided_at'),
  NULL,
  'reconciliation_import_approval.decided_at default'
);
SELECT col_type_is('public', 'reconciliation_import_approval', 'created_at', 'timestamp with time zone', 'reconciliation_import_approval.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_import_approval', 'created_at', 'reconciliation_import_approval.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_approval'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_import_approval.created_at default'
);
SELECT col_type_is('public', 'reconciliation_import_approval', 'organization_id', 'uuid', 'reconciliation_import_approval.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_import_approval', 'organization_id', 'reconciliation_import_approval.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_approval'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_import_approval.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_import_approval'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_import_approval_source_file_key => UNIQUE (source_file_id)
reconciliation_import_approval_status_check => CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'OVERRIDDEN'::text])))$chk$,
  'reconciliation_import_approval check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_import_approval'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_import_approval' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_import_approval grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_import_approval'),
  $policy$reconciliation_import_approval_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_import_approval row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_import_approval', ARRAY[]::name[], 'reconciliation_import_approval has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_import_batch', ARRAY['id', 'job_id', 'source_file_id', 'batch_number', 'state', 'row_start_number', 'row_end_number', 'row_count', 'started_at', 'completed_at', 'error_message', 'created_at', 'organization_id']::name[], 'reconciliation_import_batch has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_import_batch', ARRAY['id']::name[], 'reconciliation_import_batch primary key');
SELECT indexes_are('public', 'reconciliation_import_batch', ARRAY['reconciliation_import_batch_job_idx', 'reconciliation_import_batch_organization_idx', 'reconciliation_import_batch_pkey', 'reconciliation_import_batch_source_file_id_batch_number_key']::name[], 'reconciliation_import_batch has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_import_batch' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_import_batch has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'id', 'uuid', 'reconciliation_import_batch.id is uuid');
SELECT col_not_null('public', 'reconciliation_import_batch', 'id', 'reconciliation_import_batch.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_import_batch.id default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'job_id', 'uuid', 'reconciliation_import_batch.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_import_batch', 'job_id', 'reconciliation_import_batch.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_import_batch.job_id default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'source_file_id', 'uuid', 'reconciliation_import_batch.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_import_batch', 'source_file_id', 'reconciliation_import_batch.source_file_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'source_file_id'),
  NULL,
  'reconciliation_import_batch.source_file_id default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'batch_number', 'integer', 'reconciliation_import_batch.batch_number is integer');
SELECT col_not_null('public', 'reconciliation_import_batch', 'batch_number', 'reconciliation_import_batch.batch_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'batch_number'),
  NULL,
  'reconciliation_import_batch.batch_number default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'state', 'text', 'reconciliation_import_batch.state is text');
SELECT col_not_null('public', 'reconciliation_import_batch', 'state', 'reconciliation_import_batch.state is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'state'),
  NULL,
  'reconciliation_import_batch.state default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'row_start_number', 'integer', 'reconciliation_import_batch.row_start_number is integer');
SELECT col_not_null('public', 'reconciliation_import_batch', 'row_start_number', 'reconciliation_import_batch.row_start_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'row_start_number'),
  NULL,
  'reconciliation_import_batch.row_start_number default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'row_end_number', 'integer', 'reconciliation_import_batch.row_end_number is integer');
SELECT col_not_null('public', 'reconciliation_import_batch', 'row_end_number', 'reconciliation_import_batch.row_end_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'row_end_number'),
  NULL,
  'reconciliation_import_batch.row_end_number default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'row_count', 'integer', 'reconciliation_import_batch.row_count is integer');
SELECT col_not_null('public', 'reconciliation_import_batch', 'row_count', 'reconciliation_import_batch.row_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'row_count'),
  NULL,
  'reconciliation_import_batch.row_count default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'started_at', 'timestamp with time zone', 'reconciliation_import_batch.started_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_import_batch', 'started_at', 'reconciliation_import_batch.started_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'started_at'),
  NULL,
  'reconciliation_import_batch.started_at default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'completed_at', 'timestamp with time zone', 'reconciliation_import_batch.completed_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_import_batch', 'completed_at', 'reconciliation_import_batch.completed_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'completed_at'),
  NULL,
  'reconciliation_import_batch.completed_at default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'error_message', 'text', 'reconciliation_import_batch.error_message is text');
SELECT col_is_null('public', 'reconciliation_import_batch', 'error_message', 'reconciliation_import_batch.error_message is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'error_message'),
  NULL,
  'reconciliation_import_batch.error_message default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'created_at', 'timestamp with time zone', 'reconciliation_import_batch.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_import_batch', 'created_at', 'reconciliation_import_batch.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_import_batch.created_at default'
);
SELECT col_type_is('public', 'reconciliation_import_batch', 'organization_id', 'uuid', 'reconciliation_import_batch.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_import_batch', 'organization_id', 'reconciliation_import_batch.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_import_batch'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_import_batch.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_import_batch'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_import_batch_row_count_check => CHECK ((row_count >= 0))
reconciliation_import_batch_source_file_id_batch_number_key => UNIQUE (source_file_id, batch_number)
reconciliation_import_batch_state_check => CHECK ((state = ANY (ARRAY['PENDING'::text, 'IMPORTING'::text, 'IMPORTED'::text, 'FAILED'::text])))$chk$,
  'reconciliation_import_batch check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_import_batch'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_import_batch' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_import_batch grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_import_batch'),
  $policy$reconciliation_import_batch_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_import_batch row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_import_batch', ARRAY[]::name[], 'reconciliation_import_batch has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_job', ARRAY['id', 'correlation_id', 'account_identifier', 'period_label', 'reconciliation_frequency', 'current_state', 'input_fingerprint', 'schema_version', 'rulepack_version', 'record_version', 'retry_count', 'failure_code', 'failure_message', 'created_at', 'updated_at', 'started_at', 'completed_at', 'organization_id']::name[], 'reconciliation_job has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_job', ARRAY['id']::name[], 'reconciliation_job primary key');
SELECT indexes_are('public', 'reconciliation_job', ARRAY['reconciliation_job_completed_report_idx', 'reconciliation_job_fingerprint_idx', 'reconciliation_job_organization_idx', 'reconciliation_job_pkey', 'reconciliation_job_state_idx']::name[], 'reconciliation_job has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_job' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_job has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_job', 'id', 'uuid', 'reconciliation_job.id is uuid');
SELECT col_not_null('public', 'reconciliation_job', 'id', 'reconciliation_job.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_job.id default'
);
SELECT col_type_is('public', 'reconciliation_job', 'correlation_id', 'text', 'reconciliation_job.correlation_id is text');
SELECT col_not_null('public', 'reconciliation_job', 'correlation_id', 'reconciliation_job.correlation_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'correlation_id'),
  NULL,
  'reconciliation_job.correlation_id default'
);
SELECT col_type_is('public', 'reconciliation_job', 'account_identifier', 'text', 'reconciliation_job.account_identifier is text');
SELECT col_is_null('public', 'reconciliation_job', 'account_identifier', 'reconciliation_job.account_identifier is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'account_identifier'),
  NULL,
  'reconciliation_job.account_identifier default'
);
SELECT col_type_is('public', 'reconciliation_job', 'period_label', 'text', 'reconciliation_job.period_label is text');
SELECT col_is_null('public', 'reconciliation_job', 'period_label', 'reconciliation_job.period_label is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'period_label'),
  NULL,
  'reconciliation_job.period_label default'
);
SELECT col_type_is('public', 'reconciliation_job', 'reconciliation_frequency', 'text', 'reconciliation_job.reconciliation_frequency is text');
SELECT col_is_null('public', 'reconciliation_job', 'reconciliation_frequency', 'reconciliation_job.reconciliation_frequency is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'reconciliation_frequency'),
  NULL,
  'reconciliation_job.reconciliation_frequency default'
);
SELECT col_type_is('public', 'reconciliation_job', 'current_state', 'text', 'reconciliation_job.current_state is text');
SELECT col_not_null('public', 'reconciliation_job', 'current_state', 'reconciliation_job.current_state is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'current_state'),
  NULL,
  'reconciliation_job.current_state default'
);
SELECT col_type_is('public', 'reconciliation_job', 'input_fingerprint', 'text', 'reconciliation_job.input_fingerprint is text');
SELECT col_is_null('public', 'reconciliation_job', 'input_fingerprint', 'reconciliation_job.input_fingerprint is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'input_fingerprint'),
  NULL,
  'reconciliation_job.input_fingerprint default'
);
SELECT col_type_is('public', 'reconciliation_job', 'schema_version', 'integer', 'reconciliation_job.schema_version is integer');
SELECT col_not_null('public', 'reconciliation_job', 'schema_version', 'reconciliation_job.schema_version is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'schema_version'),
  $dflt$1$dflt$,
  'reconciliation_job.schema_version default'
);
SELECT col_type_is('public', 'reconciliation_job', 'rulepack_version', 'text', 'reconciliation_job.rulepack_version is text');
SELECT col_not_null('public', 'reconciliation_job', 'rulepack_version', 'reconciliation_job.rulepack_version is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'rulepack_version'),
  NULL,
  'reconciliation_job.rulepack_version default'
);
SELECT col_type_is('public', 'reconciliation_job', 'record_version', 'integer', 'reconciliation_job.record_version is integer');
SELECT col_not_null('public', 'reconciliation_job', 'record_version', 'reconciliation_job.record_version is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'record_version'),
  $dflt$1$dflt$,
  'reconciliation_job.record_version default'
);
SELECT col_type_is('public', 'reconciliation_job', 'retry_count', 'integer', 'reconciliation_job.retry_count is integer');
SELECT col_not_null('public', 'reconciliation_job', 'retry_count', 'reconciliation_job.retry_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'retry_count'),
  $dflt$0$dflt$,
  'reconciliation_job.retry_count default'
);
SELECT col_type_is('public', 'reconciliation_job', 'failure_code', 'text', 'reconciliation_job.failure_code is text');
SELECT col_is_null('public', 'reconciliation_job', 'failure_code', 'reconciliation_job.failure_code is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'failure_code'),
  NULL,
  'reconciliation_job.failure_code default'
);
SELECT col_type_is('public', 'reconciliation_job', 'failure_message', 'text', 'reconciliation_job.failure_message is text');
SELECT col_is_null('public', 'reconciliation_job', 'failure_message', 'reconciliation_job.failure_message is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'failure_message'),
  NULL,
  'reconciliation_job.failure_message default'
);
SELECT col_type_is('public', 'reconciliation_job', 'created_at', 'timestamp with time zone', 'reconciliation_job.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_job', 'created_at', 'reconciliation_job.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_job.created_at default'
);
SELECT col_type_is('public', 'reconciliation_job', 'updated_at', 'timestamp with time zone', 'reconciliation_job.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_job', 'updated_at', 'reconciliation_job.updated_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'updated_at'),
  $dflt$now()$dflt$,
  'reconciliation_job.updated_at default'
);
SELECT col_type_is('public', 'reconciliation_job', 'started_at', 'timestamp with time zone', 'reconciliation_job.started_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_job', 'started_at', 'reconciliation_job.started_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'started_at'),
  NULL,
  'reconciliation_job.started_at default'
);
SELECT col_type_is('public', 'reconciliation_job', 'completed_at', 'timestamp with time zone', 'reconciliation_job.completed_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_job', 'completed_at', 'reconciliation_job.completed_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'completed_at'),
  NULL,
  'reconciliation_job.completed_at default'
);
SELECT col_type_is('public', 'reconciliation_job', 'organization_id', 'uuid', 'reconciliation_job.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_job', 'organization_id', 'reconciliation_job.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_job.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_job'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_job_current_state_check => CHECK ((current_state = ANY (ARRAY['CREATED'::text, 'FILE_REGISTERED'::text, 'IMPORTING'::text, 'IMPORTED'::text, 'NORMALIZING'::text, 'NORMALIZED'::text, 'MATCHING'::text, 'MATCHED'::text, 'EXCEPTIONS_IDENTIFIED'::text, 'REVIEW_READY'::text, 'FINALIZED'::text, 'FAILED'::text, 'RETRY_PENDING'::text, 'CANCELLED'::text])))
reconciliation_job_reconciliation_frequency_check => CHECK ((reconciliation_frequency = ANY (ARRAY['Monthly'::text, 'Annual'::text])))$chk$,
  'reconciliation_job check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_job'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_job' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_job grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_job'),
  $policy$reconciliation_job_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_job row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_job', ARRAY['trg_reconciliation_job_updated_at']::name[], 'reconciliation_job has exactly the expected triggers');
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_reconciliation_job_updated_at' AND tgrelid = 'public.reconciliation_job'::regclass),
  $trig$CREATE TRIGGER trg_reconciliation_job_updated_at BEFORE UPDATE ON public.reconciliation_job FOR EACH ROW EXECUTE FUNCTION set_updated_at()$trig$,
  'reconciliation_job.trg_reconciliation_job_updated_at definition'
);
SELECT columns_are('public', 'reconciliation_job_summary', ARRAY['job_id', 'total_records_reviewed', 'bank_records', 'gl_records', 'exact_matches', 'probable_matches', 'unmatched_items', 'duplicates', 'bank_duplicates', 'gl_duplicates', 'date_variances', 'timing_differences', 'data_quality_issues', 'amount_mismatches', 'missing_from_bank', 'missing_from_gl', 'unmatched_bank_net_amount', 'unmatched_gl_net_amount', 'clean_matched_amount', 'unresolved_exposure', 'counts_by_category_json', 'amount_by_category_json', 'charts_json', 'created_at', 'updated_at', 'id', 'organization_id']::name[], 'reconciliation_job_summary has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_job_summary', ARRAY['job_id']::name[], 'reconciliation_job_summary primary key');
SELECT indexes_are('public', 'reconciliation_job_summary', ARRAY['reconciliation_job_summary_id_key', 'reconciliation_job_summary_organization_idx', 'reconciliation_job_summary_pkey']::name[], 'reconciliation_job_summary has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_job_summary' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_job_summary has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'job_id', 'uuid', 'reconciliation_job_summary.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_job_summary', 'job_id', 'reconciliation_job_summary.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_job_summary.job_id default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'total_records_reviewed', 'integer', 'reconciliation_job_summary.total_records_reviewed is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'total_records_reviewed', 'reconciliation_job_summary.total_records_reviewed is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'total_records_reviewed'),
  NULL,
  'reconciliation_job_summary.total_records_reviewed default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'bank_records', 'integer', 'reconciliation_job_summary.bank_records is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'bank_records', 'reconciliation_job_summary.bank_records is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'bank_records'),
  NULL,
  'reconciliation_job_summary.bank_records default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'gl_records', 'integer', 'reconciliation_job_summary.gl_records is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'gl_records', 'reconciliation_job_summary.gl_records is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'gl_records'),
  NULL,
  'reconciliation_job_summary.gl_records default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'exact_matches', 'integer', 'reconciliation_job_summary.exact_matches is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'exact_matches', 'reconciliation_job_summary.exact_matches is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'exact_matches'),
  NULL,
  'reconciliation_job_summary.exact_matches default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'probable_matches', 'integer', 'reconciliation_job_summary.probable_matches is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'probable_matches', 'reconciliation_job_summary.probable_matches is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'probable_matches'),
  NULL,
  'reconciliation_job_summary.probable_matches default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'unmatched_items', 'integer', 'reconciliation_job_summary.unmatched_items is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'unmatched_items', 'reconciliation_job_summary.unmatched_items is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'unmatched_items'),
  NULL,
  'reconciliation_job_summary.unmatched_items default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'duplicates', 'integer', 'reconciliation_job_summary.duplicates is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'duplicates', 'reconciliation_job_summary.duplicates is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'duplicates'),
  NULL,
  'reconciliation_job_summary.duplicates default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'bank_duplicates', 'integer', 'reconciliation_job_summary.bank_duplicates is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'bank_duplicates', 'reconciliation_job_summary.bank_duplicates is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'bank_duplicates'),
  NULL,
  'reconciliation_job_summary.bank_duplicates default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'gl_duplicates', 'integer', 'reconciliation_job_summary.gl_duplicates is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'gl_duplicates', 'reconciliation_job_summary.gl_duplicates is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'gl_duplicates'),
  NULL,
  'reconciliation_job_summary.gl_duplicates default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'date_variances', 'integer', 'reconciliation_job_summary.date_variances is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'date_variances', 'reconciliation_job_summary.date_variances is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'date_variances'),
  NULL,
  'reconciliation_job_summary.date_variances default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'timing_differences', 'integer', 'reconciliation_job_summary.timing_differences is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'timing_differences', 'reconciliation_job_summary.timing_differences is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'timing_differences'),
  NULL,
  'reconciliation_job_summary.timing_differences default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'data_quality_issues', 'integer', 'reconciliation_job_summary.data_quality_issues is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'data_quality_issues', 'reconciliation_job_summary.data_quality_issues is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'data_quality_issues'),
  NULL,
  'reconciliation_job_summary.data_quality_issues default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'amount_mismatches', 'integer', 'reconciliation_job_summary.amount_mismatches is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'amount_mismatches', 'reconciliation_job_summary.amount_mismatches is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'amount_mismatches'),
  NULL,
  'reconciliation_job_summary.amount_mismatches default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'missing_from_bank', 'integer', 'reconciliation_job_summary.missing_from_bank is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'missing_from_bank', 'reconciliation_job_summary.missing_from_bank is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'missing_from_bank'),
  NULL,
  'reconciliation_job_summary.missing_from_bank default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'missing_from_gl', 'integer', 'reconciliation_job_summary.missing_from_gl is integer');
SELECT col_not_null('public', 'reconciliation_job_summary', 'missing_from_gl', 'reconciliation_job_summary.missing_from_gl is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'missing_from_gl'),
  NULL,
  'reconciliation_job_summary.missing_from_gl default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'unmatched_bank_net_amount', 'numeric(18,2)', 'reconciliation_job_summary.unmatched_bank_net_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_job_summary', 'unmatched_bank_net_amount', 'reconciliation_job_summary.unmatched_bank_net_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'unmatched_bank_net_amount'),
  NULL,
  'reconciliation_job_summary.unmatched_bank_net_amount default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'unmatched_gl_net_amount', 'numeric(18,2)', 'reconciliation_job_summary.unmatched_gl_net_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_job_summary', 'unmatched_gl_net_amount', 'reconciliation_job_summary.unmatched_gl_net_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'unmatched_gl_net_amount'),
  NULL,
  'reconciliation_job_summary.unmatched_gl_net_amount default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'clean_matched_amount', 'numeric(18,2)', 'reconciliation_job_summary.clean_matched_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_job_summary', 'clean_matched_amount', 'reconciliation_job_summary.clean_matched_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'clean_matched_amount'),
  NULL,
  'reconciliation_job_summary.clean_matched_amount default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'unresolved_exposure', 'numeric(18,2)', 'reconciliation_job_summary.unresolved_exposure is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_job_summary', 'unresolved_exposure', 'reconciliation_job_summary.unresolved_exposure is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'unresolved_exposure'),
  NULL,
  'reconciliation_job_summary.unresolved_exposure default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'counts_by_category_json', 'jsonb', 'reconciliation_job_summary.counts_by_category_json is jsonb');
SELECT col_not_null('public', 'reconciliation_job_summary', 'counts_by_category_json', 'reconciliation_job_summary.counts_by_category_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'counts_by_category_json'),
  NULL,
  'reconciliation_job_summary.counts_by_category_json default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'amount_by_category_json', 'jsonb', 'reconciliation_job_summary.amount_by_category_json is jsonb');
SELECT col_not_null('public', 'reconciliation_job_summary', 'amount_by_category_json', 'reconciliation_job_summary.amount_by_category_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'amount_by_category_json'),
  NULL,
  'reconciliation_job_summary.amount_by_category_json default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'charts_json', 'jsonb', 'reconciliation_job_summary.charts_json is jsonb');
SELECT col_not_null('public', 'reconciliation_job_summary', 'charts_json', 'reconciliation_job_summary.charts_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'charts_json'),
  NULL,
  'reconciliation_job_summary.charts_json default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'created_at', 'timestamp with time zone', 'reconciliation_job_summary.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_job_summary', 'created_at', 'reconciliation_job_summary.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_job_summary.created_at default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'updated_at', 'timestamp with time zone', 'reconciliation_job_summary.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_job_summary', 'updated_at', 'reconciliation_job_summary.updated_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'updated_at'),
  $dflt$now()$dflt$,
  'reconciliation_job_summary.updated_at default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'id', 'uuid', 'reconciliation_job_summary.id is uuid');
SELECT col_not_null('public', 'reconciliation_job_summary', 'id', 'reconciliation_job_summary.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'id'),
  $dflt$gen_random_uuid()$dflt$,
  'reconciliation_job_summary.id default'
);
SELECT col_type_is('public', 'reconciliation_job_summary', 'organization_id', 'uuid', 'reconciliation_job_summary.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_job_summary', 'organization_id', 'reconciliation_job_summary.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_job_summary'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_job_summary.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_job_summary'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_job_summary_id_key => UNIQUE (id)$chk$,
  'reconciliation_job_summary check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_job_summary'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_job_summary' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_job_summary grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_job_summary'),
  $policy$reconciliation_job_summary_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_job_summary row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_job_summary', ARRAY['trg_reconciliation_job_summary_updated_at']::name[], 'reconciliation_job_summary has exactly the expected triggers');
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_reconciliation_job_summary_updated_at' AND tgrelid = 'public.reconciliation_job_summary'::regclass),
  $trig$CREATE TRIGGER trg_reconciliation_job_summary_updated_at BEFORE UPDATE ON public.reconciliation_job_summary FOR EACH ROW EXECUTE FUNCTION set_updated_at()$trig$,
  'reconciliation_job_summary.trg_reconciliation_job_summary_updated_at definition'
);
SELECT columns_are('public', 'reconciliation_login_event', ARRAY['id', 'organization_id', 'username', 'event_type', 'failure_reason', 'ip_address', 'created_at', 'session_id']::name[], 'reconciliation_login_event has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_login_event', ARRAY['id']::name[], 'reconciliation_login_event primary key');
SELECT indexes_are('public', 'reconciliation_login_event', ARRAY['reconciliation_login_event_organization_idx', 'reconciliation_login_event_pkey', 'reconciliation_login_event_session_idx', 'reconciliation_login_event_username_idx']::name[], 'reconciliation_login_event has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_login_event', 'id', 'uuid', 'reconciliation_login_event.id is uuid');
SELECT col_not_null('public', 'reconciliation_login_event', 'id', 'reconciliation_login_event.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_login_event'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_login_event.id default'
);
SELECT col_type_is('public', 'reconciliation_login_event', 'organization_id', 'uuid', 'reconciliation_login_event.organization_id is uuid');
SELECT col_is_null('public', 'reconciliation_login_event', 'organization_id', 'reconciliation_login_event.organization_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_login_event'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_login_event.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_login_event', 'username', 'text', 'reconciliation_login_event.username is text');
SELECT col_not_null('public', 'reconciliation_login_event', 'username', 'reconciliation_login_event.username is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_login_event'::regclass AND a.attname = 'username'),
  NULL,
  'reconciliation_login_event.username default'
);
SELECT col_type_is('public', 'reconciliation_login_event', 'event_type', 'text', 'reconciliation_login_event.event_type is text');
SELECT col_not_null('public', 'reconciliation_login_event', 'event_type', 'reconciliation_login_event.event_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_login_event'::regclass AND a.attname = 'event_type'),
  NULL,
  'reconciliation_login_event.event_type default'
);
SELECT col_type_is('public', 'reconciliation_login_event', 'failure_reason', 'text', 'reconciliation_login_event.failure_reason is text');
SELECT col_is_null('public', 'reconciliation_login_event', 'failure_reason', 'reconciliation_login_event.failure_reason is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_login_event'::regclass AND a.attname = 'failure_reason'),
  NULL,
  'reconciliation_login_event.failure_reason default'
);
SELECT col_type_is('public', 'reconciliation_login_event', 'ip_address', 'text', 'reconciliation_login_event.ip_address is text');
SELECT col_is_null('public', 'reconciliation_login_event', 'ip_address', 'reconciliation_login_event.ip_address is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_login_event'::regclass AND a.attname = 'ip_address'),
  NULL,
  'reconciliation_login_event.ip_address default'
);
SELECT col_type_is('public', 'reconciliation_login_event', 'created_at', 'timestamp with time zone', 'reconciliation_login_event.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_login_event', 'created_at', 'reconciliation_login_event.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_login_event'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_login_event.created_at default'
);
SELECT col_type_is('public', 'reconciliation_login_event', 'session_id', 'uuid', 'reconciliation_login_event.session_id is uuid');
SELECT col_is_null('public', 'reconciliation_login_event', 'session_id', 'reconciliation_login_event.session_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_login_event'::regclass AND a.attname = 'session_id'),
  NULL,
  'reconciliation_login_event.session_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_login_event'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_login_event_event_type_check => CHECK ((event_type = ANY (ARRAY['LOGIN_SUCCESS'::text, 'LOGIN_FAILURE'::text, 'LOGOUT'::text])))$chk$,
  'reconciliation_login_event check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_login_event'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_login_event' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_login_event grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_login_event'),
  $policy$$policy$,
  'reconciliation_login_event row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_login_event', ARRAY[]::name[], 'reconciliation_login_event has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_mapping_profile', ARRAY['id', 'organization_id', 'name', 'source_type', 'status', 'created_at']::name[], 'reconciliation_mapping_profile has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_mapping_profile', ARRAY['id']::name[], 'reconciliation_mapping_profile primary key');
SELECT indexes_are('public', 'reconciliation_mapping_profile', ARRAY['reconciliation_mapping_profile_org_name_key', 'reconciliation_mapping_profile_organization_idx', 'reconciliation_mapping_profile_pkey']::name[], 'reconciliation_mapping_profile has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_mapping_profile' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_mapping_profile has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'id', 'uuid', 'reconciliation_mapping_profile.id is uuid');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'id', 'reconciliation_mapping_profile.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_mapping_profile.id default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'organization_id', 'uuid', 'reconciliation_mapping_profile.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'organization_id', 'reconciliation_mapping_profile.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_mapping_profile.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'name', 'text', 'reconciliation_mapping_profile.name is text');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'name', 'reconciliation_mapping_profile.name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile'::regclass AND a.attname = 'name'),
  NULL,
  'reconciliation_mapping_profile.name default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'source_type', 'text', 'reconciliation_mapping_profile.source_type is text');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'source_type', 'reconciliation_mapping_profile.source_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile'::regclass AND a.attname = 'source_type'),
  NULL,
  'reconciliation_mapping_profile.source_type default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'status', 'text', 'reconciliation_mapping_profile.status is text');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'status', 'reconciliation_mapping_profile.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile'::regclass AND a.attname = 'status'),
  $dflt$'ACTIVE'::text$dflt$,
  'reconciliation_mapping_profile.status default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile', 'created_at', 'timestamp with time zone', 'reconciliation_mapping_profile.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_mapping_profile', 'created_at', 'reconciliation_mapping_profile.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_mapping_profile.created_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_mapping_profile'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_mapping_profile_org_name_key => UNIQUE (organization_id, name, source_type)
reconciliation_mapping_profile_source_type_check => CHECK ((source_type = ANY (ARRAY['bank'::text, 'gl'::text])))
reconciliation_mapping_profile_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))$chk$,
  'reconciliation_mapping_profile check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_mapping_profile'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_mapping_profile' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_mapping_profile grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_mapping_profile'),
  $policy$reconciliation_mapping_profile_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_mapping_profile row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_mapping_profile', ARRAY[]::name[], 'reconciliation_mapping_profile has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_mapping_profile_version', ARRAY['id', 'profile_id', 'version_number', 'column_mapping', 'transformation_rules', 'status', 'created_by', 'created_at', 'organization_id']::name[], 'reconciliation_mapping_profile_version has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_mapping_profile_version', ARRAY['id']::name[], 'reconciliation_mapping_profile_version primary key');
SELECT indexes_are('public', 'reconciliation_mapping_profile_version', ARRAY['reconciliation_mapping_profile_version_key', 'reconciliation_mapping_profile_version_organization_idx', 'reconciliation_mapping_profile_version_pkey', 'reconciliation_mapping_profile_version_profile_idx']::name[], 'reconciliation_mapping_profile_version has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_mapping_profile_version' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_mapping_profile_version has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'id', 'uuid', 'reconciliation_mapping_profile_version.id is uuid');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'id', 'reconciliation_mapping_profile_version.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile_version'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_mapping_profile_version.id default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'profile_id', 'uuid', 'reconciliation_mapping_profile_version.profile_id is uuid');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'profile_id', 'reconciliation_mapping_profile_version.profile_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile_version'::regclass AND a.attname = 'profile_id'),
  NULL,
  'reconciliation_mapping_profile_version.profile_id default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'version_number', 'integer', 'reconciliation_mapping_profile_version.version_number is integer');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'version_number', 'reconciliation_mapping_profile_version.version_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile_version'::regclass AND a.attname = 'version_number'),
  NULL,
  'reconciliation_mapping_profile_version.version_number default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'column_mapping', 'jsonb', 'reconciliation_mapping_profile_version.column_mapping is jsonb');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'column_mapping', 'reconciliation_mapping_profile_version.column_mapping is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile_version'::regclass AND a.attname = 'column_mapping'),
  NULL,
  'reconciliation_mapping_profile_version.column_mapping default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'transformation_rules', 'jsonb', 'reconciliation_mapping_profile_version.transformation_rules is jsonb');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'transformation_rules', 'reconciliation_mapping_profile_version.transformation_rules is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile_version'::regclass AND a.attname = 'transformation_rules'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_mapping_profile_version.transformation_rules default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'status', 'text', 'reconciliation_mapping_profile_version.status is text');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'status', 'reconciliation_mapping_profile_version.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile_version'::regclass AND a.attname = 'status'),
  $dflt$'ACTIVE'::text$dflt$,
  'reconciliation_mapping_profile_version.status default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'created_by', 'text', 'reconciliation_mapping_profile_version.created_by is text');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'created_by', 'reconciliation_mapping_profile_version.created_by is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile_version'::regclass AND a.attname = 'created_by'),
  NULL,
  'reconciliation_mapping_profile_version.created_by default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'created_at', 'timestamp with time zone', 'reconciliation_mapping_profile_version.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'created_at', 'reconciliation_mapping_profile_version.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile_version'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_mapping_profile_version.created_at default'
);
SELECT col_type_is('public', 'reconciliation_mapping_profile_version', 'organization_id', 'uuid', 'reconciliation_mapping_profile_version.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_mapping_profile_version', 'organization_id', 'reconciliation_mapping_profile_version.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_mapping_profile_version'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_mapping_profile_version.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_mapping_profile_version'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_mapping_profile_version_key => UNIQUE (profile_id, version_number)
reconciliation_mapping_profile_version_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))
reconciliation_mapping_profile_version_version_number_check => CHECK ((version_number > 0))$chk$,
  'reconciliation_mapping_profile_version check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_mapping_profile_version'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_mapping_profile_version' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_mapping_profile_version grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_mapping_profile_version'),
  $policy$reconciliation_mapping_profile_version_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_mapping_profile_version row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_mapping_profile_version', ARRAY[]::name[], 'reconciliation_mapping_profile_version has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_match_group', ARRAY['id', 'job_id', 'disposition', 'confidence', 'category', 'bank_transaction_ids', 'gl_transaction_ids', 'bank_members_json', 'gl_members_json', 'total_amount', 'date_difference_days', 'score', 'rule_id', 'rule_name', 'reason', 'evidence_json', 'created_at', 'organization_id']::name[], 'reconciliation_match_group has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_match_group', ARRAY['id']::name[], 'reconciliation_match_group primary key');
SELECT indexes_are('public', 'reconciliation_match_group', ARRAY['reconciliation_match_group_job_idx', 'reconciliation_match_group_organization_idx', 'reconciliation_match_group_pkey']::name[], 'reconciliation_match_group has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_match_group' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_match_group has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'id', 'uuid', 'reconciliation_match_group.id is uuid');
SELECT col_not_null('public', 'reconciliation_match_group', 'id', 'reconciliation_match_group.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_match_group.id default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'job_id', 'uuid', 'reconciliation_match_group.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_match_group', 'job_id', 'reconciliation_match_group.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_match_group.job_id default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'disposition', 'text', 'reconciliation_match_group.disposition is text');
SELECT col_not_null('public', 'reconciliation_match_group', 'disposition', 'reconciliation_match_group.disposition is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'disposition'),
  NULL,
  'reconciliation_match_group.disposition default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'confidence', 'text', 'reconciliation_match_group.confidence is text');
SELECT col_not_null('public', 'reconciliation_match_group', 'confidence', 'reconciliation_match_group.confidence is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'confidence'),
  NULL,
  'reconciliation_match_group.confidence default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'category', 'text', 'reconciliation_match_group.category is text');
SELECT col_is_null('public', 'reconciliation_match_group', 'category', 'reconciliation_match_group.category is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'category'),
  NULL,
  'reconciliation_match_group.category default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'bank_transaction_ids', 'uuid[]', 'reconciliation_match_group.bank_transaction_ids is uuid[]');
SELECT col_not_null('public', 'reconciliation_match_group', 'bank_transaction_ids', 'reconciliation_match_group.bank_transaction_ids is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'bank_transaction_ids'),
  $dflt$ARRAY[]::uuid[]$dflt$,
  'reconciliation_match_group.bank_transaction_ids default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'gl_transaction_ids', 'uuid[]', 'reconciliation_match_group.gl_transaction_ids is uuid[]');
SELECT col_not_null('public', 'reconciliation_match_group', 'gl_transaction_ids', 'reconciliation_match_group.gl_transaction_ids is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'gl_transaction_ids'),
  $dflt$ARRAY[]::uuid[]$dflt$,
  'reconciliation_match_group.gl_transaction_ids default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'bank_members_json', 'jsonb', 'reconciliation_match_group.bank_members_json is jsonb');
SELECT col_not_null('public', 'reconciliation_match_group', 'bank_members_json', 'reconciliation_match_group.bank_members_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'bank_members_json'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_match_group.bank_members_json default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'gl_members_json', 'jsonb', 'reconciliation_match_group.gl_members_json is jsonb');
SELECT col_not_null('public', 'reconciliation_match_group', 'gl_members_json', 'reconciliation_match_group.gl_members_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'gl_members_json'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_match_group.gl_members_json default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'total_amount', 'numeric(18,2)', 'reconciliation_match_group.total_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_match_group', 'total_amount', 'reconciliation_match_group.total_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'total_amount'),
  NULL,
  'reconciliation_match_group.total_amount default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'date_difference_days', 'integer', 'reconciliation_match_group.date_difference_days is integer');
SELECT col_is_null('public', 'reconciliation_match_group', 'date_difference_days', 'reconciliation_match_group.date_difference_days is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'date_difference_days'),
  NULL,
  'reconciliation_match_group.date_difference_days default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'score', 'double precision', 'reconciliation_match_group.score is double precision');
SELECT col_not_null('public', 'reconciliation_match_group', 'score', 'reconciliation_match_group.score is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'score'),
  NULL,
  'reconciliation_match_group.score default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'rule_id', 'text', 'reconciliation_match_group.rule_id is text');
SELECT col_not_null('public', 'reconciliation_match_group', 'rule_id', 'reconciliation_match_group.rule_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'rule_id'),
  NULL,
  'reconciliation_match_group.rule_id default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'rule_name', 'text', 'reconciliation_match_group.rule_name is text');
SELECT col_not_null('public', 'reconciliation_match_group', 'rule_name', 'reconciliation_match_group.rule_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'rule_name'),
  NULL,
  'reconciliation_match_group.rule_name default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'reason', 'text', 'reconciliation_match_group.reason is text');
SELECT col_not_null('public', 'reconciliation_match_group', 'reason', 'reconciliation_match_group.reason is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'reason'),
  NULL,
  'reconciliation_match_group.reason default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'evidence_json', 'jsonb', 'reconciliation_match_group.evidence_json is jsonb');
SELECT col_not_null('public', 'reconciliation_match_group', 'evidence_json', 'reconciliation_match_group.evidence_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'evidence_json'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_match_group.evidence_json default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'created_at', 'timestamp with time zone', 'reconciliation_match_group.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_match_group', 'created_at', 'reconciliation_match_group.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_match_group.created_at default'
);
SELECT col_type_is('public', 'reconciliation_match_group', 'organization_id', 'uuid', 'reconciliation_match_group.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_match_group', 'organization_id', 'reconciliation_match_group.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_group'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_match_group.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_match_group'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$$chk$,
  'reconciliation_match_group check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_match_group'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_match_group' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_match_group grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_match_group'),
  $policy$reconciliation_match_group_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_match_group row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_match_group', ARRAY[]::name[], 'reconciliation_match_group has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_match_result', ARRAY['id', 'job_id', 'result_bucket', 'bank_transaction_id', 'gl_transaction_id', 'disposition', 'confidence', 'rule_id', 'rule_name', 'reason', 'score', 'amount_difference', 'date_difference_days', 'evidence_json', 'likely_matching_reference', 'exception_category', 'created_at', 'organization_id', 'applied_amount_tolerance', 'matching_config_version_id']::name[], 'reconciliation_match_result has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_match_result', ARRAY['id']::name[], 'reconciliation_match_result primary key');
SELECT indexes_are('public', 'reconciliation_match_result', ARRAY['reconciliation_match_result_bank_transaction_idx', 'reconciliation_match_result_gl_transaction_idx', 'reconciliation_match_result_job_bank_transaction_lookup_idx', 'reconciliation_match_result_job_gl_transaction_lookup_idx', 'reconciliation_match_result_job_idx', 'reconciliation_match_result_job_result_bucket_created_idx', 'reconciliation_match_result_organization_idx', 'reconciliation_match_result_pkey']::name[], 'reconciliation_match_result has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_match_result' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_match_result has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'id', 'uuid', 'reconciliation_match_result.id is uuid');
SELECT col_not_null('public', 'reconciliation_match_result', 'id', 'reconciliation_match_result.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_match_result.id default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'job_id', 'uuid', 'reconciliation_match_result.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_match_result', 'job_id', 'reconciliation_match_result.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_match_result.job_id default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'result_bucket', 'text', 'reconciliation_match_result.result_bucket is text');
SELECT col_not_null('public', 'reconciliation_match_result', 'result_bucket', 'reconciliation_match_result.result_bucket is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'result_bucket'),
  NULL,
  'reconciliation_match_result.result_bucket default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'bank_transaction_id', 'uuid', 'reconciliation_match_result.bank_transaction_id is uuid');
SELECT col_is_null('public', 'reconciliation_match_result', 'bank_transaction_id', 'reconciliation_match_result.bank_transaction_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'bank_transaction_id'),
  NULL,
  'reconciliation_match_result.bank_transaction_id default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'gl_transaction_id', 'uuid', 'reconciliation_match_result.gl_transaction_id is uuid');
SELECT col_is_null('public', 'reconciliation_match_result', 'gl_transaction_id', 'reconciliation_match_result.gl_transaction_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'gl_transaction_id'),
  NULL,
  'reconciliation_match_result.gl_transaction_id default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'disposition', 'text', 'reconciliation_match_result.disposition is text');
SELECT col_not_null('public', 'reconciliation_match_result', 'disposition', 'reconciliation_match_result.disposition is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'disposition'),
  NULL,
  'reconciliation_match_result.disposition default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'confidence', 'text', 'reconciliation_match_result.confidence is text');
SELECT col_not_null('public', 'reconciliation_match_result', 'confidence', 'reconciliation_match_result.confidence is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'confidence'),
  NULL,
  'reconciliation_match_result.confidence default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'rule_id', 'text', 'reconciliation_match_result.rule_id is text');
SELECT col_is_null('public', 'reconciliation_match_result', 'rule_id', 'reconciliation_match_result.rule_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'rule_id'),
  NULL,
  'reconciliation_match_result.rule_id default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'rule_name', 'text', 'reconciliation_match_result.rule_name is text');
SELECT col_not_null('public', 'reconciliation_match_result', 'rule_name', 'reconciliation_match_result.rule_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'rule_name'),
  NULL,
  'reconciliation_match_result.rule_name default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'reason', 'text', 'reconciliation_match_result.reason is text');
SELECT col_is_null('public', 'reconciliation_match_result', 'reason', 'reconciliation_match_result.reason is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'reason'),
  NULL,
  'reconciliation_match_result.reason default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'score', 'double precision', 'reconciliation_match_result.score is double precision');
SELECT col_not_null('public', 'reconciliation_match_result', 'score', 'reconciliation_match_result.score is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'score'),
  NULL,
  'reconciliation_match_result.score default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'amount_difference', 'numeric(18,2)', 'reconciliation_match_result.amount_difference is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_match_result', 'amount_difference', 'reconciliation_match_result.amount_difference is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'amount_difference'),
  NULL,
  'reconciliation_match_result.amount_difference default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'date_difference_days', 'integer', 'reconciliation_match_result.date_difference_days is integer');
SELECT col_is_null('public', 'reconciliation_match_result', 'date_difference_days', 'reconciliation_match_result.date_difference_days is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'date_difference_days'),
  NULL,
  'reconciliation_match_result.date_difference_days default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'evidence_json', 'jsonb', 'reconciliation_match_result.evidence_json is jsonb');
SELECT col_not_null('public', 'reconciliation_match_result', 'evidence_json', 'reconciliation_match_result.evidence_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'evidence_json'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_match_result.evidence_json default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'likely_matching_reference', 'text', 'reconciliation_match_result.likely_matching_reference is text');
SELECT col_is_null('public', 'reconciliation_match_result', 'likely_matching_reference', 'reconciliation_match_result.likely_matching_reference is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'likely_matching_reference'),
  NULL,
  'reconciliation_match_result.likely_matching_reference default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'exception_category', 'text', 'reconciliation_match_result.exception_category is text');
SELECT col_is_null('public', 'reconciliation_match_result', 'exception_category', 'reconciliation_match_result.exception_category is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'exception_category'),
  NULL,
  'reconciliation_match_result.exception_category default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'created_at', 'timestamp with time zone', 'reconciliation_match_result.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_match_result', 'created_at', 'reconciliation_match_result.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_match_result.created_at default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'organization_id', 'uuid', 'reconciliation_match_result.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_match_result', 'organization_id', 'reconciliation_match_result.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_match_result.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'applied_amount_tolerance', 'numeric(18,6)', 'reconciliation_match_result.applied_amount_tolerance is numeric(18,6)');
SELECT col_is_null('public', 'reconciliation_match_result', 'applied_amount_tolerance', 'reconciliation_match_result.applied_amount_tolerance is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'applied_amount_tolerance'),
  NULL,
  'reconciliation_match_result.applied_amount_tolerance default'
);
SELECT col_type_is('public', 'reconciliation_match_result', 'matching_config_version_id', 'uuid', 'reconciliation_match_result.matching_config_version_id is uuid');
SELECT col_is_null('public', 'reconciliation_match_result', 'matching_config_version_id', 'reconciliation_match_result.matching_config_version_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_match_result'::regclass AND a.attname = 'matching_config_version_id'),
  NULL,
  'reconciliation_match_result.matching_config_version_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_match_result'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_match_result_exception_category_check => CHECK (((exception_category IS NULL) OR (exception_category = ANY (ARRAY['MissingFromBank'::text, 'MissingFromGL'::text, 'AmountMismatch'::text, 'DuplicateInBank'::text, 'DuplicateInGL'::text, 'LikelySplitCombineIssue'::text, 'DepositGroupingIssue'::text, 'LikelyMiscoding'::text, 'DateVariance'::text, 'TimingDifference'::text, 'CheckNumberMismatch'::text, 'ReferenceNumberMismatch'::text, 'DescriptionMerchantVariance'::text, 'WeakDescriptionMatch'::text, 'StaleOutstandingCheck'::text, 'OutstandingCheck'::text, 'FeeNettingMatch'::text, 'PartialPaymentMatch'::text, 'PayrollBatchMatch'::text, 'BankServiceChargeAmortization'::text, 'LoanPaymentSplit'::text, 'NSFReturnedDeposit'::text, 'VoidedCheckCleared'::text, 'InvalidOrMissingData'::text, 'AmbiguousMatchRequiringReview'::text, 'ReversalVoid'::text, 'ACHReturn'::text, 'DepositInTransit'::text, 'ChargebackReturn'::text, 'InterestIncome'::text, 'IntercompanyMismatch'::text]))))
reconciliation_match_result_result_bucket_check => CHECK ((result_bucket = ANY (ARRAY['MATCH'::text, 'PROBABLE'::text])))$chk$,
  'reconciliation_match_result check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_match_result'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_match_result' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_match_result grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_match_result'),
  $policy$reconciliation_match_result_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_match_result row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_match_result', ARRAY[]::name[], 'reconciliation_match_result has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_matching_config_version', ARRAY['id', 'organization_id', 'version_number', 'status', 'variance_overrides', 'created_by', 'created_at', 'published_by', 'published_at', 'effective_at', 'pending_approval_owner']::name[], 'reconciliation_matching_config_version has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_matching_config_version', ARRAY['id']::name[], 'reconciliation_matching_config_version primary key');
SELECT indexes_are('public', 'reconciliation_matching_config_version', ARRAY['reconciliation_matching_config_version_key', 'reconciliation_matching_config_version_one_active_idx', 'reconciliation_matching_config_version_one_draft_idx', 'reconciliation_matching_config_version_org_status_idx', 'reconciliation_matching_config_version_pkey']::name[], 'reconciliation_matching_config_version has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_matching_config_version' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_matching_config_version has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'id', 'uuid', 'reconciliation_matching_config_version.id is uuid');
SELECT col_not_null('public', 'reconciliation_matching_config_version', 'id', 'reconciliation_matching_config_version.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_matching_config_version.id default'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'organization_id', 'uuid', 'reconciliation_matching_config_version.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_matching_config_version', 'organization_id', 'reconciliation_matching_config_version.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_matching_config_version.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'version_number', 'integer', 'reconciliation_matching_config_version.version_number is integer');
SELECT col_not_null('public', 'reconciliation_matching_config_version', 'version_number', 'reconciliation_matching_config_version.version_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'version_number'),
  NULL,
  'reconciliation_matching_config_version.version_number default'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'status', 'text', 'reconciliation_matching_config_version.status is text');
SELECT col_not_null('public', 'reconciliation_matching_config_version', 'status', 'reconciliation_matching_config_version.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'status'),
  $dflt$'DRAFT'::text$dflt$,
  'reconciliation_matching_config_version.status default'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'variance_overrides', 'jsonb', 'reconciliation_matching_config_version.variance_overrides is jsonb');
SELECT col_not_null('public', 'reconciliation_matching_config_version', 'variance_overrides', 'reconciliation_matching_config_version.variance_overrides is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'variance_overrides'),
  $dflt$'{}'::jsonb$dflt$,
  'reconciliation_matching_config_version.variance_overrides default'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'created_by', 'text', 'reconciliation_matching_config_version.created_by is text');
SELECT col_not_null('public', 'reconciliation_matching_config_version', 'created_by', 'reconciliation_matching_config_version.created_by is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'created_by'),
  NULL,
  'reconciliation_matching_config_version.created_by default'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'created_at', 'timestamp with time zone', 'reconciliation_matching_config_version.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_matching_config_version', 'created_at', 'reconciliation_matching_config_version.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_matching_config_version.created_at default'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'published_by', 'text', 'reconciliation_matching_config_version.published_by is text');
SELECT col_is_null('public', 'reconciliation_matching_config_version', 'published_by', 'reconciliation_matching_config_version.published_by is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'published_by'),
  NULL,
  'reconciliation_matching_config_version.published_by default'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'published_at', 'timestamp with time zone', 'reconciliation_matching_config_version.published_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_matching_config_version', 'published_at', 'reconciliation_matching_config_version.published_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'published_at'),
  NULL,
  'reconciliation_matching_config_version.published_at default'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'effective_at', 'timestamp with time zone', 'reconciliation_matching_config_version.effective_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_matching_config_version', 'effective_at', 'reconciliation_matching_config_version.effective_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'effective_at'),
  NULL,
  'reconciliation_matching_config_version.effective_at default'
);
SELECT col_type_is('public', 'reconciliation_matching_config_version', 'pending_approval_owner', 'text', 'reconciliation_matching_config_version.pending_approval_owner is text');
SELECT col_is_null('public', 'reconciliation_matching_config_version', 'pending_approval_owner', 'reconciliation_matching_config_version.pending_approval_owner is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_matching_config_version'::regclass AND a.attname = 'pending_approval_owner'),
  NULL,
  'reconciliation_matching_config_version.pending_approval_owner default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_matching_config_version'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_matching_config_version_key => UNIQUE (organization_id, version_number)
reconciliation_matching_config_version_status_check => CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'SUPERSEDED'::text])))
reconciliation_matching_config_version_version_number_check => CHECK ((version_number > 0))$chk$,
  'reconciliation_matching_config_version check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_matching_config_version'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_matching_config_version' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_matching_config_version grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_matching_config_version'),
  $policy$reconciliation_matching_config_version_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_matching_config_version row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_matching_config_version', ARRAY[]::name[], 'reconciliation_matching_config_version has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_open_item', ARRAY['id', 'organization_id', 'account_id', 'opened_in_run_id', 'first_detected_job_id', 'source_system', 'category', 'natural_key', 'natural_key_tier', 'original_transaction_date', 'amount', 'check_number', 'reference_number', 'description_snapshot', 'status', 'owner_user_id', 'due_date', 'cleared_in_run_id', 'cleared_at', 'cleared_match_result_id', 'disposition_code', 'disposition_note', 'superseded_by_open_item_id', 'created_at', 'updated_at']::name[], 'reconciliation_open_item has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_open_item', ARRAY['id']::name[], 'reconciliation_open_item primary key');
SELECT indexes_are('public', 'reconciliation_open_item', ARRAY['reconciliation_open_item_aging_idx', 'reconciliation_open_item_cleared_in_run_idx', 'reconciliation_open_item_natural_key_open_key', 'reconciliation_open_item_opened_in_run_idx', 'reconciliation_open_item_pkey']::name[], 'reconciliation_open_item has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_open_item' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_open_item has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'id', 'uuid', 'reconciliation_open_item.id is uuid');
SELECT col_not_null('public', 'reconciliation_open_item', 'id', 'reconciliation_open_item.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_open_item.id default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'organization_id', 'uuid', 'reconciliation_open_item.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_open_item', 'organization_id', 'reconciliation_open_item.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_open_item.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'account_id', 'uuid', 'reconciliation_open_item.account_id is uuid');
SELECT col_not_null('public', 'reconciliation_open_item', 'account_id', 'reconciliation_open_item.account_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'account_id'),
  NULL,
  'reconciliation_open_item.account_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'opened_in_run_id', 'uuid', 'reconciliation_open_item.opened_in_run_id is uuid');
SELECT col_is_null('public', 'reconciliation_open_item', 'opened_in_run_id', 'reconciliation_open_item.opened_in_run_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'opened_in_run_id'),
  NULL,
  'reconciliation_open_item.opened_in_run_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'first_detected_job_id', 'uuid', 'reconciliation_open_item.first_detected_job_id is uuid');
SELECT col_is_null('public', 'reconciliation_open_item', 'first_detected_job_id', 'reconciliation_open_item.first_detected_job_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'first_detected_job_id'),
  NULL,
  'reconciliation_open_item.first_detected_job_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'source_system', 'text', 'reconciliation_open_item.source_system is text');
SELECT col_not_null('public', 'reconciliation_open_item', 'source_system', 'reconciliation_open_item.source_system is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'source_system'),
  NULL,
  'reconciliation_open_item.source_system default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'category', 'text', 'reconciliation_open_item.category is text');
SELECT col_not_null('public', 'reconciliation_open_item', 'category', 'reconciliation_open_item.category is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'category'),
  NULL,
  'reconciliation_open_item.category default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'natural_key', 'text', 'reconciliation_open_item.natural_key is text');
SELECT col_not_null('public', 'reconciliation_open_item', 'natural_key', 'reconciliation_open_item.natural_key is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'natural_key'),
  NULL,
  'reconciliation_open_item.natural_key default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'natural_key_tier', 'smallint', 'reconciliation_open_item.natural_key_tier is smallint');
SELECT col_not_null('public', 'reconciliation_open_item', 'natural_key_tier', 'reconciliation_open_item.natural_key_tier is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'natural_key_tier'),
  NULL,
  'reconciliation_open_item.natural_key_tier default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'original_transaction_date', 'date', 'reconciliation_open_item.original_transaction_date is date');
SELECT col_not_null('public', 'reconciliation_open_item', 'original_transaction_date', 'reconciliation_open_item.original_transaction_date is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'original_transaction_date'),
  NULL,
  'reconciliation_open_item.original_transaction_date default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'amount', 'numeric(18,2)', 'reconciliation_open_item.amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_open_item', 'amount', 'reconciliation_open_item.amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'amount'),
  NULL,
  'reconciliation_open_item.amount default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'check_number', 'text', 'reconciliation_open_item.check_number is text');
SELECT col_is_null('public', 'reconciliation_open_item', 'check_number', 'reconciliation_open_item.check_number is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'check_number'),
  NULL,
  'reconciliation_open_item.check_number default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'reference_number', 'text', 'reconciliation_open_item.reference_number is text');
SELECT col_is_null('public', 'reconciliation_open_item', 'reference_number', 'reconciliation_open_item.reference_number is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'reference_number'),
  NULL,
  'reconciliation_open_item.reference_number default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'description_snapshot', 'text', 'reconciliation_open_item.description_snapshot is text');
SELECT col_is_null('public', 'reconciliation_open_item', 'description_snapshot', 'reconciliation_open_item.description_snapshot is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'description_snapshot'),
  NULL,
  'reconciliation_open_item.description_snapshot default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'status', 'text', 'reconciliation_open_item.status is text');
SELECT col_not_null('public', 'reconciliation_open_item', 'status', 'reconciliation_open_item.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'status'),
  $dflt$'OPEN'::text$dflt$,
  'reconciliation_open_item.status default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'owner_user_id', 'uuid', 'reconciliation_open_item.owner_user_id is uuid');
SELECT col_is_null('public', 'reconciliation_open_item', 'owner_user_id', 'reconciliation_open_item.owner_user_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'owner_user_id'),
  NULL,
  'reconciliation_open_item.owner_user_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'due_date', 'date', 'reconciliation_open_item.due_date is date');
SELECT col_is_null('public', 'reconciliation_open_item', 'due_date', 'reconciliation_open_item.due_date is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'due_date'),
  NULL,
  'reconciliation_open_item.due_date default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'cleared_in_run_id', 'uuid', 'reconciliation_open_item.cleared_in_run_id is uuid');
SELECT col_is_null('public', 'reconciliation_open_item', 'cleared_in_run_id', 'reconciliation_open_item.cleared_in_run_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'cleared_in_run_id'),
  NULL,
  'reconciliation_open_item.cleared_in_run_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'cleared_at', 'timestamp with time zone', 'reconciliation_open_item.cleared_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_open_item', 'cleared_at', 'reconciliation_open_item.cleared_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'cleared_at'),
  NULL,
  'reconciliation_open_item.cleared_at default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'cleared_match_result_id', 'uuid', 'reconciliation_open_item.cleared_match_result_id is uuid');
SELECT col_is_null('public', 'reconciliation_open_item', 'cleared_match_result_id', 'reconciliation_open_item.cleared_match_result_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'cleared_match_result_id'),
  NULL,
  'reconciliation_open_item.cleared_match_result_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'disposition_code', 'text', 'reconciliation_open_item.disposition_code is text');
SELECT col_is_null('public', 'reconciliation_open_item', 'disposition_code', 'reconciliation_open_item.disposition_code is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'disposition_code'),
  NULL,
  'reconciliation_open_item.disposition_code default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'disposition_note', 'text', 'reconciliation_open_item.disposition_note is text');
SELECT col_is_null('public', 'reconciliation_open_item', 'disposition_note', 'reconciliation_open_item.disposition_note is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'disposition_note'),
  NULL,
  'reconciliation_open_item.disposition_note default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'superseded_by_open_item_id', 'uuid', 'reconciliation_open_item.superseded_by_open_item_id is uuid');
SELECT col_is_null('public', 'reconciliation_open_item', 'superseded_by_open_item_id', 'reconciliation_open_item.superseded_by_open_item_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'superseded_by_open_item_id'),
  NULL,
  'reconciliation_open_item.superseded_by_open_item_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'created_at', 'timestamp with time zone', 'reconciliation_open_item.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_open_item', 'created_at', 'reconciliation_open_item.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_open_item.created_at default'
);
SELECT col_type_is('public', 'reconciliation_open_item', 'updated_at', 'timestamp with time zone', 'reconciliation_open_item.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_open_item', 'updated_at', 'reconciliation_open_item.updated_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item'::regclass AND a.attname = 'updated_at'),
  $dflt$now()$dflt$,
  'reconciliation_open_item.updated_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_open_item'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_open_item_category_check => CHECK ((category = ANY (ARRAY['OutstandingCheck'::text, 'StaleOutstandingCheck'::text, 'DepositInTransit'::text, 'MissingFromBank'::text, 'MissingFromGL'::text, 'TimingDifference'::text, 'IntercompanyMismatch'::text, 'NSFReturnedDeposit'::text, 'AmountMismatch'::text])))
reconciliation_open_item_natural_key_tier_check => CHECK ((natural_key_tier = ANY (ARRAY[1, 2, 3])))
reconciliation_open_item_source_system_check => CHECK ((source_system = ANY (ARRAY['bank'::text, 'gl'::text])))
reconciliation_open_item_status_check => CHECK ((status = ANY (ARRAY['OPEN'::text, 'CLEARED'::text, 'WRITTEN_OFF'::text, 'ADJUSTED'::text, 'VOIDED'::text, 'SUPERSEDED'::text])))$chk$,
  'reconciliation_open_item check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_open_item'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_open_item' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_open_item grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_open_item'),
  $policy$reconciliation_open_item_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_open_item row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_open_item', ARRAY['trg_reconciliation_open_item_updated_at']::name[], 'reconciliation_open_item has exactly the expected triggers');
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_reconciliation_open_item_updated_at' AND tgrelid = 'public.reconciliation_open_item'::regclass),
  $trig$CREATE TRIGGER trg_reconciliation_open_item_updated_at BEFORE UPDATE ON public.reconciliation_open_item FOR EACH ROW EXECUTE FUNCTION set_updated_at()$trig$,
  'reconciliation_open_item.trg_reconciliation_open_item_updated_at definition'
);
SELECT columns_are('public', 'reconciliation_open_item_event', ARRAY['event_id', 'open_item_id', 'organization_id', 'run_id', 'event_type', 'from_status', 'to_status', 'actor', 'details_json', 'created_at']::name[], 'reconciliation_open_item_event has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_open_item_event', ARRAY['event_id']::name[], 'reconciliation_open_item_event primary key');
SELECT indexes_are('public', 'reconciliation_open_item_event', ARRAY['reconciliation_open_item_event_open_item_idx', 'reconciliation_open_item_event_organization_idx', 'reconciliation_open_item_event_pkey']::name[], 'reconciliation_open_item_event has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_open_item_event' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_open_item_event has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_open_item_event', 'event_id', 'bigint', 'reconciliation_open_item_event.event_id is bigint');
SELECT col_not_null('public', 'reconciliation_open_item_event', 'event_id', 'reconciliation_open_item_event.event_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item_event'::regclass AND a.attname = 'event_id'),
  $dflt$nextval('reconciliation_open_item_event_event_id_seq'::regclass)$dflt$,
  'reconciliation_open_item_event.event_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item_event', 'open_item_id', 'uuid', 'reconciliation_open_item_event.open_item_id is uuid');
SELECT col_not_null('public', 'reconciliation_open_item_event', 'open_item_id', 'reconciliation_open_item_event.open_item_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item_event'::regclass AND a.attname = 'open_item_id'),
  NULL,
  'reconciliation_open_item_event.open_item_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item_event', 'organization_id', 'uuid', 'reconciliation_open_item_event.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_open_item_event', 'organization_id', 'reconciliation_open_item_event.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item_event'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_open_item_event.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item_event', 'run_id', 'uuid', 'reconciliation_open_item_event.run_id is uuid');
SELECT col_is_null('public', 'reconciliation_open_item_event', 'run_id', 'reconciliation_open_item_event.run_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item_event'::regclass AND a.attname = 'run_id'),
  NULL,
  'reconciliation_open_item_event.run_id default'
);
SELECT col_type_is('public', 'reconciliation_open_item_event', 'event_type', 'text', 'reconciliation_open_item_event.event_type is text');
SELECT col_not_null('public', 'reconciliation_open_item_event', 'event_type', 'reconciliation_open_item_event.event_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item_event'::regclass AND a.attname = 'event_type'),
  NULL,
  'reconciliation_open_item_event.event_type default'
);
SELECT col_type_is('public', 'reconciliation_open_item_event', 'from_status', 'text', 'reconciliation_open_item_event.from_status is text');
SELECT col_is_null('public', 'reconciliation_open_item_event', 'from_status', 'reconciliation_open_item_event.from_status is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item_event'::regclass AND a.attname = 'from_status'),
  NULL,
  'reconciliation_open_item_event.from_status default'
);
SELECT col_type_is('public', 'reconciliation_open_item_event', 'to_status', 'text', 'reconciliation_open_item_event.to_status is text');
SELECT col_is_null('public', 'reconciliation_open_item_event', 'to_status', 'reconciliation_open_item_event.to_status is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item_event'::regclass AND a.attname = 'to_status'),
  NULL,
  'reconciliation_open_item_event.to_status default'
);
SELECT col_type_is('public', 'reconciliation_open_item_event', 'actor', 'text', 'reconciliation_open_item_event.actor is text');
SELECT col_is_null('public', 'reconciliation_open_item_event', 'actor', 'reconciliation_open_item_event.actor is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item_event'::regclass AND a.attname = 'actor'),
  NULL,
  'reconciliation_open_item_event.actor default'
);
SELECT col_type_is('public', 'reconciliation_open_item_event', 'details_json', 'jsonb', 'reconciliation_open_item_event.details_json is jsonb');
SELECT col_not_null('public', 'reconciliation_open_item_event', 'details_json', 'reconciliation_open_item_event.details_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item_event'::regclass AND a.attname = 'details_json'),
  $dflt$'{}'::jsonb$dflt$,
  'reconciliation_open_item_event.details_json default'
);
SELECT col_type_is('public', 'reconciliation_open_item_event', 'created_at', 'timestamp with time zone', 'reconciliation_open_item_event.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_open_item_event', 'created_at', 'reconciliation_open_item_event.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_open_item_event'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_open_item_event.created_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_open_item_event'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$$chk$,
  'reconciliation_open_item_event check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_open_item_event'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_open_item_event' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_open_item_event grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_open_item_event'),
  $policy$reconciliation_open_item_event_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_open_item_event row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_open_item_event', ARRAY[]::name[], 'reconciliation_open_item_event has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_organization', ARRAY['id', 'name', 'status', 'created_at', 'entity_state', 'entity_filing_number', 'entity_type', 'entity_verification_status', 'carry_forward_enabled', 'carry_forward_enabled_at', 'updated_at']::name[], 'reconciliation_organization has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_organization', ARRAY['id']::name[], 'reconciliation_organization primary key');
SELECT indexes_are('public', 'reconciliation_organization', ARRAY['reconciliation_organization_name_key', 'reconciliation_organization_pkey']::name[], 'reconciliation_organization has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_organization', 'id', 'uuid', 'reconciliation_organization.id is uuid');
SELECT col_not_null('public', 'reconciliation_organization', 'id', 'reconciliation_organization.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_organization.id default'
);
SELECT col_type_is('public', 'reconciliation_organization', 'name', 'text', 'reconciliation_organization.name is text');
SELECT col_not_null('public', 'reconciliation_organization', 'name', 'reconciliation_organization.name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'name'),
  NULL,
  'reconciliation_organization.name default'
);
SELECT col_type_is('public', 'reconciliation_organization', 'status', 'text', 'reconciliation_organization.status is text');
SELECT col_not_null('public', 'reconciliation_organization', 'status', 'reconciliation_organization.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'status'),
  $dflt$'ACTIVE'::text$dflt$,
  'reconciliation_organization.status default'
);
SELECT col_type_is('public', 'reconciliation_organization', 'created_at', 'timestamp with time zone', 'reconciliation_organization.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_organization', 'created_at', 'reconciliation_organization.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_organization.created_at default'
);
SELECT col_type_is('public', 'reconciliation_organization', 'entity_state', 'text', 'reconciliation_organization.entity_state is text');
SELECT col_is_null('public', 'reconciliation_organization', 'entity_state', 'reconciliation_organization.entity_state is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'entity_state'),
  NULL,
  'reconciliation_organization.entity_state default'
);
SELECT col_type_is('public', 'reconciliation_organization', 'entity_filing_number', 'text', 'reconciliation_organization.entity_filing_number is text');
SELECT col_is_null('public', 'reconciliation_organization', 'entity_filing_number', 'reconciliation_organization.entity_filing_number is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'entity_filing_number'),
  NULL,
  'reconciliation_organization.entity_filing_number default'
);
SELECT col_type_is('public', 'reconciliation_organization', 'entity_type', 'text', 'reconciliation_organization.entity_type is text');
SELECT col_is_null('public', 'reconciliation_organization', 'entity_type', 'reconciliation_organization.entity_type is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'entity_type'),
  NULL,
  'reconciliation_organization.entity_type default'
);
SELECT col_type_is('public', 'reconciliation_organization', 'entity_verification_status', 'text', 'reconciliation_organization.entity_verification_status is text');
SELECT col_not_null('public', 'reconciliation_organization', 'entity_verification_status', 'reconciliation_organization.entity_verification_status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'entity_verification_status'),
  $dflt$'pending'::text$dflt$,
  'reconciliation_organization.entity_verification_status default'
);
SELECT col_type_is('public', 'reconciliation_organization', 'carry_forward_enabled', 'boolean', 'reconciliation_organization.carry_forward_enabled is boolean');
SELECT col_not_null('public', 'reconciliation_organization', 'carry_forward_enabled', 'reconciliation_organization.carry_forward_enabled is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'carry_forward_enabled'),
  $dflt$false$dflt$,
  'reconciliation_organization.carry_forward_enabled default'
);
SELECT col_type_is('public', 'reconciliation_organization', 'carry_forward_enabled_at', 'timestamp with time zone', 'reconciliation_organization.carry_forward_enabled_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_organization', 'carry_forward_enabled_at', 'reconciliation_organization.carry_forward_enabled_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'carry_forward_enabled_at'),
  NULL,
  'reconciliation_organization.carry_forward_enabled_at default'
);
SELECT col_type_is('public', 'reconciliation_organization', 'updated_at', 'timestamp with time zone', 'reconciliation_organization.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_organization', 'updated_at', 'reconciliation_organization.updated_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_organization'::regclass AND a.attname = 'updated_at'),
  $dflt$now()$dflt$,
  'reconciliation_organization.updated_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_organization'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_organization_entity_type_check => CHECK ((entity_type = ANY (ARRAY['domestic'::text, 'foreign'::text])))
reconciliation_organization_entity_verification_status_check => CHECK ((entity_verification_status = ANY (ARRAY['pending'::text, 'verified'::text, 'failed'::text])))
reconciliation_organization_name_key => UNIQUE (name)
reconciliation_organization_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])))$chk$,
  'reconciliation_organization check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_organization'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_organization' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_organization grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_organization'),
  $policy$$policy$,
  'reconciliation_organization row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_organization', ARRAY['trg_reconciliation_organization_updated_at']::name[], 'reconciliation_organization has exactly the expected triggers');
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_reconciliation_organization_updated_at' AND tgrelid = 'public.reconciliation_organization'::regclass),
  $trig$CREATE TRIGGER trg_reconciliation_organization_updated_at BEFORE UPDATE ON public.reconciliation_organization FOR EACH ROW EXECUTE FUNCTION set_updated_at()$trig$,
  'reconciliation_organization.trg_reconciliation_organization_updated_at definition'
);
SELECT columns_are('public', 'reconciliation_payee_alias', ARRAY['id', 'account_identifier', 'bank_pattern', 'canonical_payee_name', 'normalized_tokens', 'source_direction', 'match_confidence', 'is_active', 'created_at', 'updated_at', 'organization_id']::name[], 'reconciliation_payee_alias has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_payee_alias', ARRAY['id']::name[], 'reconciliation_payee_alias primary key');
SELECT indexes_are('public', 'reconciliation_payee_alias', ARRAY['reconciliation_payee_alias_account_idx', 'reconciliation_payee_alias_active_idx', 'reconciliation_payee_alias_canonical_payee_idx', 'reconciliation_payee_alias_organization_idx', 'reconciliation_payee_alias_pkey', 'reconciliation_payee_alias_tokens_idx']::name[], 'reconciliation_payee_alias has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_payee_alias' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_payee_alias has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'id', 'uuid', 'reconciliation_payee_alias.id is uuid');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'id', 'reconciliation_payee_alias.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'id'),
  $dflt$gen_random_uuid()$dflt$,
  'reconciliation_payee_alias.id default'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'account_identifier', 'text', 'reconciliation_payee_alias.account_identifier is text');
SELECT col_is_null('public', 'reconciliation_payee_alias', 'account_identifier', 'reconciliation_payee_alias.account_identifier is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'account_identifier'),
  NULL,
  'reconciliation_payee_alias.account_identifier default'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'bank_pattern', 'text', 'reconciliation_payee_alias.bank_pattern is text');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'bank_pattern', 'reconciliation_payee_alias.bank_pattern is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'bank_pattern'),
  NULL,
  'reconciliation_payee_alias.bank_pattern default'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'canonical_payee_name', 'text', 'reconciliation_payee_alias.canonical_payee_name is text');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'canonical_payee_name', 'reconciliation_payee_alias.canonical_payee_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'canonical_payee_name'),
  NULL,
  'reconciliation_payee_alias.canonical_payee_name default'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'normalized_tokens', 'text[]', 'reconciliation_payee_alias.normalized_tokens is text[]');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'normalized_tokens', 'reconciliation_payee_alias.normalized_tokens is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'normalized_tokens'),
  $dflt$ARRAY[]::text[]$dflt$,
  'reconciliation_payee_alias.normalized_tokens default'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'source_direction', 'text', 'reconciliation_payee_alias.source_direction is text');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'source_direction', 'reconciliation_payee_alias.source_direction is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'source_direction'),
  $dflt$'bank_to_gl'::text$dflt$,
  'reconciliation_payee_alias.source_direction default'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'match_confidence', 'double precision', 'reconciliation_payee_alias.match_confidence is double precision');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'match_confidence', 'reconciliation_payee_alias.match_confidence is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'match_confidence'),
  $dflt$1.0$dflt$,
  'reconciliation_payee_alias.match_confidence default'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'is_active', 'boolean', 'reconciliation_payee_alias.is_active is boolean');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'is_active', 'reconciliation_payee_alias.is_active is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'is_active'),
  $dflt$true$dflt$,
  'reconciliation_payee_alias.is_active default'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'created_at', 'timestamp with time zone', 'reconciliation_payee_alias.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'created_at', 'reconciliation_payee_alias.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_payee_alias.created_at default'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'updated_at', 'timestamp with time zone', 'reconciliation_payee_alias.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'updated_at', 'reconciliation_payee_alias.updated_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'updated_at'),
  $dflt$now()$dflt$,
  'reconciliation_payee_alias.updated_at default'
);
SELECT col_type_is('public', 'reconciliation_payee_alias', 'organization_id', 'uuid', 'reconciliation_payee_alias.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_payee_alias', 'organization_id', 'reconciliation_payee_alias.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_payee_alias'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_payee_alias.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_payee_alias'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$payee_alias_match_confidence_check => CHECK (((match_confidence >= (0)::double precision) AND (match_confidence <= (1)::double precision)))
payee_alias_source_direction_check => CHECK ((source_direction = ANY (ARRAY['bank_to_gl'::text, 'bidirectional'::text])))$chk$,
  'reconciliation_payee_alias check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_payee_alias'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_payee_alias' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_payee_alias grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_payee_alias'),
  $policy$reconciliation_payee_alias_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_payee_alias row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_payee_alias', ARRAY['trg_reconciliation_payee_alias_updated_at']::name[], 'reconciliation_payee_alias has exactly the expected triggers');
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_reconciliation_payee_alias_updated_at' AND tgrelid = 'public.reconciliation_payee_alias'::regclass),
  $trig$CREATE TRIGGER trg_reconciliation_payee_alias_updated_at BEFORE UPDATE ON public.reconciliation_payee_alias FOR EACH ROW EXECUTE FUNCTION set_updated_at()$trig$,
  'reconciliation_payee_alias.trg_reconciliation_payee_alias_updated_at definition'
);
SELECT columns_are('public', 'reconciliation_period_rollforward', ARRAY['id', 'organization_id', 'reconciliation_run_id', 'account_id', 'opening_count', 'new_count', 'cleared_count', 'written_off_count', 'closing_count', 'opening_amount', 'new_amount', 'cleared_amount', 'written_off_amount', 'closing_amount', 'is_stale', 'computed_at']::name[], 'reconciliation_period_rollforward has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_period_rollforward', ARRAY['id']::name[], 'reconciliation_period_rollforward primary key');
SELECT indexes_are('public', 'reconciliation_period_rollforward', ARRAY['reconciliation_period_rollforward_account_idx', 'reconciliation_period_rollforward_organization_idx', 'reconciliation_period_rollforward_pkey', 'reconciliation_period_rollforward_run_account_key']::name[], 'reconciliation_period_rollforward has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_period_rollforward' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_period_rollforward has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'id', 'uuid', 'reconciliation_period_rollforward.id is uuid');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'id', 'reconciliation_period_rollforward.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_period_rollforward.id default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'organization_id', 'uuid', 'reconciliation_period_rollforward.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'organization_id', 'reconciliation_period_rollforward.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_period_rollforward.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'reconciliation_run_id', 'uuid', 'reconciliation_period_rollforward.reconciliation_run_id is uuid');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'reconciliation_run_id', 'reconciliation_period_rollforward.reconciliation_run_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'reconciliation_run_id'),
  NULL,
  'reconciliation_period_rollforward.reconciliation_run_id default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'account_id', 'uuid', 'reconciliation_period_rollforward.account_id is uuid');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'account_id', 'reconciliation_period_rollforward.account_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'account_id'),
  NULL,
  'reconciliation_period_rollforward.account_id default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'opening_count', 'integer', 'reconciliation_period_rollforward.opening_count is integer');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'opening_count', 'reconciliation_period_rollforward.opening_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'opening_count'),
  NULL,
  'reconciliation_period_rollforward.opening_count default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'new_count', 'integer', 'reconciliation_period_rollforward.new_count is integer');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'new_count', 'reconciliation_period_rollforward.new_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'new_count'),
  NULL,
  'reconciliation_period_rollforward.new_count default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'cleared_count', 'integer', 'reconciliation_period_rollforward.cleared_count is integer');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'cleared_count', 'reconciliation_period_rollforward.cleared_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'cleared_count'),
  NULL,
  'reconciliation_period_rollforward.cleared_count default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'written_off_count', 'integer', 'reconciliation_period_rollforward.written_off_count is integer');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'written_off_count', 'reconciliation_period_rollforward.written_off_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'written_off_count'),
  NULL,
  'reconciliation_period_rollforward.written_off_count default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'closing_count', 'integer', 'reconciliation_period_rollforward.closing_count is integer');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'closing_count', 'reconciliation_period_rollforward.closing_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'closing_count'),
  NULL,
  'reconciliation_period_rollforward.closing_count default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'opening_amount', 'numeric(18,2)', 'reconciliation_period_rollforward.opening_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'opening_amount', 'reconciliation_period_rollforward.opening_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'opening_amount'),
  NULL,
  'reconciliation_period_rollforward.opening_amount default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'new_amount', 'numeric(18,2)', 'reconciliation_period_rollforward.new_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'new_amount', 'reconciliation_period_rollforward.new_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'new_amount'),
  NULL,
  'reconciliation_period_rollforward.new_amount default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'cleared_amount', 'numeric(18,2)', 'reconciliation_period_rollforward.cleared_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'cleared_amount', 'reconciliation_period_rollforward.cleared_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'cleared_amount'),
  NULL,
  'reconciliation_period_rollforward.cleared_amount default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'written_off_amount', 'numeric(18,2)', 'reconciliation_period_rollforward.written_off_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'written_off_amount', 'reconciliation_period_rollforward.written_off_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'written_off_amount'),
  NULL,
  'reconciliation_period_rollforward.written_off_amount default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'closing_amount', 'numeric(18,2)', 'reconciliation_period_rollforward.closing_amount is numeric(18,2)');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'closing_amount', 'reconciliation_period_rollforward.closing_amount is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'closing_amount'),
  NULL,
  'reconciliation_period_rollforward.closing_amount default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'is_stale', 'boolean', 'reconciliation_period_rollforward.is_stale is boolean');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'is_stale', 'reconciliation_period_rollforward.is_stale is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'is_stale'),
  $dflt$false$dflt$,
  'reconciliation_period_rollforward.is_stale default'
);
SELECT col_type_is('public', 'reconciliation_period_rollforward', 'computed_at', 'timestamp with time zone', 'reconciliation_period_rollforward.computed_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_period_rollforward', 'computed_at', 'reconciliation_period_rollforward.computed_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_period_rollforward'::regclass AND a.attname = 'computed_at'),
  $dflt$now()$dflt$,
  'reconciliation_period_rollforward.computed_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_period_rollforward'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_period_rollforward_amount_ties => CHECK ((closing_amount = (((opening_amount + new_amount) - cleared_amount) - written_off_amount)))
reconciliation_period_rollforward_count_ties => CHECK ((closing_count = (((opening_count + new_count) - cleared_count) - written_off_count)))
reconciliation_period_rollforward_run_account_key => UNIQUE (reconciliation_run_id, account_id)$chk$,
  'reconciliation_period_rollforward check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_period_rollforward'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_period_rollforward' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_period_rollforward grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_period_rollforward'),
  $policy$reconciliation_period_rollforward_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_period_rollforward row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_period_rollforward', ARRAY[]::name[], 'reconciliation_period_rollforward has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_raw_row', ARRAY['id', 'job_id', 'source_file_id', 'import_batch_id', 'source_system', 'line_number', 'row_hash', 'raw_values_json', 'transaction_date_raw', 'posting_date_raw', 'transaction_type_raw', 'check_number_raw', 'serial_number_raw', 'reference_number_raw', 'description_raw', 'merchant_name_raw', 'payee_name_raw', 'amount_raw', 'debit_raw', 'credit_raw', 'running_balance_raw', 'excluded', 'exclusion_reason', 'parsing_issues_json', 'created_at', 'organization_id']::name[], 'reconciliation_raw_row has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_raw_row', ARRAY['id']::name[], 'reconciliation_raw_row primary key');
SELECT indexes_are('public', 'reconciliation_raw_row', ARRAY['reconciliation_raw_row_job_idx', 'reconciliation_raw_row_organization_idx', 'reconciliation_raw_row_pkey', 'reconciliation_raw_row_source_file_id_line_number_key']::name[], 'reconciliation_raw_row has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_raw_row' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_raw_row has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'id', 'uuid', 'reconciliation_raw_row.id is uuid');
SELECT col_not_null('public', 'reconciliation_raw_row', 'id', 'reconciliation_raw_row.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_raw_row.id default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'job_id', 'uuid', 'reconciliation_raw_row.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_raw_row', 'job_id', 'reconciliation_raw_row.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_raw_row.job_id default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'source_file_id', 'uuid', 'reconciliation_raw_row.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_raw_row', 'source_file_id', 'reconciliation_raw_row.source_file_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'source_file_id'),
  NULL,
  'reconciliation_raw_row.source_file_id default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'import_batch_id', 'uuid', 'reconciliation_raw_row.import_batch_id is uuid');
SELECT col_not_null('public', 'reconciliation_raw_row', 'import_batch_id', 'reconciliation_raw_row.import_batch_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'import_batch_id'),
  NULL,
  'reconciliation_raw_row.import_batch_id default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'source_system', 'text', 'reconciliation_raw_row.source_system is text');
SELECT col_not_null('public', 'reconciliation_raw_row', 'source_system', 'reconciliation_raw_row.source_system is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'source_system'),
  NULL,
  'reconciliation_raw_row.source_system default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'line_number', 'integer', 'reconciliation_raw_row.line_number is integer');
SELECT col_not_null('public', 'reconciliation_raw_row', 'line_number', 'reconciliation_raw_row.line_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'line_number'),
  NULL,
  'reconciliation_raw_row.line_number default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'row_hash', 'text', 'reconciliation_raw_row.row_hash is text');
SELECT col_not_null('public', 'reconciliation_raw_row', 'row_hash', 'reconciliation_raw_row.row_hash is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'row_hash'),
  NULL,
  'reconciliation_raw_row.row_hash default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'raw_values_json', 'jsonb', 'reconciliation_raw_row.raw_values_json is jsonb');
SELECT col_not_null('public', 'reconciliation_raw_row', 'raw_values_json', 'reconciliation_raw_row.raw_values_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'raw_values_json'),
  NULL,
  'reconciliation_raw_row.raw_values_json default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'transaction_date_raw', 'text', 'reconciliation_raw_row.transaction_date_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'transaction_date_raw', 'reconciliation_raw_row.transaction_date_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'transaction_date_raw'),
  NULL,
  'reconciliation_raw_row.transaction_date_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'posting_date_raw', 'text', 'reconciliation_raw_row.posting_date_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'posting_date_raw', 'reconciliation_raw_row.posting_date_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'posting_date_raw'),
  NULL,
  'reconciliation_raw_row.posting_date_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'transaction_type_raw', 'text', 'reconciliation_raw_row.transaction_type_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'transaction_type_raw', 'reconciliation_raw_row.transaction_type_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'transaction_type_raw'),
  NULL,
  'reconciliation_raw_row.transaction_type_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'check_number_raw', 'text', 'reconciliation_raw_row.check_number_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'check_number_raw', 'reconciliation_raw_row.check_number_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'check_number_raw'),
  NULL,
  'reconciliation_raw_row.check_number_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'serial_number_raw', 'text', 'reconciliation_raw_row.serial_number_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'serial_number_raw', 'reconciliation_raw_row.serial_number_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'serial_number_raw'),
  NULL,
  'reconciliation_raw_row.serial_number_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'reference_number_raw', 'text', 'reconciliation_raw_row.reference_number_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'reference_number_raw', 'reconciliation_raw_row.reference_number_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'reference_number_raw'),
  NULL,
  'reconciliation_raw_row.reference_number_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'description_raw', 'text', 'reconciliation_raw_row.description_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'description_raw', 'reconciliation_raw_row.description_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'description_raw'),
  NULL,
  'reconciliation_raw_row.description_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'merchant_name_raw', 'text', 'reconciliation_raw_row.merchant_name_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'merchant_name_raw', 'reconciliation_raw_row.merchant_name_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'merchant_name_raw'),
  NULL,
  'reconciliation_raw_row.merchant_name_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'payee_name_raw', 'text', 'reconciliation_raw_row.payee_name_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'payee_name_raw', 'reconciliation_raw_row.payee_name_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'payee_name_raw'),
  NULL,
  'reconciliation_raw_row.payee_name_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'amount_raw', 'text', 'reconciliation_raw_row.amount_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'amount_raw', 'reconciliation_raw_row.amount_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'amount_raw'),
  NULL,
  'reconciliation_raw_row.amount_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'debit_raw', 'text', 'reconciliation_raw_row.debit_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'debit_raw', 'reconciliation_raw_row.debit_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'debit_raw'),
  NULL,
  'reconciliation_raw_row.debit_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'credit_raw', 'text', 'reconciliation_raw_row.credit_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'credit_raw', 'reconciliation_raw_row.credit_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'credit_raw'),
  NULL,
  'reconciliation_raw_row.credit_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'running_balance_raw', 'text', 'reconciliation_raw_row.running_balance_raw is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'running_balance_raw', 'reconciliation_raw_row.running_balance_raw is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'running_balance_raw'),
  NULL,
  'reconciliation_raw_row.running_balance_raw default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'excluded', 'boolean', 'reconciliation_raw_row.excluded is boolean');
SELECT col_not_null('public', 'reconciliation_raw_row', 'excluded', 'reconciliation_raw_row.excluded is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'excluded'),
  $dflt$false$dflt$,
  'reconciliation_raw_row.excluded default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'exclusion_reason', 'text', 'reconciliation_raw_row.exclusion_reason is text');
SELECT col_is_null('public', 'reconciliation_raw_row', 'exclusion_reason', 'reconciliation_raw_row.exclusion_reason is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'exclusion_reason'),
  NULL,
  'reconciliation_raw_row.exclusion_reason default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'parsing_issues_json', 'jsonb', 'reconciliation_raw_row.parsing_issues_json is jsonb');
SELECT col_not_null('public', 'reconciliation_raw_row', 'parsing_issues_json', 'reconciliation_raw_row.parsing_issues_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'parsing_issues_json'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_raw_row.parsing_issues_json default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'created_at', 'timestamp with time zone', 'reconciliation_raw_row.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_raw_row', 'created_at', 'reconciliation_raw_row.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_raw_row.created_at default'
);
SELECT col_type_is('public', 'reconciliation_raw_row', 'organization_id', 'uuid', 'reconciliation_raw_row.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_raw_row', 'organization_id', 'reconciliation_raw_row.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_raw_row'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_raw_row.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_raw_row'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_raw_row_source_file_id_line_number_key => UNIQUE (source_file_id, line_number)
reconciliation_raw_row_source_system_check => CHECK ((source_system = ANY (ARRAY['bank'::text, 'gl'::text])))$chk$,
  'reconciliation_raw_row check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_raw_row'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_raw_row' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_raw_row grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_raw_row'),
  $policy$reconciliation_raw_row_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_raw_row row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_raw_row', ARRAY[]::name[], 'reconciliation_raw_row has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_review_decision', ARRAY['id', 'job_id', 'target_type', 'target_id', 'outcome', 'final_category', 'notes', 'reviewer_id', 'reviewer_name', 'record_version', 'created_at', 'updated_at', 'organization_id']::name[], 'reconciliation_review_decision has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_review_decision', ARRAY['id']::name[], 'reconciliation_review_decision primary key');
SELECT indexes_are('public', 'reconciliation_review_decision', ARRAY['reconciliation_review_decision_job_created_idx', 'reconciliation_review_decision_job_id_target_type_target_id_key', 'reconciliation_review_decision_job_idx', 'reconciliation_review_decision_organization_idx', 'reconciliation_review_decision_pkey']::name[], 'reconciliation_review_decision has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_review_decision' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_review_decision has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'id', 'uuid', 'reconciliation_review_decision.id is uuid');
SELECT col_not_null('public', 'reconciliation_review_decision', 'id', 'reconciliation_review_decision.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_review_decision.id default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'job_id', 'uuid', 'reconciliation_review_decision.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_review_decision', 'job_id', 'reconciliation_review_decision.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_review_decision.job_id default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'target_type', 'text', 'reconciliation_review_decision.target_type is text');
SELECT col_not_null('public', 'reconciliation_review_decision', 'target_type', 'reconciliation_review_decision.target_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'target_type'),
  NULL,
  'reconciliation_review_decision.target_type default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'target_id', 'uuid', 'reconciliation_review_decision.target_id is uuid');
SELECT col_not_null('public', 'reconciliation_review_decision', 'target_id', 'reconciliation_review_decision.target_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'target_id'),
  NULL,
  'reconciliation_review_decision.target_id default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'outcome', 'text', 'reconciliation_review_decision.outcome is text');
SELECT col_not_null('public', 'reconciliation_review_decision', 'outcome', 'reconciliation_review_decision.outcome is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'outcome'),
  NULL,
  'reconciliation_review_decision.outcome default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'final_category', 'text', 'reconciliation_review_decision.final_category is text');
SELECT col_is_null('public', 'reconciliation_review_decision', 'final_category', 'reconciliation_review_decision.final_category is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'final_category'),
  NULL,
  'reconciliation_review_decision.final_category default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'notes', 'text', 'reconciliation_review_decision.notes is text');
SELECT col_is_null('public', 'reconciliation_review_decision', 'notes', 'reconciliation_review_decision.notes is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'notes'),
  NULL,
  'reconciliation_review_decision.notes default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'reviewer_id', 'text', 'reconciliation_review_decision.reviewer_id is text');
SELECT col_is_null('public', 'reconciliation_review_decision', 'reviewer_id', 'reconciliation_review_decision.reviewer_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'reviewer_id'),
  NULL,
  'reconciliation_review_decision.reviewer_id default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'reviewer_name', 'text', 'reconciliation_review_decision.reviewer_name is text');
SELECT col_is_null('public', 'reconciliation_review_decision', 'reviewer_name', 'reconciliation_review_decision.reviewer_name is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'reviewer_name'),
  NULL,
  'reconciliation_review_decision.reviewer_name default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'record_version', 'integer', 'reconciliation_review_decision.record_version is integer');
SELECT col_not_null('public', 'reconciliation_review_decision', 'record_version', 'reconciliation_review_decision.record_version is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'record_version'),
  $dflt$1$dflt$,
  'reconciliation_review_decision.record_version default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'created_at', 'timestamp with time zone', 'reconciliation_review_decision.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_review_decision', 'created_at', 'reconciliation_review_decision.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_review_decision.created_at default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'updated_at', 'timestamp with time zone', 'reconciliation_review_decision.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_review_decision', 'updated_at', 'reconciliation_review_decision.updated_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'updated_at'),
  NULL,
  'reconciliation_review_decision.updated_at default'
);
SELECT col_type_is('public', 'reconciliation_review_decision', 'organization_id', 'uuid', 'reconciliation_review_decision.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_review_decision', 'organization_id', 'reconciliation_review_decision.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_decision'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_review_decision.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_review_decision'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_review_decision_job_id_target_type_target_id_key => UNIQUE (job_id, target_type, target_id)$chk$,
  'reconciliation_review_decision check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_review_decision'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_review_decision' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_review_decision grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_review_decision'),
  $policy$reconciliation_review_decision_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_review_decision row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_review_decision', ARRAY[]::name[], 'reconciliation_review_decision has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_review_observation', ARRAY['id', 'job_id', 'category', 'title', 'message', 'severity', 'related_transaction_ids', 'created_at', 'persisted_at', 'organization_id']::name[], 'reconciliation_review_observation has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_review_observation', ARRAY['id']::name[], 'reconciliation_review_observation primary key');
SELECT indexes_are('public', 'reconciliation_review_observation', ARRAY['reconciliation_review_observation_job_created_idx', 'reconciliation_review_observation_job_idx', 'reconciliation_review_observation_organization_idx', 'reconciliation_review_observation_pkey']::name[], 'reconciliation_review_observation has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_review_observation' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_review_observation has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_review_observation', 'id', 'uuid', 'reconciliation_review_observation.id is uuid');
SELECT col_not_null('public', 'reconciliation_review_observation', 'id', 'reconciliation_review_observation.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_observation'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_review_observation.id default'
);
SELECT col_type_is('public', 'reconciliation_review_observation', 'job_id', 'uuid', 'reconciliation_review_observation.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_review_observation', 'job_id', 'reconciliation_review_observation.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_observation'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_review_observation.job_id default'
);
SELECT col_type_is('public', 'reconciliation_review_observation', 'category', 'text', 'reconciliation_review_observation.category is text');
SELECT col_not_null('public', 'reconciliation_review_observation', 'category', 'reconciliation_review_observation.category is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_observation'::regclass AND a.attname = 'category'),
  NULL,
  'reconciliation_review_observation.category default'
);
SELECT col_type_is('public', 'reconciliation_review_observation', 'title', 'text', 'reconciliation_review_observation.title is text');
SELECT col_not_null('public', 'reconciliation_review_observation', 'title', 'reconciliation_review_observation.title is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_observation'::regclass AND a.attname = 'title'),
  NULL,
  'reconciliation_review_observation.title default'
);
SELECT col_type_is('public', 'reconciliation_review_observation', 'message', 'text', 'reconciliation_review_observation.message is text');
SELECT col_not_null('public', 'reconciliation_review_observation', 'message', 'reconciliation_review_observation.message is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_observation'::regclass AND a.attname = 'message'),
  NULL,
  'reconciliation_review_observation.message default'
);
SELECT col_type_is('public', 'reconciliation_review_observation', 'severity', 'text', 'reconciliation_review_observation.severity is text');
SELECT col_not_null('public', 'reconciliation_review_observation', 'severity', 'reconciliation_review_observation.severity is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_observation'::regclass AND a.attname = 'severity'),
  NULL,
  'reconciliation_review_observation.severity default'
);
SELECT col_type_is('public', 'reconciliation_review_observation', 'related_transaction_ids', 'uuid[]', 'reconciliation_review_observation.related_transaction_ids is uuid[]');
SELECT col_not_null('public', 'reconciliation_review_observation', 'related_transaction_ids', 'reconciliation_review_observation.related_transaction_ids is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_observation'::regclass AND a.attname = 'related_transaction_ids'),
  $dflt$ARRAY[]::uuid[]$dflt$,
  'reconciliation_review_observation.related_transaction_ids default'
);
SELECT col_type_is('public', 'reconciliation_review_observation', 'created_at', 'timestamp with time zone', 'reconciliation_review_observation.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_review_observation', 'created_at', 'reconciliation_review_observation.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_observation'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_review_observation.created_at default'
);
SELECT col_type_is('public', 'reconciliation_review_observation', 'persisted_at', 'timestamp with time zone', 'reconciliation_review_observation.persisted_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_review_observation', 'persisted_at', 'reconciliation_review_observation.persisted_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_observation'::regclass AND a.attname = 'persisted_at'),
  $dflt$now()$dflt$,
  'reconciliation_review_observation.persisted_at default'
);
SELECT col_type_is('public', 'reconciliation_review_observation', 'organization_id', 'uuid', 'reconciliation_review_observation.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_review_observation', 'organization_id', 'reconciliation_review_observation.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_review_observation'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_review_observation.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_review_observation'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$$chk$,
  'reconciliation_review_observation check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_review_observation'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_review_observation' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_review_observation grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_review_observation'),
  $policy$reconciliation_review_observation_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_review_observation row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_review_observation', ARRAY[]::name[], 'reconciliation_review_observation has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_rule_result', ARRAY['id', 'job_id', 'target_kind', 'target_id', 'rule_id', 'rule_name', 'passed', 'score', 'reason', 'evidence_json', 'candidate_transaction_id', 'evaluation_order', 'created_at', 'organization_id']::name[], 'reconciliation_rule_result has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_rule_result', ARRAY['id']::name[], 'reconciliation_rule_result primary key');
SELECT indexes_are('public', 'reconciliation_rule_result', ARRAY['reconciliation_rule_result_candidate_transaction_idx', 'reconciliation_rule_result_organization_idx', 'reconciliation_rule_result_pkey', 'reconciliation_rule_result_target_idx']::name[], 'reconciliation_rule_result has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_rule_result' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_rule_result has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'id', 'uuid', 'reconciliation_rule_result.id is uuid');
SELECT col_not_null('public', 'reconciliation_rule_result', 'id', 'reconciliation_rule_result.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_rule_result.id default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'job_id', 'uuid', 'reconciliation_rule_result.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_rule_result', 'job_id', 'reconciliation_rule_result.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_rule_result.job_id default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'target_kind', 'text', 'reconciliation_rule_result.target_kind is text');
SELECT col_not_null('public', 'reconciliation_rule_result', 'target_kind', 'reconciliation_rule_result.target_kind is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'target_kind'),
  NULL,
  'reconciliation_rule_result.target_kind default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'target_id', 'uuid', 'reconciliation_rule_result.target_id is uuid');
SELECT col_not_null('public', 'reconciliation_rule_result', 'target_id', 'reconciliation_rule_result.target_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'target_id'),
  NULL,
  'reconciliation_rule_result.target_id default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'rule_id', 'text', 'reconciliation_rule_result.rule_id is text');
SELECT col_not_null('public', 'reconciliation_rule_result', 'rule_id', 'reconciliation_rule_result.rule_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'rule_id'),
  NULL,
  'reconciliation_rule_result.rule_id default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'rule_name', 'text', 'reconciliation_rule_result.rule_name is text');
SELECT col_not_null('public', 'reconciliation_rule_result', 'rule_name', 'reconciliation_rule_result.rule_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'rule_name'),
  NULL,
  'reconciliation_rule_result.rule_name default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'passed', 'boolean', 'reconciliation_rule_result.passed is boolean');
SELECT col_not_null('public', 'reconciliation_rule_result', 'passed', 'reconciliation_rule_result.passed is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'passed'),
  NULL,
  'reconciliation_rule_result.passed default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'score', 'double precision', 'reconciliation_rule_result.score is double precision');
SELECT col_not_null('public', 'reconciliation_rule_result', 'score', 'reconciliation_rule_result.score is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'score'),
  NULL,
  'reconciliation_rule_result.score default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'reason', 'text', 'reconciliation_rule_result.reason is text');
SELECT col_not_null('public', 'reconciliation_rule_result', 'reason', 'reconciliation_rule_result.reason is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'reason'),
  NULL,
  'reconciliation_rule_result.reason default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'evidence_json', 'jsonb', 'reconciliation_rule_result.evidence_json is jsonb');
SELECT col_not_null('public', 'reconciliation_rule_result', 'evidence_json', 'reconciliation_rule_result.evidence_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'evidence_json'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_rule_result.evidence_json default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'candidate_transaction_id', 'uuid', 'reconciliation_rule_result.candidate_transaction_id is uuid');
SELECT col_is_null('public', 'reconciliation_rule_result', 'candidate_transaction_id', 'reconciliation_rule_result.candidate_transaction_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'candidate_transaction_id'),
  NULL,
  'reconciliation_rule_result.candidate_transaction_id default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'evaluation_order', 'integer', 'reconciliation_rule_result.evaluation_order is integer');
SELECT col_not_null('public', 'reconciliation_rule_result', 'evaluation_order', 'reconciliation_rule_result.evaluation_order is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'evaluation_order'),
  $dflt$0$dflt$,
  'reconciliation_rule_result.evaluation_order default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'created_at', 'timestamp with time zone', 'reconciliation_rule_result.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_rule_result', 'created_at', 'reconciliation_rule_result.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_rule_result.created_at default'
);
SELECT col_type_is('public', 'reconciliation_rule_result', 'organization_id', 'uuid', 'reconciliation_rule_result.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_rule_result', 'organization_id', 'reconciliation_rule_result.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_rule_result'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_rule_result.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_rule_result'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_rule_result_target_kind_check => CHECK ((target_kind = ANY (ARRAY['MATCH_RESULT'::text, 'MATCH_GROUP'::text, 'EXCEPTION_ITEM'::text])))$chk$,
  'reconciliation_rule_result check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_rule_result'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_rule_result' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_rule_result grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_rule_result'),
  $policy$reconciliation_rule_result_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_rule_result row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_rule_result', ARRAY[]::name[], 'reconciliation_rule_result has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_run', ARRAY['id', 'organization_id', 'label', 'account_identifier', 'frequency', 'period_year', 'period_month', 'status', 'submitted_by', 'submitted_at', 'decided_by', 'decided_at', 'decision_note', 'excluded_row_count', 'created_at', 'matching_job_id', 'skip_invalid_rows_by', 'skip_invalid_rows_at', 'period_start', 'period_end', 'carry_forward_applied', 'carry_forward_skip_reason', 'closed_at', 'closed_by', 'reopen_count']::name[], 'reconciliation_run has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_run', ARRAY['id']::name[], 'reconciliation_run primary key');
SELECT indexes_are('public', 'reconciliation_run', ARRAY['reconciliation_run_matching_job_idx', 'reconciliation_run_organization_idx', 'reconciliation_run_pkey', 'reconciliation_run_status_submitted_by_idx']::name[], 'reconciliation_run has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_run' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_run has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_run', 'id', 'uuid', 'reconciliation_run.id is uuid');
SELECT col_not_null('public', 'reconciliation_run', 'id', 'reconciliation_run.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_run.id default'
);
SELECT col_type_is('public', 'reconciliation_run', 'organization_id', 'uuid', 'reconciliation_run.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_run', 'organization_id', 'reconciliation_run.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_run.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_run', 'label', 'text', 'reconciliation_run.label is text');
SELECT col_not_null('public', 'reconciliation_run', 'label', 'reconciliation_run.label is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'label'),
  NULL,
  'reconciliation_run.label default'
);
SELECT col_type_is('public', 'reconciliation_run', 'account_identifier', 'text', 'reconciliation_run.account_identifier is text');
SELECT col_is_null('public', 'reconciliation_run', 'account_identifier', 'reconciliation_run.account_identifier is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'account_identifier'),
  NULL,
  'reconciliation_run.account_identifier default'
);
SELECT col_type_is('public', 'reconciliation_run', 'frequency', 'text', 'reconciliation_run.frequency is text');
SELECT col_not_null('public', 'reconciliation_run', 'frequency', 'reconciliation_run.frequency is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'frequency'),
  NULL,
  'reconciliation_run.frequency default'
);
SELECT col_type_is('public', 'reconciliation_run', 'period_year', 'integer', 'reconciliation_run.period_year is integer');
SELECT col_not_null('public', 'reconciliation_run', 'period_year', 'reconciliation_run.period_year is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'period_year'),
  NULL,
  'reconciliation_run.period_year default'
);
SELECT col_type_is('public', 'reconciliation_run', 'period_month', 'integer', 'reconciliation_run.period_month is integer');
SELECT col_is_null('public', 'reconciliation_run', 'period_month', 'reconciliation_run.period_month is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'period_month'),
  NULL,
  'reconciliation_run.period_month default'
);
SELECT col_type_is('public', 'reconciliation_run', 'status', 'text', 'reconciliation_run.status is text');
SELECT col_not_null('public', 'reconciliation_run', 'status', 'reconciliation_run.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'status'),
  $dflt$'DRAFT'::text$dflt$,
  'reconciliation_run.status default'
);
SELECT col_type_is('public', 'reconciliation_run', 'submitted_by', 'uuid', 'reconciliation_run.submitted_by is uuid');
SELECT col_is_null('public', 'reconciliation_run', 'submitted_by', 'reconciliation_run.submitted_by is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'submitted_by'),
  NULL,
  'reconciliation_run.submitted_by default'
);
SELECT col_type_is('public', 'reconciliation_run', 'submitted_at', 'timestamp with time zone', 'reconciliation_run.submitted_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_run', 'submitted_at', 'reconciliation_run.submitted_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'submitted_at'),
  NULL,
  'reconciliation_run.submitted_at default'
);
SELECT col_type_is('public', 'reconciliation_run', 'decided_by', 'uuid', 'reconciliation_run.decided_by is uuid');
SELECT col_is_null('public', 'reconciliation_run', 'decided_by', 'reconciliation_run.decided_by is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'decided_by'),
  NULL,
  'reconciliation_run.decided_by default'
);
SELECT col_type_is('public', 'reconciliation_run', 'decided_at', 'timestamp with time zone', 'reconciliation_run.decided_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_run', 'decided_at', 'reconciliation_run.decided_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'decided_at'),
  NULL,
  'reconciliation_run.decided_at default'
);
SELECT col_type_is('public', 'reconciliation_run', 'decision_note', 'text', 'reconciliation_run.decision_note is text');
SELECT col_is_null('public', 'reconciliation_run', 'decision_note', 'reconciliation_run.decision_note is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'decision_note'),
  NULL,
  'reconciliation_run.decision_note default'
);
SELECT col_type_is('public', 'reconciliation_run', 'excluded_row_count', 'integer', 'reconciliation_run.excluded_row_count is integer');
SELECT col_is_null('public', 'reconciliation_run', 'excluded_row_count', 'reconciliation_run.excluded_row_count is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'excluded_row_count'),
  NULL,
  'reconciliation_run.excluded_row_count default'
);
SELECT col_type_is('public', 'reconciliation_run', 'created_at', 'timestamp with time zone', 'reconciliation_run.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_run', 'created_at', 'reconciliation_run.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_run.created_at default'
);
SELECT col_type_is('public', 'reconciliation_run', 'matching_job_id', 'uuid', 'reconciliation_run.matching_job_id is uuid');
SELECT col_is_null('public', 'reconciliation_run', 'matching_job_id', 'reconciliation_run.matching_job_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'matching_job_id'),
  NULL,
  'reconciliation_run.matching_job_id default'
);
SELECT col_type_is('public', 'reconciliation_run', 'skip_invalid_rows_by', 'uuid', 'reconciliation_run.skip_invalid_rows_by is uuid');
SELECT col_is_null('public', 'reconciliation_run', 'skip_invalid_rows_by', 'reconciliation_run.skip_invalid_rows_by is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'skip_invalid_rows_by'),
  NULL,
  'reconciliation_run.skip_invalid_rows_by default'
);
SELECT col_type_is('public', 'reconciliation_run', 'skip_invalid_rows_at', 'timestamp with time zone', 'reconciliation_run.skip_invalid_rows_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_run', 'skip_invalid_rows_at', 'reconciliation_run.skip_invalid_rows_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'skip_invalid_rows_at'),
  NULL,
  'reconciliation_run.skip_invalid_rows_at default'
);
SELECT col_type_is('public', 'reconciliation_run', 'period_start', 'date', 'reconciliation_run.period_start is date');
SELECT col_is_null('public', 'reconciliation_run', 'period_start', 'reconciliation_run.period_start is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'period_start'),
  NULL,
  'reconciliation_run.period_start default'
);
SELECT col_type_is('public', 'reconciliation_run', 'period_end', 'date', 'reconciliation_run.period_end is date');
SELECT col_is_null('public', 'reconciliation_run', 'period_end', 'reconciliation_run.period_end is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'period_end'),
  NULL,
  'reconciliation_run.period_end default'
);
SELECT col_type_is('public', 'reconciliation_run', 'carry_forward_applied', 'boolean', 'reconciliation_run.carry_forward_applied is boolean');
SELECT col_is_null('public', 'reconciliation_run', 'carry_forward_applied', 'reconciliation_run.carry_forward_applied is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'carry_forward_applied'),
  NULL,
  'reconciliation_run.carry_forward_applied default'
);
SELECT col_type_is('public', 'reconciliation_run', 'carry_forward_skip_reason', 'text', 'reconciliation_run.carry_forward_skip_reason is text');
SELECT col_is_null('public', 'reconciliation_run', 'carry_forward_skip_reason', 'reconciliation_run.carry_forward_skip_reason is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'carry_forward_skip_reason'),
  NULL,
  'reconciliation_run.carry_forward_skip_reason default'
);
SELECT col_type_is('public', 'reconciliation_run', 'closed_at', 'timestamp with time zone', 'reconciliation_run.closed_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_run', 'closed_at', 'reconciliation_run.closed_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'closed_at'),
  NULL,
  'reconciliation_run.closed_at default'
);
SELECT col_type_is('public', 'reconciliation_run', 'closed_by', 'uuid', 'reconciliation_run.closed_by is uuid');
SELECT col_is_null('public', 'reconciliation_run', 'closed_by', 'reconciliation_run.closed_by is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'closed_by'),
  NULL,
  'reconciliation_run.closed_by default'
);
SELECT col_type_is('public', 'reconciliation_run', 'reopen_count', 'integer', 'reconciliation_run.reopen_count is integer');
SELECT col_not_null('public', 'reconciliation_run', 'reopen_count', 'reconciliation_run.reopen_count is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run'::regclass AND a.attname = 'reopen_count'),
  $dflt$0$dflt$,
  'reconciliation_run.reopen_count default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_run'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_run_carry_forward_skip_reason_check => CHECK (((carry_forward_skip_reason IS NULL) OR (carry_forward_skip_reason = ANY (ARRAY['ENV_DISABLED'::text, 'ORG_NOT_ENABLED'::text]))))
reconciliation_run_close_segregation_of_duty_check => CHECK (((closed_by IS NULL) OR (submitted_by IS DISTINCT FROM closed_by)))
reconciliation_run_frequency_check => CHECK ((frequency = ANY (ARRAY['MONTHLY'::text, 'ANNUAL'::text])))
reconciliation_run_period_month_check => CHECK (((period_month IS NULL) OR ((period_month >= 1) AND (period_month <= 12))))
reconciliation_run_period_start_before_end_check => CHECK (((period_end IS NULL) OR (period_start IS NULL) OR (period_end >= period_start)))
reconciliation_run_segregation_of_duty_check => CHECK (((decided_by IS NULL) OR (submitted_by IS DISTINCT FROM decided_by) OR (COALESCE(current_setting('app.allow_self_approval'::text, true), 'false'::text) = 'true'::text)))
reconciliation_run_status_check => CHECK ((status = ANY (ARRAY['DRAFT'::text, 'VALIDATING'::text, 'VALIDATION_FAILED'::text, 'PENDING_APPROVAL'::text, 'APPROVED'::text, 'RECONCILING'::text, 'RECONCILED'::text, 'REJECTED'::text, 'CLOSED'::text])))$chk$,
  'reconciliation_run check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_run'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_run' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_run grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_run'),
  $policy$reconciliation_run_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_run row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_run', ARRAY['trg_reconciliation_run_account_terminal_good']::name[], 'reconciliation_run has exactly the expected triggers');
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_reconciliation_run_account_terminal_good' AND tgrelid = 'public.reconciliation_run'::regclass),
  $trig$CREATE TRIGGER trg_reconciliation_run_account_terminal_good AFTER UPDATE OF status ON public.reconciliation_run FOR EACH ROW EXECUTE FUNCTION sync_reconciliation_run_account_terminal_good()$trig$,
  'reconciliation_run.trg_reconciliation_run_account_terminal_good definition'
);
SELECT columns_are('public', 'reconciliation_run_account', ARRAY['id', 'organization_id', 'reconciliation_run_id', 'account_id', 'created_at', 'period_year', 'period_month', 'is_terminal_good']::name[], 'reconciliation_run_account has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_run_account', ARRAY['id']::name[], 'reconciliation_run_account primary key');
SELECT indexes_are('public', 'reconciliation_run_account', ARRAY['reconciliation_run_account_account_idx', 'reconciliation_run_account_organization_idx', 'reconciliation_run_account_period_reconciled_key', 'reconciliation_run_account_pkey', 'reconciliation_run_account_run_account_key', 'reconciliation_run_account_run_idx']::name[], 'reconciliation_run_account has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_run_account' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_run_account has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_run_account', 'id', 'uuid', 'reconciliation_run_account.id is uuid');
SELECT col_not_null('public', 'reconciliation_run_account', 'id', 'reconciliation_run_account.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_account'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_run_account.id default'
);
SELECT col_type_is('public', 'reconciliation_run_account', 'organization_id', 'uuid', 'reconciliation_run_account.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_run_account', 'organization_id', 'reconciliation_run_account.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_account'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_run_account.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_run_account', 'reconciliation_run_id', 'uuid', 'reconciliation_run_account.reconciliation_run_id is uuid');
SELECT col_not_null('public', 'reconciliation_run_account', 'reconciliation_run_id', 'reconciliation_run_account.reconciliation_run_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_account'::regclass AND a.attname = 'reconciliation_run_id'),
  NULL,
  'reconciliation_run_account.reconciliation_run_id default'
);
SELECT col_type_is('public', 'reconciliation_run_account', 'account_id', 'uuid', 'reconciliation_run_account.account_id is uuid');
SELECT col_not_null('public', 'reconciliation_run_account', 'account_id', 'reconciliation_run_account.account_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_account'::regclass AND a.attname = 'account_id'),
  NULL,
  'reconciliation_run_account.account_id default'
);
SELECT col_type_is('public', 'reconciliation_run_account', 'created_at', 'timestamp with time zone', 'reconciliation_run_account.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_run_account', 'created_at', 'reconciliation_run_account.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_account'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_run_account.created_at default'
);
SELECT col_type_is('public', 'reconciliation_run_account', 'period_year', 'integer', 'reconciliation_run_account.period_year is integer');
SELECT col_not_null('public', 'reconciliation_run_account', 'period_year', 'reconciliation_run_account.period_year is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_account'::regclass AND a.attname = 'period_year'),
  NULL,
  'reconciliation_run_account.period_year default'
);
SELECT col_type_is('public', 'reconciliation_run_account', 'period_month', 'integer', 'reconciliation_run_account.period_month is integer');
SELECT col_is_null('public', 'reconciliation_run_account', 'period_month', 'reconciliation_run_account.period_month is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_account'::regclass AND a.attname = 'period_month'),
  NULL,
  'reconciliation_run_account.period_month default'
);
SELECT col_type_is('public', 'reconciliation_run_account', 'is_terminal_good', 'boolean', 'reconciliation_run_account.is_terminal_good is boolean');
SELECT col_not_null('public', 'reconciliation_run_account', 'is_terminal_good', 'reconciliation_run_account.is_terminal_good is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_account'::regclass AND a.attname = 'is_terminal_good'),
  $dflt$false$dflt$,
  'reconciliation_run_account.is_terminal_good default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_run_account'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_run_account_run_account_key => UNIQUE (reconciliation_run_id, account_id)$chk$,
  'reconciliation_run_account check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_run_account'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_run_account' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_run_account grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_run_account'),
  $policy$reconciliation_run_account_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_run_account row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_run_account', ARRAY[]::name[], 'reconciliation_run_account has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_run_event', ARRAY['event_id', 'run_id', 'organization_id', 'event_type', 'from_status', 'to_status', 'actor', 'details_json', 'created_at']::name[], 'reconciliation_run_event has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_run_event', ARRAY['event_id']::name[], 'reconciliation_run_event primary key');
SELECT indexes_are('public', 'reconciliation_run_event', ARRAY['reconciliation_run_event_organization_idx', 'reconciliation_run_event_pkey', 'reconciliation_run_event_run_idx']::name[], 'reconciliation_run_event has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_run_event' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_run_event has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_run_event', 'event_id', 'bigint', 'reconciliation_run_event.event_id is bigint');
SELECT col_not_null('public', 'reconciliation_run_event', 'event_id', 'reconciliation_run_event.event_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_event'::regclass AND a.attname = 'event_id'),
  $dflt$nextval('reconciliation_run_event_event_id_seq'::regclass)$dflt$,
  'reconciliation_run_event.event_id default'
);
SELECT col_type_is('public', 'reconciliation_run_event', 'run_id', 'uuid', 'reconciliation_run_event.run_id is uuid');
SELECT col_not_null('public', 'reconciliation_run_event', 'run_id', 'reconciliation_run_event.run_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_event'::regclass AND a.attname = 'run_id'),
  NULL,
  'reconciliation_run_event.run_id default'
);
SELECT col_type_is('public', 'reconciliation_run_event', 'organization_id', 'uuid', 'reconciliation_run_event.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_run_event', 'organization_id', 'reconciliation_run_event.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_event'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_run_event.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_run_event', 'event_type', 'text', 'reconciliation_run_event.event_type is text');
SELECT col_not_null('public', 'reconciliation_run_event', 'event_type', 'reconciliation_run_event.event_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_event'::regclass AND a.attname = 'event_type'),
  NULL,
  'reconciliation_run_event.event_type default'
);
SELECT col_type_is('public', 'reconciliation_run_event', 'from_status', 'text', 'reconciliation_run_event.from_status is text');
SELECT col_is_null('public', 'reconciliation_run_event', 'from_status', 'reconciliation_run_event.from_status is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_event'::regclass AND a.attname = 'from_status'),
  NULL,
  'reconciliation_run_event.from_status default'
);
SELECT col_type_is('public', 'reconciliation_run_event', 'to_status', 'text', 'reconciliation_run_event.to_status is text');
SELECT col_is_null('public', 'reconciliation_run_event', 'to_status', 'reconciliation_run_event.to_status is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_event'::regclass AND a.attname = 'to_status'),
  NULL,
  'reconciliation_run_event.to_status default'
);
SELECT col_type_is('public', 'reconciliation_run_event', 'actor', 'text', 'reconciliation_run_event.actor is text');
SELECT col_is_null('public', 'reconciliation_run_event', 'actor', 'reconciliation_run_event.actor is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_event'::regclass AND a.attname = 'actor'),
  NULL,
  'reconciliation_run_event.actor default'
);
SELECT col_type_is('public', 'reconciliation_run_event', 'details_json', 'jsonb', 'reconciliation_run_event.details_json is jsonb');
SELECT col_not_null('public', 'reconciliation_run_event', 'details_json', 'reconciliation_run_event.details_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_event'::regclass AND a.attname = 'details_json'),
  $dflt$'{}'::jsonb$dflt$,
  'reconciliation_run_event.details_json default'
);
SELECT col_type_is('public', 'reconciliation_run_event', 'created_at', 'timestamp with time zone', 'reconciliation_run_event.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_run_event', 'created_at', 'reconciliation_run_event.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_run_event'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_run_event.created_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_run_event'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$$chk$,
  'reconciliation_run_event check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_run_event'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_run_event' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_run_event grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_run_event'),
  $policy$reconciliation_run_event_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_run_event row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_run_event', ARRAY[]::name[], 'reconciliation_run_event has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_source_file', ARRAY['id', 'job_id', 'source_system', 'source_format', 'file_name', 'mime_type', 'size_bytes', 'sha256', 'storage_uri', 'worksheet_name', 'header_row', 'transaction_start_row', 'excluded_row_numbers', 'imported_row_count', 'uploaded_at', 'created_at', 'updated_at', 'organization_id', 'uploaded_by', 'approval_status', 'ingestion_mode']::name[], 'reconciliation_source_file has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_source_file', ARRAY['id']::name[], 'reconciliation_source_file primary key');
SELECT indexes_are('public', 'reconciliation_source_file', ARRAY['reconciliation_source_file_job_id_source_system_key', 'reconciliation_source_file_job_idx', 'reconciliation_source_file_organization_approval_idx', 'reconciliation_source_file_organization_idx', 'reconciliation_source_file_pkey', 'reconciliation_source_file_sha_idx']::name[], 'reconciliation_source_file has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_source_file' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_source_file has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'id', 'uuid', 'reconciliation_source_file.id is uuid');
SELECT col_not_null('public', 'reconciliation_source_file', 'id', 'reconciliation_source_file.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_source_file.id default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'job_id', 'uuid', 'reconciliation_source_file.job_id is uuid');
SELECT col_not_null('public', 'reconciliation_source_file', 'job_id', 'reconciliation_source_file.job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'job_id'),
  NULL,
  'reconciliation_source_file.job_id default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'source_system', 'text', 'reconciliation_source_file.source_system is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'source_system', 'reconciliation_source_file.source_system is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'source_system'),
  NULL,
  'reconciliation_source_file.source_system default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'source_format', 'text', 'reconciliation_source_file.source_format is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'source_format', 'reconciliation_source_file.source_format is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'source_format'),
  NULL,
  'reconciliation_source_file.source_format default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'file_name', 'text', 'reconciliation_source_file.file_name is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'file_name', 'reconciliation_source_file.file_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'file_name'),
  NULL,
  'reconciliation_source_file.file_name default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'mime_type', 'text', 'reconciliation_source_file.mime_type is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'mime_type', 'reconciliation_source_file.mime_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'mime_type'),
  NULL,
  'reconciliation_source_file.mime_type default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'size_bytes', 'bigint', 'reconciliation_source_file.size_bytes is bigint');
SELECT col_not_null('public', 'reconciliation_source_file', 'size_bytes', 'reconciliation_source_file.size_bytes is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'size_bytes'),
  NULL,
  'reconciliation_source_file.size_bytes default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'sha256', 'text', 'reconciliation_source_file.sha256 is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'sha256', 'reconciliation_source_file.sha256 is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'sha256'),
  NULL,
  'reconciliation_source_file.sha256 default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'storage_uri', 'text', 'reconciliation_source_file.storage_uri is text');
SELECT col_is_null('public', 'reconciliation_source_file', 'storage_uri', 'reconciliation_source_file.storage_uri is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'storage_uri'),
  NULL,
  'reconciliation_source_file.storage_uri default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'worksheet_name', 'text', 'reconciliation_source_file.worksheet_name is text');
SELECT col_is_null('public', 'reconciliation_source_file', 'worksheet_name', 'reconciliation_source_file.worksheet_name is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'worksheet_name'),
  NULL,
  'reconciliation_source_file.worksheet_name default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'header_row', 'integer', 'reconciliation_source_file.header_row is integer');
SELECT col_is_null('public', 'reconciliation_source_file', 'header_row', 'reconciliation_source_file.header_row is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'header_row'),
  NULL,
  'reconciliation_source_file.header_row default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'transaction_start_row', 'integer', 'reconciliation_source_file.transaction_start_row is integer');
SELECT col_is_null('public', 'reconciliation_source_file', 'transaction_start_row', 'reconciliation_source_file.transaction_start_row is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'transaction_start_row'),
  NULL,
  'reconciliation_source_file.transaction_start_row default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'excluded_row_numbers', 'jsonb', 'reconciliation_source_file.excluded_row_numbers is jsonb');
SELECT col_not_null('public', 'reconciliation_source_file', 'excluded_row_numbers', 'reconciliation_source_file.excluded_row_numbers is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'excluded_row_numbers'),
  $dflt$'[]'::jsonb$dflt$,
  'reconciliation_source_file.excluded_row_numbers default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'imported_row_count', 'integer', 'reconciliation_source_file.imported_row_count is integer');
SELECT col_is_null('public', 'reconciliation_source_file', 'imported_row_count', 'reconciliation_source_file.imported_row_count is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'imported_row_count'),
  NULL,
  'reconciliation_source_file.imported_row_count default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'uploaded_at', 'timestamp with time zone', 'reconciliation_source_file.uploaded_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_source_file', 'uploaded_at', 'reconciliation_source_file.uploaded_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'uploaded_at'),
  NULL,
  'reconciliation_source_file.uploaded_at default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'created_at', 'timestamp with time zone', 'reconciliation_source_file.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_source_file', 'created_at', 'reconciliation_source_file.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_source_file.created_at default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'updated_at', 'timestamp with time zone', 'reconciliation_source_file.updated_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_source_file', 'updated_at', 'reconciliation_source_file.updated_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'updated_at'),
  $dflt$now()$dflt$,
  'reconciliation_source_file.updated_at default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'organization_id', 'uuid', 'reconciliation_source_file.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_source_file', 'organization_id', 'reconciliation_source_file.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_source_file.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'uploaded_by', 'text', 'reconciliation_source_file.uploaded_by is text');
SELECT col_is_null('public', 'reconciliation_source_file', 'uploaded_by', 'reconciliation_source_file.uploaded_by is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'uploaded_by'),
  NULL,
  'reconciliation_source_file.uploaded_by default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'approval_status', 'text', 'reconciliation_source_file.approval_status is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'approval_status', 'reconciliation_source_file.approval_status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'approval_status'),
  $dflt$'NOT_SUBMITTED'::text$dflt$,
  'reconciliation_source_file.approval_status default'
);
SELECT col_type_is('public', 'reconciliation_source_file', 'ingestion_mode', 'text', 'reconciliation_source_file.ingestion_mode is text');
SELECT col_not_null('public', 'reconciliation_source_file', 'ingestion_mode', 'reconciliation_source_file.ingestion_mode is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file'::regclass AND a.attname = 'ingestion_mode'),
  $dflt$'DIRECT'::text$dflt$,
  'reconciliation_source_file.ingestion_mode default'
);
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
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_source_file'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_source_file' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_source_file grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_source_file'),
  $policy$reconciliation_source_file_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_source_file row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_source_file', ARRAY['trg_reconciliation_source_file_updated_at']::name[], 'reconciliation_source_file has exactly the expected triggers');
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_reconciliation_source_file_updated_at' AND tgrelid = 'public.reconciliation_source_file'::regclass),
  $trig$CREATE TRIGGER trg_reconciliation_source_file_updated_at BEFORE UPDATE ON public.reconciliation_source_file FOR EACH ROW EXECUTE FUNCTION set_updated_at()$trig$,
  'reconciliation_source_file.trg_reconciliation_source_file_updated_at definition'
);
SELECT columns_are('public', 'reconciliation_source_file_content', ARRAY['source_file_id', 'content', 'byte_size', 'sha256', 'original_file_name', 'original_mime_type', 'captured_at', 'retention_expires_at', 'id', 'created_at', 'organization_id']::name[], 'reconciliation_source_file_content has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_source_file_content', ARRAY['source_file_id']::name[], 'reconciliation_source_file_content primary key');
SELECT indexes_are('public', 'reconciliation_source_file_content', ARRAY['reconciliation_source_file_content_id_key', 'reconciliation_source_file_content_organization_idx', 'reconciliation_source_file_content_pkey', 'reconciliation_source_file_content_retention_idx', 'reconciliation_source_file_content_sha_idx']::name[], 'reconciliation_source_file_content has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_source_file_content' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_source_file_content has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'source_file_id', 'uuid', 'reconciliation_source_file_content.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'source_file_id', 'reconciliation_source_file_content.source_file_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'source_file_id'),
  NULL,
  'reconciliation_source_file_content.source_file_id default'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'content', 'bytea', 'reconciliation_source_file_content.content is bytea');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'content', 'reconciliation_source_file_content.content is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'content'),
  NULL,
  'reconciliation_source_file_content.content default'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'byte_size', 'bigint', 'reconciliation_source_file_content.byte_size is bigint');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'byte_size', 'reconciliation_source_file_content.byte_size is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'byte_size'),
  NULL,
  'reconciliation_source_file_content.byte_size default'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'sha256', 'text', 'reconciliation_source_file_content.sha256 is text');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'sha256', 'reconciliation_source_file_content.sha256 is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'sha256'),
  NULL,
  'reconciliation_source_file_content.sha256 default'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'original_file_name', 'text', 'reconciliation_source_file_content.original_file_name is text');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'original_file_name', 'reconciliation_source_file_content.original_file_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'original_file_name'),
  NULL,
  'reconciliation_source_file_content.original_file_name default'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'original_mime_type', 'text', 'reconciliation_source_file_content.original_mime_type is text');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'original_mime_type', 'reconciliation_source_file_content.original_mime_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'original_mime_type'),
  NULL,
  'reconciliation_source_file_content.original_mime_type default'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'captured_at', 'timestamp with time zone', 'reconciliation_source_file_content.captured_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'captured_at', 'reconciliation_source_file_content.captured_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'captured_at'),
  $dflt$now()$dflt$,
  'reconciliation_source_file_content.captured_at default'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'retention_expires_at', 'timestamp with time zone', 'reconciliation_source_file_content.retention_expires_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_source_file_content', 'retention_expires_at', 'reconciliation_source_file_content.retention_expires_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'retention_expires_at'),
  NULL,
  'reconciliation_source_file_content.retention_expires_at default'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'id', 'uuid', 'reconciliation_source_file_content.id is uuid');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'id', 'reconciliation_source_file_content.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'id'),
  $dflt$gen_random_uuid()$dflt$,
  'reconciliation_source_file_content.id default'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'created_at', 'timestamp with time zone', 'reconciliation_source_file_content.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'created_at', 'reconciliation_source_file_content.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_source_file_content.created_at default'
);
SELECT col_type_is('public', 'reconciliation_source_file_content', 'organization_id', 'uuid', 'reconciliation_source_file_content.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_source_file_content', 'organization_id', 'reconciliation_source_file_content.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_source_file_content'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_source_file_content.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_source_file_content'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_source_file_content_byte_size_check => CHECK ((byte_size >= 0))
reconciliation_source_file_content_id_key => UNIQUE (id)
reconciliation_source_file_content_length_matches_check => CHECK ((octet_length(content) = byte_size))$chk$,
  'reconciliation_source_file_content check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_source_file_content'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_source_file_content' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_source_file_content grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_source_file_content'),
  $policy$reconciliation_source_file_content_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_source_file_content row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_source_file_content', ARRAY[]::name[], 'reconciliation_source_file_content has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_staged_transaction', ARRAY['id', 'raw_row_id', 'source_file_id', 'mapping_profile_version_id', 'status', 'normalized_fields_json', 'validation_summary_json', 'control_total_amount', 'created_at', 'ingestion_mode', 'promoted_at', 'promoted_by', 'organization_id']::name[], 'reconciliation_staged_transaction has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_staged_transaction', ARRAY['id']::name[], 'reconciliation_staged_transaction primary key');
SELECT indexes_are('public', 'reconciliation_staged_transaction', ARRAY['reconciliation_staged_transaction_mapping_profile_version_idx', 'reconciliation_staged_transaction_organization_idx', 'reconciliation_staged_transaction_pkey', 'reconciliation_staged_transaction_raw_row_key', 'reconciliation_staged_transaction_source_file_idx']::name[], 'reconciliation_staged_transaction has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_staged_transaction' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_staged_transaction has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'id', 'uuid', 'reconciliation_staged_transaction.id is uuid');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'id', 'reconciliation_staged_transaction.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_staged_transaction.id default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'raw_row_id', 'uuid', 'reconciliation_staged_transaction.raw_row_id is uuid');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'raw_row_id', 'reconciliation_staged_transaction.raw_row_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'raw_row_id'),
  NULL,
  'reconciliation_staged_transaction.raw_row_id default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'source_file_id', 'uuid', 'reconciliation_staged_transaction.source_file_id is uuid');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'source_file_id', 'reconciliation_staged_transaction.source_file_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'source_file_id'),
  NULL,
  'reconciliation_staged_transaction.source_file_id default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'mapping_profile_version_id', 'uuid', 'reconciliation_staged_transaction.mapping_profile_version_id is uuid');
SELECT col_is_null('public', 'reconciliation_staged_transaction', 'mapping_profile_version_id', 'reconciliation_staged_transaction.mapping_profile_version_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'mapping_profile_version_id'),
  NULL,
  'reconciliation_staged_transaction.mapping_profile_version_id default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'status', 'text', 'reconciliation_staged_transaction.status is text');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'status', 'reconciliation_staged_transaction.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'status'),
  $dflt$'PENDING_VALIDATION'::text$dflt$,
  'reconciliation_staged_transaction.status default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'normalized_fields_json', 'jsonb', 'reconciliation_staged_transaction.normalized_fields_json is jsonb');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'normalized_fields_json', 'reconciliation_staged_transaction.normalized_fields_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'normalized_fields_json'),
  NULL,
  'reconciliation_staged_transaction.normalized_fields_json default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'validation_summary_json', 'jsonb', 'reconciliation_staged_transaction.validation_summary_json is jsonb');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'validation_summary_json', 'reconciliation_staged_transaction.validation_summary_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'validation_summary_json'),
  $dflt$'{}'::jsonb$dflt$,
  'reconciliation_staged_transaction.validation_summary_json default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'control_total_amount', 'numeric(19,4)', 'reconciliation_staged_transaction.control_total_amount is numeric(19,4)');
SELECT col_is_null('public', 'reconciliation_staged_transaction', 'control_total_amount', 'reconciliation_staged_transaction.control_total_amount is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'control_total_amount'),
  NULL,
  'reconciliation_staged_transaction.control_total_amount default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'created_at', 'timestamp with time zone', 'reconciliation_staged_transaction.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'created_at', 'reconciliation_staged_transaction.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_staged_transaction.created_at default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'ingestion_mode', 'text', 'reconciliation_staged_transaction.ingestion_mode is text');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'ingestion_mode', 'reconciliation_staged_transaction.ingestion_mode is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'ingestion_mode'),
  $dflt$'DIRECT'::text$dflt$,
  'reconciliation_staged_transaction.ingestion_mode default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'promoted_at', 'timestamp with time zone', 'reconciliation_staged_transaction.promoted_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_staged_transaction', 'promoted_at', 'reconciliation_staged_transaction.promoted_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'promoted_at'),
  NULL,
  'reconciliation_staged_transaction.promoted_at default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'promoted_by', 'text', 'reconciliation_staged_transaction.promoted_by is text');
SELECT col_is_null('public', 'reconciliation_staged_transaction', 'promoted_by', 'reconciliation_staged_transaction.promoted_by is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'promoted_by'),
  NULL,
  'reconciliation_staged_transaction.promoted_by default'
);
SELECT col_type_is('public', 'reconciliation_staged_transaction', 'organization_id', 'uuid', 'reconciliation_staged_transaction.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_staged_transaction', 'organization_id', 'reconciliation_staged_transaction.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_staged_transaction'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_staged_transaction.organization_id default'
);
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
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_staged_transaction'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_staged_transaction' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_staged_transaction grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_staged_transaction'),
  $policy$reconciliation_staged_transaction_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_staged_transaction row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_staged_transaction', ARRAY[]::name[], 'reconciliation_staged_transaction has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_template_definition', ARRAY['id', 'template_type', 'version', 'headers_json', 'instructions', 'status', 'created_at']::name[], 'reconciliation_template_definition has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_template_definition', ARRAY['id']::name[], 'reconciliation_template_definition primary key');
SELECT indexes_are('public', 'reconciliation_template_definition', ARRAY['reconciliation_template_definition_active_idx', 'reconciliation_template_definition_pkey', 'reconciliation_template_definition_type_version_key']::name[], 'reconciliation_template_definition has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_template_definition', 'id', 'uuid', 'reconciliation_template_definition.id is uuid');
SELECT col_not_null('public', 'reconciliation_template_definition', 'id', 'reconciliation_template_definition.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_template_definition'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_template_definition.id default'
);
SELECT col_type_is('public', 'reconciliation_template_definition', 'template_type', 'text', 'reconciliation_template_definition.template_type is text');
SELECT col_not_null('public', 'reconciliation_template_definition', 'template_type', 'reconciliation_template_definition.template_type is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_template_definition'::regclass AND a.attname = 'template_type'),
  NULL,
  'reconciliation_template_definition.template_type default'
);
SELECT col_type_is('public', 'reconciliation_template_definition', 'version', 'integer', 'reconciliation_template_definition.version is integer');
SELECT col_not_null('public', 'reconciliation_template_definition', 'version', 'reconciliation_template_definition.version is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_template_definition'::regclass AND a.attname = 'version'),
  NULL,
  'reconciliation_template_definition.version default'
);
SELECT col_type_is('public', 'reconciliation_template_definition', 'headers_json', 'jsonb', 'reconciliation_template_definition.headers_json is jsonb');
SELECT col_not_null('public', 'reconciliation_template_definition', 'headers_json', 'reconciliation_template_definition.headers_json is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_template_definition'::regclass AND a.attname = 'headers_json'),
  NULL,
  'reconciliation_template_definition.headers_json default'
);
SELECT col_type_is('public', 'reconciliation_template_definition', 'instructions', 'text', 'reconciliation_template_definition.instructions is text');
SELECT col_is_null('public', 'reconciliation_template_definition', 'instructions', 'reconciliation_template_definition.instructions is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_template_definition'::regclass AND a.attname = 'instructions'),
  NULL,
  'reconciliation_template_definition.instructions default'
);
SELECT col_type_is('public', 'reconciliation_template_definition', 'status', 'text', 'reconciliation_template_definition.status is text');
SELECT col_not_null('public', 'reconciliation_template_definition', 'status', 'reconciliation_template_definition.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_template_definition'::regclass AND a.attname = 'status'),
  $dflt$'ACTIVE'::text$dflt$,
  'reconciliation_template_definition.status default'
);
SELECT col_type_is('public', 'reconciliation_template_definition', 'created_at', 'timestamp with time zone', 'reconciliation_template_definition.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_template_definition', 'created_at', 'reconciliation_template_definition.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_template_definition'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_template_definition.created_at default'
);
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
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_template_definition'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_template_definition' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_template_definition grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_template_definition'),
  $policy$$policy$,
  'reconciliation_template_definition row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_template_definition', ARRAY[]::name[], 'reconciliation_template_definition has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_user', ARRAY['user_name', 'first_name', 'last_name', 'last_changed', 'id', 'created_at', 'organization_id', 'role', 'password_hash', 'email', 'phone', 'identity_verification_status', 'identity_verification_code_hash', 'identity_verification_code_expires_at']::name[], 'reconciliation_user has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_user', ARRAY['user_name']::name[], 'reconciliation_user primary key');
SELECT indexes_are('public', 'reconciliation_user', ARRAY['reconciliation_user_email_key', 'reconciliation_user_id_key', 'reconciliation_user_pkey']::name[], 'reconciliation_user has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_user', 'user_name', 'text', 'reconciliation_user.user_name is text');
SELECT col_not_null('public', 'reconciliation_user', 'user_name', 'reconciliation_user.user_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'user_name'),
  NULL,
  'reconciliation_user.user_name default'
);
SELECT col_type_is('public', 'reconciliation_user', 'first_name', 'text', 'reconciliation_user.first_name is text');
SELECT col_not_null('public', 'reconciliation_user', 'first_name', 'reconciliation_user.first_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'first_name'),
  NULL,
  'reconciliation_user.first_name default'
);
SELECT col_type_is('public', 'reconciliation_user', 'last_name', 'text', 'reconciliation_user.last_name is text');
SELECT col_not_null('public', 'reconciliation_user', 'last_name', 'reconciliation_user.last_name is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'last_name'),
  NULL,
  'reconciliation_user.last_name default'
);
SELECT col_type_is('public', 'reconciliation_user', 'last_changed', 'timestamp with time zone', 'reconciliation_user.last_changed is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_user', 'last_changed', 'reconciliation_user.last_changed is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'last_changed'),
  $dflt$now()$dflt$,
  'reconciliation_user.last_changed default'
);
SELECT col_type_is('public', 'reconciliation_user', 'id', 'uuid', 'reconciliation_user.id is uuid');
SELECT col_not_null('public', 'reconciliation_user', 'id', 'reconciliation_user.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'id'),
  $dflt$gen_random_uuid()$dflt$,
  'reconciliation_user.id default'
);
SELECT col_type_is('public', 'reconciliation_user', 'created_at', 'timestamp with time zone', 'reconciliation_user.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_user', 'created_at', 'reconciliation_user.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_user.created_at default'
);
SELECT col_type_is('public', 'reconciliation_user', 'organization_id', 'uuid', 'reconciliation_user.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_user', 'organization_id', 'reconciliation_user.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_user.organization_id default'
);
SELECT col_type_is('public', 'reconciliation_user', 'role', 'text', 'reconciliation_user.role is text');
SELECT col_not_null('public', 'reconciliation_user', 'role', 'reconciliation_user.role is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'role'),
  NULL,
  'reconciliation_user.role default'
);
SELECT col_type_is('public', 'reconciliation_user', 'password_hash', 'text', 'reconciliation_user.password_hash is text');
SELECT col_not_null('public', 'reconciliation_user', 'password_hash', 'reconciliation_user.password_hash is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'password_hash'),
  NULL,
  'reconciliation_user.password_hash default'
);
SELECT col_type_is('public', 'reconciliation_user', 'email', 'text', 'reconciliation_user.email is text');
SELECT col_is_null('public', 'reconciliation_user', 'email', 'reconciliation_user.email is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'email'),
  NULL,
  'reconciliation_user.email default'
);
SELECT col_type_is('public', 'reconciliation_user', 'phone', 'text', 'reconciliation_user.phone is text');
SELECT col_is_null('public', 'reconciliation_user', 'phone', 'reconciliation_user.phone is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'phone'),
  NULL,
  'reconciliation_user.phone default'
);
SELECT col_type_is('public', 'reconciliation_user', 'identity_verification_status', 'text', 'reconciliation_user.identity_verification_status is text');
SELECT col_not_null('public', 'reconciliation_user', 'identity_verification_status', 'reconciliation_user.identity_verification_status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'identity_verification_status'),
  $dflt$'pending'::text$dflt$,
  'reconciliation_user.identity_verification_status default'
);
SELECT col_type_is('public', 'reconciliation_user', 'identity_verification_code_hash', 'text', 'reconciliation_user.identity_verification_code_hash is text');
SELECT col_is_null('public', 'reconciliation_user', 'identity_verification_code_hash', 'reconciliation_user.identity_verification_code_hash is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'identity_verification_code_hash'),
  NULL,
  'reconciliation_user.identity_verification_code_hash default'
);
SELECT col_type_is('public', 'reconciliation_user', 'identity_verification_code_expires_at', 'timestamp with time zone', 'reconciliation_user.identity_verification_code_expires_at is timestamp with time zone');
SELECT col_is_null('public', 'reconciliation_user', 'identity_verification_code_expires_at', 'reconciliation_user.identity_verification_code_expires_at is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_user'::regclass AND a.attname = 'identity_verification_code_expires_at'),
  NULL,
  'reconciliation_user.identity_verification_code_expires_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_user'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_user_email_key => UNIQUE (email)
reconciliation_user_id_key => UNIQUE (id)
reconciliation_user_identity_verification_status_check => CHECK ((identity_verification_status = ANY (ARRAY['pending'::text, 'verified'::text])))
reconciliation_user_role_check => CHECK ((role = ANY (ARRAY['financial-analyst'::text, 'senior-analyst'::text, 'staff-accountant'::text, 'controller'::text, 'vp-finance'::text, 'cfo'::text, 'admin'::text, 'superuser'::text])))$chk$,
  'reconciliation_user check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_user'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_user' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_user grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_user'),
  $policy$$policy$,
  'reconciliation_user row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_user', ARRAY['trg_reconciliation_user_password_changed']::name[], 'reconciliation_user has exactly the expected triggers');
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_reconciliation_user_password_changed' AND tgrelid = 'public.reconciliation_user'::regclass),
  $trig$CREATE TRIGGER trg_reconciliation_user_password_changed BEFORE UPDATE ON public.reconciliation_user FOR EACH ROW EXECUTE FUNCTION set_reconciliation_user_last_changed()$trig$,
  'reconciliation_user.trg_reconciliation_user_password_changed definition'
);
SELECT columns_are('public', 'reconciliation_validation_result', ARRAY['id', 'staged_transaction_id', 'source_file_id', 'rule_version_id', 'severity', 'passed', 'message', 'created_at', 'organization_id']::name[], 'reconciliation_validation_result has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_validation_result', ARRAY['id']::name[], 'reconciliation_validation_result primary key');
SELECT indexes_are('public', 'reconciliation_validation_result', ARRAY['reconciliation_validation_result_organization_idx', 'reconciliation_validation_result_pkey', 'reconciliation_validation_result_severity_idx', 'reconciliation_validation_result_source_file_idx', 'reconciliation_validation_result_staged_transaction_idx']::name[], 'reconciliation_validation_result has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'reconciliation_validation_result' AND relnamespace = 'public'::regnamespace),
  true,
  'reconciliation_validation_result has row-level security enabled'
);
SELECT col_type_is('public', 'reconciliation_validation_result', 'id', 'uuid', 'reconciliation_validation_result.id is uuid');
SELECT col_not_null('public', 'reconciliation_validation_result', 'id', 'reconciliation_validation_result.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_result'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_validation_result.id default'
);
SELECT col_type_is('public', 'reconciliation_validation_result', 'staged_transaction_id', 'uuid', 'reconciliation_validation_result.staged_transaction_id is uuid');
SELECT col_is_null('public', 'reconciliation_validation_result', 'staged_transaction_id', 'reconciliation_validation_result.staged_transaction_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_result'::regclass AND a.attname = 'staged_transaction_id'),
  NULL,
  'reconciliation_validation_result.staged_transaction_id default'
);
SELECT col_type_is('public', 'reconciliation_validation_result', 'source_file_id', 'uuid', 'reconciliation_validation_result.source_file_id is uuid');
SELECT col_is_null('public', 'reconciliation_validation_result', 'source_file_id', 'reconciliation_validation_result.source_file_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_result'::regclass AND a.attname = 'source_file_id'),
  NULL,
  'reconciliation_validation_result.source_file_id default'
);
SELECT col_type_is('public', 'reconciliation_validation_result', 'rule_version_id', 'uuid', 'reconciliation_validation_result.rule_version_id is uuid');
SELECT col_not_null('public', 'reconciliation_validation_result', 'rule_version_id', 'reconciliation_validation_result.rule_version_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_result'::regclass AND a.attname = 'rule_version_id'),
  NULL,
  'reconciliation_validation_result.rule_version_id default'
);
SELECT col_type_is('public', 'reconciliation_validation_result', 'severity', 'text', 'reconciliation_validation_result.severity is text');
SELECT col_not_null('public', 'reconciliation_validation_result', 'severity', 'reconciliation_validation_result.severity is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_result'::regclass AND a.attname = 'severity'),
  NULL,
  'reconciliation_validation_result.severity default'
);
SELECT col_type_is('public', 'reconciliation_validation_result', 'passed', 'boolean', 'reconciliation_validation_result.passed is boolean');
SELECT col_not_null('public', 'reconciliation_validation_result', 'passed', 'reconciliation_validation_result.passed is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_result'::regclass AND a.attname = 'passed'),
  NULL,
  'reconciliation_validation_result.passed default'
);
SELECT col_type_is('public', 'reconciliation_validation_result', 'message', 'text', 'reconciliation_validation_result.message is text');
SELECT col_not_null('public', 'reconciliation_validation_result', 'message', 'reconciliation_validation_result.message is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_result'::regclass AND a.attname = 'message'),
  NULL,
  'reconciliation_validation_result.message default'
);
SELECT col_type_is('public', 'reconciliation_validation_result', 'created_at', 'timestamp with time zone', 'reconciliation_validation_result.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_validation_result', 'created_at', 'reconciliation_validation_result.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_result'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_validation_result.created_at default'
);
SELECT col_type_is('public', 'reconciliation_validation_result', 'organization_id', 'uuid', 'reconciliation_validation_result.organization_id is uuid');
SELECT col_not_null('public', 'reconciliation_validation_result', 'organization_id', 'reconciliation_validation_result.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_result'::regclass AND a.attname = 'organization_id'),
  NULL,
  'reconciliation_validation_result.organization_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_validation_result'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_validation_result_severity_check => CHECK ((severity = ANY (ARRAY['FATAL'::text, 'WARNING'::text, 'INFO'::text])))
reconciliation_validation_result_target_check => CHECK (((staged_transaction_id IS NOT NULL) OR (source_file_id IS NOT NULL)))$chk$,
  'reconciliation_validation_result check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_validation_result'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_validation_result' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_validation_result grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_validation_result'),
  $policy$reconciliation_validation_result_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'reconciliation_validation_result row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_validation_result', ARRAY[]::name[], 'reconciliation_validation_result has exactly the expected triggers');
SELECT columns_are('public', 'reconciliation_validation_rule_version', ARRAY['id', 'rule_code', 'version_number', 'scope', 'severity', 'description', 'status', 'created_at', 'source_type']::name[], 'reconciliation_validation_rule_version has exactly the expected columns');
SELECT col_is_pk('public', 'reconciliation_validation_rule_version', ARRAY['id']::name[], 'reconciliation_validation_rule_version primary key');
SELECT indexes_are('public', 'reconciliation_validation_rule_version', ARRAY['reconciliation_validation_rule_version_key', 'reconciliation_validation_rule_version_pkey']::name[], 'reconciliation_validation_rule_version has exactly the expected indexes');
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'id', 'uuid', 'reconciliation_validation_rule_version.id is uuid');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'id', 'reconciliation_validation_rule_version.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_rule_version'::regclass AND a.attname = 'id'),
  NULL,
  'reconciliation_validation_rule_version.id default'
);
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'rule_code', 'text', 'reconciliation_validation_rule_version.rule_code is text');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'rule_code', 'reconciliation_validation_rule_version.rule_code is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_rule_version'::regclass AND a.attname = 'rule_code'),
  NULL,
  'reconciliation_validation_rule_version.rule_code default'
);
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'version_number', 'integer', 'reconciliation_validation_rule_version.version_number is integer');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'version_number', 'reconciliation_validation_rule_version.version_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_rule_version'::regclass AND a.attname = 'version_number'),
  NULL,
  'reconciliation_validation_rule_version.version_number default'
);
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'scope', 'text', 'reconciliation_validation_rule_version.scope is text');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'scope', 'reconciliation_validation_rule_version.scope is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_rule_version'::regclass AND a.attname = 'scope'),
  NULL,
  'reconciliation_validation_rule_version.scope default'
);
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'severity', 'text', 'reconciliation_validation_rule_version.severity is text');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'severity', 'reconciliation_validation_rule_version.severity is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_rule_version'::regclass AND a.attname = 'severity'),
  NULL,
  'reconciliation_validation_rule_version.severity default'
);
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'description', 'text', 'reconciliation_validation_rule_version.description is text');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'description', 'reconciliation_validation_rule_version.description is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_rule_version'::regclass AND a.attname = 'description'),
  NULL,
  'reconciliation_validation_rule_version.description default'
);
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'status', 'text', 'reconciliation_validation_rule_version.status is text');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'status', 'reconciliation_validation_rule_version.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_rule_version'::regclass AND a.attname = 'status'),
  $dflt$'ACTIVE'::text$dflt$,
  'reconciliation_validation_rule_version.status default'
);
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'created_at', 'timestamp with time zone', 'reconciliation_validation_rule_version.created_at is timestamp with time zone');
SELECT col_not_null('public', 'reconciliation_validation_rule_version', 'created_at', 'reconciliation_validation_rule_version.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_rule_version'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'reconciliation_validation_rule_version.created_at default'
);
SELECT col_type_is('public', 'reconciliation_validation_rule_version', 'source_type', 'text', 'reconciliation_validation_rule_version.source_type is text');
SELECT col_is_null('public', 'reconciliation_validation_rule_version', 'source_type', 'reconciliation_validation_rule_version.source_type is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.reconciliation_validation_rule_version'::regclass AND a.attname = 'source_type'),
  NULL,
  'reconciliation_validation_rule_version.source_type default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.reconciliation_validation_rule_version'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$reconciliation_validation_rule_version_key => UNIQUE (rule_code, version_number)
reconciliation_validation_rule_version_scope_check => CHECK ((scope = ANY (ARRAY['FILE'::text, 'SCHEMA'::text, 'ROW'::text, 'CROSS_ROW'::text, 'PERIOD'::text, 'ACCOUNTING'::text])))
reconciliation_validation_rule_version_severity_check => CHECK ((severity = ANY (ARRAY['FATAL'::text, 'WARNING'::text, 'INFO'::text])))
reconciliation_validation_rule_version_source_type_check => CHECK (((source_type IS NULL) OR (source_type = ANY (ARRAY['BANK'::text, 'GL'::text, 'BILLING'::text]))))
reconciliation_validation_rule_version_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))
reconciliation_validation_rule_version_version_number_check => CHECK ((version_number > 0))$chk$,
  'reconciliation_validation_rule_version check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reconciliation_validation_rule_version'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'reconciliation_validation_rule_version' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'reconciliation_validation_rule_version grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reconciliation_validation_rule_version'),
  $policy$$policy$,
  'reconciliation_validation_rule_version row-level security policies'
);
SELECT triggers_are('public', 'reconciliation_validation_rule_version', ARRAY[]::name[], 'reconciliation_validation_rule_version has exactly the expected triggers');
SELECT columns_are('public', 'run_source_file', ARRAY['id', 'organization_id', 'reconciliation_run_id', 'import_file_id', 'role', 'created_at']::name[], 'run_source_file has exactly the expected columns');
SELECT col_is_pk('public', 'run_source_file', ARRAY['id']::name[], 'run_source_file primary key');
SELECT indexes_are('public', 'run_source_file', ARRAY['run_source_file_import_file_idx', 'run_source_file_organization_idx', 'run_source_file_pkey', 'run_source_file_reconciliation_run_idx', 'run_source_file_run_import_file_key']::name[], 'run_source_file has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'run_source_file' AND relnamespace = 'public'::regnamespace),
  true,
  'run_source_file has row-level security enabled'
);
SELECT col_type_is('public', 'run_source_file', 'id', 'uuid', 'run_source_file.id is uuid');
SELECT col_not_null('public', 'run_source_file', 'id', 'run_source_file.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.run_source_file'::regclass AND a.attname = 'id'),
  NULL,
  'run_source_file.id default'
);
SELECT col_type_is('public', 'run_source_file', 'organization_id', 'uuid', 'run_source_file.organization_id is uuid');
SELECT col_not_null('public', 'run_source_file', 'organization_id', 'run_source_file.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.run_source_file'::regclass AND a.attname = 'organization_id'),
  NULL,
  'run_source_file.organization_id default'
);
SELECT col_type_is('public', 'run_source_file', 'reconciliation_run_id', 'uuid', 'run_source_file.reconciliation_run_id is uuid');
SELECT col_not_null('public', 'run_source_file', 'reconciliation_run_id', 'run_source_file.reconciliation_run_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.run_source_file'::regclass AND a.attname = 'reconciliation_run_id'),
  NULL,
  'run_source_file.reconciliation_run_id default'
);
SELECT col_type_is('public', 'run_source_file', 'import_file_id', 'uuid', 'run_source_file.import_file_id is uuid');
SELECT col_not_null('public', 'run_source_file', 'import_file_id', 'run_source_file.import_file_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.run_source_file'::regclass AND a.attname = 'import_file_id'),
  NULL,
  'run_source_file.import_file_id default'
);
SELECT col_type_is('public', 'run_source_file', 'role', 'text', 'run_source_file.role is text');
SELECT col_not_null('public', 'run_source_file', 'role', 'run_source_file.role is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.run_source_file'::regclass AND a.attname = 'role'),
  NULL,
  'run_source_file.role default'
);
SELECT col_type_is('public', 'run_source_file', 'created_at', 'timestamp with time zone', 'run_source_file.created_at is timestamp with time zone');
SELECT col_not_null('public', 'run_source_file', 'created_at', 'run_source_file.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.run_source_file'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'run_source_file.created_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.run_source_file'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$run_source_file_run_import_file_key => UNIQUE (reconciliation_run_id, import_file_id)$chk$,
  'run_source_file check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'run_source_file'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'run_source_file' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'run_source_file grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'run_source_file'),
  $policy$run_source_file_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'run_source_file row-level security policies'
);
SELECT triggers_are('public', 'run_source_file', ARRAY[]::name[], 'run_source_file has exactly the expected triggers');
SELECT columns_are('public', 'validation_issue', ARRAY['id', 'organization_id', 'import_job_id', 'import_file_id', 'severity', 'code', 'row_number', 'entry_id', 'field', 'message', 'created_at', 'rule_version_id']::name[], 'validation_issue has exactly the expected columns');
SELECT col_is_pk('public', 'validation_issue', ARRAY['id']::name[], 'validation_issue primary key');
SELECT indexes_are('public', 'validation_issue', ARRAY['validation_issue_import_file_idx', 'validation_issue_import_job_idx', 'validation_issue_organization_idx', 'validation_issue_pkey', 'validation_issue_rule_version_idx']::name[], 'validation_issue has exactly the expected indexes');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'validation_issue' AND relnamespace = 'public'::regnamespace),
  true,
  'validation_issue has row-level security enabled'
);
SELECT col_type_is('public', 'validation_issue', 'id', 'bigint', 'validation_issue.id is bigint');
SELECT col_not_null('public', 'validation_issue', 'id', 'validation_issue.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'id'),
  $dflt$nextval('validation_issue_id_seq'::regclass)$dflt$,
  'validation_issue.id default'
);
SELECT col_type_is('public', 'validation_issue', 'organization_id', 'uuid', 'validation_issue.organization_id is uuid');
SELECT col_not_null('public', 'validation_issue', 'organization_id', 'validation_issue.organization_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'organization_id'),
  NULL,
  'validation_issue.organization_id default'
);
SELECT col_type_is('public', 'validation_issue', 'import_job_id', 'uuid', 'validation_issue.import_job_id is uuid');
SELECT col_not_null('public', 'validation_issue', 'import_job_id', 'validation_issue.import_job_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'import_job_id'),
  NULL,
  'validation_issue.import_job_id default'
);
SELECT col_type_is('public', 'validation_issue', 'import_file_id', 'uuid', 'validation_issue.import_file_id is uuid');
SELECT col_not_null('public', 'validation_issue', 'import_file_id', 'validation_issue.import_file_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'import_file_id'),
  NULL,
  'validation_issue.import_file_id default'
);
SELECT col_type_is('public', 'validation_issue', 'severity', 'text', 'validation_issue.severity is text');
SELECT col_not_null('public', 'validation_issue', 'severity', 'validation_issue.severity is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'severity'),
  NULL,
  'validation_issue.severity default'
);
SELECT col_type_is('public', 'validation_issue', 'code', 'text', 'validation_issue.code is text');
SELECT col_not_null('public', 'validation_issue', 'code', 'validation_issue.code is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'code'),
  NULL,
  'validation_issue.code default'
);
SELECT col_type_is('public', 'validation_issue', 'row_number', 'integer', 'validation_issue.row_number is integer');
SELECT col_is_null('public', 'validation_issue', 'row_number', 'validation_issue.row_number is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'row_number'),
  NULL,
  'validation_issue.row_number default'
);
SELECT col_type_is('public', 'validation_issue', 'entry_id', 'text', 'validation_issue.entry_id is text');
SELECT col_is_null('public', 'validation_issue', 'entry_id', 'validation_issue.entry_id is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'entry_id'),
  NULL,
  'validation_issue.entry_id default'
);
SELECT col_type_is('public', 'validation_issue', 'field', 'text', 'validation_issue.field is text');
SELECT col_is_null('public', 'validation_issue', 'field', 'validation_issue.field is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'field'),
  NULL,
  'validation_issue.field default'
);
SELECT col_type_is('public', 'validation_issue', 'message', 'text', 'validation_issue.message is text');
SELECT col_not_null('public', 'validation_issue', 'message', 'validation_issue.message is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'message'),
  NULL,
  'validation_issue.message default'
);
SELECT col_type_is('public', 'validation_issue', 'created_at', 'timestamp with time zone', 'validation_issue.created_at is timestamp with time zone');
SELECT col_not_null('public', 'validation_issue', 'created_at', 'validation_issue.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'validation_issue.created_at default'
);
SELECT col_type_is('public', 'validation_issue', 'rule_version_id', 'uuid', 'validation_issue.rule_version_id is uuid');
SELECT col_not_null('public', 'validation_issue', 'rule_version_id', 'validation_issue.rule_version_id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_issue'::regclass AND a.attname = 'rule_version_id'),
  NULL,
  'validation_issue.rule_version_id default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.validation_issue'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$validation_issue_severity_check => CHECK ((severity = ANY (ARRAY['ERROR'::text, 'WARNING'::text])))$chk$,
  'validation_issue check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'validation_issue'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'validation_issue' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'validation_issue grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'validation_issue'),
  $policy$validation_issue_tenant_isolation => cmd=ALL roles=public using=(organization_id = (current_setting('app.current_organization_id'::text, true))::uuid) check=$policy$,
  'validation_issue row-level security policies'
);
SELECT triggers_are('public', 'validation_issue', ARRAY[]::name[], 'validation_issue has exactly the expected triggers');
SELECT columns_are('public', 'validation_rule_version', ARRAY['id', 'rule_code', 'version_number', 'scope', 'source_type', 'severity', 'description', 'status', 'created_at']::name[], 'validation_rule_version has exactly the expected columns');
SELECT col_is_pk('public', 'validation_rule_version', ARRAY['id']::name[], 'validation_rule_version primary key');
SELECT indexes_are('public', 'validation_rule_version', ARRAY['validation_rule_version_code_version_key', 'validation_rule_version_pkey']::name[], 'validation_rule_version has exactly the expected indexes');
SELECT col_type_is('public', 'validation_rule_version', 'id', 'uuid', 'validation_rule_version.id is uuid');
SELECT col_not_null('public', 'validation_rule_version', 'id', 'validation_rule_version.id is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_rule_version'::regclass AND a.attname = 'id'),
  NULL,
  'validation_rule_version.id default'
);
SELECT col_type_is('public', 'validation_rule_version', 'rule_code', 'text', 'validation_rule_version.rule_code is text');
SELECT col_not_null('public', 'validation_rule_version', 'rule_code', 'validation_rule_version.rule_code is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_rule_version'::regclass AND a.attname = 'rule_code'),
  NULL,
  'validation_rule_version.rule_code default'
);
SELECT col_type_is('public', 'validation_rule_version', 'version_number', 'integer', 'validation_rule_version.version_number is integer');
SELECT col_not_null('public', 'validation_rule_version', 'version_number', 'validation_rule_version.version_number is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_rule_version'::regclass AND a.attname = 'version_number'),
  NULL,
  'validation_rule_version.version_number default'
);
SELECT col_type_is('public', 'validation_rule_version', 'scope', 'text', 'validation_rule_version.scope is text');
SELECT col_not_null('public', 'validation_rule_version', 'scope', 'validation_rule_version.scope is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_rule_version'::regclass AND a.attname = 'scope'),
  NULL,
  'validation_rule_version.scope default'
);
SELECT col_type_is('public', 'validation_rule_version', 'source_type', 'text', 'validation_rule_version.source_type is text');
SELECT col_is_null('public', 'validation_rule_version', 'source_type', 'validation_rule_version.source_type is nullable');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_rule_version'::regclass AND a.attname = 'source_type'),
  NULL,
  'validation_rule_version.source_type default'
);
SELECT col_type_is('public', 'validation_rule_version', 'severity', 'text', 'validation_rule_version.severity is text');
SELECT col_not_null('public', 'validation_rule_version', 'severity', 'validation_rule_version.severity is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_rule_version'::regclass AND a.attname = 'severity'),
  NULL,
  'validation_rule_version.severity default'
);
SELECT col_type_is('public', 'validation_rule_version', 'description', 'text', 'validation_rule_version.description is text');
SELECT col_not_null('public', 'validation_rule_version', 'description', 'validation_rule_version.description is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_rule_version'::regclass AND a.attname = 'description'),
  NULL,
  'validation_rule_version.description default'
);
SELECT col_type_is('public', 'validation_rule_version', 'status', 'text', 'validation_rule_version.status is text');
SELECT col_not_null('public', 'validation_rule_version', 'status', 'validation_rule_version.status is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_rule_version'::regclass AND a.attname = 'status'),
  $dflt$'ACTIVE'::text$dflt$,
  'validation_rule_version.status default'
);
SELECT col_type_is('public', 'validation_rule_version', 'created_at', 'timestamp with time zone', 'validation_rule_version.created_at is timestamp with time zone');
SELECT col_not_null('public', 'validation_rule_version', 'created_at', 'validation_rule_version.created_at is NOT NULL');
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.validation_rule_version'::regclass AND a.attname = 'created_at'),
  $dflt$now()$dflt$,
  'validation_rule_version.created_at default'
);
SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.validation_rule_version'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$validation_rule_version_code_version_key => UNIQUE (rule_code, version_number)
validation_rule_version_scope_check => CHECK ((scope = ANY (ARRAY['SCHEMA'::text, 'FILE'::text, 'ROW'::text, 'CROSS_ROW'::text])))
validation_rule_version_severity_check => CHECK ((severity = ANY (ARRAY['ERROR'::text, 'WARNING'::text])))
validation_rule_version_source_type_check => CHECK (((source_type IS NULL) OR (source_type = ANY (ARRAY['BANK'::text, 'GL'::text, 'BILLING'::text]))))
validation_rule_version_status_check => CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))
validation_rule_version_version_number_check => CHECK ((version_number > 0))$chk$,
  'validation_rule_version check/unique/exclusion constraints'
);
SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'validation_rule_version'
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = 'validation_rule_version' AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$app_user => DELETE,INSERT,SELECT,UPDATE
recon_app_runtime => DELETE,INSERT,SELECT,UPDATE$grants$,
  'validation_rule_version grants'
);
SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'validation_rule_version'),
  $policy$$policy$,
  'validation_rule_version row-level security policies'
);
SELECT triggers_are('public', 'validation_rule_version', ARRAY[]::name[], 'validation_rule_version has exactly the expected triggers');
SELECT fk_ok('public', 'canonical_record', ARRAY['import_file_id']::name[], 'public', 'import_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'canonical_record', ARRAY['import_job_id']::name[], 'public', 'import_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'canonical_record', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'canonical_record', ARRAY['reconciliation_run_id']::name[], 'public', 'reconciliation_run', ARRAY['id']::name[]);
SELECT fk_ok('public', 'dashboard_secret_finding_snapshot', ARRAY['scan_run_id']::name[], 'public', 'dashboard_secret_scan_run', ARRAY['id']::name[]);
SELECT fk_ok('public', 'import_file', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'import_file_content', ARRAY['import_file_id']::name[], 'public', 'import_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'import_file_content', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'import_job', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'import_job', ARRAY['reconciliation_run_id']::name[], 'public', 'reconciliation_run', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_account', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_approval_history', ARRAY['actor']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_approval_history', ARRAY['approval_id']::name[], 'public', 'reconciliation_import_approval', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_approval_history', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_approval_request', ARRAY['decided_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_approval_request', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_approval_request', ARRAY['submitted_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_approval_request_history', ARRAY['actor']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_approval_request_history', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_approval_request_history', ARRAY['approval_request_id']::name[], 'public', 'reconciliation_approval_request', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_audit_event', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_audit_event', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_canonical_row', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_canonical_row', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_canonical_row', ARRAY['raw_row_id']::name[], 'public', 'reconciliation_raw_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_canonical_row', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_canonical_row', ARRAY['staged_transaction_id']::name[], 'public', 'reconciliation_staged_transaction', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_exception', ARRAY['canonical_row_id']::name[], 'public', 'reconciliation_canonical_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_exception', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_exception', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_export', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_export', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_import_approval', ARRAY['approved_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_import_approval', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_import_approval', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_import_approval', ARRAY['uploaded_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_import_batch', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_import_batch', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_import_batch', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_job', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_job_summary', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_job_summary', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_login_event', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_mapping_profile', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_mapping_profile_version', ARRAY['created_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_mapping_profile_version', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_mapping_profile_version', ARRAY['profile_id']::name[], 'public', 'reconciliation_mapping_profile', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_group', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_group', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_result', ARRAY['bank_transaction_id']::name[], 'public', 'reconciliation_canonical_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_result', ARRAY['gl_transaction_id']::name[], 'public', 'reconciliation_canonical_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_result', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_result', ARRAY['matching_config_version_id']::name[], 'public', 'reconciliation_matching_config_version', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_match_result', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_matching_config_version', ARRAY['created_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_matching_config_version', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_matching_config_version', ARRAY['pending_approval_owner']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_matching_config_version', ARRAY['published_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item', ARRAY['account_id']::name[], 'public', 'reconciliation_account', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item', ARRAY['cleared_in_run_id']::name[], 'public', 'reconciliation_run', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item', ARRAY['cleared_match_result_id']::name[], 'public', 'reconciliation_match_result', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item', ARRAY['first_detected_job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item', ARRAY['opened_in_run_id']::name[], 'public', 'reconciliation_run', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item', ARRAY['owner_user_id']::name[], 'public', 'reconciliation_user', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item', ARRAY['superseded_by_open_item_id']::name[], 'public', 'reconciliation_open_item', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item_event', ARRAY['open_item_id']::name[], 'public', 'reconciliation_open_item', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item_event', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_open_item_event', ARRAY['run_id']::name[], 'public', 'reconciliation_run', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_payee_alias', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_period_rollforward', ARRAY['account_id']::name[], 'public', 'reconciliation_account', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_period_rollforward', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_period_rollforward', ARRAY['reconciliation_run_id']::name[], 'public', 'reconciliation_run', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_raw_row', ARRAY['import_batch_id']::name[], 'public', 'reconciliation_import_batch', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_raw_row', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_raw_row', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_raw_row', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_review_decision', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_review_decision', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_review_observation', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_review_observation', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_rule_result', ARRAY['candidate_transaction_id']::name[], 'public', 'reconciliation_canonical_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_rule_result', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_rule_result', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run', ARRAY['closed_by']::name[], 'public', 'reconciliation_user', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run', ARRAY['decided_by']::name[], 'public', 'reconciliation_user', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run', ARRAY['matching_job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run', ARRAY['skip_invalid_rows_by']::name[], 'public', 'reconciliation_user', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run', ARRAY['submitted_by']::name[], 'public', 'reconciliation_user', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run_account', ARRAY['account_id']::name[], 'public', 'reconciliation_account', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run_account', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run_account', ARRAY['reconciliation_run_id']::name[], 'public', 'reconciliation_run', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run_event', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_run_event', ARRAY['run_id']::name[], 'public', 'reconciliation_run', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_source_file', ARRAY['job_id']::name[], 'public', 'reconciliation_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_source_file', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_source_file', ARRAY['uploaded_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_source_file_content', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_source_file_content', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_staged_transaction', ARRAY['mapping_profile_version_id']::name[], 'public', 'reconciliation_mapping_profile_version', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_staged_transaction', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_staged_transaction', ARRAY['promoted_by']::name[], 'public', 'reconciliation_user', ARRAY['user_name']::name[]);
SELECT fk_ok('public', 'reconciliation_staged_transaction', ARRAY['raw_row_id']::name[], 'public', 'reconciliation_raw_row', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_staged_transaction', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_user', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_validation_result', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_validation_result', ARRAY['rule_version_id']::name[], 'public', 'reconciliation_validation_rule_version', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_validation_result', ARRAY['source_file_id']::name[], 'public', 'reconciliation_source_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'reconciliation_validation_result', ARRAY['staged_transaction_id']::name[], 'public', 'reconciliation_staged_transaction', ARRAY['id']::name[]);
SELECT fk_ok('public', 'run_source_file', ARRAY['import_file_id']::name[], 'public', 'import_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'run_source_file', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'run_source_file', ARRAY['reconciliation_run_id']::name[], 'public', 'reconciliation_run', ARRAY['id']::name[]);
SELECT fk_ok('public', 'validation_issue', ARRAY['import_file_id']::name[], 'public', 'import_file', ARRAY['id']::name[]);
SELECT fk_ok('public', 'validation_issue', ARRAY['import_job_id']::name[], 'public', 'import_job', ARRAY['id']::name[]);
SELECT fk_ok('public', 'validation_issue', ARRAY['organization_id']::name[], 'public', 'reconciliation_organization', ARRAY['id']::name[]);
SELECT fk_ok('public', 'validation_issue', ARRAY['rule_version_id']::name[], 'public', 'validation_rule_version', ARRAY['id']::name[]);
SELECT is(
  (SELECT COALESCE(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') RETURNS ' || pg_get_function_result(p.oid) || ' LANGUAGE ' || l.lanname, E'\n' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), '')
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.objid = p.oid AND dep.deptype = 'e')),
  $funcs$reconciliation_run_timeline(p_organization_id uuid, p_run_id uuid) RETURNS TABLE(stage text, occurred_at timestamp with time zone, event_type text, status text, actor text, message text, details jsonb) LANGUAGE sql
set_reconciliation_user_last_changed() RETURNS trigger LANGUAGE plpgsql
set_updated_at() RETURNS trigger LANGUAGE plpgsql
sync_reconciliation_run_account_terminal_good() RETURNS trigger LANGUAGE plpgsql$funcs$,
  'public schema contains exactly the expected functions'
);
SELECT views_are('public', ARRAY['reconciliation_canonical_lineage', 'reconciliation_source_file_recovery']::name[], 'public schema contains exactly the expected views');
SELECT is(
  (SELECT pg_get_viewdef('public.reconciliation_canonical_lineage'::regclass)),
  $view$ SELECT canonical.id AS canonical_row_id,
    canonical.job_id,
    canonical.source_system,
    canonical.line_number,
    canonical.transaction_date,
    canonical.amount,
    canonical.raw_row_id,
    canonical.source_file_id,
    source_file.file_name,
    source_file.ingestion_mode,
    staged.id AS staged_transaction_id,
    staged.status AS staged_status,
    staged.promoted_at,
    staged.promoted_by,
    mapping_version.id AS mapping_profile_version_id,
    mapping_version.version_number AS mapping_profile_version_number,
    mapping_profile.name AS mapping_profile_name,
    approval.id AS import_approval_id,
    approval.status AS import_approval_status,
    approval.approved_by,
    approval.decided_at AS import_approved_at,
    (content.source_file_id IS NOT NULL) AS original_bytes_preserved
   FROM ((((((reconciliation_canonical_row canonical
     LEFT JOIN reconciliation_source_file source_file ON ((source_file.id = canonical.source_file_id)))
     LEFT JOIN reconciliation_staged_transaction staged ON ((staged.id = canonical.staged_transaction_id)))
     LEFT JOIN reconciliation_mapping_profile_version mapping_version ON ((mapping_version.id = staged.mapping_profile_version_id)))
     LEFT JOIN reconciliation_mapping_profile mapping_profile ON ((mapping_profile.id = mapping_version.profile_id)))
     LEFT JOIN reconciliation_import_approval approval ON ((approval.source_file_id = canonical.source_file_id)))
     LEFT JOIN reconciliation_source_file_content content ON ((content.source_file_id = canonical.source_file_id)));$view$,
  'reconciliation_canonical_lineage definition'
);
SELECT is(
  (SELECT pg_get_viewdef('public.reconciliation_source_file_recovery'::regclass)),
  $view$ SELECT source_file.id AS source_file_id,
    source_file.job_id,
    source_file.organization_id,
    source_file.source_system,
    source_file.source_format,
    source_file.file_name,
    source_file.ingestion_mode,
    source_file.approval_status,
    source_file.uploaded_by,
    source_file.uploaded_at,
    content.original_file_name,
    content.original_mime_type,
    source_file.sha256 AS registered_sha256,
    content.sha256 AS preserved_sha256,
    source_file.size_bytes AS registered_byte_size,
    content.byte_size AS preserved_byte_size,
    (content.source_file_id IS NOT NULL) AS content_preserved,
        CASE
            WHEN (content.source_file_id IS NULL) THEN 'MISSING'::text
            WHEN (content.sha256 IS DISTINCT FROM source_file.sha256) THEN 'HASH_MISMATCH'::text
            WHEN (content.byte_size IS DISTINCT FROM source_file.size_bytes) THEN 'SIZE_MISMATCH'::text
            ELSE 'VERIFIED'::text
        END AS recovery_status,
    content.captured_at,
    content.retention_expires_at
   FROM (reconciliation_source_file source_file
     LEFT JOIN reconciliation_source_file_content content ON ((content.source_file_id = source_file.id)));$view$,
  'reconciliation_source_file_recovery definition'
);

SELECT * FROM finish();
