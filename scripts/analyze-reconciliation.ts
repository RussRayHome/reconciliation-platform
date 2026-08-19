/**
 * Runs reconciliation sensitivity analysis across amount tolerance, date variance, and
 * similarity threshold windows to help calibrate matching configuration values.
 * Invoked via `npm run analyze:reconciliation`.
 */
import { toNormalizedTransactions, tokenSimilarity, validateFile } from '@recon/core';
import { resolveReconciliationConfig, sampleAccountOverrides } from '@recon/config';

import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';

type CliOptions = {
  accountId: string;
  bankPath: string;
  glPath: string;
  windows: number[];
  thresholds: number[];
  similarityDays: number;
  hybridThresholds: number[];
  hybridOccurrences: number[];
};

type MatchKind = 'Probable' | 'Exact' | 'Timing';

type Candidate = {
  bankId: string;
  glId: string;
  bankLine: number;
  glLine: number;
  score: number;
  kind: MatchKind;
};

const usage = (): string =>
  [
    'Usage:',
    '  npm run analyze:reconciliation -- --account <accountId> --bank <bank.xlsx> --gl <gl.xlsx> [--windows <csv>] [--thresholds <csv>] [--similarity-days <int>] [--hybrid-thresholds <csv>] [--hybrid-occurrences <csv>]',
    '',
    'Example:',
    '  npm run analyze:reconciliation -- --account 5703 --bank ./data/bank.xlsx --gl ./data/gl.xlsx',
    '  npm run analyze:reconciliation -- --account 5703 --bank ./data/bank.xlsx --gl ./data/gl.xlsx --windows 0,1,3,5,10,21 --thresholds 0,0.05,0.1,0.2,0.3',
    '  npm run analyze:reconciliation -- --account 5703 --bank ./data/bank.xlsx --gl ./data/gl.xlsx --similarity-days 7 --hybrid-thresholds 0.1,0.15,0.2 --hybrid-occurrences 1,2,3',
  ].join('\n');

const DEFAULT_WINDOWS = [0, 1, 2, 3, 4, 5, 7, 10, 14, 21];
const DEFAULT_THRESHOLDS = [
  0, 0.03, 0.05, 0.07, 0.08, 0.09, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7,
];
const DEFAULT_SIMILARITY_DAYS = 5;
const DEFAULT_HYBRID_THRESHOLDS = [0.1, 0.15];
const DEFAULT_HYBRID_OCCURRENCES = [1, 2];

const readArg = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }

  return args[index + 1];
};

const parseNumberList = (
  value: string | undefined,
  flagName: string,
  defaults: number[],
): number[] => {
  if (!value) {
    return defaults;
  }

  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map(Number);

  if (parsed.length === 0 || parsed.some((item) => Number.isNaN(item))) {
    throw new Error(
      `Invalid ${flagName} value: "${value}". Expected a comma-separated list of numbers.\n\n${usage()}`,
    );
  }

  return Array.from(new Set(parsed)).sort((left, right) => left - right);
};

const parseArgs = (args: string[]): CliOptions => {
  const accountId = readArg(args, '--account');
  const bankPath = readArg(args, '--bank');
  const glPath = readArg(args, '--gl');
  const windows = parseNumberList(readArg(args, '--windows'), '--windows', DEFAULT_WINDOWS);
  const thresholds = parseNumberList(
    readArg(args, '--thresholds'),
    '--thresholds',
    DEFAULT_THRESHOLDS,
  );
  const similarityDaysRaw = readArg(args, '--similarity-days');
  const similarityDays = similarityDaysRaw ? Number(similarityDaysRaw) : DEFAULT_SIMILARITY_DAYS;
  const hybridThresholds = parseNumberList(
    readArg(args, '--hybrid-thresholds'),
    '--hybrid-thresholds',
    DEFAULT_HYBRID_THRESHOLDS,
  );
  const hybridOccurrences = parseNumberList(
    readArg(args, '--hybrid-occurrences'),
    '--hybrid-occurrences',
    DEFAULT_HYBRID_OCCURRENCES,
  );

  if (!accountId || !bankPath || !glPath) {
    throw new Error(usage());
  }

  if (windows.some((value) => value < 0 || !Number.isInteger(value))) {
    throw new Error(
      `Invalid --windows values. Each window must be a non-negative integer.\n\n${usage()}`,
    );
  }

  if (thresholds.some((value) => value < 0 || value > 1)) {
    throw new Error(
      `Invalid --thresholds values. Each threshold must be between 0 and 1.\n\n${usage()}`,
    );
  }

  if (!Number.isInteger(similarityDays) || similarityDays < 0) {
    throw new Error(
      `Invalid --similarity-days value. It must be a non-negative integer.\n\n${usage()}`,
    );
  }

  if (hybridThresholds.some((value) => value < 0 || value > 1)) {
    throw new Error(
      `Invalid --hybrid-thresholds values. Each threshold must be between 0 and 1.\n\n${usage()}`,
    );
  }

  if (hybridOccurrences.some((value) => value < 1 || !Number.isInteger(value))) {
    throw new Error(
      `Invalid --hybrid-occurrences values. Each value must be a positive integer.\n\n${usage()}`,
    );
  }

  return {
    accountId,
    bankPath,
    glPath,
    windows,
    thresholds,
    similarityDays,
    hybridThresholds,
    hybridOccurrences,
  };
};

