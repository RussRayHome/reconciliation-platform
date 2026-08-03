--liquibase formatted sql

--changeset recon:0025-widen_mapping_profile_name_uniqueness
-- A "mapping profile" as the Create Mapping screen presents it is one name with a paired GL
-- mapping and a Bank mapping -- but `reconciliation_mapping_profile` stores one row per side
-- (source_type IN ('bank', 'gl')), and the existing UNIQUE (organization_id, name) constraint
-- means two rows can't share that name even though they're different sides. Adding source_type
-- to that constraint lets the app upsert both rows under the same user-facing name.

ALTER TABLE reconciliation_mapping_profile
  DROP CONSTRAINT reconciliation_mapping_profile_org_name_key;

ALTER TABLE reconciliation_mapping_profile
  ADD CONSTRAINT reconciliation_mapping_profile_org_name_key
  UNIQUE (organization_id, name, source_type);

--rollback ALTER TABLE reconciliation_mapping_profile DROP CONSTRAINT reconciliation_mapping_profile_org_name_key;
--rollback ALTER TABLE reconciliation_mapping_profile ADD CONSTRAINT reconciliation_mapping_profile_org_name_key UNIQUE (organization_id, name);
