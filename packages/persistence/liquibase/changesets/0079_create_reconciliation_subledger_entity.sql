--liquibase formatted sql

--changeset recon:0079-create_reconciliation_subledger_entity splitStatements:false
-- The AP and AR entity registries (UI-9, Issue #448, designs 5a/5b). Mirrors
-- `reconciliation_account` (changeset 0059) deliberately: a subledger entity is the same kind of
-- object as a bank account -- a stable identity a file is attributed to, which outlives any one
-- run -- so it gets the same shape rather than a novel one.
--
-- Three product rules are encoded here, each stated on screen 5a:
--
--   ONE TABLE, TWO REGISTRIES. `kind` names which registry a row belongs to. AP and AR are
--   separate registries in the UI but identical in structure, and the design says outright that
--   "one id may legitimately exist in both registries as a single legal entity" -- so the unique
--   key is (organization, kind, entity_id), NOT (organization, entity_id). Northwind can be both
--   a vendor and a customer, and forcing one row would make deactivating it as a vendor also
--   deactivate it as a customer.
--
--   THE ENTITY ID IS IMMUTABLE, and that is a data rule rather than a UI one: the id is what a
--   filename claims (`E100_ap-payments.csv`), so changing it would silently re-point every file,
--   run and open item already attributed to it. The display name is the mutable half -- 5a says
--   "rename the display name instead". Nothing here enforces immutability at the column level
--   (Postgres has no such constraint); the store simply never issues an UPDATE that touches it,
--   the same way `reconciliation_account.account_identifier` is protected by
--   `UpdateReconciliationAccountInput` omitting it.
--
--   DEACTIVATED, NEVER DELETED. Same rule as bank accounts and saved views. A deactivated entity
--   keeps every file, run and open item already attributed to it and stops being offered for new
--   assignments; 5a adds that importing against one "warns on submit, does not block -- history
--   stays provable".
CREATE TABLE IF NOT EXISTS reconciliation_subledger_entity (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id) ON DELETE CASCADE,
  -- Which registry. Enum-shaped TEXT rather than a boolean for the same reason saved views'
  -- `visibility` is (changeset 0078): a third subledger is plausible, and widening a CHECK keeps
  -- every existing row correct where a boolean would need a column swap against live data.
  kind TEXT NOT NULL CHECK (kind IN ('ap', 'ar')),
  -- The prefix a filename carries. Case is preserved as entered but uniqueness is case-insensitive
  -- (see the index below), because a filename is not a reliable source of casing.
  entity_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  -- Where this entity's ledger comes from. Free TEXT, not a CHECK: 5a shows "Files (CSV or XLSX)"
  -- and "QuickBooks" as examples, and the accounting-system integration those imply does not exist
  -- (#464). Constraining it now would encode a vocabulary nobody has designed.
  ledger_source TEXT,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness per registry. `E100` and `e100` in the same registry are the same
-- entity -- a filename's casing is not something an operator controls reliably, and two rows that
-- differ only by case would make prefix matching ambiguous exactly where it must not be.
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_subledger_entity_kind_entity_key
  ON reconciliation_subledger_entity (organization_id, kind, LOWER(entity_id));

-- The registry read is "this organization's entities of one kind, active first".
CREATE INDEX IF NOT EXISTS reconciliation_subledger_entity_registry_idx
  ON reconciliation_subledger_entity (organization_id, kind, is_active);

ALTER TABLE reconciliation_subledger_entity ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_subledger_entity_tenant_isolation ON reconciliation_subledger_entity
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

CREATE TRIGGER trg_reconciliation_subledger_entity_updated_at
  BEFORE UPDATE ON reconciliation_subledger_entity
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--rollback DROP TRIGGER IF EXISTS trg_reconciliation_subledger_entity_updated_at ON reconciliation_subledger_entity;
--rollback DROP POLICY IF EXISTS reconciliation_subledger_entity_tenant_isolation ON reconciliation_subledger_entity;
--rollback DROP TABLE IF EXISTS reconciliation_subledger_entity CASCADE;
