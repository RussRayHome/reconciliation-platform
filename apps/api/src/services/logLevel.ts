import type { Level, LevelWithSilent } from 'pino';

const isTestRuntime = (): boolean =>
  process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

const pinoLevels: readonly Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

const minimumLevelIndex = pinoLevels.indexOf('info');

const isPinoLevel = (value: string): value is Level =>
  (pinoLevels as readonly string[]).includes(value);

export const resolveLogLevelAtLeastInfo = (
  configuredLevel: string | undefined,
): LevelWithSilent => {
  const normalized = (configuredLevel ?? 'info').trim().toLowerCase();

  if (normalized === 'silent') {
    return isTestRuntime() ? 'silent' : 'info';
  }

  if (!isPinoLevel(normalized)) {
    return 'info';
  }

  return pinoLevels.indexOf(normalized) < minimumLevelIndex ? 'info' : normalized;
};
