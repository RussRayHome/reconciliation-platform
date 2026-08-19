--liquibase formatted sql

--changeset recon:0050-repoint_file_validation_rules_to_template_schema splitStatements:false
-- Issue #137: the File Validation Engine validated against an invented snake_case schema
-- (transaction_id/account_id/entry_id/line_number/etc.) that shared zero header overlap with the
-- app's actual downloadable Bank/GL templates -- every uploaded file that followed the app's own
-- template failed validation immediately. packages/core/src/fileValidation/ruleCatalog.ts's
-- FILE_VALIDATION_RULES now validates the real template headers instead (docs/transaction-csv-
-- spec.md). This changeset brings validation_rule_version (changeset 0047) in line with that new
-- catalog -- append-only per this table's own precedent: old rows are marked DEPRECATED, never
-- deleted or edited in place, so historical validation_issue.rule_version_id references stay
-- resolvable.
--
-- All 4 STRUCT_* codes are format-agnostic and unchanged by this issue -- no action needed for
-- them. Of the 20 old BANK_* rows, 17 are retired outright (transaction_id/account_id/currency_
-- code/transaction_type no longer exist as columns) and 3 survive under the same rule_code with a
-- redefined check, promoted to version_number 2: BANK_DESCRIPTION_REQUIRED, BANK_BALANCE_FORMAT,
-- BANK_BALANCE_CONTINUITY. Of the 21 old GL_* rows, 17 are retired outright (entry_id/line_number/
-- split debit_amount+credit_amount/currency_code no longer exist -- GL is now a flat, already-
-- signed register, not a double-entry journal) and 4 survive at version_number 2: GL_TXN_DATE_
-- REQUIRED, GL_TXN_DATE_FORMAT, GL_TXN_DATE_FUTURE, GL_DESCRIPTION_REQUIRED. 13 brand-new codes are
-- added at version_number 1: BANK_DATE_REQUIRED/FORMAT/FUTURE, BANK_SEQUENCE_REQUIRED/DUPLICATE
-- (the new per-file transaction-identity column, which Issue #141's account-derived composite
-- prefix will layer onto without further schema change), BANK_DEBIT_FORMAT/NEGATIVE,
-- BANK_CREDIT_FORMAT/NEGATIVE, BANK_NO_AMOUNT, BANK_BOTH_AMOUNTS, GL_AMOUNT_FORMAT, GL_AMOUNT_ZERO.
--
-- Dropping GL's entry-grouping/balancing checks does not remove split-transaction detection --
-- that's an entirely separate Matching Engine capability (groupedReservations.ts:
-- LikelySplitCombineIssue, PartialPaymentMatch, LoanPaymentSplit, BankServiceChargeAmortization,
-- PayrollBatchMatch, FeeNettingMatch) that operates on flat normalized rows and never depended on a
-- journal-entry-balancing structural gate.

UPDATE validation_rule_version
SET status = 'DEPRECATED'
WHERE version_number = 1
  AND rule_code IN (
    -- retired BANK_* (17)
    'BANK_ID_REQUIRED', 'BANK_ID_DUPLICATE', 'BANK_ACCOUNT_REQUIRED',
    'BANK_POSTED_DATE_REQUIRED', 'BANK_POSTED_DATE_FORMAT', 'BANK_POSTED_DATE_FUTURE',
    'BANK_TXN_DATE_FORMAT', 'BANK_TXN_DATE_AFTER_POSTED',
    'BANK_AMOUNT_FORMAT', 'BANK_AMOUNT_ZERO',
    'BANK_CURRENCY_REQUIRED', 'BANK_CURRENCY_FORMAT',
    'BANK_TYPE_REQUIRED', 'BANK_TYPE_INVALID', 'BANK_TYPE_SIGN',
    'BANK_CHECK_NUMBER_MISSING', 'BANK_MULTI_CURRENCY',
    -- superseded BANK_* (3, replaced by version_number 2 below)
    'BANK_DESCRIPTION_REQUIRED', 'BANK_BALANCE_FORMAT', 'BANK_BALANCE_CONTINUITY',
    -- retired GL_* (17)
    'GL_ENTRY_ID_REQUIRED', 'GL_LINE_NO_REQUIRED', 'GL_LINE_NO_FORMAT',
    'GL_POSTING_DATE_FORMAT', 'GL_POSTING_BEFORE_TXN',
    'GL_ACCOUNT_REQUIRED', 'GL_CURRENCY_REQUIRED', 'GL_CURRENCY_FORMAT',
    'GL_DEBIT_FORMAT', 'GL_CREDIT_FORMAT', 'GL_DEBIT_NEGATIVE', 'GL_CREDIT_NEGATIVE',
    'GL_NO_AMOUNT', 'GL_BOTH_AMOUNTS', 'GL_MULTI_CURRENCY',
    'GL_LINE_NO_DUPLICATE', 'GL_UNBALANCED',
    -- superseded GL_* (4, replaced by version_number 2 below)
    'GL_TXN_DATE_REQUIRED', 'GL_TXN_DATE_FORMAT', 'GL_TXN_DATE_FUTURE', 'GL_DESCRIPTION_REQUIRED'
  );

