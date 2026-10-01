import { setTimeout as sleep } from 'node:timers/promises';
import { NativeConnection, Worker } from '@temporalio/worker';
import { createActivities } from '../temporal/activities';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import { closeRedis, getRedis } from '../lib/redis';

const MAX_BACKOFF_MS = 10_000;

/** Temporal may still be booting (e.g. under docker compose): keep retrying instead of crashing. */
const connectWithRetry = async (): Promise<NativeConnection> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
    } catch (err) {
      const delay = Math.min(500 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      logger.warn({ attempt, delay, err: (err as Error).message }, 'Temporal not reachable, retrying');
      await sleep(delay);
    }
  }
};

const run = async (): Promise<void> => {
  const connection = await connectWithRetry();
  logger.info({ address: config.TEMPORAL_ADDRESS }, 'connected to Temporal');

  try {
    const worker = await Worker.create({
      connection,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      // Resolves to dist/temporal/workflows/index.js when compiled, or the .ts file under tsx.
      // The worker bundles this entry with webpack into an isolated, deterministic sandbox.
      workflowsPath: require.resolve('../temporal/workflows'),
      activities: createActivities({
        supplierBaseUrl: config.SUPPLIER_BASE_URL,
        supplierTimeoutMs: config.SUPPLIER_TIMEOUT_MS,
        getRedis,
        cacheTtlSeconds: config.CACHE_TTL_SECONDS,
        partialCacheTtlSeconds: config.PARTIAL_CACHE_TTL_SECONDS,
        logger,
      }),
    });

    logger.info({ taskQueue: config.TEMPORAL_TASK_QUEUE }, 'worker started');
    // Resolves after SIGINT/SIGTERM, once in-flight tasks finish (the SDK installs those handlers).
    await worker.run();
    logger.info('worker stopped');
  } finally {
    await connection.close();
    await closeRedis();
  }
};

run().catch((err: unknown) => {
  logger.fatal({ err }, 'worker crashed');
  process.exit(1);
});
