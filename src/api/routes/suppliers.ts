import { Router } from 'express';
import { z } from 'zod';
import supplierAData from '../../data/supplierA.json';
import supplierBData from '../../data/supplierB.json';
import { normalizeKey, SUPPLIER_IDS } from '../../domain/types';
import type { SupplierHotel, SupplierId } from '../../domain/types';
import type { SupplierStatus } from '../supplierStatus';
import { parseOrThrow } from '../middleware/validate';

const DATA: Record<SupplierId, readonly SupplierHotel[]> = {
  supplierA: supplierAData,
  supplierB: supplierBData,
};

const querySchema = z.object({ city: z.string().optional() });

/** Mock supplier endpoints: GET /supplierA/hotels and GET /supplierB/hotels. */
export const suppliersRouter = (status: SupplierStatus): Router => {
  const router = Router();

  for (const id of SUPPLIER_IDS) {
    router.get(`/${id}/hotels`, (req, res) => {
      if (status.isDown(id)) {
        res.status(503).json({ error: `${id} is unavailable` });
        return;
      }
      const { city } = parseOrThrow(querySchema, req.query);
      const hotels = city ? DATA[id].filter((h) => normalizeKey(h.city) === normalizeKey(city)) : DATA[id];
      res.json(hotels);
    });
  }

  return router;
};
