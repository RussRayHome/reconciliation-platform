/**
 * Dev-only convenience: purges a BullMQ dead-letter queue (reconciliation, import-validation, or
 * both). Runs the actual purge *inside* the `api` container via `docker compose exec` rather than
 * connecting to Redis from the host -- `redis` deliberately has no published port anywhere in
 * compose.yaml/compose.dev.yaml/compose.stage.yaml (it's only reachable on the internal `data`
 * network), and BullMQ's own `Queue.obliterate({force: true})` is the correct, schema-aware way to
 * purge a queue -- hand-rolled `redis-cli DEL`/`LREM` against BullMQ's internal key structure risks
 * corrupting index state a raw command wouldn't know to update.
 *
 * Usage: tsx scripts/clear-dead-letter-queue.ts <reconciliation|import-validation|all> [--force]
 */
import { runDockerCompose, resolveDockerEnvFile } from './docker-runtime';

type QueueTarget = 'reconciliation' | 'import-validation' | 'all';

const QUEUE_NAME_BY_TARGET: Record<Exclude<QueueTarget, 'all'>, string> = {
  reconciliation: 'reconciliation-runs',
  'import-validation': 'import-validation-runs',
};

const usage = [
  'Usage: tsx scripts/clear-dead-letter-queue.ts <reconciliation|import-validation|all> [--force]',
  '',
  'Purges the given dead-letter queue (or both) inside the running `api` container.',
  '--force is required when the resolved Docker env file targets Stage -- this is a dev',
  'convenience, not an operational tool for a shared environment.',
].join('\n');

const asTarget = (value: string | undefined): QueueTarget | null => {
  if (value === 'reconciliation' || value === 'import-validation' || value === 'all') {
    return value;
  }

  return null;
};

/** Builds the inline Node script run inside the `api` container. Plain CommonJS (`node -e`
 * defaults to CommonJS regardless of the package's own "type": "module") so no build step is
 * needed -- `bullmq` and the queue Redis URL env vars are already present in that container. */
const buildPurgeScript = (queueName: string): string => `
const { Queue } = require('bullmq');

const redisUrl =
  process.env.${queueName === QUEUE_NAME_BY_TARGET.reconciliation ? 'RECONCILIATION_QUEUE_REDIS_URL' : 'IMPORT_VALIDATION_QUEUE_REDIS_URL'} ||
  process.env.RATE_LIMIT_REDIS_URL ||
  process.env.REDIS_URL;

if (!redisUrl) {
  console.error('No Redis URL configured for ${queueName} -- is the queue enabled in this environment?');
  process.exit(1);
}

const parsed = new URL(redisUrl);
const connection = {
  host: parsed.hostname,
  port: Number(parsed.port) || 6379,
  username: parsed.username || undefined,
  password: parsed.password || undefined,
  db: Number(parsed.pathname.replace('/', '')) || undefined,
  tls: parsed.protocol === 'rediss:' ? {} : undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

(async () => {
  const dlq = new Queue('${queueName}-dlq', { connection, prefix: 'recon' });
  const before = await dlq.getJobCounts('waiting');
  await dlq.obliterate({ force: true });
  console.log(\`${queueName}-dlq: removed \${before.waiting ?? 0} job(s)\`);
  await dlq.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

const purgeQueue = async (target: Exclude<QueueTarget, 'all'>): Promise<void> => {
  const queueName = QUEUE_NAME_BY_TARGET[target];
  const output = await runDockerCompose([
    'exec',
    '-T',
    'api',
    'node',
    '-e',
    buildPurgeScript(queueName),
  ]);
  console.log(output);
};

const main = async (): Promise<void> => {
  const target = asTarget(process.argv[2]);
  const force = process.argv.includes('--force');

  if (!target) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  const envFile = resolveDockerEnvFile();
  if (envFile.includes('stage') && !force) {
    console.error(
      `Resolved Docker env file (${envFile}) targets Stage. This is a dev-only convenience -- ` +
        're-run with --force if you really mean to purge a dead-letter queue on a shared environment.',
    );
    process.exitCode = 1;
    return;
  }

  const targets: Exclude<QueueTarget, 'all'>[] =
    target === 'all' ? ['reconciliation', 'import-validation'] : [target];

  for (const queueTarget of targets) {
    await purgeQueue(queueTarget);
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