const absDays = (left: string | undefined, right: string | undefined): number | null => {
  if (!left || !right) {
    return null;
  }

  return Math.abs((new Date(left).getTime() - new Date(right).getTime()) / 86400000);
};

const sameAmount = (left: number | null, right: number | null): boolean => {
  if (left === null || right === null) {
    return false;
  }

  return Math.abs(left - right) <= 0.01;
};

const isMonthEndDate = (value?: string): boolean => {
  if (!value) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) {
    return false;
  }

  const month = date.getUTCMonth();
  const next = new Date(Date.UTC(date.getUTCFullYear(), month, date.getUTCDate() + 1));
  return next.getUTCMonth() !== month;
};

const includesText = (text: string | undefined, fragment: string): boolean =>
  Boolean(text?.toLowerCase().includes(fragment));

const buildAmountFrequency = (values: Array<{ amount: number | null }>): Map<number, number> => {
  const frequency = new Map<number, number>();

  values.forEach((item) => {
    if (item.amount !== null) {
      frequency.set(item.amount, (frequency.get(item.amount) ?? 0) + 1);
    }
  });

  return frequency;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const config = resolveReconciliationConfig(options.accountId, sampleAccountOverrides);

  const [bankBuffer, glBuffer] = await Promise.all([
    readFile(options.bankPath),
    readFile(options.glPath),
  ]);

  const [bankOutcome, glOutcome] = await Promise.all([
    validateFile({ bytes: bankBuffer, fileFormat: 'XLSX', fileType: 'BANK' }),
    validateFile({ bytes: glBuffer, fileFormat: 'XLSX', fileType: 'GL' }),
  ]);

  for (const [label, outcome] of [
    ['bank', bankOutcome],
    ['gl', glOutcome],
  ] as const) {
    if (!outcome.gatesRun.includes('CELL_VALUES')) {
      throw new Error(
        `${label} file failed structural validation -- issues: ${JSON.stringify(outcome.issues)}`,
      );
    }
    if (outcome.issues.some((issue) => issue.severity === 'ERROR')) {
      console.error(
        `${label} file has ${outcome.totalRowCount - outcome.normalized.length} row(s) excluded by validation errors -- issues: ${JSON.stringify(outcome.issues)}`,
      );
    }
  }

  const transactions = [
    ...toNormalizedTransactions(bankOutcome.normalized, {
      runId: `analysis-${options.accountId}`,
      sourceFileId: 'bank',
      spreadsheetFileName: basename(options.bankPath),
      config,
    }),
    ...toNormalizedTransactions(glOutcome.normalized, {
      runId: `analysis-${options.accountId}`,
      sourceFileId: 'gl',
      spreadsheetFileName: basename(options.glPath),
      config,
    }),
  ];

  const active = transactions.filter(
    (item) => !item.isExcluded && item.dataQualityIssues.length === 0,
  );
  const bankTx = active.filter((item) => item.source === 'bank');
  const glTx = active.filter((item) => item.source === 'gl');

  const bankAmountFrequency = buildAmountFrequency(bankTx);
  const glAmountFrequency = buildAmountFrequency(glTx);

  const countGreedyMatches = (maxDays: number): number => {
    const usedGl = new Set<string>();
    let matched = 0;

    for (const bankItem of bankTx) {
      let bestIndex = -1;
      let bestDiff = Number.POSITIVE_INFINITY;

      for (let index = 0; index < glTx.length; index += 1) {
        const glItem = glTx[index];
        if (!glItem || usedGl.has(glItem.id) || !sameAmount(bankItem.amount, glItem.amount)) {
          continue;
        }

        const diff = absDays(
          bankItem.transactionDate ?? bankItem.postingDate,
          glItem.transactionDate ?? glItem.postingDate,
        );
        if (diff === null || diff > maxDays) {
          continue;
        }

        if (diff < bestDiff) {
          bestDiff = diff;
          bestIndex = index;
        }
      }

      if (bestIndex >= 0) {
        usedGl.add(glTx[bestIndex]!.id);
        matched += 1;
      }
    }

    return matched;
  };

  const countGreedyMatchesWithSimilarity = (maxDays: number, minSimilarity: number): number => {
    const usedGl = new Set<string>();
    let matched = 0;

    for (const bankItem of bankTx) {
      let bestIndex = -1;
      let bestScore = -1;

      for (let index = 0; index < glTx.length; index += 1) {
        const glItem = glTx[index];
        if (!glItem || usedGl.has(glItem.id) || !sameAmount(bankItem.amount, glItem.amount)) {
          continue;
        }

        const diff = absDays(
          bankItem.transactionDate ?? bankItem.postingDate,
          glItem.transactionDate ?? glItem.postingDate,
        );
        if (diff === null || diff > maxDays) {
          continue;
        }

        const similarity = tokenSimilarity(
          bankItem.normalizedComparisonTokens,
          glItem.normalizedComparisonTokens,
        );
        if (similarity < minSimilarity) {
          continue;
        }

        const score = similarity - diff / 100;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }

      if (bestIndex >= 0) {
        usedGl.add(glTx[bestIndex]!.id);
        matched += 1;
      }
    }

    return matched;
  };

  const countGreedyHybridMatches = (
    maxDays: number,
    minSimilarity: number,
    maxOccurrences: number,
  ): number => {
    const usedGl = new Set<string>();
    let matched = 0;

    for (const bankItem of bankTx) {
      let bestIndex = -1;
      let bestScore = -1;

      for (let index = 0; index < glTx.length; index += 1) {
        const glItem = glTx[index];
        if (!glItem || usedGl.has(glItem.id) || !sameAmount(bankItem.amount, glItem.amount)) {
          continue;
        }

        const diff = absDays(
          bankItem.transactionDate ?? bankItem.postingDate,
          glItem.transactionDate ?? glItem.postingDate,
        );
        if (diff === null || diff > maxDays) {
          continue;
        }

        const similarity = tokenSimilarity(
          bankItem.normalizedComparisonTokens,
          glItem.normalizedComparisonTokens,
        );
        const amount = bankItem.amount;
        const isDistinctive =
          amount !== null &&
          (bankAmountFrequency.get(amount) ?? 0) <= maxOccurrences &&
          (glAmountFrequency.get(amount) ?? 0) <= maxOccurrences;

        if (similarity < minSimilarity && !isDistinctive) {
          continue;
        }

        const score = similarity + (isDistinctive ? 0.05 : 0) - diff / 100;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }

      if (bestIndex >= 0) {
        usedGl.add(glTx[bestIndex]!.id);
        matched += 1;
      }
    }

    return matched;
  };

  const isMonthEndTransferProbable = (
    bankItem: (typeof bankTx)[number],
    glItem: (typeof glTx)[number],
    diff: number | null,
  ): boolean => {
    if (!sameAmount(bankItem.amount, glItem.amount)) {
      return false;
    }

    if (diff === null || diff < 3 || diff > 31) {
      return false;
    }

    if (!includesText(bankItem.description, 'online from')) {
      return false;
    }

    if ((glItem.transactionType ?? '').toLowerCase() !== 'journal entry') {
      return false;
    }

    if (!includesText(glItem.description, 'money transfers')) {
      return false;
    }

    if (!isMonthEndDate(glItem.transactionDate ?? glItem.postingDate)) {
      return false;
    }

    const bankDateValue = bankItem.transactionDate ?? bankItem.postingDate;
    const glDateValue = glItem.transactionDate ?? glItem.postingDate;
    if (!bankDateValue || !glDateValue) {
      return false;
    }

    const bankDate = new Date(`${bankDateValue}T00:00:00Z`);
    const glDate = new Date(`${glDateValue}T00:00:00Z`);
    if (glDate < bankDate) {
      return false;
    }

    if (
      bankDate.getUTCFullYear() !== glDate.getUTCFullYear() ||
      bankDate.getUTCMonth() !== glDate.getUTCMonth()
    ) {
      return false;
    }

    return true;
  };

  const classifyModeledMatches = (): {
    counts: Record<MatchKind, number>;
    unmatchedBank: number;
    unmatchedGl: number;
    probablePairs: Array<{ bankLine: number; glLine: number }>;
  } => {
    const candidates: Candidate[] = [];

    for (const bankItem of bankTx) {
      for (const glItem of glTx) {
        if (!sameAmount(bankItem.amount, glItem.amount)) {
          continue;
        }

        const diff = absDays(
          bankItem.transactionDate ?? bankItem.postingDate,
          glItem.transactionDate ?? glItem.postingDate,
        );
        if (diff === null) {
          continue;
        }

        const similarity = tokenSimilarity(
          bankItem.normalizedComparisonTokens,
          glItem.normalizedComparisonTokens,
        );
        const amount = bankItem.amount;
        const distinctiveAmount =
          amount !== null &&
          (bankAmountFrequency.get(amount) ?? 0) <= 1 &&
          (glAmountFrequency.get(amount) ?? 0) <= 1;
        const zeroSimilarityShortTokenFallback =
          similarity === 0 &&
          distinctiveAmount &&
          diff <= 3 &&
          glItem.normalizedComparisonTokens.length <= 2;

        const hasAlternativeTimingCandidate = glTx.some((otherGlItem) => {
          if (otherGlItem.id === glItem.id || !sameAmount(bankItem.amount, otherGlItem.amount)) {
            return false;
          }

          const otherIsMonthEndTransfer = isMonthEndTransferProbable(
            bankItem,
            otherGlItem,
            absDays(
              bankItem.transactionDate ?? bankItem.postingDate,
              otherGlItem.transactionDate ?? otherGlItem.postingDate,
            ),
          );
          if (otherIsMonthEndTransfer) {
            return false;
          }

          const otherDiff = absDays(
            bankItem.transactionDate ?? bankItem.postingDate,
            otherGlItem.transactionDate ?? otherGlItem.postingDate,
          );

          return otherDiff !== null && otherDiff <= 21;
        });

        if (isMonthEndTransferProbable(bankItem, glItem, diff) && !hasAlternativeTimingCandidate) {
          candidates.push({
            bankId: bankItem.id,
            glId: glItem.id,
            bankLine: bankItem.lineNumber,
            glLine: glItem.lineNumber,
            score: 100 - diff,
            kind: 'Probable',
          });
          continue;
        }

        if (diff <= 5 && (similarity >= 0.12 || zeroSimilarityShortTokenFallback)) {
          candidates.push({
            bankId: bankItem.id,
            glId: glItem.id,
            bankLine: bankItem.lineNumber,
            glLine: glItem.lineNumber,
            score: 80 + similarity - diff / 100,
            kind: 'Exact',
          });
          continue;
        }

        if (diff <= 21) {
          candidates.push({
            bankId: bankItem.id,
            glId: glItem.id,
            bankLine: bankItem.lineNumber,
            glLine: glItem.lineNumber,
            score: 40 - diff / 100,
            kind: 'Timing',
          });
        }
      }
    }

    candidates.sort((left, right) => right.score - left.score);

    const matchedBank = new Set<string>();
    const matchedGl = new Set<string>();
    const counts: Record<MatchKind, number> = { Exact: 0, Timing: 0, Probable: 0 };
    const probablePairs: Array<{ bankLine: number; glLine: number }> = [];

    for (const candidate of candidates) {
      if (matchedBank.has(candidate.bankId) || matchedGl.has(candidate.glId)) {
        continue;
      }

      matchedBank.add(candidate.bankId);
      matchedGl.add(candidate.glId);
      counts[candidate.kind] += 1;
      if (candidate.kind === 'Probable') {
        probablePairs.push({ bankLine: candidate.bankLine, glLine: candidate.glLine });
      }
    }

    return {
      counts,
      unmatchedBank: bankTx.length - matchedBank.size,
      unmatchedGl: glTx.length - matchedGl.size,
      probablePairs,
    };
  };

  const countsByWindow = Object.fromEntries(
    options.windows.map((days) => [days, countGreedyMatches(days)]),
  );
  const similarityCounts = Object.fromEntries(
    options.thresholds.map((threshold) => [
      threshold,
      countGreedyMatchesWithSimilarity(options.similarityDays, threshold),
    ]),
  );

  const hybridCounts = Object.fromEntries(
    options.hybridThresholds.flatMap((threshold) =>
      options.hybridOccurrences.map((occurrence) => {
        const thresholdLabel = threshold.toString().replace('.', '_');
        const key = `sim_${thresholdLabel}_occ_${occurrence}`;
        return [
          key,
          countGreedyHybridMatches(options.similarityDays, threshold, occurrence),
        ] as const;
      }),
    ),
  );

  const result = {
    accountId: options.accountId,
    files: {
      bank: options.bankPath,
      gl: options.glPath,
    },
    settings: {
      windows: options.windows,
      thresholds: options.thresholds,
      similarityDays: options.similarityDays,
      hybridThresholds: options.hybridThresholds,
      hybridOccurrences: options.hybridOccurrences,
    },
    bankActive: bankTx.length,
    glActive: glTx.length,
    dataQualityBank: transactions.filter(
      (item) => item.source === 'bank' && item.dataQualityIssues.length > 0 && !item.isExcluded,
    ).length,
    dataQualityGl: transactions.filter(
      (item) => item.source === 'gl' && item.dataQualityIssues.length > 0 && !item.isExcluded,
    ).length,
    countsByWindow,
    similarityCountsWithinConfiguredDays: similarityCounts,
    hybridCountsWithinConfiguredDays: hybridCounts,
    modeledCounts: classifyModeledMatches(),
  };

  console.log(JSON.stringify(result, null, 2));
};

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
