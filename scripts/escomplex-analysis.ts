/**
 * Runs escomplex AST-based complexity analysis across all TypeScript source files under
 * `apps/` and `packages/` and reports cyclomatic complexity, maintainability index, and
 * Halstead metrics. Exits non-zero when thresholds are exceeded.
 * Invoked via `npm run analyze:complexity`.
 *
 * With --json-out <path>, additionally writes a ComplexityScan tree (dir -> file -> method) to
 * that path for the Developer Dashboard's Code Health section (dashboard-status.yml's
 * `complexity` job) -- this is purely additive to the console/exit-code behavior above, which
 * local `npm run analyze:complexity` usage keeps relying on unchanged.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';

import ts from 'typescript';

type EscomplexFunctionReport = {
  name: string;
  cyclomatic: number;
  params: number;
  line: number;
  sloc?: { logical?: number };
};

type EscomplexReport = {
  cyclomatic: number;
  maintainability: number;
  functions?: EscomplexFunctionReport[];
  aggregate?: {
    sloc?: {
      logical?: number;
    };
  };
};

type FileComplexity = {
  filePath: string;
  cyclomatic: number;
  maintainability: number;
  logicalSloc: number;
  methods: ScanMethod[];
};

/** One method/function's metrics, matching the Developer Dashboard's Method contract. escomplex's
 *  function report has no nesting depth or exit-point count, and the design's own spec says to
 *  omit those fields rather than estimate them -- so this stays a subset of the full design
 *  contract (name/cc/lines/params/startLine only). */
type ScanMethod = {
  name: string;
  cc: number;
  lines: number;
  params: number;
  startLine: number;
};

type ScanNode =
  | { type: 'dir'; name: string; children: ScanNode[] }
  | { type: 'file'; name: string; lines: number; methods: ScanMethod[] };

type ComplexityScan = {
  scannedAt: string;
  root: ScanNode;
};

const require = createRequire(import.meta.url);
const { analyse } = require('escomplex') as {
  analyse: (source: string) => EscomplexReport;
};

const sourceRoots = ['apps', 'packages', 'scripts'];
const ignoredDirectories = new Set([
  '.git',
  '.vscode',
  'coverage',
  'dist',
  'docs',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const skipPathPatterns = [
  /\.d\.ts$/,
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /\/escomplex-analysis\.ts$/,
  /\/playwright\.config\.ts$/,
  /\/vite\.config\.ts$/,
  /\/vitest(?:\.[^.]+)?\.config\.ts$/,
  /\/__tests__\//,
  /\/tests\//,
  /\/test\//,
];

const maxCyclomaticPerFile = readNumberFromEnv('MAX_CYCLOMATIC_PER_FILE', 80);
const minMaintainability = readNumberFromEnv('MIN_MAINTAINABILITY', 60);

const readTranspileOptions: ts.TranspileOptions = {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES5,
    jsx: ts.JsxEmit.ReactJSX,
  },
};

function readNumberFromEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function shouldSkipPath(filePath: string): boolean {
  return skipPathPatterns.some((pattern) => pattern.test(filePath));
}

function collectSourceFiles(rootPath: string): string[] {
  const entries = readdirSync(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(rootPath, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }

      files.push(...collectSourceFiles(entryPath));
      continue;
    }

    const extension = extname(entry.name);
    if (extension !== '.ts' && extension !== '.tsx') {
      continue;
    }

    if (shouldSkipPath(entryPath)) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

function analyzeFile(filePath: string): FileComplexity | null {
  const source = readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    ...readTranspileOptions,
    fileName: filePath,
  });

  if (!transpiled.outputText.trim()) {
    return null;
  }

  const report = analyse(transpiled.outputText);
  if (!Number.isFinite(report.cyclomatic) || !Number.isFinite(report.maintainability)) {
    return null;
  }

  const methods: ScanMethod[] = (report.functions ?? [])
    .filter(
      (fn) =>
        typeof fn.name === 'string' &&
        fn.name.length > 0 &&
        Number.isFinite(fn.cyclomatic) &&
        Number.isFinite(fn.line),
    )
    .map((fn) => ({
      name: fn.name,
      cc: fn.cyclomatic,
      lines: fn.sloc?.logical ?? 0,
      params: Number.isFinite(fn.params) ? fn.params : 0,
      startLine: fn.line,
    }));

  return {
    filePath,
    cyclomatic: report.cyclomatic,
    maintainability: report.maintainability,
    logicalSloc: report.aggregate?.sloc?.logical ?? 0,
    methods,
  };
}

