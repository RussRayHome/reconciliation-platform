--liquibase formatted sql

--changeset recon:0077-account_registration_and_statement_assignment splitStatements:false
-- Track A / A-D1 (Issue #338, #342, #343). reconciliation_account already stores a stable UUID
-- id, but nothing registers an account deliberately: openItemStore.findOrCreateAccount invents a
-- row from whatever free text arrives, which under A-D1 is exactly the path that must stop.
-- Identity becomes the UUID; the last four digits and the filename become display and suggestion
-- material only. Two additions support that split:
--
--   last_four            derived from account_identifier at registration, for the friendly label
--                        ("Operating -- ending in 5703") and for detecting a filename that
--                        disagrees with the operator's explicit choice. Deliberately NOT unique:
--                        A-D1 states two registered accounts may legitimately share their last
--                        four, in which case the operator must choose explicitly.
--   gl_cash_account_code the GL cash account this bank account reconciles against (A-D2, Issue
--                        #339). Captured at registration so the binding is declared rather than
--                        inferred; nothing reads it until matching is partitioned (Issue #344).
ALTER TABLE reconciliation_account ADD COLUMN IF NOT EXISTS last_four TEXT;
ALTER TABLE reconciliation_account ADD COLUMN IF NOT EXISTS gl_cash_account_code TEXT;

-- Existing rows were all created by the find-or-create path from a last-four-shaped identifier,
-- so deriving the display tail from the identifier's own trailing digits reproduces what the UI
-- would have shown anyway. An identifier holding fewer than four digits gets NULL and simply has
-- no last-four hint -- legal, per deriveLastFour in @recon/domain.
UPDATE reconciliation_account
   SET last_four = RIGHT(REGEXP_REPLACE(account_identifier, '\D', '', 'g'), 4)
 WHERE last_four IS NULL
   AND LENGTH(REGEXP_REPLACE(account_identifier, '\D', '', 'g')) >= 4;

-- Statement-to-account assignment (A-D1 step 2/4): which registered account each uploaded bank
-- statement was explicitly assigned to. run_source_file is already the per-run, per-upload row,
-- and import_file.id is already the durable per-statement identifier A-D1 calls "Statement ID",
-- so the assignment is one nullable FK here rather than a new table. Nullable because GL uploads
-- and every pre-existing run legitimately have no bank account assignment.
ALTER TABLE run_source_file ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES reconciliation_account (id);

CREATE INDEX IF NOT EXISTS run_source_file_account_idx ON run_source_file (account_id);

--rollback DROP INDEX IF EXISTS run_source_file_account_idx;
--rollback ALTER TABLE run_source_file DROP COLUMN IF EXISTS account_id;
--rollback ALTER TABLE reconciliation_account DROP COLUMN IF EXISTS gl_cash_account_code;
--rollback ALTER TABLE reconciliation_account DROP COLUMN IF EXISTS last_four;
