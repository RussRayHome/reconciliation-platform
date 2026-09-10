import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApiSpec, createApp } from '../apps/api/src/app';

type CliOptions = {
  outFile: string;
  checkOnly: boolean;
};

const defaultOutputPath = 'generated/openapi.generated.json';

const usage = [
  'Usage: tsx scripts/generate-openapi-docs.ts [--out generated/openapi.generated.json] [--check]',
  '',
  'Examples:',
  '  tsx scripts/generate-openapi-docs.ts',
  '  tsx scripts/generate-openapi-docs.ts --check',
  '  tsx scripts/generate-openapi-docs.ts --out generated/openapi.generated.json',
].join('\n');

type ParsedOutFlag = {
  value: string;
  consumeNext: boolean;
};

const parseOutFlag = (token: string, nextToken: string | undefined): ParsedOutFlag | null => {
  if (token === '--out') {
    if (!nextToken) {
      throw new Error('Missing value for --out');
    }

    return {
      value: nextToken,
      consumeNext: true,
    };
  }

  if (!token.startsWith('--out=')) {
    return null;
  }

  const value = token.slice('--out='.length);
  if (!value) {
    throw new Error('Missing value for --out');
  }

  return {
    value,
    consumeNext: false,
  };
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    outFile: defaultOutputPath,
    checkOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token) {
      continue;
    }

    if (token === '--help' || token === '-h') {
      console.log(usage);
      process.exit(0);
    }

    if (token === '--check') {
      options.checkOnly = true;
      continue;
    }

    const parsedOutFlag = parseOutFlag(token, argv[index + 1]);
    if (parsedOutFlag) {
      options.outFile = parsedOutFlag.value;
      if (parsedOutFlag.consumeNext) {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
};

/**
 * Routes deliberately absent from the published spec, each with its reason. Opt-OUT, never the
 * default: a route neither documented nor listed here fails the check (#462).
 *
 * Not a backlog. `assertCoverage` also fails on an entry matching no real route, so this cannot rot
 * into a list of things nobody remembers deciding.
 */
const UNDOCUMENTED_BY_DESIGN: ReadonlyMap<string, string> = new Map([
  [
    'GET /api/openapi.json',
    'Serves this very document. Describing the spec inside the spec adds nothing an integrator can use.',
  ],
]);

type RouteLayer = {
  route?: { path?: string | string[]; methods?: Record<string, boolean> };
};

/**
 * Express and OpenAPI spell path parameters differently -- `/api/reconciliation/:id` against
 * `/api/reconciliation/{id}` -- so the two inventories cannot be compared as raw strings.
 *
 * Not a near miss if omitted: without this the check reported every already-documented parameterised
 * route as missing (`/api/reconciliation/{id}`, `{id}/summary`, `{id}/exceptions`,
 * `{id}/export/workbook`, `jobs/{jobId}`, `saved-views/{savedViewId}`), inflating a real gap of 50
 * to 56. A coverage check that cries wolf on documented routes is worse than none.
 */
const toComparablePath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/**
 * OpenAPI path-item keys that are NOT operations. `parameters` is the one this repo emits; the rest
 * are listed because the spec permits them. Counting any as an operation inflates coverage -- before
 * this filter the check reported "91 documented, 67 registered", which is impossible on its face.
 */
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/**
 * Every `/api/*` operation the Express app actually registers, as "METHOD /path".
 *
 * Derived from the router rather than a list, which is the whole point of #462: the previous check
 * compared `buildOpenApiSpec()` against its own generated output, so a route never added to the
 * literal was not a mismatch. It described 16 of 67 operations and reported success.
 * `generate-zap-api-targets.ts` already derives its targets this way -- this makes the OpenAPI check
 * the second of the pattern rather than the outlier.
 */
const discoverApiOperations = (): Set<string> => {
  const app = createApp();
  // Express 5 exposes this as `.router`; older Express (and @types/express) as `._router`.
  const holder = app as unknown as { router?: unknown; _router?: unknown };
  const router = holder.router ?? holder._router;
  const stack = (router as { stack?: RouteLayer[] } | undefined)?.stack ?? [];

  const operations = new Set<string>();
  for (const layer of stack) {
    const route = layer.route;
    const path = Array.isArray(route?.path) ? route?.path[0] : route?.path;

    if (typeof path !== 'string' || !path.startsWith('/api/')) {
      continue;
    }

    for (const [method, enabled] of Object.entries(route?.methods ?? {})) {
      if (enabled) {
        operations.add(`${method.toUpperCase()} ${toComparablePath(path)}`);
      }
    }
  }

  return operations;
};

/** Every operation the spec describes, in the same "METHOD /path" shape. */
const documentedOperations = (): Set<string> => {
  const spec = buildOpenApiSpec() as { paths?: Record<string, Record<string, unknown>> };
  const documented = new Set<string>();

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const key of Object.keys(pathItem)) {
      if (!HTTP_METHODS.has(key.toLowerCase())) {
        continue;
      }

      documented.add(`${key.toUpperCase()} ${toComparablePath(path)}`);
    }
  }

  return documented;
};

