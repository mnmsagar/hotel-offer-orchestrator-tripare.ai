import { createRedisActivities } from './redis.activities';
import type { RedisActivityDeps } from './redis.activities';
import { createSupplierActivities } from './suppliers.activities';
import type { SupplierActivityDeps } from './suppliers.activities';

export type ActivityDeps = SupplierActivityDeps & RedisActivityDeps;

/**
 * Builds the activity implementations with their dependencies injected.
 * The worker registers the returned object; workflows only ever `import type` it.
 */
export const createActivities = (deps: ActivityDeps) => ({
  ...createSupplierActivities(deps),
  ...createRedisActivities(deps),
});

export type HotelActivities = ReturnType<typeof createActivities>;
