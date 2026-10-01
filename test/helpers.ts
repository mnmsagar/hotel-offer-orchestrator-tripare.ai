import { pino } from 'pino';
import { createApp } from '../src/api/app';
import type { AppDeps } from '../src/api/app';
import type { HealthReport } from '../src/api/services/health.service';
import { createHotelOffersService } from '../src/api/services/hotelOffers.service';
import type { HotelOffersDeps } from '../src/api/services/hotelOffers.service';
import { SupplierStatus } from '../src/api/supplierStatus';

export const silentLogger = pino({ level: 'silent' });

export const okHealth: HealthReport = {
  status: 'ok',
  suppliers: { supplierA: 'up', supplierB: 'up' },
  redis: 'up',
  temporal: 'up',
};

/** Builds the real Express app with fake workflow/cache dependencies. */
export const buildTestApp = (
  overrides: Partial<HotelOffersDeps> = {},
  appOverrides: Partial<Omit<AppDeps, 'hotelOffers'>> = {},
) => {
  const deps: HotelOffersDeps = {
    runWorkflow: async () => [],
    readCache: async () => null,
    ...overrides,
  };
  const supplierStatus = appOverrides.supplierStatus ?? new SupplierStatus();
  const app = createApp({
    logger: silentLogger,
    hotelOffers: createHotelOffersService(deps),
    checkHealth: async () => okHealth,
    enableAdmin: true,
    ...appOverrides,
    supplierStatus,
  });
  return { app, supplierStatus };
};