/**
 * Fails when a registered route has no spec entry, and equally when an exclusion matches no route.
 * The second half matters as much as the first: a stale exclusion silently re-opens the gap.
 */
const assertCoverage = (): void => {
  const registered = discoverApiOperations();
  const documented = documentedOperations();

  const undocumented = [...registered]
    .filter((operation) => !documented.has(operation) && !UNDOCUMENTED_BY_DESIGN.has(operation))
    .sort();

  const staleExclusions = [...UNDOCUMENTED_BY_DESIGN.keys()]
    .filter((operation) => !registered.has(operation))
    .sort();

  const problems: string[] = [];

  if (undocumented.length > 0) {
    problems.push(
      `${undocumented.length} registered route(s) have no OpenAPI entry:\n` +
        undocumented.map((operation) => `  - ${operation}`).join('\n') +
        '\n\nAdd them to apps/api/src/openApiPaths.ts, or to UNDOCUMENTED_BY_DESIGN with a reason.',
    );
  }

  if (staleExclusions.length > 0) {
    problems.push(
      `${staleExclusions.length} UNDOCUMENTED_BY_DESIGN entr(ies) match no registered route:\n` +
        staleExclusions.map((operation) => `  - ${operation}`).join('\n') +
        '\n\nRemove them; the route is gone.',
    );
  }

  if (problems.length > 0) {
    throw new Error(problems.join('\n\n'));
  }

  console.log(
    `OpenAPI coverage: ${documented.size} documented, ${registered.size} registered, ${UNDOCUMENTED_BY_DESIGN.size} excluded by design.`,
  );
};

const renderSpec = (): string => `${JSON.stringify(buildOpenApiSpec(), null, 2)}\n`;

const run = (): void => {
  const options = parseArgs(process.argv.slice(2));
  const outputPath = resolve(process.cwd(), options.outFile);
  const rendered = renderSpec();

  if (options.checkOnly) {
    // Coverage first: a stale generated file is an artifact problem, an undocumented route is a hole
    // in the published contract. The second is the more useful failure to surface.
    assertCoverage();

    if (!existsSync(outputPath)) {
      throw new Error(`OpenAPI output is missing: ${options.outFile}`);
    }

    const existing = readFileSync(outputPath, 'utf8');
    if (existing !== rendered) {
      throw new Error(
        `OpenAPI output is out of date. Run: tsx scripts/generate-openapi-docs.ts --out ${options.outFile}`,
      );
    }

    console.log(`OpenAPI output is up to date: ${options.outFile}`);
    return;
  }

  writeFileSync(outputPath, rendered, 'utf8');
  console.log(`Wrote OpenAPI output to ${options.outFile}`);
};

run();
