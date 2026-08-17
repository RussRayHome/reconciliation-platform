--liquibase formatted sql

--changeset recon:0047-add_rule_version_lineage splitStatements:false
-- File Imports & Validation traceability review (2026-08-12): a validation_issue only carried a
-- bare rule_code TEXT, with no way to tell which version of that rule's logic produced a given
-- historical finding once the rule changes -- the same gap the *older* import path already closed
-- for itself via reconciliation_validation_rule_version + reconciliation_validation_result.rule_
-- version_id (changeset 0016). This changeset closes it for the new pipeline the same way.
--
-- ── validation_rule_version ──────────────────────────────────────────────────────────────────────
-- Global (no organization_id), matching reconciliation_validation_rule_version's own precedent --
-- these are platform rules, not tenant data. Seeded below with every STRUCT_*/BANK_*/GL_* code the
-- File Validation Engine emits today, at version_number 1. The seed values mirror
-- packages/core/src/fileValidation/ruleCatalog.ts's FILE_VALIDATION_RULES array exactly --
-- ruleCatalog.test.ts asserts that array can never drift from what structuralGates.ts/
-- rowValidators.ts actually emit, so this seed and the engine cannot silently disagree either.
--
-- validation_issue.rule_version_id is added NOT NULL directly (no nullable transitional step):
-- nothing writes to validation_issue yet (Phase 6, the async validation worker, doesn't exist),
-- so the table is guaranteed empty at this point in the migration history.
CREATE TABLE IF NOT EXISTS validation_rule_version (
  id UUID PRIMARY KEY,
  rule_code TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  -- SCHEMA/FILE/CROSS_ROW are new relative to 0016's FILE/SCHEMA/ROW/CROSS_ROW/PERIOD/ACCOUNTING
  -- enum -- this engine has no PERIOD/ACCOUNTING-scoped rules today, so those two are omitted
  -- rather than carried speculatively.
  scope TEXT NOT NULL CHECK (scope IN ('SCHEMA', 'FILE', 'ROW', 'CROSS_ROW')),
  -- NULL for STRUCT_* codes, which apply identically to both formats.
  source_type TEXT CHECK (source_type IS NULL OR source_type IN ('BANK', 'GL')),
  severity TEXT NOT NULL CHECK (severity IN ('ERROR', 'WARNING')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPRECATED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT validation_rule_version_code_version_key UNIQUE (rule_code, version_number)
);

INSERT INTO validation_rule_version (id, rule_code, version_number, scope, source_type, severity, description)
VALUES
  (gen_random_uuid(), 'STRUCT_HEADER_MISSING', 1, 'SCHEMA', NULL, 'ERROR', 'No header row was found, or the first row does not match any expected column name.'),
  (gen_random_uuid(), 'STRUCT_COLUMN_MISSING', 1, 'SCHEMA', NULL, 'ERROR', 'A required column is absent from the file.'),
  (gen_random_uuid(), 'STRUCT_COLUMN_ORDER', 1, 'SCHEMA', NULL, 'ERROR', 'A required column is present but out of order relative to the other required columns.'),
  (gen_random_uuid(), 'STRUCT_COLUMN_UNKNOWN', 1, 'SCHEMA', NULL, 'WARNING', 'An unrecognized column is present and is ignored.'),

  (gen_random_uuid(), 'BANK_ID_REQUIRED', 1, 'ROW', 'BANK', 'ERROR', 'transaction_id is required.'),
  (gen_random_uuid(), 'BANK_ID_DUPLICATE', 1, 'ROW', 'BANK', 'ERROR', 'transaction_id duplicates an earlier row in the same file.'),
  (gen_random_uuid(), 'BANK_ACCOUNT_REQUIRED', 1, 'ROW', 'BANK', 'ERROR', 'account_id is required.'),
  (gen_random_uuid(), 'BANK_POSTED_DATE_REQUIRED', 1, 'ROW', 'BANK', 'ERROR', 'posted_date is required.'),
  (gen_random_uuid(), 'BANK_POSTED_DATE_FORMAT', 1, 'ROW', 'BANK', 'ERROR', 'posted_date must be YYYY-MM-DD.'),
  (gen_random_uuid(), 'BANK_POSTED_DATE_FUTURE', 1, 'ROW', 'BANK', 'ERROR', 'posted_date is in the future.'),
  (gen_random_uuid(), 'BANK_TXN_DATE_FORMAT', 1, 'ROW', 'BANK', 'ERROR', 'transaction_date must be YYYY-MM-DD.'),
  (gen_random_uuid(), 'BANK_TXN_DATE_AFTER_POSTED', 1, 'ROW', 'BANK', 'WARNING', 'transaction_date is after posted_date.'),
  (gen_random_uuid(), 'BANK_AMOUNT_FORMAT', 1, 'ROW', 'BANK', 'ERROR', 'amount must be a plain signed decimal (no symbols/thousands separators).'),
  (gen_random_uuid(), 'BANK_AMOUNT_ZERO', 1, 'ROW', 'BANK', 'WARNING', 'amount is zero.'),
  (gen_random_uuid(), 'BANK_CURRENCY_REQUIRED', 1, 'ROW', 'BANK', 'ERROR', 'currency_code is required.'),
  (gen_random_uuid(), 'BANK_CURRENCY_FORMAT', 1, 'ROW', 'BANK', 'ERROR', 'currency_code must be a 3-letter ISO 4217 code.'),
  (gen_random_uuid(), 'BANK_TYPE_REQUIRED', 1, 'ROW', 'BANK', 'ERROR', 'transaction_type is required.'),
  (gen_random_uuid(), 'BANK_TYPE_INVALID', 1, 'ROW', 'BANK', 'ERROR', 'transaction_type is not a recognized value.'),
  (gen_random_uuid(), 'BANK_TYPE_SIGN', 1, 'ROW', 'BANK', 'ERROR', 'amount''s sign does not match the inflow/outflow convention for this transaction_type.'),
  (gen_random_uuid(), 'BANK_DESCRIPTION_REQUIRED', 1, 'ROW', 'BANK', 'ERROR', 'description is required.'),
  (gen_random_uuid(), 'BANK_CHECK_NUMBER_MISSING', 1, 'ROW', 'BANK', 'WARNING', 'check_number is recommended when transaction_type is CHECK.'),
  (gen_random_uuid(), 'BANK_BALANCE_FORMAT', 1, 'ROW', 'BANK', 'ERROR', 'running_balance must be a plain decimal.'),
  (gen_random_uuid(), 'BANK_MULTI_CURRENCY', 1, 'FILE', 'BANK', 'ERROR', 'The file mixes currencies; a single currency is expected.'),
  (gen_random_uuid(), 'BANK_BALANCE_CONTINUITY', 1, 'CROSS_ROW', 'BANK', 'ERROR', 'running_balance does not continue from the prior row''s balance plus this row''s amount.'),

  (gen_random_uuid(), 'GL_ENTRY_ID_REQUIRED', 1, 'ROW', 'GL', 'ERROR', 'entry_id is required.'),
  (gen_random_uuid(), 'GL_LINE_NO_REQUIRED', 1, 'ROW', 'GL', 'ERROR', 'line_number is required.'),
  (gen_random_uuid(), 'GL_LINE_NO_FORMAT', 1, 'ROW', 'GL', 'ERROR', 'line_number must be a positive integer.'),
  (gen_random_uuid(), 'GL_TXN_DATE_REQUIRED', 1, 'ROW', 'GL', 'ERROR', 'transaction_date is required.'),
  (gen_random_uuid(), 'GL_TXN_DATE_FORMAT', 1, 'ROW', 'GL', 'ERROR', 'transaction_date must be YYYY-MM-DD.'),
  (gen_random_uuid(), 'GL_TXN_DATE_FUTURE', 1, 'ROW', 'GL', 'ERROR', 'transaction_date is in the future.'),
  (gen_random_uuid(), 'GL_POSTING_DATE_FORMAT', 1, 'ROW', 'GL', 'ERROR', 'posting_date must be YYYY-MM-DD.'),
  (gen_random_uuid(), 'GL_POSTING_BEFORE_TXN', 1, 'ROW', 'GL', 'WARNING', 'posting_date is before transaction_date.'),
  (gen_random_uuid(), 'GL_ACCOUNT_REQUIRED', 1, 'ROW', 'GL', 'ERROR', 'account_code is required.'),
  (gen_random_uuid(), 'GL_DESCRIPTION_REQUIRED', 1, 'ROW', 'GL', 'ERROR', 'description is required.'),
  (gen_random_uuid(), 'GL_CURRENCY_REQUIRED', 1, 'ROW', 'GL', 'ERROR', 'currency_code is required.'),
  (gen_random_uuid(), 'GL_CURRENCY_FORMAT', 1, 'ROW', 'GL', 'ERROR', 'currency_code must be a 3-letter ISO 4217 code.'),
  (gen_random_uuid(), 'GL_DEBIT_FORMAT', 1, 'ROW', 'GL', 'ERROR', 'debit_amount must be a plain decimal.'),
  (gen_random_uuid(), 'GL_CREDIT_FORMAT', 1, 'ROW', 'GL', 'ERROR', 'credit_amount must be a plain decimal.'),
  (gen_random_uuid(), 'GL_DEBIT_NEGATIVE', 1, 'ROW', 'GL', 'ERROR', 'debit_amount must be non-negative.'),
  (gen_random_uuid(), 'GL_CREDIT_NEGATIVE', 1, 'ROW', 'GL', 'ERROR', 'credit_amount must be non-negative.'),
  (gen_random_uuid(), 'GL_NO_AMOUNT', 1, 'ROW', 'GL', 'ERROR', 'Exactly one of debit_amount or credit_amount must be greater than 0 (both were empty/zero).'),
  (gen_random_uuid(), 'GL_BOTH_AMOUNTS', 1, 'ROW', 'GL', 'ERROR', 'A line cannot have both debit_amount and credit_amount greater than 0.'),
  (gen_random_uuid(), 'GL_MULTI_CURRENCY', 1, 'FILE', 'GL', 'ERROR', 'The file mixes currencies; a single currency is expected.'),
  (gen_random_uuid(), 'GL_LINE_NO_DUPLICATE', 1, 'CROSS_ROW', 'GL', 'ERROR', 'line_number duplicates another line within the same entry_id.'),
  (gen_random_uuid(), 'GL_UNBALANCED', 1, 'CROSS_ROW', 'GL', 'ERROR', 'An entry''s total debits and credits do not balance within tolerance.');

ALTER TABLE validation_issue
  ADD COLUMN rule_version_id UUID NOT NULL REFERENCES validation_rule_version (id);

CREATE INDEX IF NOT EXISTS validation_issue_rule_version_idx ON validation_issue (rule_version_id);

-- ── mapping_rule_version ─────────────────────────────────────────────────────────────────────────
-- A standalone catalog for the future Stage 2 Mapping Rules engine (design-handoff v2.3,
-- implementation-spec.md's two-stage model) -- explicitly out of scope for this build ("Make the
-- map columns out of scope"). Created empty and deliberately not wired to canonical_record with an
-- FK: nothing in this build produces a canonical_record via a rule-driven mapping step (Bank/GL go
-- through a fixed, built-in translation baked directly into rowValidators.ts, not a versioned
-- rule), so a consumer column today would sit permanently NULL/unpopulated. source_type reuses
-- import_file's full 14-value taxonomy (changeset 0044) since mapping rules, unlike today's
-- validation rules, are meant to eventually cover every source type. target_field records which
-- canonical_record column a rule populates (e.g. 'counterparty_id') -- optional, since some
-- mapping rules will be file-format-wide rather than single-field.
CREATE TABLE IF NOT EXISTS mapping_rule_version (
  id UUID PRIMARY KEY,
  rule_code TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  source_type TEXT CHECK (source_type IS NULL OR source_type IN (
    'BANK', 'GL', 'PAYROLL', 'RECEIPT', 'REMITTANCE', 'BILLING', 'VMS', 'FACTOR', 'LOC',
    'TAX', 'BENEFITS', 'TIMEKEEPING', 'INTERCOMPANY', 'ASSIGNMENT', 'LEGAL_ENTITY'
  )),
  target_field TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPRECATED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mapping_rule_version_code_version_key UNIQUE (rule_code, version_number)
);

--rollback DROP TABLE IF EXISTS mapping_rule_version CASCADE;
--rollback DROP INDEX IF EXISTS validation_issue_rule_version_idx;
--rollback ALTER TABLE validation_issue DROP COLUMN IF EXISTS rule_version_id;
--rollback DROP TABLE IF EXISTS validation_rule_version CASCADE;
