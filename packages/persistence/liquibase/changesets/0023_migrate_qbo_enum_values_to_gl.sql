--liquibase formatted sql

--changeset recon:0023-migrate_qbo_enum_values_to_gl
-- Migrates stored enum *values* from the legacy "qbo" vocabulary to "gl", completing the rename
-- applied to column names in 0022. Each constraint is dropped, the data rewritten, and the
-- constraint re-added with the new vocabulary -- the drop must come first because the existing CHECK
-- would reject every updated row.
--
-- (Comment lines here must never begin with the word "changeset" or "rollback": Liquibase's
-- formatted-SQL parser matches `--\s*changeset` and would read the prose as a malformed directive.)
--
-- WHAT IS DELIBERATELY NOT MIGRATED
--
-- Uploaded file names. `reconciliation_source_file.file_name`, `..._content.original_file_name`, and
-- `reconciliation_canonical_row/exception.spreadsheet_file_name` hold values like 'qbo.xlsx'. That is
-- a factual record of the file a user actually uploaded, not a vocabulary choice. Rewriting it to
-- 'gl.xlsx' would fabricate audit history and contradict the preserved bytes. Free text that quotes
-- those names -- for example reconciliation_review_observation.message, "qbo.xlsx is missing
-- transactions for: Feb, Mar..." -- is left alone for the same reason: it stays accurate precisely
-- because the file name it cites is unchanged.
--
-- This is why the JSONB rewrites below match the quoted token '"qbo"' rather than a bare 'qbo': the
-- quote-delimited form matches a complete JSON string value and cannot match inside '"qbo.xlsx"'.

-- ── source_system / source_type / template_type: 'qbo' -> 'gl' ───────────────────────────────────
ALTER TABLE reconciliation_source_file DROP CONSTRAINT reconciliation_source_file_source_system_check;
ALTER TABLE reconciliation_raw_row DROP CONSTRAINT reconciliation_raw_row_source_system_check;
ALTER TABLE reconciliation_canonical_row DROP CONSTRAINT reconciliation_canonical_row_source_system_check;
ALTER TABLE reconciliation_exception DROP CONSTRAINT reconciliation_exception_source_system_check;
ALTER TABLE reconciliation_mapping_profile DROP CONSTRAINT reconciliation_mapping_profile_source_type_check;
ALTER TABLE reconciliation_template_definition DROP CONSTRAINT reconciliation_template_definition_template_type_check;
ALTER TABLE reconciliation_payee_alias DROP CONSTRAINT payee_alias_source_direction_check;

UPDATE reconciliation_source_file SET source_system = 'gl' WHERE source_system = 'qbo';
UPDATE reconciliation_raw_row SET source_system = 'gl' WHERE source_system = 'qbo';
UPDATE reconciliation_canonical_row SET source_system = 'gl' WHERE source_system = 'qbo';
UPDATE reconciliation_exception SET source_system = 'gl' WHERE source_system = 'qbo';
UPDATE reconciliation_mapping_profile SET source_type = 'gl' WHERE source_type = 'qbo';
UPDATE reconciliation_template_definition SET template_type = 'gl' WHERE template_type = 'qbo';
UPDATE reconciliation_payee_alias SET source_direction = 'bank_to_gl' WHERE source_direction = 'bank_to_qbo';

ALTER TABLE reconciliation_source_file ADD CONSTRAINT reconciliation_source_file_source_system_check
  CHECK (source_system IN ('bank', 'gl'));
ALTER TABLE reconciliation_raw_row ADD CONSTRAINT reconciliation_raw_row_source_system_check
  CHECK (source_system IN ('bank', 'gl'));
ALTER TABLE reconciliation_canonical_row ADD CONSTRAINT reconciliation_canonical_row_source_system_check
  CHECK (source_system IN ('bank', 'gl'));
ALTER TABLE reconciliation_exception ADD CONSTRAINT reconciliation_exception_source_system_check
  CHECK (source_system IN ('bank', 'gl'));
ALTER TABLE reconciliation_mapping_profile ADD CONSTRAINT reconciliation_mapping_profile_source_type_check
  CHECK (source_type IN ('bank', 'gl'));
ALTER TABLE reconciliation_template_definition ADD CONSTRAINT reconciliation_template_definition_template_type_check
  CHECK (template_type IN ('bank', 'gl'));
ALTER TABLE reconciliation_payee_alias ADD CONSTRAINT payee_alias_source_direction_check
  CHECK (source_direction IN ('bank_to_gl', 'bidirectional'));

-- ── ErrorCategory: MissingFromQBO -> MissingFromGL, DuplicateInQBO -> DuplicateInGL ──────────────
-- These two are the only categories carrying the legacy vocabulary. The full 30-value list is
-- restated because the constraint is replaced wholesale; the other 28 values are unchanged.
ALTER TABLE reconciliation_exception DROP CONSTRAINT reconciliation_exception_category_check;
ALTER TABLE reconciliation_match_result DROP CONSTRAINT reconciliation_match_result_exception_category_check;

