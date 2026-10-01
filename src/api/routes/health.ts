import { Router } from 'express';
import type { HealthChecker } from '../services/health.service';

export const healthRouter = (checkHealth: HealthChecker): Router => {
  const router = Router();

  /** GET /health → dependency report; 200 for ok/degraded, 503 for down. */
  router.get('/', async (_req, res) => {
    const report = await checkHealth();
    res.status(report.status === 'down' ? 503 : 200).json(report);
  });

  /** GET /health/live → process liveness only (used by container healthchecks). */
  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return router;
};
