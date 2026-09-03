import { Client } from 'pg';

/**
 * Deletes every reconciliation run belonging to this worker's organization.
 *
 * The Import Files screen behaves differently once its organization has a terminal run, and the
 * difference is not cosmetic. `durableRunPhase` is fetched from the server on each page load
 * (App.tsx's mount-time getLatestImportRunRequest), so in the succeeded phase the screen renders
 * its post-run shape: the submit button relabels to "Start new run", and the mount-time hydration
 * does noticeably more work (it fetches the latest run, then that run's full report).
 *
 * Empirically that extra in-flight work is what makes a programmatic `setInputFiles` on the first
 * bank slot go missing under parallel load -- traced directly: the slot reads "No file selected"
 * immediately after the upload call returns, so the file is never assigned rather than assigned
 * and cleared. The tests then cannot submit, and previously waited out a full timeout on a Review
 * stage assertion that had nothing to do with the real fault.
 *
 * Per-worker organizations (see auth.ts's resolveWorkerCredential) remove the cross-worker version
 * of this, but not this one: one worker runs several spec files in sequence against its own
 * organization, so any earlier run leaves every later test in the post-run phase. Resetting before
 * each test makes every test start from the pre-run state it was written against.
 *
 * DELETE on reconciliation_run cascades to import_job (and through it canonical_record and
 * validation_issue), reconciliation_run_account, reconciliation_run_event, run_source_file and
 * reconciliation_period_rollforward; reconciliation_open_item is ON DELETE SET NULL. Verified
 * against the live schema's foreign keys, so this is one statement rather than a delete order.
 */
export const resetRunsForWorker = async (): Promise<void> => {
  const slot = process.env.TEST_PARALLEL_INDEX?.trim();

  // Outside a per-worker organization there is nothing safe to target: every other scope is shared
  // with workers still using it, so deleting would race them. Callers degrade to the previous
  // (order-dependent) behaviour rather than corrupting a concurrent run.
  if (!slot || !/^\d+$/.test(slot)) {
    return;
  }

  const connectionString = process.env.DATABASE_URL;

  // Deliberately loud. A skipped reset does not fail here -- it fails later as a 30s timeout on an
  // unrelated-looking assertion, which is exactly the diagnosis this helper exists to prevent.
  if (!connectionString) {
    throw new Error(
      'resetRunsForWorker requires DATABASE_URL. The e2e lanes set it (compose.e2e.yaml, ' +
        'docker-validate.yml); set it too when running these specs outside those lanes.',
    );
  }

  const organizationName = `E2E Worker ${slot}`;
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const org = await client.query<{ id: string }>(
      'SELECT id FROM reconciliation_organization WHERE name = $1',
      [organizationName],
    );

    if (org.rowCount === 0) {
      throw new Error(
        `No organization named "${organizationName}". Apply ` +
          'scripts/db/dev-stage/create-e2e-orgs.psql (both e2e lanes run it after create-users.psql).',
      );
    }

    const organizationId = org.rows[0]!.id;

    // reconciliation_run has RLS enabled, and its policy is
    //   organization_id = current_setting('app.current_organization_id', true)::uuid
    // With missing_ok = true an unset setting yields NULL, so every row fails the predicate and a
    // DELETE removes NOTHING while still reporting success -- the connection here is app_user, the
    // least-privilege runtime role the policy applies to (the table's owner, recon_app, would
    // bypass it, but borrowing owner credentials to sidestep tenant isolation in a test helper is
    // exactly the habit that lets a real isolation bug hide). Set the tenant context instead, the
    // same way the application does.
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'app.current_organization_id',
      organizationId,
    ]);
    await client.query('DELETE FROM reconciliation_run WHERE organization_id = $1', [
      organizationId,
    ]);

    // Prove it. A reset that silently removes nothing is worse than no reset: it reports success
    // and the failure resurfaces later as a 30-second timeout on an unrelated-looking assertion.
    const remaining = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM reconciliation_run WHERE organization_id = $1',
      [organizationId],
    );
    await client.query('COMMIT');

    if (remaining.rows[0]!.count !== '0') {
      throw new Error(
        `resetRunsForWorker left ${remaining.rows[0]!.count} run(s) on "${organizationName}". ` +
          'The DELETE is being filtered -- check the RLS tenant context above.',
      );
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};
