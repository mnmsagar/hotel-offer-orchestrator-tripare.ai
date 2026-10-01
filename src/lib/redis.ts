import { Redis } from 'ioredis';
import { config } from './config';
import { logger } from './logger';

let client: Redis | undefined;

/** Lazily-created shared ioredis client. */
export const getRedis = (): Redis => {
  if (!client) {
    client = new Redis(config.REDIS_URL, {
      // Fail requests fast instead of queueing them forever while Redis is down.
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
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
