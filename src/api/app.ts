import express from 'express';
import type { Express } from 'express';
import type { Logger } from '../lib/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { adminRouter } from './routes/admin';
import { healthRouter } from './routes/health';
import { hotelsRouter } from './routes/hotels';
import { suppliersRouter } from './routes/suppliers';
import type { HealthChecker } from './services/health.service';
import type { HotelOffersService } from './services/hotelOffers.service';
import type { SupplierStatus } from './supplierStatus';

export interface AppDeps {
  logger: Logger;
  hotelOffers: HotelOffersService;
  checkHealth: HealthChecker;
  supplierStatus: SupplierStatus;
  /** Mount the dev-only failure toggle (disabled in production). */
  enableAdmin: boolean;
}

/** Builds the Express app from injected dependencies (real ones in server.ts, fakes in tests). */
export const createApp = (deps: AppDeps): Express => {
  const app = express();
  app.disable('x-powered-by');
  // Logger first so every request (including ones with malformed bodies) gets an id and req.log.
  app.use(requestLogger(deps.logger));
  app.use(express.json({ limit: '10kb' }));

  app.use('/api/hotels', hotelsRouter(deps.hotelOffers));
  app.use('/health', healthRouter(deps.checkHealth));
  app.use('/', suppliersRouter(deps.supplierStatus));
  if (deps.enableAdmin) app.use('/admin', adminRouter(deps.supplierStatus));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
