import { normalizeKey } from '../domain/types';

/**
 * Single source of truth for Redis key names. Never build these strings anywhere else.
 * The city is normalized here too, so callers can't accidentally create "Delhi" vs "delhi" keys.
 */
export const redisKeys = {
  /** Sorted set: member = normalized hotel name, score = price. */
  byPrice: (city: string) => `hotels:${normalizeKey(city)}:byPrice`,
  /** Hash: field = normalized hotel name, value = JSON HotelOffer. */
  data: (city: string) => `hotels:${normalizeKey(city)}:data`,
  /** String (JSON `{ count, updatedAt }`): marks the city as cached, even with zero results. */
  meta: (city: string) => `hotels:${normalizeKey(city)}:meta`,
} as const;
