import type { Pool } from 'pg';

/**
 * Liquibase's own bookkeeping tables are created by the tool, not by our changesets, so they are
 * not part of the schema contract this baseline pins.
 */
const IGNORED_TABLES = new Set(['databasechangelog', 'databasechangeloglock']);

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const sqlArray = (values: string[]): string => `ARRAY[${values.map(quote).join(', ')}]::name[]`;

interface ColumnRow {
  table_name: string;
  column_name: string;
  column_type: string;
  not_null: boolean;
}

interface ConstraintRow {
  table_name: string;
  constraint_name: string;
  definition: string;
}

interface ForeignKeyRow {
  table_name: string;
  columns: string[];
  foreign_table: string;
  foreign_columns: string[];
}

interface IndexRow {
  table_name: string;
  index_name: string;
}

interface PrimaryKeyRow {
  table_name: string;
  columns: string[];
}

interface GrantRow {
  table_name: string;
  grantee: string;
  privileges: string;
}

interface PolicyRow {
  table_name: string;
  policy_name: string;
  cmd: string;
  // Rendered as text in SQL (array_to_string) rather than left as pg_policies.roles' native
  // `name[]` type -- node-postgres has no built-in array parser registered for the `name` OID, so
  // the driver would otherwise hand back the raw literal ('{public}') instead of a JS array.
  roles: string;
  using_expr: string | null;
  with_check_expr: string | null;
}

interface DefaultRow {
  table_name: string;
  column_name: string;
  default_expr: string;
}

interface FunctionRow {
  function_name: string;
  arguments: string;
  return_type: string;
  language: string;
}

interface TriggerRow {
  table_name: string;
  trigger_name: string;
  definition: string;
}

interface ViewRow {
  view_name: string;
  definition: string;
}

const groupBy = <T>(rows: T[], key: (row: T) => string): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(key(row), [row]);
    }
  }
  return grouped;
};

/**
 * Introspects the live schema and renders it as a pgTap script.
 *
 * Assertion choice matters here: `tables_are` / `columns_are` / `indexes_are` assert an *exact*
 * set, so an object added without updating the baseline fails just as loudly as one removed.
 * Per-object `has_*` assertions alone would silently accept additions, which is the failure mode
 * that lets schema drift accumulate unnoticed.
 */
