import type { HotelOffer, PriceRange } from '../../domain/types';
import { HttpError } from '../errors';

export interface HotelOffersDeps {
  /** Runs the Temporal workflow (which also refreshes the Redis cache). */
  runWorkflow: (city: string, requestId: string) => Promise<HotelOffer[]>;
  /** Filters a city's cached offers in Redis; `null` means cache miss. */
  readCache: (city: string, range: PriceRange) => Promise<HotelOffer[] | null>;
}

export interface HotelOffersService {
  getOffers(city: string, range: PriceRange, requestId: string): Promise<HotelOffer[]>;
}

const hasRange = ({ minPrice, maxPrice }: PriceRange): boolean => minPrice !== undefined || maxPrice !== undefined;

export const createHotelOffersService = ({ runWorkflow, readCache }: HotelOffersDeps): HotelOffersService => {
  // Price filtering lives in Redis, so a Redis failure means this request can't be served.
  const filterInRedis = (city: string, range: PriceRange) =>
    readCache(city, range).catch((err: unknown) => {
      throw new HttpError(503, 'Cache unavailable', { cause: err });
    });

  return {
    async getOffers(city, range, requestId) {
      // No filter: always fetch fresh data through the workflow.
      if (!hasRange(range)) return runWorkflow(city, requestId);

      // Filter: serve from Redis when the city is cached...
      const cached = await filterInRedis(city, range);
      if (cached) return cached;

      // ...otherwise populate the cache via the workflow, then filter in Redis.
      await runWorkflow(city, requestId);
      const fresh = await filterInRedis(city, range);
      if (!fresh) throw new HttpError(503, 'Cache unavailable');
      return fresh;
    },
  };
};