INSERT INTO validation_rule_version (id, rule_code, version_number, scope, source_type, severity, description)
VALUES
  -- ── BANK, brand new (version 1) ──────────────────────────────────────────────────────────────
  (gen_random_uuid(), 'BANK_DATE_REQUIRED', 1, 'ROW', 'BANK', 'ERROR', 'Date is required.'),
  (gen_random_uuid(), 'BANK_DATE_FORMAT', 1, 'ROW', 'BANK', 'ERROR', 'Date must be YYYY-MM-DD.'),
  (gen_random_uuid(), 'BANK_DATE_FUTURE', 1, 'ROW', 'BANK', 'ERROR', 'Date is in the future.'),
  (gen_random_uuid(), 'BANK_SEQUENCE_REQUIRED', 1, 'ROW', 'BANK', 'ERROR', 'Sequence Number is required.'),
  (gen_random_uuid(), 'BANK_SEQUENCE_DUPLICATE', 1, 'ROW', 'BANK', 'ERROR', 'Sequence Number duplicates another row within the same file.'),
  (gen_random_uuid(), 'BANK_DEBIT_FORMAT', 1, 'ROW', 'BANK', 'ERROR', 'Debit must be a valid amount.'),
  (gen_random_uuid(), 'BANK_CREDIT_FORMAT', 1, 'ROW', 'BANK', 'ERROR', 'Credit must be a valid amount.'),
  (gen_random_uuid(), 'BANK_DEBIT_NEGATIVE', 1, 'ROW', 'BANK', 'ERROR', 'Debit must be non-negative.'),
  (gen_random_uuid(), 'BANK_CREDIT_NEGATIVE', 1, 'ROW', 'BANK', 'ERROR', 'Credit must be non-negative.'),
  (gen_random_uuid(), 'BANK_NO_AMOUNT', 1, 'ROW', 'BANK', 'ERROR', 'Exactly one of Debit or Credit must be greater than 0 (both were empty/zero).'),
  (gen_random_uuid(), 'BANK_BOTH_AMOUNTS', 1, 'ROW', 'BANK', 'ERROR', 'A row cannot have both Debit and Credit greater than 0.'),

  -- ── BANK, superseded (version 2) ─────────────────────────────────────────────────────────────
  (gen_random_uuid(), 'BANK_DESCRIPTION_REQUIRED', 2, 'ROW', 'BANK', 'ERROR', 'Description is required.'),
  (gen_random_uuid(), 'BANK_BALANCE_FORMAT', 2, 'ROW', 'BANK', 'ERROR', 'Balance must be a valid amount.'),
  (gen_random_uuid(), 'BANK_BALANCE_CONTINUITY', 2, 'CROSS_ROW', 'BANK', 'ERROR', 'Balance does not continue from the prior row''s balance plus this row''s amount.'),

  -- ── GL, brand new (version 1) ────────────────────────────────────────────────────────────────
  (gen_random_uuid(), 'GL_AMOUNT_FORMAT', 1, 'ROW', 'GL', 'ERROR', 'Amount is required and must be a valid signed amount.'),
  (gen_random_uuid(), 'GL_AMOUNT_ZERO', 1, 'ROW', 'GL', 'WARNING', 'Amount is zero.'),

  -- ── GL, superseded (version 2) ───────────────────────────────────────────────────────────────
  (gen_random_uuid(), 'GL_TXN_DATE_REQUIRED', 2, 'ROW', 'GL', 'ERROR', 'Date is required.'),
  (gen_random_uuid(), 'GL_TXN_DATE_FORMAT', 2, 'ROW', 'GL', 'ERROR', 'Date must be YYYY-MM-DD.'),
  (gen_random_uuid(), 'GL_TXN_DATE_FUTURE', 2, 'ROW', 'GL', 'ERROR', 'Date is in the future.'),
  (gen_random_uuid(), 'GL_DESCRIPTION_REQUIRED', 2, 'ROW', 'GL', 'ERROR', 'Memo is required.');

