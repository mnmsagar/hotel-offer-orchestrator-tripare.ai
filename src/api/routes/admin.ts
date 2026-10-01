import { Router } from 'express';
import { z } from 'zod';
import { SUPPLIER_IDS } from '../../domain/types';
import type { SupplierStatus } from '../supplierStatus';
import { parseOrThrow } from '../middleware/validate';

const paramsSchema = z.object({ id: z.enum(SUPPLIER_IDS) });
const bodySchema = z.object({ down: z.boolean() }, { error: 'Body must be { "down": boolean }' });

/** Dev/demo-only: POST /admin/suppliers/:id/status { down: boolean }. Not mounted in production. */
export const adminRouter = (status: SupplierStatus): Router => {
  const router = Router();

  router.post('/suppliers/:id/status', (req, res) => {
    const { id } = parseOrThrow(paramsSchema, req.params);
    const { down } = parseOrThrow(bodySchema, req.body);
    status.setDown(id, down);
    req.log.info({ supplier: id, down }, 'supplier status changed');
    res.json({ supplier: id, down });
  });

  router.get('/suppliers/status', (_req, res) => {
    res.json(status.snapshot());
  });

  return router;
};