export const generateSchemaBaseline = async (pool: Pool): Promise<string> => {
  const { rows: columnRows } = await pool.query<ColumnRow>(
    `SELECT c.relname AS table_name,
            a.attname AS column_name,
            format_type(a.atttypid, a.atttypmod) AS column_type,
            a.attnotnull AS not_null
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum`,
  );

  const { rows: primaryKeyRows } = await pool.query<PrimaryKeyRow>(
    `SELECT c.relname AS table_name,
            (SELECT array_agg(att.attname::text ORDER BY k.ord)
               FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute att
                 ON att.attrelid = con.conrelid AND att.attnum = k.attnum) AS columns
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype = 'p' AND n.nspname = 'public'
      ORDER BY c.relname`,
  );

  const { rows: foreignKeyRows } = await pool.query<ForeignKeyRow>(
    `SELECT src.relname AS table_name,
            (SELECT array_agg(att.attname::text ORDER BY k.ord)
               FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute att
                 ON att.attrelid = con.conrelid AND att.attnum = k.attnum) AS columns,
            tgt.relname AS foreign_table,
            (SELECT array_agg(att.attname::text ORDER BY k.ord)
               FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute att
                 ON att.attrelid = con.confrelid AND att.attnum = k.attnum) AS foreign_columns
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid
       JOIN pg_class tgt ON tgt.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = src.relnamespace
      WHERE con.contype = 'f' AND n.nspname = 'public'
      ORDER BY src.relname, con.conname`,
  );

  const { rows: indexRows } = await pool.query<IndexRow>(
    `SELECT tablename AS table_name, indexname AS index_name
       FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname`,
  );

  // CHECK, UNIQUE, and EXCLUSION constraints together. UNIQUE has to be here rather than left to
  // `indexes_are`: that assertion compares index *names*, so widening
  // UNIQUE (organization_id, name) to UNIQUE (organization_id, name, source_type) under the same
  // constraint name is invisible to it. Comparing rendered definitions catches the columns.
  // PRIMARY KEY and FOREIGN KEY are already covered by col_is_pk and fk_ok.
  const { rows: checkRows } = await pool.query<ConstraintRow>(
    `SELECT c.relname AS table_name,
            con.conname AS constraint_name,
            pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE con.contype IN ('c', 'u', 'x') AND n.nspname = 'public'
      ORDER BY c.relname, con.conname`,
  );

  // Excludes the schema owner (whichever role actually ran the migrations -- `recon` in the
  // testcontainers harness, `recon_app` in a real deployment) rather than a hardcoded role name:
  // the owner has implicit ALL PRIVILEGES that isn't itself something a changeset granted, and
  // that role's name differs between environments.
  const { rows: grantRows } = await pool.query<GrantRow>(
    `SELECT c.relname AS table_name,
            p.grantee AS grantee,
            string_agg(DISTINCT p.privilege_type, ',' ORDER BY p.privilege_type) AS privileges
       FROM information_schema.table_privileges p
       JOIN pg_class c ON c.relname = p.table_name
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.table_schema
      WHERE p.table_schema = 'public'
        AND p.grantee <> (SELECT rolname FROM pg_roles WHERE oid = c.relowner)
      GROUP BY c.relname, p.grantee
      ORDER BY c.relname, p.grantee`,
  );

  // ADR-0001: every RLS-enabled table is expected to carry exactly one tenant-isolation policy.
  // Comparing the rendered USING/WITH CHECK expressions (not just the policy's existence) is what
  // catches a predicate quietly weakened from `organization_id = current_setting(...)` to
  // something looser.
  const { rows: policyRows } = await pool.query<PolicyRow>(
    `SELECT tablename AS table_name,
            policyname AS policy_name,
            cmd,
            array_to_string(roles, ',') AS roles,
            qual AS using_expr,
            with_check AS with_check_expr
       FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname`,
  );

  const { rows: defaultRows } = await pool.query<DefaultRow>(
    `SELECT c.relname AS table_name,
            a.attname AS column_name,
            pg_get_expr(d.adbin, d.adrelid) AS default_expr
       FROM pg_attrdef d
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       JOIN pg_class c ON c.oid = d.adrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY c.relname, a.attname`,
  );

  // Extension-owned functions (pgcrypto, pgaudit, ...) are excluded via pg_depend rather than by
  // name -- they live in `public` too, but their set is a function of which extensions are
  // installed, not something a changeset in this repo defines. Including them would make this
  // baseline fail on an unrelated extension/Postgres version bump instead of a real schema change.
  const { rows: functionRows } = await pool.query<FunctionRow>(
    `SELECT p.proname AS function_name,
            pg_get_function_identity_arguments(p.oid) AS arguments,
            pg_get_function_result(p.oid) AS return_type,
            l.lanname AS language
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
        AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.objid = p.oid AND dep.deptype = 'e')
      ORDER BY p.proname, arguments`,
  );

  const { rows: triggerRows } = await pool.query<TriggerRow>(
    `SELECT c.relname AS table_name,
            t.tgname AS trigger_name,
            pg_get_triggerdef(t.oid) AS definition
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT t.tgisinternal
        AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.objid = t.oid AND dep.deptype = 'e')
      ORDER BY c.relname, t.tgname`,
  );

  const { rows: viewRows } = await pool.query<ViewRow>(
    `SELECT c.relname AS view_name,
            pg_get_viewdef(c.oid) AS definition
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'v'
        AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.objid = c.oid AND dep.deptype = 'e')
      ORDER BY c.relname`,
  );

  const keep = <T extends { table_name: string }>(rows: T[]): T[] =>
    rows.filter((row) => !IGNORED_TABLES.has(row.table_name));

  const columns = keep(columnRows);
  const primaryKeys = keep(primaryKeyRows);
  const foreignKeys = keep(foreignKeyRows);
  const indexes = keep(indexRows);
  const checks = keep(checkRows);
  const grants = keep(grantRows);
  const policies = keep(policyRows);
  const defaults = keep(defaultRows);
  const triggers = keep(triggerRows);

  // `tables_are` asserts an exact set against what actually exists, so the inventory has to
  // include Liquibase's own bookkeeping tables even though the per-table assertions below skip
  // them. A Liquibase upgrade that adds a tracking table should fail this loudly rather than
  // slip through.
  const allTableNames = [...new Set(columnRows.map((row) => row.table_name))].sort();
  const tableNames = [...new Set(columns.map((row) => row.table_name))].sort();
  const columnsByTable = groupBy(columns, (row) => row.table_name);
  const indexesByTable = groupBy(indexes, (row) => row.table_name);
  const checksByTable = groupBy(checks, (row) => row.table_name);
  const grantsByTable = groupBy(grants, (row) => row.table_name);
  const policiesByTable = groupBy(policies, (row) => row.table_name);
  const defaultsByColumn = new Map(defaults.map((row) => [`${row.table_name}.${row.column_name}`, row.default_expr]));
  const triggersByTable = groupBy(triggers, (row) => row.table_name);
  const primaryKeyByTable = new Map(primaryKeys.map((row) => [row.table_name, row.columns]));

  const assertions: string[] = [];

  assertions.push(
    `SELECT tables_are('public', ${sqlArray(allTableNames)}, 'public schema contains exactly the expected tables');`,
  );

  for (const table of tableNames) {
    const tableColumns = columnsByTable.get(table) ?? [];
    assertions.push(
      `SELECT columns_are('public', ${quote(table)}, ${sqlArray(tableColumns.map((row) => row.column_name))}, ${quote(`${table} has exactly the expected columns`)});`,
    );

    const primaryKeyColumns = primaryKeyByTable.get(table);
    assertions.push(
      primaryKeyColumns
        ? `SELECT col_is_pk('public', ${quote(table)}, ${sqlArray(primaryKeyColumns)}, ${quote(`${table} primary key`)});`
        : `SELECT hasnt_pk('public', ${quote(table)}, ${quote(`${table} has no primary key`)});`,
    );

    assertions.push(
      `SELECT indexes_are('public', ${quote(table)}, ${sqlArray((indexesByTable.get(table) ?? []).map((row) => row.index_name))}, ${quote(`${table} has exactly the expected indexes`)});`,
    );

    // ADR-0001 step 7: "tenant-scoped" is defined structurally here, not by a maintained list --
    // any table that carries an organization_id column must have row-level security enabled, full
    // stop. That makes this assertion self-updating: a future changeset that adds organization_id
    // to a new table without also enabling RLS on it fails this baseline diff immediately, rather
    // than shipping a silently unprotected tenant table.
    //
    // reconciliation_user (changeset 0032) and reconciliation_login_event (changeset 0040) are
    // the deliberate exceptions: /api/auth/login must look up a row by username, and a
    // LOGIN_FAILURE for an unresolvable username must still be recorded, before any tenant is
    // known -- both are how tenant context gets established or a failed attempt to establish it
    // gets recorded, so neither can itself be gated by a tenant GUC that doesn't exist yet. Same
    // category as reconciliation_organization (already excluded, no organization_id column at
    // all): all three bootstrap tenant context rather than operate within it.
    const rlsExemptTables = new Set(['reconciliation_user', 'reconciliation_login_event']);
    if (
      !rlsExemptTables.has(table) &&
      tableColumns.some((column) => column.column_name === 'organization_id')
    ) {
      assertions.push(
        `SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE relname = ${quote(table)} AND relnamespace = 'public'::regnamespace),
  true,
  ${quote(`${table} has row-level security enabled`)}
);`,
      );
    }

    for (const column of tableColumns) {
      assertions.push(
        `SELECT col_type_is('public', ${quote(table)}, ${quote(column.column_name)}, ${quote(column.column_type)}, ${quote(`${table}.${column.column_name} is ${column.column_type}`)});`,
      );
      assertions.push(
        column.not_null
          ? `SELECT col_not_null('public', ${quote(table)}, ${quote(column.column_name)}, ${quote(`${table}.${column.column_name} is NOT NULL`)});`
          : `SELECT col_is_null('public', ${quote(table)}, ${quote(column.column_name)}, ${quote(`${table}.${column.column_name} is nullable`)});`,
      );

      // col_default_is expects a bare value in the column's own type, not a full expression --
      // pg_get_expr's output for a jsonb/enum-cast default (e.g. `'{}'::jsonb`) is a SQL
      // expression, not a value, and fails "invalid input syntax" when pgTap tries to cast it
      // directly. Comparing the raw expression text via `is()` (same pattern as CHECK
      // constraints above) sidesteps that entirely and still catches any change to the default.
      const defaultExpr = defaultsByColumn.get(`${table}.${column.column_name}`);
      assertions.push(
        `SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.${table}'::regclass AND a.attname = ${quote(column.column_name)}),
  ${defaultExpr ? `$dflt$${defaultExpr}$dflt$` : 'NULL'},
  ${quote(`${table}.${column.column_name} default`)}
);`,
      );
    }

    const tableChecks = checksByTable.get(table) ?? [];
    // pgTap has no assertion for a CHECK's expression, so compare the rendered definitions
    // directly — that is what catches a predicate being quietly weakened.
    //
    // Deliberately `is()` on an aggregated string rather than `results_eq`: results_eq compares
    // two `record` values, and PostgreSQL cannot resolve a collation for that comparison, failing
    // with "could not determine which collation to use for string comparison". Aggregating to a
    // single text value sidesteps record comparison altogether.
    const expectedChecks = tableChecks
      .map((row) => `${row.constraint_name} => ${row.definition}`)
      .join('\n');
    assertions.push(
      `SELECT is(
  (SELECT COALESCE(string_agg(con.conname || ' => ' || pg_get_constraintdef(con.oid), E'\\n' ORDER BY con.conname), '')
     FROM pg_constraint con
    WHERE con.conrelid = 'public.${table}'::regclass AND con.contype IN ('c', 'u', 'x')),
  $chk$${expectedChecks}$chk$,
  ${quote(`${table} check/unique/exclusion constraints`)}
);`,
    );

    // Grants: exact-set comparison per (grantee, privileges) pair, same reasoning as CHECK
    // constraints above -- an aggregated string sidesteps results_eq's collation error, and
    // catches a role quietly gaining or losing a privilege on this table.
    const tableGrants = grantsByTable.get(table) ?? [];
    const expectedGrants = tableGrants
      .map((row) => `${row.grantee} => ${row.privileges}`)
      .join('\n');
    assertions.push(
      `SELECT is(
  (SELECT COALESCE(string_agg(p.grantee || ' => ' || p.privs, E'\\n' ORDER BY p.grantee), '')
     FROM (
       SELECT grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = ${quote(table)}
          AND grantee <> (SELECT rolname FROM pg_roles WHERE oid = (SELECT relowner FROM pg_class WHERE relname = ${quote(table)} AND relnamespace = 'public'::regnamespace))
        GROUP BY grantee
     ) p),
  $grants$${expectedGrants}$grants$,
  ${quote(`${table} grants`)}
);`,
    );

    // RLS policies: rendered USING/WITH CHECK expressions, not just each policy's existence --
    // ADR-0001's tenant-isolation predicate quietly loosening from `organization_id =
    // current_setting(...)` to something wider is exactly the failure mode a mere has_policy()
    // wouldn't catch.
    const tablePolicies = policiesByTable.get(table) ?? [];
    const expectedPolicies = tablePolicies
      .map(
        (row) =>
          `${row.policy_name} => cmd=${row.cmd} roles=${row.roles} using=${row.using_expr ?? ''} check=${row.with_check_expr ?? ''}`,
      )
      .join('\n');
    assertions.push(
      `SELECT is(
  (SELECT COALESCE(string_agg(policyname || ' => cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || COALESCE(qual, '') || ' check=' || COALESCE(with_check, ''), E'\\n' ORDER BY policyname), '')
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ${quote(table)}),
  $policy$${expectedPolicies}$policy$,
  ${quote(`${table} row-level security policies`)}
);`,
    );

    // Triggers: exact-set of names (mirrors indexes_are), plus each definition compared directly
    // -- pgTap has no assertion for a trigger's timing/event/function, same gap as CHECK above.
    assertions.push(
      `SELECT triggers_are('public', ${quote(table)}, ${sqlArray((triggersByTable.get(table) ?? []).map((row) => row.trigger_name))}, ${quote(`${table} has exactly the expected triggers`)});`,
    );
    const tableTriggers = triggersByTable.get(table) ?? [];
    for (const trigger of tableTriggers) {
      assertions.push(
        `SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = ${quote(trigger.trigger_name)} AND tgrelid = 'public.${table}'::regclass),
  $trig$${trigger.definition}$trig$,
  ${quote(`${table}.${trigger.trigger_name} definition`)}
);`,
      );
    }
  }

  for (const foreignKey of foreignKeys) {
    assertions.push(
      `SELECT fk_ok('public', ${quote(foreignKey.table_name)}, ${sqlArray(foreignKey.columns)}, 'public', ${quote(foreignKey.foreign_table)}, ${sqlArray(foreignKey.foreign_columns)});`,
    );
  }

  // Functions and views, schema-wide (mirrors tables_are's single exact-set assertion, not a
  // per-table one -- neither is owned by a specific table). Aggregated string comparison rather
  // than pgTap's has_function/functions_are: those key on argument-type arrays, which is one more
  // thing to get exactly right for no real benefit here, since none of these functions are
  // overloaded.
  const functionsSql = functionRows
    .map((row) => `${row.function_name}(${row.arguments}) RETURNS ${row.return_type} LANGUAGE ${row.language}`)
    .join('\n');
  assertions.push(
    `SELECT is(
  (SELECT COALESCE(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') RETURNS ' || pg_get_function_result(p.oid) || ' LANGUAGE ' || l.lanname, E'\\n' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), '')
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.objid = p.oid AND dep.deptype = 'e')),
  $funcs$${functionsSql}$funcs$,
  'public schema contains exactly the expected functions'
);`,
  );

  const viewNames = viewRows.map((row) => row.view_name).sort();
  assertions.push(
    `SELECT views_are('public', ${sqlArray(viewNames)}, 'public schema contains exactly the expected views');`,
  );
  for (const view of viewRows) {
    assertions.push(
      `SELECT is(
  (SELECT pg_get_viewdef('public.${view.view_name}'::regclass)),
  $view$${view.definition}$view$,
  ${quote(`${view.view_name} definition`)}
);`,
    );
  }

  const header = [
    '-- GENERATED FILE — do not edit by hand.',
    '--',
    '-- pgTap baseline for the Liquibase-managed schema. Regenerate after an intentional schema',
    '-- change with:',
    '--',
    '--   npm run test:postgres:update-baseline',
    '--',
    '-- and review the diff: every line that moves is a schema change someone is shipping.',
    '',
  ].join('\n');

  return `${header}SELECT plan(${assertions.length});\n\n${assertions.join('\n')}\n\nSELECT * FROM finish();\n`;
};
