import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const sourceRoots = ['apps', 'packages'];
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

const testFilePattern = /\.(test|spec)\.[tj]sx?$/;
const assertionPatterns = [
  /\bexpect(?:\.[A-Za-z]+)?\s*\(/,
  /\.expect\s*\(/,
  /\bassert(?:\.[A-Za-z]+)?\s*\(/,
];

function collectTestFiles(directoryPath: string): string[] {
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }

      files.push(...collectTestFiles(entryPath));
      continue;
    }

    if (testFilePattern.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function hasAssertion(source: string): boolean {
  return assertionPatterns.some((pattern) => pattern.test(source));
}

function main(): void {
  const testFiles = sourceRoots
    .map((root) => join(process.cwd(), root))
    .flatMap((root) => collectTestFiles(root));

  if (testFiles.length === 0) {
    console.error('No test files were found in apps/ or packages/.');
    process.exit(1);
  }

  const violations = testFiles.filter((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    return !hasAssertion(source);
  });

  if (violations.length > 0) {
    console.error('The following test files do not appear to contain assertions:');
    for (const filePath of violations) {
      console.error(`- ${relative(process.cwd(), filePath)}`);
    }

    process.exit(1);
  }

  console.log(`Verified assertion presence in ${testFiles.length} test files.`);
}

main();
