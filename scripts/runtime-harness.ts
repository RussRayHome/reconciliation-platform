import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const apiPort = 4000;
const webPort = 4173;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeLogPath = path.join(repoRoot, 'test-results', 'runtime-api.log');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

type HarnessCommand = 'start' | 'restart' | 'stop' | 'status';
type PortStatus = {
  port: number;
  pids: number[];
};

const isHarnessCommand = (value: string | undefined): value is HarnessCommand =>
  value === 'start' || value === 'restart' || value === 'stop' || value === 'status';

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const parseNumericLines = (value: string): number[] =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(Number)
    .filter((line) => Number.isInteger(line) && line > 0);

const listPortPids = async (port: number): Promise<number[]> => {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp']);

      return stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.includes('LISTENING'))
        .map((line) => line.split(/\s+/u))
        .filter((parts) => parts.length >= 5 && parts[1]?.endsWith(`:${port}`))
        .map((parts) => Number(parts[4]))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
    } catch {
      return [];
    }
  }

  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${port}`]);
    return parseNumericLines(stdout);
  } catch {
    return [];
  }
};

const getPortStatuses = async (): Promise<PortStatus[]> => {
  const [apiPids, webPids] = await Promise.all([listPortPids(apiPort), listPortPids(webPort)]);

  return [
    { port: apiPort, pids: apiPids },
    { port: webPort, pids: webPids },
  ];
};

const isPidRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const terminatePid = async (pid: number): Promise<void> => {
  if (!isPidRunning(pid)) {
    return;
  }

  process.kill(pid, 'SIGTERM');

  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (!isPidRunning(pid)) {
      return;
    }

    await delay(100);
  }

  if (isPidRunning(pid)) {
    process.kill(pid, 'SIGKILL');
  }
};

const printStatus = async (): Promise<number> => {
  const statuses = await getPortStatuses();

  statuses.forEach((status) => {
    if (status.pids.length === 0) {
      console.log(`Port ${status.port}: free`);
      return;
    }

    console.log(`Port ${status.port}: listening (${status.pids.join(', ')})`);
  });

  return statuses.some((status) => status.pids.length > 0) ? 1 : 0;
};

const stopHarness = async (): Promise<number> => {
  const statuses = await getPortStatuses();
  const pids = [...new Set(statuses.flatMap((status) => status.pids))];

  if (pids.length === 0) {
    console.log('Runtime harness is already stopped.');
    return 0;
  }

  for (const pid of pids) {
    await terminatePid(pid);
  }

  console.log(`Stopped runtime harness processes: ${pids.join(', ')}`);
  return 0;
};

const spawnHarnessChild = (
  label: string,
  workspaceName: '@recon/api' | '@recon/web',
  envOverrides: NodeJS.ProcessEnv,
): ChildProcess => {
  const child = spawn(
    npmExecutable,
    ['run', 'dev:test', '--workspace', workspaceName],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: 'inherit',
    },
  );

  child.on('error', (error) => {
    console.error(`${label} failed to start: ${error.message}`);
  });

  return child;
};

const startHarness = async (): Promise<number> => {
  const statuses = await getPortStatuses();
  const occupied = statuses.filter((status) => status.pids.length > 0);

  if (occupied.length > 0) {
    occupied.forEach((status) => {
      console.error(`Port ${status.port} is already in use by PID(s): ${status.pids.join(', ')}`);
    });
    console.error('Run `npm run harness:stop` first, then retry `npm run harness:start`.');
    return 1;
  }

  await mkdir(path.dirname(runtimeLogPath), { recursive: true });

  const apiChild = spawnHarnessChild('API', '@recon/api', {
    PORT: String(apiPort),
    LOG_FILE: runtimeLogPath,
  });
  const webChild = spawnHarnessChild('WEB', '@recon/web', {
    VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
  });

  const children = [apiChild, webChild];
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals | 'EXIT', exitCode = 0): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    children.forEach((child) => {
      if (!child.killed) {
        child.kill(signal === 'EXIT' ? 'SIGTERM' : signal);
      }
    });

    if (signal !== 'EXIT') {
      process.exit(exitCode);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return await new Promise<number>((resolve) => {
    let settled = false;

    const settle = (code: number) => {
      if (settled) {
        return;
      }

      settled = true;
      shutdown('EXIT', code);
      resolve(code);
    };

    apiChild.on('exit', (code) => {
      settle(code ?? 0);
    });

    webChild.on('exit', (code) => {
      settle(code ?? 0);
    });
  });
};

const restartHarness = async (): Promise<number> => {
  await stopHarness();
  return startHarness();
};

const main = async (): Promise<void> => {
  const command = process.argv[2];

  if (!isHarnessCommand(command)) {
    console.error('Usage: npm run harness:start | npm run harness:restart | npm run harness:stop | npm run harness:status');
    process.exitCode = 1;
    return;
  }

  if (command === 'start') {
    process.exitCode = await startHarness();
    return;
  }

  if (command === 'restart') {
    process.exitCode = await restartHarness();
    return;
  }

  if (command === 'stop') {
    process.exitCode = await stopHarness();
    return;
  }

  process.exitCode = await printStatus();
};

await main();