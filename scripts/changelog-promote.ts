/**
 * Promotes the current `## [Unreleased]` changelog content into a dated release section.
 * Invoked via `npm run changelog:promote -- --date YYYY-MM-DD`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type CliOptions = {
  date?: string;
  dryRun: boolean;
  filePath: string;
};

type ParsedFlagValue = {
  value: string;
  nextIndex: number;
};

const defaultChangelogPath = 'CHANGELOG.md';
const unreleasedHeading = '## [Unreleased]';
const unreleasedPlaceholder = '_No notable changes recorded yet._';

const usage = [
  'Usage: tsx scripts/changelog-promote.ts [--date YYYY-MM-DD] [--file CHANGELOG.md] [--dry-run]',
  '',
  'Examples:',
  '  tsx scripts/changelog-promote.ts',
  '  tsx scripts/changelog-promote.ts --date 2026-06-18',
  '  tsx scripts/changelog-promote.ts --dry-run',
].join('\n');

const parseFlagValue = (
  token: string,
  key: 'date' | 'file',
  argv: string[],
  index: number,
): ParsedFlagValue | null => {
  const equalsPrefix = `--${key}=`;
  if (token.startsWith(equalsPrefix)) {
    const value = token.slice(equalsPrefix.length);
    if (!value) {
      throw new Error(`Missing value for --${key}.`);
    }

    return {
      value,
      nextIndex: index + 1,
    };
  }

  if (token !== `--${key}`) {
    return null;
  }

  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for --${key}.`);
  }

  return {
    value,
    nextIndex: index + 2,
  };
};

const printUsageAndExit = (): never => {
  console.log(usage);
  process.exit(0);
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    dryRun: false,
    filePath: defaultChangelogPath,
  };

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token) {
      index += 1;
      continue;
    }

    if (token === '--help' || token === '-h') {
      printUsageAndExit();
    }

    if (token === '--dry-run') {
      options.dryRun = true;
      index += 1;
      continue;
    }

    const dateFlag = parseFlagValue(token, 'date', argv, index);
    if (dateFlag) {
      options.date = dateFlag.value;
      index = dateFlag.nextIndex;
      continue;
    }

    const fileFlag = parseFlagValue(token, 'file', argv, index);
    if (fileFlag) {
      options.filePath = fileFlag.value;
      index = fileFlag.nextIndex;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
};

const trimBlankLines = (lines: string[]): string[] => {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.trim().length === 0) {
    start += 1;
  }

  while (end > start && lines[end - 1]?.trim().length === 0) {
    end -= 1;
  }

  return lines.slice(start, end);
};

const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
};

const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

const hasMeaningfulContent = (lines: string[]): boolean => {
  const meaningfulLines = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && trimmed !== unreleasedPlaceholder;
  });

  return meaningfulLines.length > 0;
};

const rebuildChangelog = (source: string, releaseDate: string): string => {
  const normalized = source.replaceAll('\r\n', '\n');
  const originalHasTrailingNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');

  const unreleasedIndex = lines.findIndex((line) => line.trim() === unreleasedHeading);
  if (unreleasedIndex < 0) {
    throw new Error(`Could not find ${unreleasedHeading} section.`);
  }

  let nextSectionIndex = lines.length;
  for (let index = unreleasedIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';
    if (/^##\s+\[[^\]]+\]$/.test(line)) {
      nextSectionIndex = index;
      break;
    }
  }

  const unreleasedBody = lines.slice(unreleasedIndex + 1, nextSectionIndex);
  const cleanedUnreleasedBody = trimBlankLines(
    unreleasedBody.filter((line) => line.trim() !== unreleasedPlaceholder),
  );

  if (!hasMeaningfulContent(cleanedUnreleasedBody)) {
    return source;
  }

  const targetHeading = `## [${releaseDate}]`;
  if (lines.some((line, index) => index !== unreleasedIndex && line.trim() === targetHeading)) {
    throw new Error(`Section ${targetHeading} already exists. Choose a different date.`);
  }

  const before = lines.slice(0, unreleasedIndex);
  const after = lines.slice(nextSectionIndex);

  const rebuilt: string[] = [
    ...before,
    unreleasedHeading,
    '',
    unreleasedPlaceholder,
    '',
    targetHeading,
    '',
    ...cleanedUnreleasedBody,
    '',
  ];

  const normalizedAfter = [...after];
  while (
    normalizedAfter.length > 0 &&
    normalizedAfter[0]?.trim().length === 0 &&
    (rebuilt.at(-1)?.trim().length ?? 0) === 0
  ) {
    normalizedAfter.shift();
  }

  rebuilt.push(...normalizedAfter);

  let output = rebuilt.join('\n');
  if (originalHasTrailingNewline && !output.endsWith('\n')) {
    output += '\n';
  }

  if (!originalHasTrailingNewline) {
    output = output.replace(/\n$/u, '');
  }

  if (source.includes('\r\n')) {
    output = output.replaceAll('\n', '\r\n');
  }

  return output;
};

const main = (): void => {
  const options = parseArgs(process.argv.slice(2));
  const releaseDate = options.date ?? todayIsoDate();

  if (!isValidIsoDate(releaseDate)) {
    throw new Error(`Invalid date "${releaseDate}". Expected YYYY-MM-DD.`);
  }

  const changelogPath = resolve(process.cwd(), options.filePath);
  const current = readFileSync(changelogPath, 'utf8');
  const next = rebuildChangelog(current, releaseDate);

  if (next === current) {
    console.log('No unreleased changelog entries to promote.');
    return;
  }

  if (options.dryRun) {
    console.log(`Dry run: would promote Unreleased changelog entries into ## [${releaseDate}].`);
    return;
  }

  writeFileSync(changelogPath, next, 'utf8');
  console.log(`Promoted Unreleased changelog entries into ## [${releaseDate}].`);
};

main();
