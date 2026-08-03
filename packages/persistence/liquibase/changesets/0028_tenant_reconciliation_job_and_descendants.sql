--liquibase formatted sql

--changeset recon:0028-tenant_reconciliation_job_and_descendants splitStatements:false
-- ADR-0001 prerequisite work, step 3: tenant the data model. reconciliation_job is the aggregate
-- root that reconciliation_audit_event, reconciliation_canonical_row, and ten other tables FK
-- into; until it carries organization_id, an RLS policy has nothing to filter the reconciliation
-- data itself on (reconciliation_user and reconciliation_mapping_profile already carry it, added
-- by changesets 0026 and 0012, but that only tenants principals and mapping config, not runs).
--
-- Denormalizes organization_id onto every tenant-scoped table rather than requiring policies to
-- join back to reconciliation_job -- ADR-0001 names this "faster to query and simpler to police"
-- and it is what a session-GUC RLS policy (`organization_id = current_setting(...)`) needs to
-- stay a single-column check instead of a join.
--
-- Backfill: every existing row predates real customer data, so everything attributes to the same
-- default organization findOrCreateDefaultOrganization() (readModelStore.ts) and changeset 0026
-- already use -- matched by name, not a hardcoded id, so this composes with whichever of the
-- three already created it.
--
-- reconciliation_template_definition and reconciliation_validation_rule_version are deliberately
-- excluded: both are global catalogs (template_type+version / rule_code+version keyed, no
-- account or job association anywhere in their schema or the code that reads them) rather than
-- per-customer data.

INSERT INTO reconciliation_organization (id, name)
VALUES (gen_random_uuid(), 'Default Organization')
ON CONFLICT (name) DO NOTHING;

-- ── reconciliation_job (aggregate root) ─────────────────────────────────────────────────────────
ALTER TABLE reconciliation_job
  ADD COLUMN organization_id UUID REFERENCES reconciliation_organization (id);

UPDATE reconciliation_job
SET organization_id = (SELECT id FROM reconciliation_organization WHERE name = 'Default Organization')
WHERE organization_id IS NULL;

ALTER TABLE reconciliation_job
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX reconciliation_job_organization_idx ON reconciliation_job (organization_id);

-- ── reconciliation_source_file: close the nullable gap ADR-0001 flagged ────────────────────────
UPDATE reconciliation_source_file sf
SET organization_id = j.organization_id
FROM reconciliation_job j
WHERE sf.job_id = j.id AND sf.organization_id IS NULL;

ALTER TABLE reconciliation_source_file
  ALTER COLUMN organization_id SET NOT NULL;

-- ── direct descendants of reconciliation_job (denormalized straight from the parent) ───────────
ALTER TABLE reconciliation_audit_event ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_canonical_row ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_exception ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_export ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_import_batch ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_job_summary ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_match_group ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_match_result ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_raw_row ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_review_decision ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_review_observation ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_rule_result ADD COLUMN organization_id UUID;

UPDATE reconciliation_audit_event t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_canonical_row t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_exception t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_export t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_import_batch t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_job_summary t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_match_group t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_match_result t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_raw_row t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_review_decision t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_review_observation t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;
UPDATE reconciliation_rule_result t SET organization_id = j.organization_id FROM reconciliation_job j WHERE t.job_id = j.id;

ALTER TABLE reconciliation_audit_event ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_canonical_row ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_exception ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_export ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_import_batch ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_job_summary ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_match_group ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_match_result ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_raw_row ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_review_decision ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_review_observation ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_rule_result ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE reconciliation_audit_event ADD CONSTRAINT reconciliation_audit_event_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_canonical_row ADD CONSTRAINT reconciliation_canonical_row_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_exception ADD CONSTRAINT reconciliation_exception_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_export ADD CONSTRAINT reconciliation_export_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_import_batch ADD CONSTRAINT reconciliation_import_batch_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_job_summary ADD CONSTRAINT reconciliation_job_summary_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_match_group ADD CONSTRAINT reconciliation_match_group_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_match_result ADD CONSTRAINT reconciliation_match_result_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_raw_row ADD CONSTRAINT reconciliation_raw_row_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_review_decision ADD CONSTRAINT reconciliation_review_decision_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_review_observation ADD CONSTRAINT reconciliation_review_observation_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_rule_result ADD CONSTRAINT reconciliation_rule_result_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);