UPDATE reconciliation_exception SET category = 'MissingFromGL' WHERE category = 'MissingFromQBO';
UPDATE reconciliation_exception SET category = 'DuplicateInGL' WHERE category = 'DuplicateInQBO';
UPDATE reconciliation_match_result SET exception_category = 'MissingFromGL' WHERE exception_category = 'MissingFromQBO';
UPDATE reconciliation_match_result SET exception_category = 'DuplicateInGL' WHERE exception_category = 'DuplicateInQBO';

ALTER TABLE reconciliation_exception ADD CONSTRAINT reconciliation_exception_category_check
  CHECK (category IN ('MissingFromBank', 'MissingFromGL', 'AmountMismatch', 'DuplicateInBank', 'DuplicateInGL', 'LikelySplitCombineIssue', 'DepositGroupingIssue', 'LikelyMiscoding', 'DateVariance', 'TimingDifference', 'CheckNumberMismatch', 'ReferenceNumberMismatch', 'DescriptionMerchantVariance', 'StaleOutstandingCheck', 'OutstandingCheck', 'FeeNettingMatch', 'PartialPaymentMatch', 'PayrollBatchMatch', 'BankServiceChargeAmortization', 'LoanPaymentSplit', 'NSFReturnedDeposit', 'VoidedCheckCleared', 'InvalidOrMissingData', 'AmbiguousMatchRequiringReview', 'ReversalVoid', 'ACHReturn', 'DepositInTransit', 'ChargebackReturn', 'InterestIncome', 'IntercompanyMismatch'));
ALTER TABLE reconciliation_match_result ADD CONSTRAINT reconciliation_match_result_exception_category_check
  CHECK (exception_category IS NULL OR exception_category IN ('MissingFromBank', 'MissingFromGL', 'AmountMismatch', 'DuplicateInBank', 'DuplicateInGL', 'LikelySplitCombineIssue', 'DepositGroupingIssue', 'LikelyMiscoding', 'DateVariance', 'TimingDifference', 'CheckNumberMismatch', 'ReferenceNumberMismatch', 'DescriptionMerchantVariance', 'StaleOutstandingCheck', 'OutstandingCheck', 'FeeNettingMatch', 'PartialPaymentMatch', 'PayrollBatchMatch', 'BankServiceChargeAmortization', 'LoanPaymentSplit', 'NSFReturnedDeposit', 'VoidedCheckCleared', 'InvalidOrMissingData', 'AmbiguousMatchRequiringReview', 'ReversalVoid', 'ACHReturn', 'DepositInTransit', 'ChargebackReturn', 'InterestIncome', 'IntercompanyMismatch'));

-- ── Category keys inside the summary JSONB ───────────────────────────────────────────────────────
-- Rebuilt rather than string-replaced so the key rename is structural. jsonb_strip_nulls drops the
-- synthesized key when the legacy one was absent, so a summary containing only one of the two -- or
-- neither -- is not given a spurious null entry.
UPDATE reconciliation_job_summary SET
  counts_by_category_json = (counts_by_category_json - 'MissingFromQBO' - 'DuplicateInQBO')
    || jsonb_strip_nulls(jsonb_build_object(
         'MissingFromGL', counts_by_category_json -> 'MissingFromQBO',
         'DuplicateInGL', counts_by_category_json -> 'DuplicateInQBO')),
  amount_by_category_json = (amount_by_category_json - 'MissingFromQBO' - 'DuplicateInQBO')
    || jsonb_strip_nulls(jsonb_build_object(
         'MissingFromGL', amount_by_category_json -> 'MissingFromQBO',
         'DuplicateInGL', amount_by_category_json -> 'DuplicateInQBO'))
-- jsonb_exists_any() is used instead of the equivalent JSONB key-existence operator: Liquibase sends
-- SQL through JDBC, which reads that operator's leading question mark as a bind placeholder and
-- fails to parse the statement. The function form has no such conflict.
WHERE jsonb_exists_any(counts_by_category_json, ARRAY['MissingFromQBO', 'DuplicateInQBO'])
   OR jsonb_exists_any(amount_by_category_json, ARRAY['MissingFromQBO', 'DuplicateInQBO']);

-- ── Rule identifiers and embedded source-system tokens ───────────────────────────────────────────
-- rule_id is a structural identifier that tracks the rule catalog in packages/core, so it follows the
-- rename. Inside JSONB the two replaced forms are the hyphenated rule id and the quoted standalone
-- string "qbo"; neither can match inside "qbo.xlsx", so embedded file names survive untouched.
UPDATE reconciliation_rule_result SET rule_id = replace(rule_id, 'missing-from-qbo', 'missing-from-gl')
  WHERE rule_id LIKE '%missing-from-qbo%';

