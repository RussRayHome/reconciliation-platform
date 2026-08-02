# Liquibase changelogs

This directory is the source of truth for the reconciliation platform's Postgres
schema, replacing the old `postgresMigrations` array in
`packages/persistence/src/schema.ts`.

- `changelog-master.yaml` includes every file in `changesets/` in filename order.
- `changesets/0001` through `0009` are a verbatim, changeset-per-file port of the
  9 migrations that previously lived in `schema.ts`, each with an authored
  `--rollback` block (the old mechanism had none).
- `changesets/0010` drops the old `schema_migrations` tracking table. It is the
  convergence point: whether a database got here via a fresh `update` or via
  `changelog-sync` (see below), it ends up in the same state afterward.
- `changesets/0011` onward add the new approval-pipeline tables (organization,
  mapping profiles, staged transactions, validation, import approvals,
  templates) — see the numbered files for details.

Liquibase creates its own bookkeeping tables (`databasechangelog`,
`databasechangeloglock`) automatically on first run; nothing here creates them
by hand.

## Cutover procedure

**Fresh or empty databases (local dev reset, CI, a new environment):**

```
liquibase update
```

Applies every changeset from 0001 onward for real.

**Already-migrated databases (existing dev/stage/prod that ran the old
`runPostgresMigrations` mechanism and already have `schema_migrations` rows
1-9):**

One-time, per environment:

```
liquibase changelog-sync --to-tag=v1-v9-baseline
liquibase tag v1-v9-baseline   # only if the tag wasn't already applied
liquibase update
```

`changelog-sync` marks changesets 0001-0009 as already applied *without*
re-running their SQL (the tables already exist). `update` then runs 0010
onward for real. After this one-time step, every environment runs plain
`liquibase update` going forward, converging on the same schema as a fresh
`update` run — verified by `packages/persistence/tests/liquibase-migrations.test.ts`.

## A note on the ported CHECK constraints

The original migrations built several `CHECK (... IN (...))` constraint lists
dynamically from TypeScript const-arrays (`reconciliationJobStates`,
`errorCategories`, etc. in `packages/persistence/src/stateMachine.ts` and
`packages/domain/src/enums.ts`). Liquibase changesets are static SQL, so
those lists were inlined as literals in `0001` and `0006`. If those enums
change in the future, a **new** changeset must add/alter the constraint —
editing the TS enum alone no longer changes the database.
