/**
 * Generates `scripts/db/dev-stage/seed.psql` from the shared test fixtures by running them through
 * the REAL pipeline and the REAL persistence layer, then dumping what the application actually
 * wrote.
 *
 * Why generated rather than hand-written: the previous seed was hand-written in 2026 and drifted
 * until it could no longer run at all (Issue #305) -- it modelled 13 of 48 tables, referenced
 * columns changeset 0022 had renamed, and predated multi-tenancy entirely. Nothing detected any of
 * that, because a hand-written INSERT has no relationship to the code that normally writes the row.
 *
 * The design closes that loop: every INSERT in the output came from
 * `PostgresReconciliationLifecycleStore` persisting a `runReconciliation` result. If the schema or
 * the writer changes, regenerating produces the new shape automatically; if the generator itself
 * breaks, it breaks loudly here rather than silently in a seed file nobody runs.
 *
 *   npx tsx scripts/generate-seed-sql.ts --database seedgen
 *
 * The target database is scratch space: it is migrated to the current changelog, populated, dumped,
 * and left behind for inspection. It is never the dev or stage database.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';

import { defaultReconciliationConfig } from '@recon/config';
import { runReconciliation, toRawTransactionRows, validateFile } from '@recon/core';
import {
  PostgresImportRunStore,
  PostgresImportValidationStore,
  PostgresReconciliationLifecycleStore,
  computeSha256Hex,
  createPostgresPool,
} from '@recon/persistence';

import {
  createAllExceptionsBankWorkbook,
  createAllExceptionsGlWorkbook,
} from '../packages/test-fixtures/src/exceptionScenarios';

const SEED_RUN_LABEL = 'Seed - January 2026 (all exception categories)';
const SEED_CORRELATION_ID = 'seed-all-exceptions';
const BANK_FILE_NAME = 'seed-bank-all-exceptions.xlsx';
const GL_FILE_NAME = 'seed-gl-all-exceptions.xlsx';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Bridges the row-array fixtures into `runReconciliation`'s input, mirroring
 * `packages/core/src/reconcile.test.ts`'s `buildRawRowsFromBuffers`.
 *
 * This deliberately goes through the File Validation Engine rather than fabricating
 * `RawTransactionRow`s: `toRawTransactionRows` repackages the raw cell values validation already
 * captured, so the rows the seed persists are a real re-derivation of the fixture workbooks rather
 * than synthetic data shaped to whatever the schema happens to want.
 */
const buildRawRowsFromBuffers = async (bankBuffer: Buffer, glBuffer: Buffer) => {
  const bankSourceFileId = randomUUID();
  const glSourceFileId = randomUUID();

  const [bankOutcome, glOutcome] = await Promise.all([
    validateFile({ bytes: bankBuffer, fileFormat: 'XLSX', fileType: 'BANK' }),
    validateFile({ bytes: glBuffer, fileFormat: 'XLSX', fileType: 'GL' }),
  ]);

  // These fixtures deliberately contain invalid rows -- that is how they produce exceptions. Only a
  // STRUCTURAL failure (never reaching CELL_VALUES) means the fixture headers themselves are wrong,
  // which is a generator bug rather than intended data.
  for (const [label, outcome] of [
    ['bank', bankOutcome],
    ['gl', glOutcome],
  ] as const) {
    if (!outcome.gatesRun.includes('CELL_VALUES')) {
      throw new Error(
        `${label} fixture failed structural validation: ${JSON.stringify(outcome.issues)}`,
      );
    }
  }

  const context = (sourceFileId: string, spreadsheetFileName: string) => ({
    runId: 'unused',
    sourceFileId,
    spreadsheetFileName,
    config: defaultReconciliationConfig,
  });

  const sourceFile = (id: string, source: 'bank' | 'gl', fileName: string, bytes: number) => ({
    id,
    source,
    fileName,
    mimeType: XLSX_MIME,
    sizeBytes: bytes,
    worksheetName: '',
    headerRow: 1,
    transactionStartRow: 2,
    excludedRowNumbers: [] as number[],
    uploadedAt: new Date(0).toISOString(),
  });

  return {
    sourceFiles: [
      sourceFile(bankSourceFileId, 'bank', BANK_FILE_NAME, bankBuffer.length),
      sourceFile(glSourceFileId, 'gl', GL_FILE_NAME, glBuffer.length),
    ],
    rawRows: [
      ...toRawTransactionRows(bankOutcome.normalized, context(bankSourceFileId, BANK_FILE_NAME)),
      ...toRawTransactionRows(glOutcome.normalized, context(glSourceFileId, GL_FILE_NAME)),
    ],
    validationIssues: { bank: bankOutcome.issues, gl: glOutcome.issues },
  };
};

