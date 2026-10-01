import { Redis } from 'ioredis';
import { config } from './config';
import { logger } from './logger';

const REDIS_COMMAND_TIMEOUT_MS = 2_000;
const REDIS_CONNECT_TIMEOUT_MS = 2_000;

let client: Redis | undefined;

/** Lazily-created shared ioredis client. */
export const getRedis = (): Redis => {
  if (!client) {
    client = new Redis(config.REDIS_URL, {
      // While disconnected, ioredis queues commands and keeps reconnecting in the background.
      // Cap how long any single command may wait so callers fail fast instead of hanging.
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
    });
    client.on('error', (err) => logger.warn({ err: err.message }, 'redis connection error'));
  }
  return client;
};

/** Test hook: inject a client (e.g. ioredis-mock). */
export const setRedis = (redis: Redis): void => {
  client = redis;
};

export const closeRedis = async (): Promise<void> => {
  if (client) {
    await client.quit().catch(() => client?.disconnect());
    client = undefined;
  }
};
