import type { Redis } from 'ioredis';
import type { HotelOffer, PriceRange } from '../domain/types';
import { normalizeKey } from '../domain/types';
import { redisKeys } from './redisKeys';

export interface CityCacheMeta {
  count: number;
  updatedAt: string;
  /** True when a supplier failed, so the cached list may be missing hotels. */
  partial: boolean;
}

export interface WriteCityOffersOptions {
  ttlSeconds: number;
  partial?: boolean;
  now?: Date;
}

/**
 * Atomically replaces the cached offers for a city.
 *
 * MULTI/EXEC queues every command and runs them as one unit, so readers never observe a
 * half-written city (e.g. the sorted set updated but the hash not yet).
 */
export const writeCityOffers = async (
  redis: Redis,
  city: string,
  offers: readonly HotelOffer[],
  { ttlSeconds, partial = false, now = new Date() }: WriteCityOffersOptions,
): Promise<void> => {
  const keys = { byPrice: redisKeys.byPrice(city), data: redisKeys.data(city), meta: redisKeys.meta(city) };
  const meta: CityCacheMeta = { count: offers.length, updatedAt: now.toISOString(), partial };

  const tx = redis.multi().del(keys.byPrice, keys.data, keys.meta);

  if (offers.length > 0) {
    const zaddArgs = offers.flatMap((o) => [o.price, normalizeKey(o.name)]);
    const hashFields = Object.fromEntries(offers.map((o) => [normalizeKey(o.name), JSON.stringify(o)]));
    tx.zadd(keys.byPrice, ...zaddArgs)
      .expire(keys.byPrice, ttlSeconds)
      .hset(keys.data, hashFields)
      .expire(keys.data, ttlSeconds);
  }

  // The meta key exists even for zero results, so "no hotels in this city" is cached too.
  tx.set(keys.meta, JSON.stringify(meta), 'EX', ttlSeconds);

  const results = await tx.exec();
  const failed = results?.find(([err]) => err);
  if (!results || failed) throw failed?.[0] ?? new Error('Redis transaction aborted');
};

const bound = (value: number | undefined, fallback: '-inf' | '+inf'): string =>
  value === undefined ? fallback : String(value);

/**
 * Reads a city's offers filtered by price, entirely inside Redis.
 * Returns `null` on a cache miss (city never cached or expired) so the caller can refresh it.
 */
export const readCityOffers = async (
  redis: Redis,
  city: string,
  range: PriceRange = {},
): Promise<HotelOffer[] | null> => {
  // Round trip 1 (pipelined): check the meta marker and fetch matching names together.
  // ZRANGE ... BYSCORE returns members ordered by score (price), ties ordered by member (name).
  const pipelineResults = await redis
    .pipeline()
    .exists(redisKeys.meta(city))
    .zrange(redisKeys.byPrice(city), bound(range.minPrice, '-inf'), bound(range.maxPrice, '+inf'), 'BYSCORE')
    .exec();

  if (!pipelineResults) throw new Error('Redis pipeline aborted');
  const [existsResult, zrangeResult] = pipelineResults;
  if (existsResult?.[0]) throw existsResult[0];
  if (zrangeResult?.[0]) throw zrangeResult[0];

  if (existsResult?.[1] !== 1) return null;
  const names = zrangeResult?.[1] as string[];
  if (names.length === 0) return [];

  // Round trip 2: fetch the full offer documents for just the matching names.
  const docs = await redis.hmget(redisKeys.data(city), ...names);
  return docs.filter((doc): doc is string => doc !== null).map((doc) => JSON.parse(doc) as HotelOffer);
};

/** True when the city has a (non-expired) cache entry. */
export const hasCityCache = async (redis: Redis, city: string): Promise<boolean> =>
  (await redis.exists(redisKeys.meta(city))) === 1;
