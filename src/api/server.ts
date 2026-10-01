import { config } from '../lib/config';
import { readCityOffers } from '../lib/hotelCache';
import { logger } from '../lib/logger';
import { closeRedis, getRedis } from '../lib/redis';
import { closeTemporalClient, pingTemporal, runHotelOffersWorkflow } from '../temporal/client';
import { createApp } from './app';
import { createHealthChecker } from './services/health.service';
import { createHotelOffersService } from './services/hotelOffers.service';
import { SupplierStatus } from './supplierStatus';

const SHUTDOWN_GRACE_MS = 10_000;

const app = createApp({
  logger,
  supplierStatus: new SupplierStatus({ supplierA: config.SUPPLIER_A_DOWN, supplierB: config.SUPPLIER_B_DOWN }),
  enableAdmin: config.NODE_ENV !== 'production',
  hotelOffers: createHotelOffersService({
    runWorkflow: runHotelOffersWorkflow,
    readCache: (city, range) => readCityOffers(getRedis(), city, range),
  }),
  checkHealth: createHealthChecker({
    supplierBaseUrl: config.SUPPLIER_BASE_URL,
    pingRedis: () => getRedis().ping(),
    pingTemporal,
  }),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  // Force-exit if open connections don't drain in time.
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  server.close(async (err) => {
    await Promise.allSettled([closeTemporalClient(), closeRedis()]);
    if (err) logger.error({ err }, 'error while closing server');
    process.exit(err ? 1 : 0);
  });
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