UPDATE reconciliation_rule_result
   SET evidence_json = replace(replace(evidence_json::text, '"qbo"', '"gl"'), 'missing-from-qbo', 'missing-from-gl')::jsonb
 WHERE evidence_json::text LIKE '%"qbo"%' OR evidence_json::text LIKE '%missing-from-qbo%';

UPDATE reconciliation_match_group
   SET evidence_json = replace(replace(evidence_json::text, '"qbo"', '"gl"'), 'missing-from-qbo', 'missing-from-gl')::jsonb
 WHERE evidence_json::text LIKE '%"qbo"%' OR evidence_json::text LIKE '%missing-from-qbo%';

UPDATE reconciliation_exception
   SET rule_trace_json = replace(replace(rule_trace_json::text, '"qbo"', '"gl"'), 'missing-from-qbo', 'missing-from-gl')::jsonb
 WHERE rule_trace_json::text LIKE '%"qbo"%' OR rule_trace_json::text LIKE '%missing-from-qbo%';

UPDATE reconciliation_exception
   SET prior_rule_traces_json = replace(replace(prior_rule_traces_json::text, '"qbo"', '"gl"'), 'missing-from-qbo', 'missing-from-gl')::jsonb
 WHERE prior_rule_traces_json::text LIKE '%"qbo"%' OR prior_rule_traces_json::text LIKE '%missing-from-qbo%';

