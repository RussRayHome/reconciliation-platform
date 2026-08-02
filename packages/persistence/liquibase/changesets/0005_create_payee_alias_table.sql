--liquibase formatted sql

--changeset recon:0005-create_payee_alias_table
CREATE TABLE IF NOT EXISTS payee_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_identifier TEXT,
  bank_pattern TEXT NOT NULL,
  canonical_payee_name TEXT NOT NULL,
  normalized_tokens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  source_direction TEXT NOT NULL DEFAULT 'bank_to_qbo'
    CHECK (source_direction IN ('bank_to_qbo', 'bidirectional')),
  match_confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0
    CHECK (match_confidence >= 0 AND match_confidence <= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payee_alias_account_idx
  ON payee_alias (account_identifier)
  WHERE account_identifier IS NOT NULL;

CREATE INDEX IF NOT EXISTS payee_alias_canonical_payee_idx
  ON payee_alias (canonical_payee_name);

CREATE INDEX IF NOT EXISTS payee_alias_tokens_idx
  ON payee_alias USING GIN (normalized_tokens);

CREATE INDEX IF NOT EXISTS payee_alias_active_idx
  ON payee_alias (is_active, account_identifier)
  WHERE is_active = TRUE;

--rollback DROP TABLE IF EXISTS payee_alias CASCADE;
