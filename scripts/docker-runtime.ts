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
const fallbackComposeEnvFile = path.join(repoRoot, '.env.docker.example');

export type ComposeService = 'postgres' | 'migrate' | 'api' | 'web';

const resolveEnvFilePath = (value: string): string =>
	path.isAbsolute(value) ? value : path.resolve(repoRoot, value);

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

export const delay = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export const runDockerCommand = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('docker', args, {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 10,
  });

  return stdout.trim();
};

export const runDockerCompose = async (args: string[]): Promise<string> =>
  await runDockerCommand([...resolveComposeArgs(), ...args]);

export const ensureDockerCli = (): void => {
  // `docker` existence is validated through `execFile`; this gives a clearer message up front.
  if (!process.env.PATH) {
    throw new Error('PATH is not configured; Docker CLI cannot be resolved.');
  }
};

export const isDockerDesktopReady = async (): Promise<boolean> => {
  try {
    await runDockerCommand(['info']);
    return true;
  } catch {
    return false;
  }
};

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

export const composePs = async (services: ComposeService[] = []): Promise<string> =>
  await runDockerCompose(['ps', ...services]);

export const composeUp = async (services: ComposeService[], build = false): Promise<string> => {
  const args = ['up', '-d'];
  if (build) {
    args.push('--build');
  }

  return await runDockerCompose([...args, ...services]);
};

export const composeStop = async (services: ComposeService[]): Promise<string> =>
  await runDockerCompose(['stop', ...services]);

export const dockerDesktopPlatformLabel = (): string =>
  process.platform === 'darwin' ? `macOS ${os.release()}` : process.platform;
