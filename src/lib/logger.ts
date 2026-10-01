import { pino } from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'hotel-offer-orchestrator' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