--rollback DELETE FROM validation_rule_version WHERE version_number = 2 AND rule_code IN ('BANK_DESCRIPTION_REQUIRED', 'BANK_BALANCE_FORMAT', 'BANK_BALANCE_CONTINUITY', 'GL_TXN_DATE_REQUIRED', 'GL_TXN_DATE_FORMAT', 'GL_TXN_DATE_FUTURE', 'GL_DESCRIPTION_REQUIRED');
--rollback DELETE FROM validation_rule_version WHERE version_number = 1 AND rule_code IN ('BANK_DATE_REQUIRED', 'BANK_DATE_FORMAT', 'BANK_DATE_FUTURE', 'BANK_SEQUENCE_REQUIRED', 'BANK_SEQUENCE_DUPLICATE', 'BANK_DEBIT_FORMAT', 'BANK_CREDIT_FORMAT', 'BANK_DEBIT_NEGATIVE', 'BANK_CREDIT_NEGATIVE', 'BANK_NO_AMOUNT', 'BANK_BOTH_AMOUNTS', 'GL_AMOUNT_FORMAT', 'GL_AMOUNT_ZERO');
--rollback UPDATE validation_rule_version SET status = 'ACTIVE' WHERE version_number = 1 AND rule_code IN ('BANK_ID_REQUIRED', 'BANK_ID_DUPLICATE', 'BANK_ACCOUNT_REQUIRED', 'BANK_POSTED_DATE_REQUIRED', 'BANK_POSTED_DATE_FORMAT', 'BANK_POSTED_DATE_FUTURE', 'BANK_TXN_DATE_FORMAT', 'BANK_TXN_DATE_AFTER_POSTED', 'BANK_AMOUNT_FORMAT', 'BANK_AMOUNT_ZERO', 'BANK_CURRENCY_REQUIRED', 'BANK_CURRENCY_FORMAT', 'BANK_TYPE_REQUIRED', 'BANK_TYPE_INVALID', 'BANK_TYPE_SIGN', 'BANK_CHECK_NUMBER_MISSING', 'BANK_MULTI_CURRENCY', 'BANK_DESCRIPTION_REQUIRED', 'BANK_BALANCE_FORMAT', 'BANK_BALANCE_CONTINUITY', 'GL_ENTRY_ID_REQUIRED', 'GL_LINE_NO_REQUIRED', 'GL_LINE_NO_FORMAT', 'GL_POSTING_DATE_FORMAT', 'GL_POSTING_BEFORE_TXN', 'GL_ACCOUNT_REQUIRED', 'GL_CURRENCY_REQUIRED', 'GL_CURRENCY_FORMAT', 'GL_DEBIT_FORMAT', 'GL_CREDIT_FORMAT', 'GL_DEBIT_NEGATIVE', 'GL_CREDIT_NEGATIVE', 'GL_NO_AMOUNT', 'GL_BOTH_AMOUNTS', 'GL_MULTI_CURRENCY', 'GL_LINE_NO_DUPLICATE', 'GL_UNBALANCED', 'GL_TXN_DATE_REQUIRED', 'GL_TXN_DATE_FORMAT', 'GL_TXN_DATE_FUTURE', 'GL_DESCRIPTION_REQUIRED');