CREATE INDEX reconciliation_audit_event_organization_idx ON reconciliation_audit_event (organization_id);
CREATE INDEX reconciliation_canonical_row_organization_idx ON reconciliation_canonical_row (organization_id);
CREATE INDEX reconciliation_exception_organization_idx ON reconciliation_exception (organization_id);
CREATE INDEX reconciliation_export_organization_idx ON reconciliation_export (organization_id);
CREATE INDEX reconciliation_import_batch_organization_idx ON reconciliation_import_batch (organization_id);
CREATE INDEX reconciliation_job_summary_organization_idx ON reconciliation_job_summary (organization_id);
CREATE INDEX reconciliation_match_group_organization_idx ON reconciliation_match_group (organization_id);
CREATE INDEX reconciliation_match_result_organization_idx ON reconciliation_match_result (organization_id);
CREATE INDEX reconciliation_raw_row_organization_idx ON reconciliation_raw_row (organization_id);
CREATE INDEX reconciliation_review_decision_organization_idx ON reconciliation_review_decision (organization_id);
CREATE INDEX reconciliation_review_observation_organization_idx ON reconciliation_review_observation (organization_id);
CREATE INDEX reconciliation_rule_result_organization_idx ON reconciliation_rule_result (organization_id);

-- ── indirect descendants (chain through reconciliation_source_file, now NOT NULL above) ────────
ALTER TABLE reconciliation_import_approval ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_source_file_content ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_staged_transaction ADD COLUMN organization_id UUID;
ALTER TABLE reconciliation_validation_result ADD COLUMN organization_id UUID;

UPDATE reconciliation_import_approval t SET organization_id = sf.organization_id FROM reconciliation_source_file sf WHERE t.source_file_id = sf.id;
UPDATE reconciliation_source_file_content t SET organization_id = sf.organization_id FROM reconciliation_source_file sf WHERE t.source_file_id = sf.id;
UPDATE reconciliation_staged_transaction t SET organization_id = sf.organization_id FROM reconciliation_source_file sf WHERE t.source_file_id = sf.id;
UPDATE reconciliation_validation_result t SET organization_id = sf.organization_id FROM reconciliation_source_file sf WHERE t.source_file_id = sf.id;

ALTER TABLE reconciliation_import_approval ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_source_file_content ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_staged_transaction ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_validation_result ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE reconciliation_import_approval ADD CONSTRAINT reconciliation_import_approval_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_source_file_content ADD CONSTRAINT reconciliation_source_file_content_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_staged_transaction ADD CONSTRAINT reconciliation_staged_transaction_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
ALTER TABLE reconciliation_validation_result ADD CONSTRAINT reconciliation_validation_result_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);

CREATE INDEX reconciliation_import_approval_organization_idx ON reconciliation_import_approval (organization_id);
CREATE INDEX reconciliation_source_file_content_organization_idx ON reconciliation_source_file_content (organization_id);
CREATE INDEX reconciliation_staged_transaction_organization_idx ON reconciliation_staged_transaction (organization_id);
CREATE INDEX reconciliation_validation_result_organization_idx ON reconciliation_validation_result (organization_id);

-- reconciliation_approval_history chains through reconciliation_import_approval (just tenanted above)
ALTER TABLE reconciliation_approval_history ADD COLUMN organization_id UUID;

UPDATE reconciliation_approval_history t
SET organization_id = ia.organization_id
FROM reconciliation_import_approval ia
WHERE t.approval_id = ia.id;

ALTER TABLE reconciliation_approval_history ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_approval_history ADD CONSTRAINT reconciliation_approval_history_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
CREATE INDEX reconciliation_approval_history_organization_idx ON reconciliation_approval_history (organization_id);

-- ── reconciliation_mapping_profile_version chains through reconciliation_mapping_profile ───────
ALTER TABLE reconciliation_mapping_profile_version ADD COLUMN organization_id UUID;

