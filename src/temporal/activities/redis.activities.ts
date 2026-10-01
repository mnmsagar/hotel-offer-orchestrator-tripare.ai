import { Context } from '@temporalio/activity';
import type { Redis } from 'ioredis';
import type { HotelOffer } from '../../domain/types';
import { writeCityOffers } from '../../lib/hotelCache';
import type { Logger } from '../../lib/logger';

export interface RedisActivityDeps {
  getRedis: () => Redis;
  cacheTtlSeconds: number;
  /** Shorter TTL for results built while a supplier was down, so they refresh soon. */
  partialCacheTtlSeconds: number;
  logger: Logger;
}

export interface SaveToRedisOptions {
  /** A supplier failed, so the list may be missing hotels. */
  partial?: boolean;
}

const currentWorkflowId = (): string | undefined => {
  try {
    return Context.current().info.workflowExecution?.workflowId;
  } catch {
    return undefined; // Called outside a worker (tests).
  }
};

export const createRedisActivities = ({
  getRedis,
  cacheTtlSeconds,
  partialCacheTtlSeconds,
  logger,
}: RedisActivityDeps) => ({
  /** Replaces the city's cached offers (sorted set + hash + meta marker) in one MULTI transaction. */
  async saveToRedis(city: string, offers: HotelOffer[], { partial = false }: SaveToRedisOptions = {}): Promise<void> {
    const ttlSeconds = partial ? Math.min(partialCacheTtlSeconds, cacheTtlSeconds) : cacheTtlSeconds;
    await writeCityOffers(getRedis(), city, offers, { ttlSeconds, partial });
    logger.info({ city, workflowId: currentWorkflowId(), count: offers.length, partial, ttlSeconds }, 'cached hotel offers');
  },
});
