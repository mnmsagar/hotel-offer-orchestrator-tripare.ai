import { Router } from 'express';
import { z } from 'zod';
import { normalizeKey } from '../../domain/types';
import { parseOrThrow } from '../middleware/validate';
import type { HotelOffersService } from '../services/hotelOffers.service';

// Query values arrive as strings; reject "", "abc", "-5", "1e3" etc. instead of coercing silently.
const price = (field: string) =>
  z
    .string({ error: `${field} must be a single value` })
    .trim()
    .regex(/^\d+(\.\d+)?$/, `${field} must be a non-negative number`)
    .transform(Number)
    .optional();

const querySchema = z
  .object({
    city: z
      .string({ error: 'city is required' })
      .transform(normalizeKey)
      .pipe(z.string().min(1, 'city is required').max(100, 'city is too long')),
    minPrice: price('minPrice'),
    maxPrice: price('maxPrice'),
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    message: 'minPrice must be less than or equal to maxPrice',
  });

/** GET /api/hotels?city=<city>[&minPrice=<n>][&maxPrice=<n>] */
export const hotelsRouter = (service: HotelOffersService): Router => {
  const router = Router();

  router.get('/', async (req, res) => {
    const { city, minPrice, maxPrice } = parseOrThrow(querySchema, req.query);
    req.log = req.log.child({ city });
    const offers = await service.getOffers(city, { minPrice, maxPrice }, req.id);
    res.json(offers);
  });

  return router;
};
