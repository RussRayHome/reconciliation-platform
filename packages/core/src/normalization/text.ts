import type { TextNormalizationConfig } from '@recon/domain';

const punctuationPattern = /[^A-Z0-9\s]/g;

export const normalizeText = (value: string | undefined, config: TextNormalizationConfig): string => {
  if (!value) {
    return '';
  }

  let output = value;
  if (config.uppercase) {
    output = output.toUpperCase();
  }

  if (config.stripPunctuation) {
    output = output.replace(punctuationPattern, ' ');
  }

  if (config.collapseWhitespace) {
    output = output.replace(/\s+/g, ' ').trim();
  }

  if (config.removeStopWords) {
    const stopWords = new Set(config.stopWords.map((word) => word.toUpperCase()));
    output = output
      .split(' ')
      .filter((token) => token && !stopWords.has(token))
      .join(' ');
  }

  return output.trim();
};

export const buildComparisonTokens = (
  values: Array<string | undefined>,
  config: TextNormalizationConfig,
): string[] => {
  const tokenSet = new Set<string>();

  values
    .map((value) => normalizeText(value, config))
    .filter(Boolean)
    .forEach((value) => {
      value.split(' ').forEach((token) => {
        if (token) {
          tokenSet.add(token);
        }
      });
    });

  return [...tokenSet].sort();
};
