/**
 * Prints the current API and web runtime mode (harness vs Docker vs dev server) along
 * with active port listeners. Used for quick local environment diagnostics.
 * Invoked via `npm run runtime:status`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { composePs, isDockerDesktopReady } from './docker-runtime';

const execFileAsync = promisify(execFile);

type Listener = {
  command: string;
  pid: string;
};

const listListeners = async (port: number): Promise<Listener[]> => {
  if (process.platform === 'win32') {
    return [];
  }

  try {
    const { stdout } = await execFileAsync('lsof', [
      '-nP',
      '-iTCP:' + String(port),
      '-sTCP:LISTEN',
    ]);
    return stdout
      .split(/\r?\n/u)
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(/\s+/u))
      .filter((parts) => parts.length >= 2)
      .map((parts) => ({ command: parts[0] ?? 'unknown', pid: parts[1] ?? 'unknown' }));
  } catch {
    return [];
  }
};

const listComposeServices = async (): Promise<Set<string>> => {
  if (!(await isDockerDesktopReady())) {
    return new Set();
  }

  try {
    const output = await composePs([]);
    const services = output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.startsWith('NAME'))
      .map((line) => line.split(/\s+/u)[0])
      .filter((name): name is string => Boolean(name));
    return new Set(services);
  } catch {
    return new Set();
  }
};

const describeListeners = (listeners: Listener[]): string => {
  if (listeners.length === 0) {
    return 'none';
  }

  return listeners.map((listener) => `${listener.command}(${listener.pid})`).join(', ');
};

const main = async (): Promise<void> => {
  const [port4000, port4173, port5173, composeServices, dockerReady] = await Promise.all([
    listListeners(4000),
    listListeners(4173),
    listListeners(5173),
    listComposeServices(),
    isDockerDesktopReady(),
  ]);

  let webRuntime = 'not running';
  if (composeServices.has('recon-web') || composeServices.has('web')) {
    webRuntime = 'Nginx container via Docker Compose on 4173';
  } else if (port5173.length > 0) {
    webRuntime = 'Vite dev server on 5173';
  } else if (port4173.length > 0) {
    webRuntime = 'Vite dev server on 4173 (runtime harness mode)';
  }

  let apiRuntime = 'not running';
  if (composeServices.has('recon-api') || composeServices.has('api')) {
    apiRuntime = 'Express API container on the internal Docker Compose network';
  } else if (port4000.length > 0) {
    apiRuntime = 'Local Node/tsx API on 4000';
  }

  console.log(`Docker Desktop: ${dockerReady ? 'ready' : 'not ready'}`);
  console.log(`Web runtime: ${webRuntime}`);
  console.log(`API runtime: ${apiRuntime}`);
  console.log(`Port 5173 listeners: ${describeListeners(port5173)}`);
  console.log(`Port 4173 listeners: ${describeListeners(port4173)}`);
  console.log(`Port 4000 listeners: ${describeListeners(port4000)}`);
};

await main();