export const buildSeedRun = async () => {
  const [bankBuffer, glBuffer] = await Promise.all([
    createAllExceptionsBankWorkbook(),
    createAllExceptionsGlWorkbook(),
  ]);

  const { sourceFiles, rawRows, validationIssues } = await buildRawRowsFromBuffers(
    bankBuffer,
    glBuffer,
  );

  const report = await runReconciliation({
    runId: randomUUID(),
    correlationId: SEED_CORRELATION_ID,
    sourceFiles,
    rawRows,
    config: defaultReconciliationConfig,
    accountIdentifier: 'OPERATING-001',
    periodLabel: 'January 2026',
  });

  return { report, sourceFiles, rawRows, validationIssues, bankBuffer, glBuffer };
};

/**
 * Persists one run through the real lifecycle store, in the same order the API's own request flow
 * uses (`app.ts` createJob, then `reconciliationService.ts` for the rest). Driving the real writer
 * is the entire point: the INSERT statements this script eventually emits are the ones the
 * application produces, so they cannot drift from the persistence layer the way a hand-written
 * seed does.
 */
const persistRun = async (
  store: InstanceType<typeof PostgresReconciliationLifecycleStore>,
  organizationId: string,
  jobId: string,
  run: Awaited<ReturnType<typeof buildSeedRun>>,
): Promise<void> => {
  const startedAt = new Date('2026-01-31T09:00:00.000Z').toISOString();
  const completedAt = new Date('2026-01-31T09:05:00.000Z').toISOString();

  await store.createJob({
    jobId,
    correlationId: SEED_CORRELATION_ID,
    startedAt,
    rulepackVersion: '1.0.0',
    organizationId,
    accountIdentifier: 'OPERATING-001',
    periodLabel: 'January 2026',
    reconciliationFrequency: 'Monthly',
    inputFingerprint: 'seed-all-exceptions-fingerprint',
    sourceFiles: run.sourceFiles.map((file) => ({
      id: file.id,
      sourceSystem: file.source,
      sourceFormat: 'xlsx' as const,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: computeSha256Hex(file.source === 'bank' ? run.bankBuffer : run.glBuffer),
      uploadedAt: file.uploadedAt,
      content: file.source === 'bank' ? run.bankBuffer : run.glBuffer,
      ingestionMode: 'DIRECT' as const,
    })),
  });

  await store.persistParsedRows(organizationId, jobId, run.sourceFiles, run.rawRows);
  await store.persistNormalizedRows(organizationId, jobId, run.report.normalizedTransactions);
  await store.persistMatchingArtifacts(organizationId, {
    jobId,
    matchResults: run.report.matchResults,
    probableMatches: run.report.probableMatches,
    groupedMatchResults: run.report.groupedMatchResults,
  });
  await store.persistReviewArtifacts(organizationId, {
    jobId,
    exceptions: run.report.exceptions,
    reviewerObservations: run.report.reviewerObservations,
    summary: run.report.summary,
  });
  await store.persistExportAndFinalize(organizationId, {
    jobId,
    outputWorkbook: run.report.outputWorkbook,
    completedAt,
  });
};


