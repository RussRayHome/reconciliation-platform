import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import ts from 'typescript';

type EscomplexReport = {
  cyclomatic: number;
  maintainability: number;
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

  return {
    filePath,
    cyclomatic: report.cyclomatic,
    maintainability: report.maintainability,
    logicalSloc: report.aggregate?.sloc?.logical ?? 0,
  };
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
