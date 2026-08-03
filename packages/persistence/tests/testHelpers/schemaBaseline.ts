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

  const keep = <T extends { table_name: string }>(rows: T[]): T[] =>
    rows.filter((row) => !IGNORED_TABLES.has(row.table_name));

  const columns = keep(columnRows);
  const primaryKeys = keep(primaryKeyRows);
  const foreignKeys = keep(foreignKeyRows);
  const indexes = keep(indexRows);
  const checks = keep(checkRows);

  // `tables_are` asserts an exact set against what actually exists, so the inventory has to
  // include Liquibase's own bookkeeping tables even though the per-table assertions below skip
  // them. A Liquibase upgrade that adds a tracking table should fail this loudly rather than
  // slip through.
  const allTableNames = [...new Set(columnRows.map((row) => row.table_name))].sort();
  const tableNames = [...new Set(columns.map((row) => row.table_name))].sort();
  const columnsByTable = groupBy(columns, (row) => row.table_name);
  const indexesByTable = groupBy(indexes, (row) => row.table_name);
  const checksByTable = groupBy(checks, (row) => row.table_name);
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
    if (tableColumns.some((column) => column.column_name === 'organization_id')) {
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
  }

  for (const foreignKey of foreignKeys) {
    assertions.push(
      `SELECT fk_ok('public', ${quote(foreignKey.table_name)}, ${sqlArray(foreignKey.columns)}, 'public', ${quote(foreignKey.foreign_table)}, ${sqlArray(foreignKey.foreign_columns)});`,
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
