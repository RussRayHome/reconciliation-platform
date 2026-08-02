--liquibase formatted sql

--changeset recon:0009-create_reconciliation_user_table splitStatements:false
CREATE TABLE IF NOT EXISTS reconciliation_user (
  user_name TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  password TEXT NOT NULL,
  last_changed TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_reconciliation_user_last_changed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password THEN
    NEW.last_changed = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reconciliation_user_password_changed ON reconciliation_user;

CREATE TRIGGER trg_reconciliation_user_password_changed
BEFORE UPDATE ON reconciliation_user
FOR EACH ROW
EXECUTE FUNCTION set_reconciliation_user_last_changed();

--rollback DROP TRIGGER IF EXISTS trg_reconciliation_user_password_changed ON reconciliation_user;
--rollback DROP FUNCTION IF EXISTS set_reconciliation_user_last_changed();
--rollback DROP TABLE IF EXISTS reconciliation_user CASCADE;
