--liquibase formatted sql

--changeset recon:0046-rename_normalized_record_to_canonical_record splitStatements:false
-- reconciliation-design-v2 review (2026-08-12): normalized_record was Bank/GL-shaped;
-- canonical_record (implementation-spec.md v2 §3.6) is the same envelope generalized with
-- source_type and the fields 1:N/N:1 matching (payroll, remittance, factoring, ...) will need
-- later: counterparty, references, and matching-set evidence. normalized_record has no rows
-- yet, so this is a plain rename + additive columns, no backfill.
--
-- source_system -> source_type: same values today ('BANK'/'GL'), renamed for consistency with
-- import_file.source_type (changeset 0044) and the wider taxonomy it will eventually carry
-- (tracked separately, GitHub issue #121 -- not widened here, this changeset only renames the
-- column; the CHECK stays BANK/GL until a source-type-specific canonical validator exists).
--
-- reference (TEXT, one value) -> reference_ids (JSONB, a bag of external ids: invoice, batch,
-- remittance, check, ACH, factor -- format spec v2 §0.6's `references[]`). Named reference_ids
-- rather than "references": REFERENCES is a fully reserved word in PostgreSQL's grammar (used
-- in FOREIGN KEY ... REFERENCES), so an unquoted column literally named references would force
-- every piece of SQL touching it to double-quote the identifier from then on -- not worth the
-- footgun for a rename that's free to avoid.
ALTER TABLE normalized_record RENAME TO canonical_record;

ALTER TABLE canonical_record RENAME COLUMN source_system TO source_type;

ALTER TABLE canonical_record RENAME COLUMN reference TO legacy_reference;
ALTER TABLE canonical_record ADD COLUMN reference_ids JSONB;
UPDATE canonical_record SET reference_ids = jsonb_build_object('reference', legacy_reference) WHERE legacy_reference IS NOT NULL;
ALTER TABLE canonical_record DROP COLUMN legacy_reference;

ALTER TABLE canonical_record
  ADD COLUMN counterparty_type TEXT,
  ADD COLUMN counterparty_id TEXT,
  ADD COLUMN counterparty_name TEXT,
  ADD COLUMN value_date DATE,
  ADD COLUMN effective_date DATE,
  ADD COLUMN evidence JSONB;

CREATE INDEX IF NOT EXISTS canonical_record_counterparty_id_idx ON canonical_record (counterparty_id)
  WHERE counterparty_id IS NOT NULL;

--rollback DROP INDEX IF EXISTS canonical_record_counterparty_id_idx;
--rollback ALTER TABLE canonical_record DROP COLUMN evidence;
--rollback ALTER TABLE canonical_record DROP COLUMN effective_date;
--rollback ALTER TABLE canonical_record DROP COLUMN value_date;
--rollback ALTER TABLE canonical_record DROP COLUMN counterparty_name;
--rollback ALTER TABLE canonical_record DROP COLUMN counterparty_id;
--rollback ALTER TABLE canonical_record DROP COLUMN counterparty_type;
--rollback ALTER TABLE canonical_record ADD COLUMN legacy_reference TEXT;
--rollback UPDATE canonical_record SET legacy_reference = reference_ids ->> 'reference' WHERE reference_ids IS NOT NULL;
--rollback ALTER TABLE canonical_record DROP COLUMN reference_ids;
--rollback ALTER TABLE canonical_record RENAME COLUMN legacy_reference TO reference;
--rollback ALTER TABLE canonical_record RENAME COLUMN source_type TO source_system;
--rollback ALTER TABLE canonical_record RENAME TO normalized_record;
