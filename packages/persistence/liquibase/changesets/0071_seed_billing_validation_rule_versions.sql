--liquibase formatted sql

--changeset recon:0071-seed_billing_validation_rule_versions splitStatements:false
-- R1 (AP inclusion), WP0.1, follow-on to 0070: validation_rule_version.source_type carries its own
-- CHECK constraint (BANK/GL only, nullable for STRUCT_*), separate from every union 0070's own
-- comment enumerated -- a second live instance of the same class of gap in the same workstream.
-- Unlike canonical_record.source_type (a value stored per-row at file-submit time),
-- validation_rule_version is a seeded catalog: recordFileValidationOutcome
-- (importValidationStore.ts) looks up each validation_issue's code against this table's ACTIVE
-- rows and throws if none matches ("the seed (changeset 0047) is out of sync with
-- ruleCatalog.ts") -- so a BILLING file that trips even one of WP0.1's 14 new AP_* codes (e.g. a
-- routinely-missing Due Date) would crash file submission today without this changeset, not merely
-- fail to be seeded for later use.
--
-- All 4 STRUCT_* codes stay untouched -- header/column-order gates are already format-agnostic
-- (structuralGates.ts takes allKnownHeaders/requiredHeaders as plain arguments, no BILLING branch
-- needed), so no new STRUCT_* row is required. Seeded at version_number 1, mirroring 0051's own
-- precedent for how BANK's/GL's "brand new" codes were seeded.
ALTER TABLE validation_rule_version DROP CONSTRAINT validation_rule_version_source_type_check;
ALTER TABLE validation_rule_version ADD CONSTRAINT validation_rule_version_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('BANK', 'GL', 'BILLING'));

INSERT INTO validation_rule_version (id, rule_code, version_number, scope, source_type, severity, description)
VALUES
  (gen_random_uuid(), 'AP_ENTITY_ID_REQUIRED', 1, 'ROW', 'BILLING', 'ERROR', 'Entity Id is required.'),
  (gen_random_uuid(), 'AP_ENTITY_MISMATCH', 1, 'ROW', 'BILLING', 'ERROR', 'Entity Id does not match this file''s entity -- one AP ledger slot holds exactly one entity.'),
  (gen_random_uuid(), 'AP_VENDOR_ID_REQUIRED', 1, 'ROW', 'BILLING', 'ERROR', 'Vendor Id is required.'),
  (gen_random_uuid(), 'AP_DOC_NO_REQUIRED', 1, 'ROW', 'BILLING', 'ERROR', 'Doc No is required.'),
  (gen_random_uuid(), 'AP_DOC_NO_DUPLICATE', 1, 'ROW', 'BILLING', 'ERROR', 'Doc No duplicates another row within the same file.'),
  (gen_random_uuid(), 'AP_DOC_DATE_REQUIRED', 1, 'ROW', 'BILLING', 'ERROR', 'Doc Date is required.'),
  (gen_random_uuid(), 'AP_DOC_DATE_FORMAT', 1, 'ROW', 'BILLING', 'ERROR', 'Doc Date must be YYYY-MM-DD.'),
  (gen_random_uuid(), 'AP_DOC_DATE_FUTURE', 1, 'ROW', 'BILLING', 'ERROR', 'Doc Date is in the future.'),
  (gen_random_uuid(), 'AP_DUE_DATE_MISSING', 1, 'ROW', 'BILLING', 'WARNING', 'Due Date is missing; the row will be unbandable for aging.'),
  (gen_random_uuid(), 'AP_DUE_DATE_FORMAT', 1, 'ROW', 'BILLING', 'ERROR', 'Due Date must be YYYY-MM-DD.'),
  (gen_random_uuid(), 'AP_AMOUNT_FORMAT', 1, 'ROW', 'BILLING', 'ERROR', 'Amount is required and must be a valid signed amount.'),
  (gen_random_uuid(), 'AP_AMOUNT_ZERO', 1, 'ROW', 'BILLING', 'WARNING', 'Amount is zero.'),
  (gen_random_uuid(), 'AP_DOC_TYPE_UNRECOGNIZED', 1, 'ROW', 'BILLING', 'WARNING', 'Doc Type is not one of the recognized values (Bill, Payment, Credit Memo).'),
  (gen_random_uuid(), 'AP_APPLIED_DOC_UNKNOWN', 1, 'CROSS_ROW', 'BILLING', 'WARNING', 'Applied To Doc No does not match any Doc No in this file.');

--rollback DELETE FROM validation_rule_version WHERE version_number = 1 AND source_type = 'BILLING';
--rollback ALTER TABLE validation_rule_version DROP CONSTRAINT validation_rule_version_source_type_check;
--rollback ALTER TABLE validation_rule_version ADD CONSTRAINT validation_rule_version_source_type_check CHECK (source_type IS NULL OR source_type IN ('BANK', 'GL'));