/** Groups the flat analyzed-file list into a dir/file tree rooted at `rootName`, matching the
 *  ComplexityScan Node contract. Directories with a single child chain (e.g. apps/api/src) are
 *  NOT collapsed -- each path segment is its own node -- so the drill-down UI's breadcrumb always
 *  matches the real directory structure one hop at a time. */
function buildTree(rootName: string, files: FileComplexity[]): ScanNode {
  const root: ScanNode & { type: 'dir' } = { type: 'dir', name: rootName, children: [] };

  for (const file of files) {
    const relativePath = relative(process.cwd(), file.filePath);
    const segments = relativePath.split(sep).filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) continue;

    let cursor = root;
    for (const segment of segments) {
      let next = cursor.children.find(
        (child): child is ScanNode & { type: 'dir' } => child.type === 'dir' && child.name === segment,
      );
      if (!next) {
        next = { type: 'dir', name: segment, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }

    cursor.children.push({
      type: 'file',
      name: fileName,
      lines: file.logicalSloc,
      methods: file.methods,
    });
  }

  return root;
}

function formatMetric(file: FileComplexity): string {
  const relativePath = relative(process.cwd(), file.filePath);
  return `${relativePath} | cyclomatic=${file.cyclomatic} | maintainability=${file.maintainability.toFixed(2)} | sloc=${file.logicalSloc}`;
}

function printSection(title: string, files: FileComplexity[]): void {
  console.log(`\n${title}`);
  for (const file of files) {
    console.log(`- ${formatMetric(file)}`);
  }
}

function readJsonOutFlag(): string | null {
  const flagIndex = process.argv.indexOf('--json-out');
  return flagIndex !== -1 ? (process.argv[flagIndex + 1] ?? null) : null;
}

function writeComplexityScan(jsonOutPath: string, analyzed: FileComplexity[]): void {
  const scan: ComplexityScan = {
    scannedAt: new Date().toISOString(),
    root: buildTree('reconciliation-platform', analyzed),
  };

  mkdirSync(dirname(jsonOutPath), { recursive: true });
  writeFileSync(jsonOutPath, JSON.stringify(scan));
}

function main(): void {
  const files = sourceRoots
    .map((root) => join(process.cwd(), root))
    .flatMap((root) => collectSourceFiles(root));

  const analyzed: FileComplexity[] = [];

  for (const filePath of files) {
    try {
      const result = analyzeFile(filePath);
      if (result) {
        analyzed.push(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping ${relative(process.cwd(), filePath)}: ${message}`);
    }
  }

  if (analyzed.length === 0) {
    console.error('No TypeScript source files were analyzed by escomplex.');
    process.exit(1);
  }

  const jsonOutPath = readJsonOutFlag();
  if (jsonOutPath) {
    writeComplexityScan(jsonOutPath, analyzed);
    console.log(`Wrote complexity scan to ${jsonOutPath}`);
  }

  const topCyclomatic = [...analyzed].sort((a, b) => b.cyclomatic - a.cyclomatic).slice(0, 10);
  const lowestMaintainability = [...analyzed]
    .sort((a, b) => a.maintainability - b.maintainability)
    .slice(0, 10);

  console.log(`Analyzed ${analyzed.length} files with escomplex.`);
  console.log(
    `Thresholds: cyclomatic <= ${maxCyclomaticPerFile}, maintainability >= ${minMaintainability}`,
  );

  printSection('Top cyclomatic files:', topCyclomatic);
  printSection('Lowest maintainability files:', lowestMaintainability);

  const violations = analyzed.filter(
    (file) => file.cyclomatic > maxCyclomaticPerFile || file.maintainability < minMaintainability,
  );

  if (violations.length > 0) {
    console.error(`\nComplexity threshold violations: ${violations.length}`);
    for (const violation of violations.slice(0, 50)) {
      console.error(`- ${formatMetric(violation)}`);
    }

    process.exit(1);
  }

  console.log('\nComplexity thresholds passed.');
}

main();
