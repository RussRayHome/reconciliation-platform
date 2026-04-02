# Bank-to-QBO Reconciliation Platform

A production-style monorepo for reconciling bank transaction exports against QuickBooks Online exports. The platform parses source workbooks, preserves row-level lineage, normalizes accounting data, applies evidence-based matching rules, classifies exceptions, produces accountant-friendly review outputs, and exports a multi-tab workpaper workbook.

## Stack

- Frontend: React, TypeScript, Vite, TanStack Query, Recharts
- API: Node.js, Express, TypeScript, Pino, Multer
- Shared validation and typing: TypeScript-first domain packages
- Workbook parsing/export: ExcelJS
- Testing: Vitest, Supertest, Playwright
- Tooling: npm workspaces, ESLint, Prettier, VS Code tasks/launch settings

## Workspace Layout

```text
reconciliation-platform/
  apps/
    api/
    web/
  packages/
    config/
    core/
    domain/
    test-fixtures/
    ui/
  docs/
  scripts/
```

## What It Does

- Ingests bank and QBO `.xlsx` exports
- Dynamically maps source columns using configurable aliases
- Preserves original file names and spreadsheet row numbers
- Excludes QBO beginning-balance rows from matching
- Normalizes dates, amounts, references, descriptions, merchants, and payees
- Applies layered matching rules with one-to-one default behavior
- Separates exact matches from probable matches and exceptions
- Flags timing differences, duplicates, missing items, amount mismatches, and data-quality issues
- Exports an Excel workpaper with summary, assumptions, error report, probable matches, reviewer observations, and normalized views
- Returns JSON summaries for local automation or integration

## Quick Start

```bash
npm install
npm run dev
```

- API: `http://localhost:4000`
- Web: `http://127.0.0.1:5173`

## Scripts

- `npm run dev`
- `npm run dev:web`
- `npm run dev:api`
- `npm run build`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run coverage`
- `npm run security:scan`
- `npm run fixtures:generate`
- `npm run analyze:reconciliation -- --account <accountId> --bank <bank.xlsx> --qbo <qbo.xlsx> [--windows 0,1,3,5,10,21] [--thresholds 0,0.05,0.1,0.2] [--similarity-days 5] [--hybrid-thresholds 0.1,0.15] [--hybrid-occurrences 1,2]`

## Core Flow

1. Upload bank and QBO workbooks from the web UI.
2. API validates file types, assigns a correlation ID, parses both workbooks, and resolves account-specific config.
3. Shared core logic normalizes source rows and runs the matching engine.
4. Exception classification and summary metrics are generated for accounting review.
5. The API stores the run in memory and serves summary, exception, and workbook export endpoints.
6. The web UI renders dashboard metrics, charts, probable matches, and filterable exceptions.

## Documentation

- `docs/architecture.md`
- `docs/reconciliation-rules.md`
- `docs/developer-setup.md`
- `docs/test-strategy.md`
- `docs/sample-config.md`
- `docs/api.md`
- `docs/class-method-reference.md`

## Class and Method Documentation

Complete class and method documentation, including method inputs, outputs, and before/after state objects, is maintained in `docs/class-method-reference.md`.

## Current Persistence Model

The API uses in-memory storage for reconciliation runs. The repository interface is isolated so SQLite, Prisma, or another persistence layer can be added later without reworking the reconciliation engine.