--rollback ALTER TABLE reconciliation_match_result DROP CONSTRAINT reconciliation_match_result_exception_category_check;
--rollback ALTER TABLE reconciliation_exception DROP CONSTRAINT reconciliation_exception_category_check;
--rollback UPDATE reconciliation_exception SET prior_rule_traces_json = replace(replace(prior_rule_traces_json::text, '"gl"', '"qbo"'), 'missing-from-gl', 'missing-from-qbo')::jsonb WHERE prior_rule_traces_json::text LIKE '%"gl"%' OR prior_rule_traces_json::text LIKE '%missing-from-gl%';
--rollback UPDATE reconciliation_exception SET rule_trace_json = replace(replace(rule_trace_json::text, '"gl"', '"qbo"'), 'missing-from-gl', 'missing-from-qbo')::jsonb WHERE rule_trace_json::text LIKE '%"gl"%' OR rule_trace_json::text LIKE '%missing-from-gl%';
--rollback UPDATE reconciliation_match_group SET evidence_json = replace(replace(evidence_json::text, '"gl"', '"qbo"'), 'missing-from-gl', 'missing-from-qbo')::jsonb WHERE evidence_json::text LIKE '%"gl"%' OR evidence_json::text LIKE '%missing-from-gl%';
--rollback UPDATE reconciliation_rule_result SET evidence_json = replace(replace(evidence_json::text, '"gl"', '"qbo"'), 'missing-from-gl', 'missing-from-qbo')::jsonb WHERE evidence_json::text LIKE '%"gl"%' OR evidence_json::text LIKE '%missing-from-gl%';
--rollback UPDATE reconciliation_rule_result SET rule_id = replace(rule_id, 'missing-from-gl', 'missing-from-qbo') WHERE rule_id LIKE '%missing-from-gl%';
--rollback UPDATE reconciliation_job_summary SET counts_by_category_json = (counts_by_category_json - 'MissingFromGL' - 'DuplicateInGL') || jsonb_strip_nulls(jsonb_build_object('MissingFromQBO', counts_by_category_json -> 'MissingFromGL', 'DuplicateInQBO', counts_by_category_json -> 'DuplicateInGL')), amount_by_category_json = (amount_by_category_json - 'MissingFromGL' - 'DuplicateInGL') || jsonb_strip_nulls(jsonb_build_object('MissingFromQBO', amount_by_category_json -> 'MissingFromGL', 'DuplicateInQBO', amount_by_category_json -> 'DuplicateInGL')) WHERE jsonb_exists_any(counts_by_category_json, ARRAY['MissingFromGL','DuplicateInGL']) OR jsonb_exists_any(amount_by_category_json, ARRAY['MissingFromGL','DuplicateInGL']);
--rollback UPDATE reconciliation_match_result SET exception_category = 'DuplicateInQBO' WHERE exception_category = 'DuplicateInGL';
--rollback UPDATE reconciliation_match_result SET exception_category = 'MissingFromQBO' WHERE exception_category = 'MissingFromGL';
--rollback UPDATE reconciliation_exception SET category = 'DuplicateInQBO' WHERE category = 'DuplicateInGL';
--rollback UPDATE reconciliation_exception SET category = 'MissingFromQBO' WHERE category = 'MissingFromGL';
--rollback ALTER TABLE reconciliation_exception ADD CONSTRAINT reconciliation_exception_category_check CHECK (category IN ('MissingFromBank','MissingFromQBO','AmountMismatch','DuplicateInBank','DuplicateInQBO','LikelySplitCombineIssue','DepositGroupingIssue','LikelyMiscoding','DateVariance','TimingDifference','CheckNumberMismatch','ReferenceNumberMismatch','DescriptionMerchantVariance','StaleOutstandingCheck','OutstandingCheck','FeeNettingMatch','PartialPaymentMatch','PayrollBatchMatch','BankServiceChargeAmortization','LoanPaymentSplit','NSFReturnedDeposit','VoidedCheckCleared','InvalidOrMissingData','AmbiguousMatchRequiringReview','ReversalVoid','ACHReturn','DepositInTransit','ChargebackReturn','InterestIncome','IntercompanyMismatch'));
--rollback ALTER TABLE reconciliation_match_result ADD CONSTRAINT reconciliation_match_result_exception_category_check CHECK (exception_category IS NULL OR exception_category IN ('MissingFromBank','MissingFromQBO','AmountMismatch','DuplicateInBank','DuplicateInQBO','LikelySplitCombineIssue','DepositGroupingIssue','LikelyMiscoding','DateVariance','TimingDifference','CheckNumberMismatch','ReferenceNumberMismatch','DescriptionMerchantVariance','StaleOutstandingCheck','OutstandingCheck','FeeNettingMatch','PartialPaymentMatch','PayrollBatchMatch','BankServiceChargeAmortization','LoanPaymentSplit','NSFReturnedDeposit','VoidedCheckCleared','InvalidOrMissingData','AmbiguousMatchRequiringReview','ReversalVoid','ACHReturn','DepositInTransit','ChargebackReturn','InterestIncome','IntercompanyMismatch'));
--rollback ALTER TABLE reconciliation_payee_alias DROP CONSTRAINT payee_alias_source_direction_check;
--rollback ALTER TABLE reconciliation_template_definition DROP CONSTRAINT reconciliation_template_definition_template_type_check;
--rollback ALTER TABLE reconciliation_mapping_profile DROP CONSTRAINT reconciliation_mapping_profile_source_type_check;
--rollback ALTER TABLE reconciliation_exception DROP CONSTRAINT reconciliation_exception_source_system_check;
--rollback ALTER TABLE reconciliation_canonical_row DROP CONSTRAINT reconciliation_canonical_row_source_system_check;
--rollback ALTER TABLE reconciliation_raw_row DROP CONSTRAINT reconciliation_raw_row_source_system_check;
--rollback ALTER TABLE reconciliation_source_file DROP CONSTRAINT reconciliation_source_file_source_system_check;
--rollback UPDATE reconciliation_payee_alias SET source_direction = 'bank_to_qbo' WHERE source_direction = 'bank_to_gl';
--rollback UPDATE reconciliation_template_definition SET template_type = 'qbo' WHERE template_type = 'gl';
--rollback UPDATE reconciliation_mapping_profile SET source_type = 'qbo' WHERE source_type = 'gl';
--rollback UPDATE reconciliation_exception SET source_system = 'qbo' WHERE source_system = 'gl';
--rollback UPDATE reconciliation_canonical_row SET source_system = 'qbo' WHERE source_system = 'gl';
--rollback UPDATE reconciliation_raw_row SET source_system = 'qbo' WHERE source_system = 'gl';
--rollback UPDATE reconciliation_source_file SET source_system = 'qbo' WHERE source_system = 'gl';
--rollback ALTER TABLE reconciliation_source_file ADD CONSTRAINT reconciliation_source_file_source_system_check CHECK (source_system IN ('bank','qbo'));
--rollback ALTER TABLE reconciliation_raw_row ADD CONSTRAINT reconciliation_raw_row_source_system_check CHECK (source_system IN ('bank','qbo'));
--rollback ALTER TABLE reconciliation_canonical_row ADD CONSTRAINT reconciliation_canonical_row_source_system_check CHECK (source_system IN ('bank','qbo'));
--rollback ALTER TABLE reconciliation_exception ADD CONSTRAINT reconciliation_exception_source_system_check CHECK (source_system IN ('bank','qbo'));
--rollback ALTER TABLE reconciliation_mapping_profile ADD CONSTRAINT reconciliation_mapping_profile_source_type_check CHECK (source_type IN ('bank','qbo'));
--rollback ALTER TABLE reconciliation_template_definition ADD CONSTRAINT reconciliation_template_definition_template_type_check CHECK (template_type IN ('bank','qbo'));
--rollback ALTER TABLE reconciliation_payee_alias ADD CONSTRAINT payee_alias_source_direction_check CHECK (source_direction IN ('bank_to_qbo','bidirectional'));
