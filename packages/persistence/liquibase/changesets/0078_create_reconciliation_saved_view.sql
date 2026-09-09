--liquibase formatted sql

--changeset recon:0078-create_reconciliation_saved_view splitStatements:false
-- Saved views (Issue #458, decided on #396). Views live in each browser's localStorage today
-- (SAVED_VIEWS_STORAGE_KEY, apps/web/src/lib/exceptionTriage.ts), which makes them per-browser,
-- per-device and invisible to the server -- so the designed "Shared" visibility has nowhere to
-- live. This table is what makes a shared view possible at all.
--
-- Four product decisions are encoded here, each recorded on #396 / #458:
--
--   ONE VIEW MODEL, TWO SCOPES ("one view with reuse"). A view applies to Exceptions OR to Open
--   items, not a separate object per screen. `scope` names which, and `filters` is deliberately
--   JSONB rather than columns: the two screens have genuinely different filter shapes (triage has
--   severity/category/source/amount-band facets plus a sort key; open items has status and an
--   aging band), and modelling the union as columns would leave half of them NULL on every row.
--
--   VISIBILITY IS AN ENUM-SHAPED TEXT COLUMN, NOT A BOOLEAN, even though v1 writes only two of
--   its values. Sub-teams are a recorded future refinement (#458): "there could be multiple small
--   teams within the overall finance team ... each person will be assigned to the overall finance
--   team but should check which sub team they are a member of". Adding 'subteam' to this CHECK is
--   then one changeset with every existing row still correct. An `is_shared BOOLEAN` would instead
--   need a column swap, a backfill and a rewrite of every read -- against live user data.
--
--   RETIRED, NEVER DELETED. Bank accounts deactivate (A-D1), AP/AR entities deactivate, matching
--   config versions supersede; saved views were the one object proposed as an exception to that
--   and no longer are. There is no delete path, so a retired view keeps its history and can be
--   restored.
--
--   SHARED MEANS THE WHOLE FINANCE TEAM, org-wide -- not a per-person grant. That is why sharing
--   needs no membership table in v1: `visibility = 'team'` plus `organization_id` is the whole
--   access rule.
CREATE TABLE IF NOT EXISTS reconciliation_saved_view (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES reconciliation_organization (id) ON DELETE CASCADE,
  -- TWO person columns, deliberately, because they answer different questions and one of them will
  -- change (#458). A shared view is a TEAM asset: when its steward moves to another sub-team the
  -- view stays put and ownership transfers to a remaining member. So `owner_user_id` is a pointer
  -- that follows team membership, while `created_by_user_id` is a historical fact that never moves.
  --
  -- Collapsing them into one column would mean the first ownership transfer overwrites the author
  -- permanently -- the only irreversible loss in this design, and the reason the column exists now
  -- rather than when teams are built. In v1 the two are always equal and nothing diverges, since
  -- teams do not exist yet.
  created_by_user_id UUID NOT NULL REFERENCES reconciliation_user (id),
  owner_user_id UUID NOT NULL REFERENCES reconciliation_user (id),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('exceptions', 'open_items')),
  -- The saved filter selection. Shape is the screen's own filter model, versioned by `scope`.
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Name uniqueness is per owner, not per organization, and only among ACTIVE views. Two analysts
-- may each keep their own "Critical - unresolved"; retiring one frees the name again, which is
-- what makes retire usable as the delete replacement rather than a permanent name reservation.
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_saved_view_owner_name_key
  ON reconciliation_saved_view (organization_id, owner_user_id, name)
  WHERE status = 'ACTIVE';

-- The list read is "every view this user may see": their own, plus the organization's shared ones.
CREATE INDEX IF NOT EXISTS reconciliation_saved_view_visible_idx
  ON reconciliation_saved_view (organization_id, visibility, status);

ALTER TABLE reconciliation_saved_view ENABLE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_saved_view_tenant_isolation ON reconciliation_saved_view
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

CREATE TRIGGER trg_reconciliation_saved_view_updated_at
  BEFORE UPDATE ON reconciliation_saved_view
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

--rollback DROP TRIGGER IF EXISTS trg_reconciliation_saved_view_updated_at ON reconciliation_saved_view;
--rollback DROP POLICY IF EXISTS reconciliation_saved_view_tenant_isolation ON reconciliation_saved_view;
--rollback DROP TABLE IF EXISTS reconciliation_saved_view CASCADE;