UPDATE reconciliation_mapping_profile_version t
SET organization_id = mp.organization_id
FROM reconciliation_mapping_profile mp
WHERE t.profile_id = mp.id;

ALTER TABLE reconciliation_mapping_profile_version ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_mapping_profile_version ADD CONSTRAINT reconciliation_mapping_profile_version_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
CREATE INDEX reconciliation_mapping_profile_version_organization_idx ON reconciliation_mapping_profile_version (organization_id);

-- ── reconciliation_payee_alias: no job/source_file chain to derive from, backfill directly ─────
ALTER TABLE reconciliation_payee_alias ADD COLUMN organization_id UUID;

UPDATE reconciliation_payee_alias
SET organization_id = (SELECT id FROM reconciliation_organization WHERE name = 'Default Organization')
WHERE organization_id IS NULL;

ALTER TABLE reconciliation_payee_alias ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE reconciliation_payee_alias ADD CONSTRAINT reconciliation_payee_alias_organization_fk FOREIGN KEY (organization_id) REFERENCES reconciliation_organization (id);
CREATE INDEX reconciliation_payee_alias_organization_idx ON reconciliation_payee_alias (organization_id);

--rollback ALTER TABLE reconciliation_payee_alias DROP CONSTRAINT reconciliation_payee_alias_organization_fk;
--rollback ALTER TABLE reconciliation_payee_alias DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_mapping_profile_version DROP CONSTRAINT reconciliation_mapping_profile_version_organization_fk;
--rollback ALTER TABLE reconciliation_mapping_profile_version DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_approval_history DROP CONSTRAINT reconciliation_approval_history_organization_fk;
--rollback ALTER TABLE reconciliation_approval_history DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_validation_result DROP CONSTRAINT reconciliation_validation_result_organization_fk;
--rollback ALTER TABLE reconciliation_validation_result DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_staged_transaction DROP CONSTRAINT reconciliation_staged_transaction_organization_fk;
--rollback ALTER TABLE reconciliation_staged_transaction DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_source_file_content DROP CONSTRAINT reconciliation_source_file_content_organization_fk;
--rollback ALTER TABLE reconciliation_source_file_content DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_import_approval DROP CONSTRAINT reconciliation_import_approval_organization_fk;
--rollback ALTER TABLE reconciliation_import_approval DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_rule_result DROP CONSTRAINT reconciliation_rule_result_organization_fk;
--rollback ALTER TABLE reconciliation_rule_result DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_review_observation DROP CONSTRAINT reconciliation_review_observation_organization_fk;
--rollback ALTER TABLE reconciliation_review_observation DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_review_decision DROP CONSTRAINT reconciliation_review_decision_organization_fk;
--rollback ALTER TABLE reconciliation_review_decision DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_raw_row DROP CONSTRAINT reconciliation_raw_row_organization_fk;
--rollback ALTER TABLE reconciliation_raw_row DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_match_result DROP CONSTRAINT reconciliation_match_result_organization_fk;
--rollback ALTER TABLE reconciliation_match_result DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_match_group DROP CONSTRAINT reconciliation_match_group_organization_fk;
--rollback ALTER TABLE reconciliation_match_group DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_job_summary DROP CONSTRAINT reconciliation_job_summary_organization_fk;
--rollback ALTER TABLE reconciliation_job_summary DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_import_batch DROP CONSTRAINT reconciliation_import_batch_organization_fk;
--rollback ALTER TABLE reconciliation_import_batch DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_export DROP CONSTRAINT reconciliation_export_organization_fk;
--rollback ALTER TABLE reconciliation_export DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_exception DROP CONSTRAINT reconciliation_exception_organization_fk;
--rollback ALTER TABLE reconciliation_exception DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_canonical_row DROP CONSTRAINT reconciliation_canonical_row_organization_fk;
--rollback ALTER TABLE reconciliation_canonical_row DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_audit_event DROP CONSTRAINT reconciliation_audit_event_organization_fk;
--rollback ALTER TABLE reconciliation_audit_event DROP COLUMN organization_id;
--rollback ALTER TABLE reconciliation_source_file ALTER COLUMN organization_id DROP NOT NULL;
--rollback ALTER TABLE reconciliation_job DROP COLUMN organization_id;
