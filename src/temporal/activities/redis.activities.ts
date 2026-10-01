import { Context } from '@temporalio/activity';
import type { Redis } from 'ioredis';
import type { HotelOffer } from '../../domain/types';
import { writeCityOffers } from '../../lib/hotelCache';
import type { Logger } from '../../lib/logger';

export interface RedisActivityDeps {
  getRedis: () => Redis;
  cacheTtlSeconds: number;
  logger: Logger;
}

const currentWorkflowId = (): string | undefined => {
  try {
    return Context.current().info.workflowExecution?.workflowId;
  } catch {
    return undefined; // Called outside a worker (tests).
  }
};

export const createRedisActivities = ({ getRedis, cacheTtlSeconds, logger }: RedisActivityDeps) => ({
  /** Replaces the city's cached offers (sorted set + hash + meta marker) in one MULTI transaction. */
  async saveToRedis(city: string, offers: HotelOffer[]): Promise<void> {
    await writeCityOffers(getRedis(), city, offers, cacheTtlSeconds);
    logger.info({ city, workflowId: currentWorkflowId(), count: offers.length }, 'cached hotel offers');
  },
});
