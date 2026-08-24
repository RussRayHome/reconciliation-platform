/**
 * Sets `reconciliation_organization.carry_forward_enabled` for one organization -- the only
 * admin surface for Unreconciled Item Roll-Forward PR C.5's per-organization enablement until a
 * real API endpoint + UI exists (per the change document's own C.5.5). Deliberately requires
 * --actor: the column must not be changed without a record of who did it and when, and this
 * script's own stdout output (organization, before/after state, actor, timestamp) plus the
 * `carry_forward_enabled_at` column it stamps are that record -- an ad hoc `psql -c "UPDATE ..."`
 * against production would leave neither.
 *
 * Usage:
 *   tsx scripts/ops/set-carry-forward-enabled.ts <organization-name> <enable|disable> --actor <username>
 *
 * Connects via DATABASE_URL (same convention as the rest of the app -- see .env.example).
 */
import { createPostgresPool } from '@recon/persistence';

const usage = [
  'Usage: tsx scripts/ops/set-carry-forward-enabled.ts <organization-name> <enable|disable> --actor <username>',
  '',
  'Sets reconciliation_organization.carry_forward_enabled for one organization, by name.',
  '--actor is required -- this is a production-reachable admin action and must be attributable.',
].join('\n');

interface ParsedArgs {
  organizationName: string;
  enabled: boolean;
  actor: string;
}

const parseArgs = (argv: string[]): ParsedArgs | null => {
  const organizationName = argv[0];
  const action = argv[1];
  const actorFlagIndex = argv.indexOf('--actor');
  const actor = actorFlagIndex >= 0 ? argv[actorFlagIndex + 1] : undefined;

  if (!organizationName || (action !== 'enable' && action !== 'disable') || !actor) {
    return null;
  }

  return { organizationName, enabled: action === 'enable', actor };
};

const main = async (): Promise<void> => {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    process.exitCode = 1;
    return;
  }

  const pool = createPostgresPool({ connectionString });

  try {
    const before = await pool.query<{ id: string; carry_forward_enabled: boolean }>(
      'SELECT id, carry_forward_enabled FROM reconciliation_organization WHERE name = $1',
      [parsed.organizationName],
    );
    const organization = before.rows[0];
    if (!organization) {
      console.error(`No organization named "${parsed.organizationName}" found.`);
      process.exitCode = 1;
      return;
    }

    const result = await pool.query<{ carry_forward_enabled: boolean; carry_forward_enabled_at: string | null }>(
      `UPDATE reconciliation_organization
          SET carry_forward_enabled = $2,
              carry_forward_enabled_at = CASE WHEN $2 THEN NOW() ELSE carry_forward_enabled_at END
        WHERE id = $1
        RETURNING carry_forward_enabled, carry_forward_enabled_at`,
      [organization.id, parsed.enabled],
    );
    const after = result.rows[0]!;

    console.log(
      JSON.stringify({
        action: 'ops.carryForward.setEnabled',
        organizationName: parsed.organizationName,
        organizationId: organization.id,
        actor: parsed.actor,
        before: organization.carry_forward_enabled,
        after: after.carry_forward_enabled,
        carryForwardEnabledAt: after.carry_forward_enabled_at,
        at: new Date().toISOString(),
      }),
    );
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
