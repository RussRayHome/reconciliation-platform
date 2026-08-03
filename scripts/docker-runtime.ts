/**
 * Low-level Docker and Docker Desktop runtime helpers: process detection, compose
 * invocation, container health polling, and cross-platform Docker Desktop control.
 * Used as the foundation by `docker-ops.ts` and the preflight/predeploy scripts.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(repoRoot, 'compose.yaml');
const defaultComposeEnvFile = path.join(repoRoot, '.env.docker');
const fallbackComposeEnvFile = path.join(repoRoot, '.env.docker.dev.fallback');

/** Named compose service identifiers used as arguments to `composeUp` and `composeStop`. */
export type ComposeService = 'postgres' | 'migrate' | 'api' | 'web';

const resolveEnvFilePath = (value: string): string =>
  path.isAbsolute(value) ? value : path.resolve(repoRoot, value);

/** Resolves the active Docker env file path from `DOCKER_ENV_FILE` env var or falls back to the dev fallback. */
export const resolveDockerEnvFile = (): string => {
  const configuredEnvFile = process.env.DOCKER_ENV_FILE ?? process.env.DOCKER_COMPOSE_ENV_FILE;
  if (configuredEnvFile) {
    return resolveEnvFilePath(configuredEnvFile);
  }

  if (fs.existsSync(defaultComposeEnvFile)) {
    return defaultComposeEnvFile;
  }

  return fallbackComposeEnvFile;
};

const resolveComposeArgs = (): string[] => {
  const envFile = resolveDockerEnvFile();

  const args = ['compose', '-f', composeFile];
  if (fs.existsSync(envFile)) {
    args.push('--env-file', envFile);
  }

  return args;
};

/** Returns a promise that resolves after `milliseconds` ms; used for polling retry loops. */
export const delay = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/** Runs a `docker` command with the given args in the repo root and returns trimmed stdout. */
export const runDockerCommand = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('docker', args, {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 10,
  });

  return stdout.trim();
};

/** Runs a `docker compose` command using the resolved compose file and env file. */
export const runDockerCompose = async (args: string[]): Promise<string> =>
  await runDockerCommand([...resolveComposeArgs(), ...args]);

/** Throws with a clear message if `PATH` is unset, preventing a confusing `ENOENT` from execFile. */
export const ensureDockerCli = (): void => {
  // `docker` existence is validated through `execFile`; this gives a clearer message up front.
  if (!process.env.PATH) {
    throw new Error('PATH is not configured; Docker CLI cannot be resolved.');
  }
};

/** Returns `true` if the Docker daemon is reachable (i.e. `docker info` exits 0). */
export const isDockerDesktopReady = async (): Promise<boolean> => {
  try {
    await runDockerCommand(['info']);
    return true;
  } catch {
    return false;
  }
};

/** Polls `isDockerDesktopReady` every second until the daemon responds or `maxAttempts` is exceeded. */
export const waitForDockerDesktop = async (maxAttempts = 120): Promise<void> => {
  ensureDockerCli();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isDockerDesktopReady()) {
      return;
    }

    await delay(1000);
  }

  throw new Error('Docker Desktop did not become ready in time.');
};

/** Ensures Docker Desktop is running; launches it on macOS via `open -a Docker` if it is not. */
export const ensureDockerDesktopRunning = async (): Promise<void> => {
  ensureDockerCli();

  if (await isDockerDesktopReady()) {
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Docker is not running. Start your Docker daemon, then retry.');
  }

  await execFileAsync('open', ['-a', 'Docker'], { cwd: repoRoot });
  await waitForDockerDesktop();
};

/** Quits Docker Desktop via AppleScript on macOS and polls until the daemon is no longer reachable. */
export const stopDockerDesktop = async (): Promise<void> => {
  ensureDockerCli();

  if (!(await isDockerDesktopReady())) {
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Automatic Docker shutdown is only implemented for macOS.');
  }

  await execFileAsync('osascript', ['-e', 'quit app "Docker"'], { cwd: repoRoot });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (!(await isDockerDesktopReady())) {
      return;
    }

    await delay(1000);
  }

  throw new Error('Docker Desktop did not stop in time.');
};

/** Returns `docker compose ps` output, optionally scoped to the given services. */
export const composePs = async (services: ComposeService[] = []): Promise<string> =>
  await runDockerCompose(['ps', ...services]);

/** Runs `docker compose up -d [--build]` for the specified services. */
export const composeUp = async (services: ComposeService[], build = false): Promise<string> => {
  const args = ['up', '-d'];
  if (build) {
    args.push('--build');
  }

  return await runDockerCompose([...args, ...services]);
};

/** Runs `docker compose stop` for the specified services. */
export const composeStop = async (services: ComposeService[]): Promise<string> =>
  await runDockerCompose(['stop', ...services]);

/** Returns a short OS identifier string for display in preflight output. */
export const dockerDesktopPlatformLabel = (): string =>
  process.platform === 'darwin' ? `macOS ${os.release()}` : process.platform;