const OUTPUT_PATH = path.resolve(process.cwd(), 'scripts', 'db', 'dev-stage', 'seed.psql');

/** Tables the seed must never write. The two Liquibase tables are the schema's own bookkeeping --
 *  a seed that inserted into them would be claiming migrations ran that did not. The other three
 *  are owned elsewhere: `validation_rule_version` by changesets 0047/0071,
 *  `reconciliation_organization` by 0026/0028, and `reconciliation_user` by create-users.psql. */
const EXCLUDED_TABLES = [
  'databasechangelog',
  'databasechangeloglock',
  'validation_rule_version',
  'reconciliation_organization',
  'reconciliation_user',
];

interface SchemaFingerprint {
  appliedChangesets: number;
  latestChangeset: string;
  changesetDigest: string;
}

const readSchemaFingerprint = async (pool: ReturnType<typeof createPostgresPool>) => {
  const result = await pool.query<SchemaFingerprint>(
    `SELECT count(*)::int AS "appliedChangesets",
            (SELECT id FROM databasechangelog ORDER BY orderexecuted DESC LIMIT 1) AS "latestChangeset",
            md5(string_agg(id, ',' ORDER BY id)) AS "changesetDigest"
       FROM databasechangelog`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('databasechangelog is empty -- target database is not migrated.');
  return row;
};

const runPgDump = (container: string, database: string): string =>
  execFileSync(
    'docker',
    [
      'exec', container,
      'pg_dump', '-U', 'recon_app', '-d', database,
      '--data-only', '--column-inserts', '--on-conflict-do-nothing',
      ...EXCLUDED_TABLES.flatMap((table) => ['--exclude-table', table]),
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );


/**
 * Columns whose values are surrogate sequence keys, meaningful only inside the database that
 * generated them. pg_dump emits them as literals, which silently collides with rows already in the
 * target: verified on a real dev database, where 20 canonical_record rows and 5 audit events were
 * DROPPED by `ON CONFLICT DO NOTHING` because their dumped ids already existed. The seed reported
 * success while losing 25 rows.
 *
 * None of these is the target of a foreign key (verified against pg_constraint), so omitting the
 * column lets the sequence assign a fresh value and the row always lands.
 */
const SEQUENCE_COLUMNS: Record<string, string> = {
  'public.canonical_record': 'id',
  'public.reconciliation_audit_event': 'event_id',
  'public.validation_issue': 'id',
};

/** Splits a pg_dump VALUES tuple on top-level commas, respecting single-quoted strings and their
 *  doubled-quote escaping. Runs BEFORE UUID substitution, so every value is still a plain literal
 *  and no parentheses from injected subqueries are in play. */
const splitValues = (tuple: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;

  for (let index = 0; index < tuple.length; index += 1) {
    const char = tuple[index];
    if (inQuote) {
      if (char === "'" && tuple[index + 1] === "'") {
        current += "''";
        index += 1;
        continue;
      }
      if (char === "'") inQuote = false;
      current += char;
      continue;
    }
    if (char === "'") {
      inQuote = true;
      current += char;
      continue;
    }
    if (char === ',') {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts;
};

const stripSequenceColumns = (dump: string): { sql: string; stripped: Record<string, number> } => {
  const stripped: Record<string, number> = {};

  const sql = dump.replace(
    /^INSERT INTO (\S+) \(([^)]*)\) VALUES \((.*)\)( ON CONFLICT DO NOTHING)?;$/gm,
    (whole, table: string, columnList: string, valueList: string, suffix: string | undefined) => {
      const target = SEQUENCE_COLUMNS[table];
      if (!target) return whole;

      const columns = columnList.split(',').map((column) => column.trim());
      const position = columns.indexOf(target);
      if (position === -1) return whole;

      const values = splitValues(valueList);
      if (values.length !== columns.length) {
        throw new Error(
          `${table}: parsed ${values.length} values for ${columns.length} columns -- splitter is wrong, refusing to emit a corrupted seed`,
        );
      }

      columns.splice(position, 1);
      values.splice(position, 1);
      stripped[table] = (stripped[table] ?? 0) + 1;
      return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})${suffix ?? ''};`;
    },
  );

  return { sql, stripped };
};

/**
 * Rewrites the environment-specific UUIDs pg_dump emits as literals into lookups resolved at run
 * time. Without this the file is not portable: `reconciliation_organization`,
 * `reconciliation_user` and `validation_rule_version` all get their ids from `gen_random_uuid()`
 * in migrations or `create-users.psql`, so the same logical row has a DIFFERENT id in every
 * database. Verified: 'AP_AMOUNT_FORMAT' is 89a3c984... in one database and f09e6883... in another.
 */
const makePortable = (
  dump: string,
  substitutions: Array<{ uuid: string; replacement: string; label: string }>,
): { sql: string; applied: Array<{ label: string; count: number }> } => {
  let sql = dump;
  const applied = substitutions.map(({ uuid, replacement, label }) => {
    const count = sql.split(`'${uuid}'`).length - 1;
    sql = sql.split(`'${uuid}'`).join(replacement);
    return { label, count };
  });
  return { sql, applied };
};


const buildSeedFile = (input: {
  fingerprint: SchemaFingerprint;
  generatedAt: string;
  body: string;
  stats: Record<string, number>;
}): string => {
  const { fingerprint, generatedAt, body, stats } = input;

  return `-- =============================================================================
-- DEV AND STAGE ENVIRONMENTS ONLY -- DO NOT RUN IN PRODUCTION.
--
-- GENERATED FILE -- do not edit by hand. Regenerate with:
--
--     npx tsx scripts/generate-seed-sql.ts --database seedgen
--
-- PROVENANCE
--   generated at ......... ${generatedAt}
--   schema changesets .... ${fingerprint.appliedChangesets} applied
--   latest changeset ..... ${fingerprint.latestChangeset}
--   changeset digest ..... ${fingerprint.changesetDigest}
--
-- Every INSERT below was produced by running the shared test fixtures through the REAL pipeline
-- (\`runReconciliation\`) and the REAL persistence layer (\`PostgresReconciliationLifecycleStore\`,
-- \`PostgresImportRunStore\`, \`PostgresImportValidationStore\`), then dumping what the application
-- actually wrote. Nothing here is hand-authored, which is the point: the previous seed was, and it
-- drifted until it could no longer run at all (Issue #305).
--
-- CONTENTS
${Object.entries(stats)
  .map(([k, v]) => `--   ${k.padEnd(24, '.')} ${v}`)
  .join('\n')}
--
-- WHAT IS DELIBERATELY NOT HERE
--   * databasechangelog / databasechangeloglock -- the schema's own bookkeeping. This file never
--     reads or writes them except for the read-only version assertion below.
--   * validation_rule_version -- owned by changesets 0047/0071.
--   * reconciliation_organization -- owned by changesets 0026/0028.
--   * reconciliation_user -- owned by scripts/db/dev-stage/create-users.psql. Run that first.
--   * InvalidOrMissingData exceptions -- that category has no producer in the current pipeline
--     (see packages/core/src/reconcile.test.ts:205 and Issue #137). 30 of 31 categories appear.
-- =============================================================================

\\set ON_ERROR_STOP on

-- ── Schema version assertion ────────────────────────────────────────────────
-- READ-ONLY on databasechangelog. This file was generated against a specific schema; running it
-- against a different one is how the previous seed silently half-applied. Refuse instead.
DO \$\$
DECLARE
  actual_count integer;
  actual_digest text;
BEGIN
  SELECT count(*), md5(string_agg(id, ',' ORDER BY id))
    INTO actual_count, actual_digest
    FROM databasechangelog;

  IF actual_count <> ${fingerprint.appliedChangesets} OR actual_digest <> '${fingerprint.changesetDigest}' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'seed.psql was generated for a different schema version',
      DETAIL  = format('expected %s changesets (digest %s); this database has %s (digest %s)',
                       ${fingerprint.appliedChangesets}, '${fingerprint.changesetDigest}',
                       actual_count, actual_digest),
      HINT    = 'Run migrations, then regenerate: npx tsx scripts/generate-seed-sql.ts';
  END IF;
END
\$\$;

-- ── Resolve environment-specific ids ────────────────────────────────────────
-- These are gen_random_uuid() values, different in every database, so they are resolved by name
-- rather than baked in as literals.
SELECT id AS seed_org_id FROM reconciliation_organization WHERE name = 'Default Organization' \\gset

\\if :{?seed_org_id}
\\else
\\echo 'ERROR: no organization named ''Default Organization'' -- is this database migrated?'
\\quit 1
\\endif

-- ── Atomic from here ────────────────────────────────────────────────────────
-- Teardown and reinsert are ONE transaction. Without this, ON_ERROR_STOP aborts the run but the
-- rows already inserted stay: verified by injecting a failure 226 INSERTs in, which left 66
-- canonical rows, 66 raw rows, a job and 7 exceptions behind -- a half-seeded database that
-- reports failure but cannot be re-run cleanly. With the transaction, the same injected failure
-- leaves the database exactly as it started.
--
-- The schema assertion and the organization lookup above stay OUTSIDE the transaction on purpose:
-- both are read-only, and failing them should stop the script before it has opened one.
BEGIN;

-- ── Teardown ────────────────────────────────────────────────────────────────
-- Removes everything a previous run of THIS file inserted, leaving no orphans. Order is dictated
-- by the live FK graph, not by convenience:
--   1. reconciliation_run first -- reconciliation_run.matching_job_id -> reconciliation_job is
--      ON DELETE NO ACTION, so deleting the job first would error. Cascades import_job,
--      canonical_record, run_source_file and validation_issue.
--   2. reconciliation_job -- cascades the matching artifacts (raw rows, canonical rows, matches,
--      rule results, exceptions, observations, summary, export, audit events).
--   3. import_file last -- nothing cascades to it (it hangs off the organization, not the run),
--      and run_source_file -> import_file is ON DELETE NO ACTION, so its children must be gone
--      first. Cascades import_file_content.
-- Matched by STABLE identity (run label, job correlation_id, original filenames) rather than by
-- the UUIDs of this particular generation. Regenerating mints new UUIDs, so an id-based teardown
-- could not clean up rows a PREVIOUS generation inserted -- it would silently leave a full
-- duplicate run behind. These three predicates survive regeneration.
-- Verified against a populated database: these three statements leave 0 rows across all 21 tables.
DELETE FROM reconciliation_run WHERE label = '${SEED_RUN_LABEL}';
DELETE FROM reconciliation_job WHERE correlation_id = '${SEED_CORRELATION_ID}';
DELETE FROM import_file WHERE original_filename IN ('${BANK_FILE_NAME}', '${GL_FILE_NAME}');

-- ── Data ────────────────────────────────────────────────────────────────────
${body}

COMMIT;
`;
};

const ASSUMED_CURRENCY_CODE = 'USD';

/**
 * Drives the File-Validation import pipeline, which is a SEPARATE store from the matching
 * lifecycle and writes the tables the old seed never touched at all: reconciliation_run,
 * import_file, import_file_content, run_source_file, import_job, canonical_record,
 * validation_issue.
 *
 * The final `recordMatchingJobId` call is what links reconciliation_run.matching_job_id to the
 * reconciliation_job persisted by the matching half. That FK is ON DELETE NO ACTION, so it also
 * dictates teardown order: the run must be deleted before the job it points at.
 */
const persistImportRun = async (
  runStore: InstanceType<typeof PostgresImportRunStore>,
  validationStore: InstanceType<typeof PostgresImportValidationStore>,
  organizationId: string,
  matchingJobId: string,
  run: Awaited<ReturnType<typeof buildSeedRun>>,
): Promise<{ runId: string; importJobId: string }> => {
  const summary = await runStore.createRun({
    organizationId,
    label: SEED_RUN_LABEL,
    accountIdentifier: 'OPERATING-001',
    frequency: 'MONTHLY',
    periodYear: 2026,
    periodMonth: 1,
    files: [
      {
        role: 'BANK_STATEMENT',
        sourceType: 'BANK',
        originalFilename: BANK_FILE_NAME,
        fileFormat: 'XLSX',
        bytes: run.bankBuffer,
      },
      {
        role: 'GENERAL_LEDGER',
        sourceType: 'GL',
        originalFilename: GL_FILE_NAME,
        fileFormat: 'XLSX',
        bytes: run.glBuffer,
      },
    ],
  });

  const submitted = await validationStore.submitRun(organizationId, summary.id, 'rray');
  if (submitted.outcome !== 'submitted') {
    throw new Error(`submitRun refused the seed run: ${JSON.stringify(submitted)}`);
  }
  const importJobId = submitted.importJobId;
  await validationStore.markJobRunning(organizationId, importJobId, 'seed-generator');

  const ruleVersionIds = await validationStore.loadActiveValidationRuleVersionIds(organizationId);

  for (const file of summary.files) {
    const isBank = file.sourceType === 'BANK';
    const outcome = await validateFile({
      bytes: isBank ? run.bankBuffer : run.glBuffer,
      fileFormat: 'XLSX',
      fileType: isBank ? 'BANK' : 'GL',
    });

    await validationStore.recordFileValidationOutcome(
      organizationId,
      {
        importJobId,
        importFileId: file.importFileId,
        reconciliationRunId: summary.id,
        totalRowCount: outcome.totalRowCount,
        issues: outcome.issues,
        normalized: outcome.normalized.map((record) => ({
          sourceType: record.sourceSystem,
          recordId: record.recordId,
          account: record.account ?? '',
          date: record.date,
          currencyCode: ASSUMED_CURRENCY_CODE,
          signedAmount: record.signedAmount,
          direction: record.direction,
          magnitude: record.magnitude,
          description: record.description,
          reference: record.referenceNumber ?? record.checkNumber,
          sourceLineNumber: record.sourceLineNumber,
          raw: record.raw,
        })),
      },
      ruleVersionIds,
    );
  }

  await validationStore.finalizeRun(organizationId, summary.id, importJobId, { passed: true });
  await validationStore.recordMatchingJobId(organizationId, summary.id, matchingJobId);

  return { runId: summary.id, importJobId };
};

const main = async () => {
  const databaseFlagIndex = process.argv.indexOf('--database');
  const databaseName =
    databaseFlagIndex >= 0 ? (process.argv[databaseFlagIndex + 1] ?? 'seedgen') : 'seedgen';
  const connectionString =
    process.env.SEEDGEN_DATABASE_URL ??
    `postgresql://recon_app:${process.env.POSTGRES_PASSWORD ?? 'recon_app'}@127.0.0.1:5432/${databaseName}`;

  const run = await buildSeedRun();
  const pool = createPostgresPool({ connectionString });

  try {
    const orgResult = await pool.query<{ id: string }>(
      "SELECT id FROM reconciliation_organization WHERE name = 'Default Organization'",
    );
    const organizationId = orgResult.rows[0]?.id;
    if (!organizationId) {
      throw new Error("No 'Default Organization' in the target database -- is it migrated?");
    }

    // The generator is re-runnable: clear anything a previous generation left in the scratch
    // database, in the same FK-dictated order the emitted teardown uses (run -> job -> import_file).
    await pool.query('DELETE FROM reconciliation_run');
    await pool.query('DELETE FROM reconciliation_job');
    await pool.query('DELETE FROM import_file');

    const store = new PostgresReconciliationLifecycleStore(pool);
    const jobId = randomUUID();
    await persistRun(store, organizationId, jobId, run);

    const importRun = await persistImportRun(
      new PostgresImportRunStore(pool),
      new PostgresImportValidationStore(pool),
      organizationId,
      jobId,
      run,
    );

    const byCategory = new Map<string, number>();
    for (const item of run.report.exceptions) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
    }

    console.log('  database ................', databaseName);
    console.log('  matching job ............', jobId);
    console.log('  import run ..............', importRun.runId);
    console.log('  import job ..............', importRun.importJobId);
    console.log('  raw rows ................', run.rawRows.length);
    console.log('  normalized ..............', run.report.normalizedTransactions.length);
    console.log('  match results ...........', run.report.matchResults.length);
    console.log('  probable matches ........', run.report.probableMatches.length);
    console.log('  grouped matches .........', run.report.groupedMatchResults.length);
    console.log('  exceptions ..............', run.report.exceptions.length);
    console.log('  distinct categories .....', byCategory.size);

    // --- emit -------------------------------------------------------------
    const container = process.env.SEEDGEN_CONTAINER ?? 'reconciliation-platform-dev-postgres-1';
    const fingerprint = await readSchemaFingerprint(pool);

    const userRow = await pool.query<{ id: string }>(
      "SELECT id FROM reconciliation_user WHERE user_name = 'rray'",
    );
    const ruleRows = await pool.query<{ id: string; rule_code: string }>(
      'SELECT id, rule_code FROM validation_rule_version',
    );
    const fileRows = await pool.query<{ id: string }>('SELECT id FROM import_file');

    const substitutions = [
      { uuid: organizationId, replacement: ":'seed_org_id'", label: 'organization_id' },
      ...(userRow.rows[0]
        ? [
            {
              uuid: userRow.rows[0].id,
              replacement:
                "(SELECT id FROM public.reconciliation_user WHERE user_name = 'rray')",
              label: 'user rray',
            },
          ]
        : []),
      ...ruleRows.rows.map((rule) => ({
        uuid: rule.id,
        replacement: `(SELECT id FROM public.validation_rule_version WHERE rule_code = '${rule.rule_code}' AND status = 'ACTIVE' ORDER BY version_number DESC LIMIT 1)`,
        label: `rule ${rule.rule_code}`,
      })),
    ];

    const dump = runPgDump(container, databaseName);
    const { sql: withoutSequences, stripped } = stripSequenceColumns(dump);
    const { sql: body, applied } = makePortable(withoutSequences, substitutions);
    const substituted = applied.filter((entry) => entry.count > 0);

    const seedFile = buildSeedFile({
      fingerprint,
      generatedAt: new Date().toISOString(),
      body,
      stats: {
        'raw rows': run.rawRows.length,
        'canonical rows': run.report.normalizedTransactions.length,
        'match results': run.report.matchResults.length,
        'probable matches': run.report.probableMatches.length,
        'grouped matches': run.report.groupedMatchResults.length,
        exceptions: run.report.exceptions.length,
        'exception categories': byCategory.size,
        'INSERT statements': (body.match(/^INSERT INTO/gm) ?? []).length,
      },
    });

    writeFileSync(OUTPUT_PATH, seedFile, 'utf8');
    // Tool-written files land at 0600 here, which breaks the Docker bind mount the runner uses.
    chmodSync(OUTPUT_PATH, 0o644);

    console.log('');
    console.log('  wrote ...................', path.relative(process.cwd(), OUTPUT_PATH));
    console.log('  INSERT statements .......', (body.match(/^INSERT INTO/gm) ?? []).length);
    console.log('  schema ..................', `${fingerprint.appliedChangesets} changesets @ ${fingerprint.latestChangeset}`);
    for (const entry of substituted) {
      console.log(`  portable: ${entry.label.padEnd(24, '.')} ${entry.count}`);
    }
    for (const [table, count] of Object.entries(stripped)) {
      console.log(`  sequence col stripped: ${table.replace('public.', '').padEnd(28, '.')} ${count}`);
    }
  } finally {
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
