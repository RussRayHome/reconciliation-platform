import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const projectRoot = process.cwd();
const baselineFile = resolve(projectRoot, 'scripts/unused-exports.baseline.txt');
const ignorePattern = String.raw`(\.test\.|\.spec\.|/tests/|/coverage/|/docs/)`;
const shouldUpdate = process.argv.includes('--update');
const compareEntries = (left: string, right: string): number => left.localeCompare(right);

function runTsPrune(): string[] {
  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    npxCommand,
    ['--no-install', 'ts-prune', '-p', 'tsconfig.typecheck.json', '-s', ignorePattern],
    {
      cwd: projectRoot,
      encoding: 'utf8',
    },
  );

  if (result.error) {
    console.error(`Failed to execute ts-prune: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    console.error('ts-prune exited with a non-zero status.');
    if (stderr.length > 0) {
      console.error(stderr);
    }
    process.exit(result.status ?? 1);
  }

  const matches = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[^:\s][^:]*:\d+\s-\s.+$/.test(line));

  return [...new Set(matches)].sort(compareEntries);
}

function readBaseline(): string[] {
  if (!existsSync(baselineFile)) {
    return [];
  }

  const entries = readFileSync(baselineFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  return [...new Set(entries)].sort(compareEntries);
}

function writeBaseline(entries: string[]): void {
  mkdirSync(dirname(baselineFile), { recursive: true });

  const header = [
    '# Unused-export triage baseline',
    '#',
    '# This file is generated from ts-prune output via:',
    '# npm run analyze:unused-exports:baseline:update',
    '#',
    '# Each line format: <relative-file-path>:<line> - <export-name>',
    '# Lines in this file are treated as triaged/expected until cleaned up.',
    '',
  ].join('\n');

  const payload = entries.length > 0 ? `${entries.join('\n')}\n` : '';
  writeFileSync(baselineFile, `${header}${payload}`, 'utf8');
}

function printList(title: string, entries: string[]): void {
  console.error(title);
  for (const entry of entries) {
    console.error(`- ${entry}`);
  }
}

function main(): void {
  const currentEntries = runTsPrune();

  if (shouldUpdate) {
    writeBaseline(currentEntries);
    console.log(
      `Updated baseline with ${currentEntries.length} triaged entries: ${relative(projectRoot, baselineFile)}`,
    );
    return;
  }

  const baselineEntries = readBaseline();
  const currentSet = new Set(currentEntries);
  const baselineSet = new Set(baselineEntries);

  const untriagedEntries = currentEntries.filter((entry) => !baselineSet.has(entry));
  const staleBaselineEntries = baselineEntries.filter((entry) => !currentSet.has(entry));

  console.log(
    `Unused-export triage summary: current=${currentEntries.length}, triaged=${baselineEntries.length}, untriaged=${untriagedEntries.length}, stale-baseline=${staleBaselineEntries.length}`,
  );

  if (untriagedEntries.length > 0) {
    printList('\nUntriaged unused-export findings:', untriagedEntries);
    console.error('\nTriage options:');
    console.error('- Remove the export if it is truly unused.');
    console.error(
      '- Keep the export, then refresh baseline with: npm run analyze:unused-exports:baseline:update',
    );
    process.exit(1);
  }

  if (staleBaselineEntries.length > 0) {
    printList('\nStale baseline entries (already resolved in code):', staleBaselineEntries);
    console.log(
      '\nRefresh baseline to keep it tidy: npm run analyze:unused-exports:baseline:update',
    );
  }

  console.log('Unused-export triage check passed.');
}

main();
