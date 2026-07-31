import type { Level, LevelWithSilent } from 'pino';

const isTestRuntime = (): boolean =>
  process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

const pinoLevels: readonly Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

const minimumLevelIndex = pinoLevels.indexOf('info');

const isPinoLevel = (value: string): value is Level =>
  (pinoLevels as readonly string[]).includes(value);

/**
 * Resolves the effective pino log level from the configured value, enforcing a floor of
 * `info` verbosity in non-test runtimes — quieter levels (`warn`/`error`/`fatal`) are promoted
 * up to `info` so operational messages are never silently suppressed, while louder levels
 * (`debug`/`trace`) pass through unchanged since they already include everything `info` would.
 * `silent` is only permitted when `NODE_ENV=test` or `VITEST=true`; otherwise it is promoted to
 * `info`. Invalid level strings fall back to `info`.
 */
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

  return pinoLevels.indexOf(normalized) > minimumLevelIndex ? 'info' : normalized;
};
