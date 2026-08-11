/**
 * Runs dependency-cruiser (the same `.dependency-cruiser.cjs` config `npm run analyze:deps`
 * already uses) and normalizes its raw JSON into the Developer Dashboard's DependencyScan
 * contract: module names/extensions stripped, local-only fan-in/fan-out, self-consistent
 * instability computed from those same counts (not dependency-cruiser's own --metrics
 * instability, which counts non-local dependencies too and would disagree with the fanIn/fanOut
 * numbers shown next to it), 2-cycle detection, and per-file line counts read directly off disk
 * (dependency-cruiser's JSON output has no size/LOC metric at all).
 *
 * Invoked via `npm run analyze:deps:json`. Exits non-zero when any `error`-severity violation
 * exists, mirroring `npm run analyze:deps`'s existing meaning of failure for local use.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';

type RawDependency = {
  resolved: string;
  dependencyTypes: string[];
  circular: boolean;
};

type RawModule = {
  source: string;
  dependencies: RawDependency[];
  dependents: string[];
};

type RawViolation = {
  from: string;
  to: string;
  rule: { name: string; severity: 'error' | 'warn' | 'info' };
};

type RawReport = {
  modules: RawModule[];
  summary: { violations: RawViolation[] };
};

type DependencyModule = {
  name: string;
  folder: string;
  loc: number;
  deps: string[];
  fanIn: number;
  fanOut: number;
  instability: number;
  cyclic: boolean;
};

type DependencyViolation = {
  id: string;
  sev: 'error' | 'warn' | 'info';
  from: string;
  to: string;
  note: string;
};

type DependencyScan = {
  scannedAt: string;
  modules: DependencyModule[];
  violations: DependencyViolation[];
};

/** Strips the file extension -- "apps/api/src/app.ts" -> "apps/api/src/app". Kept as the full
 *  relative path (not stripped to a bare basename) since this monorepo has many same-named files
 *  (index.ts, types.ts) across packages that a basename-only id would collide on. */
const moduleName = (sourcePath: string): string => sourcePath.slice(0, -extname(sourcePath).length);

/** The scope-chip grouping: apps/api -> "api", packages/core -> "core", scripts/foo.ts ->
 *  "scripts". Uses the second path segment (not the first, which would only ever be
 *  "apps"/"packages"/"scripts" -- three chips is not a useful scope filter in an ~11-workspace
 *  monorepo). */
const folderFor = (sourcePath: string): string => {
  const segments = sourcePath.split('/');
  return segments.length > 1 && segments[0] !== 'scripts' ? (segments[1] as string) : (segments[0] as string);
};

const countLines = (sourcePath: string): number => {
  if (!existsSync(sourcePath)) return 0;
  try {
    return readFileSync(sourcePath, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
};

function main(): void {
  const jsonOutFlagIndex = process.argv.indexOf('--json-out');
  const jsonOutPath = jsonOutFlagIndex !== -1 ? process.argv[jsonOutFlagIndex + 1] : null;
  if (!jsonOutPath) {
    console.error('Usage: tsx scripts/ci/depcruise-scan.ts --json-out <path>');
    process.exit(2);
  }

  let rawOutput: string;
  try {
    rawOutput = execFileSync(
      'npx',
      ['depcruise', '--config', '.dependency-cruiser.cjs', '--output-type', 'json', 'apps', 'packages', 'scripts'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    // depcruise itself exits non-zero on an error-severity violation while still printing valid
    // JSON to stdout -- execFileSync throws in that case but still carries stdout on the error.
    const withStdout = error as { stdout?: string };
    if (typeof withStdout.stdout !== 'string' || !withStdout.stdout.trim()) {
      console.error('depcruise produced no output.');
      process.exit(1);
    }
    rawOutput = withStdout.stdout;
  }

  const raw = JSON.parse(rawOutput) as RawReport;

  const byResolved = new Map(raw.modules.map((module) => [module.source, module]));
  const localDepsOf = (module: RawModule): RawDependency[] =>
    module.dependencies.filter((dep) => dep.dependencyTypes.includes('local') && byResolved.has(dep.resolved));

  const modules: DependencyModule[] = raw.modules.map((module) => {
    const localDeps = localDepsOf(module);
    const fanOut = localDeps.length;
    const fanIn = module.dependents.filter((dependent) => byResolved.has(dependent)).length;
    const total = fanIn + fanOut;

    return {
      name: moduleName(module.source),
      folder: folderFor(module.source),
      loc: countLines(module.source),
      deps: localDeps.map((dep) => moduleName(dep.resolved)),
      fanIn,
      fanOut,
      instability: total > 0 ? fanOut / total : 0,
      cyclic: localDeps.some((dep) => dep.circular),
    };
  });

  const violations: DependencyViolation[] = raw.summary.violations.map((violation) => ({
    id: violation.rule.name,
    sev: violation.rule.severity,
    from: moduleName(violation.from),
    to: moduleName(violation.to),
    note: `Violates "${violation.rule.name}" (${violation.rule.severity}).`,
  }));

  const scan: DependencyScan = { scannedAt: new Date().toISOString(), modules, violations };

  mkdirSync(dirname(jsonOutPath), { recursive: true });
  writeFileSync(jsonOutPath, JSON.stringify(scan));

  const errorCount = violations.filter((v) => v.sev === 'error').length;
  console.log(
    `Wrote dependency scan to ${jsonOutPath}: ${modules.length} modules, ${violations.length} violation(s) (${errorCount} error).`,
  );

  if (errorCount > 0) {
    console.error(`\n${errorCount} error-severity dependency-cruiser violation(s):`);
    for (const violation of violations.filter((v) => v.sev === 'error').slice(0, 50)) {
      console.error(`- ${violation.id}: ${violation.from} -> ${violation.to}`);
    }
    process.exit(1);
  }
}

main();
