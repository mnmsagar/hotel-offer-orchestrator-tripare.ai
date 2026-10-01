import { beforeEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { readCityOffers, writeCityOffers } from '../src/lib/hotelCache';
import { redisKeys } from '../src/lib/redisKeys';
import type { HotelOffer } from '../src/domain/types';
import { createRedisActivities } from '../src/temporal/activities/redis.activities';
import { silentLogger } from './helpers';

const offers: HotelOffer[] = [
  { name: 'Bloomrooms', price: 2800, supplier: 'Supplier B', commissionPct: 7 },
  { name: 'The Lalit', price: 5200, supplier: 'Supplier A', commissionPct: 10 },
  { name: 'Pride Plaza', price: 5500, supplier: 'Supplier B', commissionPct: 11 },
  { name: 'Taj Palace', price: 5900, supplier: 'Supplier B', commissionPct: 10 },
  { name: 'ITC Maurya', price: 6000, supplier: 'Supplier A', commissionPct: 15 },
];

const names = (list: HotelOffer[] | null) => list?.map((o) => o.name);

describe('hotelCache (Redis filtering)', () => {
  let redis: Redis;

  beforeEach(async () => {
    // ioredis-mock implements the ioredis API in memory; cast because its types are a separate package.
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
    await writeCityOffers(redis, 'Delhi', offers, { ttlSeconds: 300 });
  });

  it('returns null on a cache miss', async () => {
    expect(await readCityOffers(redis, 'atlantis')).toBeNull();
  });

  it('returns everything sorted by price with no bounds', async () => {
    expect(await readCityOffers(redis, 'delhi')).toEqual(offers);
  });

  it('treats both bounds as inclusive', async () => {
    const result = await readCityOffers(redis, 'delhi', { minPrice: 5200, maxPrice: 5900 });
    expect(names(result)).toEqual(['The Lalit', 'Pride Plaza', 'Taj Palace']);
  });

  it('supports only minPrice', async () => {
    expect(names(await readCityOffers(redis, 'delhi', { minPrice: 5900 }))).toEqual(['Taj Palace', 'ITC Maurya']);
  });

  it('supports only maxPrice', async () => {
    expect(names(await readCityOffers(redis, 'delhi', { maxPrice: 5200 }))).toEqual(['Bloomrooms', 'The Lalit']);
  });

  it('returns [] when nothing matches', async () => {
    expect(await readCityOffers(redis, 'delhi', { minPrice: 10000, maxPrice: 20000 })).toEqual([]);
  });

  it('caches empty results as a hit, not a miss', async () => {
    await writeCityOffers(redis, 'atlantis', [], { ttlSeconds: 300 });
    expect(await readCityOffers(redis, 'atlantis')).toEqual([]);
    expect(JSON.parse((await redis.get(redisKeys.meta('atlantis')))!)).toMatchObject({ count: 0 });
  });

  it('replaces stale hotels on rewrite', async () => {
    await writeCityOffers(redis, 'delhi', [offers[0]!], { ttlSeconds: 300 });
    expect(names(await readCityOffers(redis, 'delhi'))).toEqual(['Bloomrooms']);
  });

  it('sets a TTL on every key', async () => {
    for (const key of [redisKeys.byPrice('delhi'), redisKeys.data('delhi'), redisKeys.meta('delhi')]) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
    }
  });

  describe('saveToRedis activity', () => {
    const activities = () =>
      createRedisActivities({
        getRedis: () => redis,
        cacheTtlSeconds: 300,
        partialCacheTtlSeconds: 30,
        logger: silentLogger,
      });

    it('uses the full TTL for complete results', async () => {
      await activities().saveToRedis('mumbai', offers);
      expect(await redis.ttl(redisKeys.byPrice('mumbai'))).toBeGreaterThan(30);
      expect(JSON.parse((await redis.get(redisKeys.meta('mumbai')))!)).toMatchObject({ partial: false });
    });

    it('uses the short TTL for partial results (a supplier was down)', async () => {
      await activities().saveToRedis('mumbai', offers, { partial: true });
      for (const key of [redisKeys.byPrice('mumbai'), redisKeys.data('mumbai'), redisKeys.meta('mumbai')]) {
        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(30);
      }
      expect(JSON.parse((await redis.get(redisKeys.meta('mumbai')))!)).toMatchObject({ partial: true });
    });
  });
});
