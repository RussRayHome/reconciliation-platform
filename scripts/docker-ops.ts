/**
 * Higher-level Docker stack lifecycle operations: startup sequences, graceful shutdown,
 * health verification, and auxiliary service management. Builds on the primitives in
 * `docker-runtime.ts`. Invoked by the `docker:deploy`, `docker:cleanup`, and related npm scripts.
 */
import {
  composePs,
  composeStop,
  composeUp,
  dockerDesktopPlatformLabel,
  ensureDockerDesktopRunning,
  isDockerDesktopReady,
  stopDockerDesktop,
  type ComposeService,
} from './docker-runtime';

type Scope = 'web' | 'db' | 'docker' | 'stack';
type Action = 'start' | 'stop' | 'restart';

const usage = [
  'Usage: tsx scripts/docker-ops.ts <scope> <action>',
  'Scopes:',
  '  web     start | stop',
  '  db      start | stop',
  '  docker  stop | restart',
  '  stack   start | stop',
].join('\n');

const asScope = (value: string | undefined): Scope | null => {
  if (value === 'web' || value === 'db' || value === 'docker' || value === 'stack') {
    return value;
  }

  return null;
};

const asAction = (value: string | undefined): Action | null => {
  if (value === 'start' || value === 'stop' || value === 'restart') {
    return value;
  }

  return null;
};

const printPs = async (services: ComposeService[]): Promise<void> => {
  if (!(await isDockerDesktopReady())) {
    return;
  }

  const output = await composePs(services);
  if (output) {
    console.log(output);
  }
};

const startServices = async (services: ComposeService[]): Promise<void> => {
  await ensureDockerDesktopRunning();
  await composeUp(services);
  await printPs(services);
};

const stopServices = async (services: ComposeService[]): Promise<void> => {
  await ensureDockerDesktopRunning();
  await composeStop(services);
  await printPs(services);
};

const stopStack = async (): Promise<void> => {
  if (await isDockerDesktopReady()) {
    if ((await composePs([])).length > 0) {
      await composeStop(['web', 'api', 'postgres']);
    }

    await stopDockerDesktop();
    console.log('Containerized stack stopped and Docker Desktop closed.');
    return;
  }

  console.log('Docker Desktop is already stopped.');
};

const commands: Record<Scope, Partial<Record<Action, () => Promise<void>>>> = {
  web: {
    start: async () => await startServices(['web']),
    stop: async () => await stopServices(['web']),
  },
  db: {
    start: async () => await startServices(['postgres']),
    stop: async () => await stopServices(['postgres']),
  },
  docker: {
    stop: async () => {
      await stopDockerDesktop();
      console.log(`Docker Desktop stopped on ${dockerDesktopPlatformLabel()}.`);
    },
    restart: async () => {
      await stopDockerDesktop();
      await ensureDockerDesktopRunning();
      await printPs([]);
    },
  },
  stack: {
    start: async () => await startServices(['postgres', 'migrate', 'api', 'web']),
    stop: stopStack,
  },
};

const run = async (scope: Scope, action: Action): Promise<void> => {
  const command = commands[scope][action];
  if (!command) {
    throw new Error(usage);
  }

  await command();
};

const main = async (): Promise<void> => {
  const scope = asScope(process.argv[2]);
  const action = asAction(process.argv[3]);

  if (!scope || !action) {
    throw new Error(usage);
  }

  await run(scope, action);
};

await main();