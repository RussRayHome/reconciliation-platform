import { startServer } from './server';
import { startWorker } from './worker';

/** PROCESS_MODE (Issue #134 phase 3): 'server' (default) runs the Express API; 'worker' runs the
 * standalone BullMQ consumer process (see worker.ts). Same image, different entrypoint -- Dev/
 * Stage's compose.dev.yaml runs both as separate services/containers against the same Redis.
 * Static imports (not top-level await + dynamic import) deliberately -- apps/api builds to CJS
 * (tsup.config.ts), which doesn't support top-level await. */
const processMode = process.env.PROCESS_MODE?.trim() || 'server';

if (processMode === 'worker') {
  void startWorker();
} else {
  void startServer();
}
