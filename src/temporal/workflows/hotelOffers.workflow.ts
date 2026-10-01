import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
// `import type` is erased at compile time, so no activity (I/O) code enters the workflow bundle.
import type { HotelActivities } from '../activities';
import { ALL_SUPPLIERS_UNAVAILABLE, ALL_SUPPLIERS_UNAVAILABLE_MESSAGE } from '../../domain/errors';
import { selectBestOffers } from '../../domain/selectBestOffers';
import type { HotelOffer, SupplierHotel } from '../../domain/types';

const activityOptions = {
  startToCloseTimeout: '5s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '500ms',
    backoffCoefficient: 2,
  },
} as const;

const { fetchSupplierA, fetchSupplierB, saveToRedis } = proxyActivities<HotelActivities>(activityOptions);

export interface HotelOffersInput {
  /** Normalized (trimmed, lower-cased) city name. */
  city: string;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Turns a rejection into a value so one failing supplier can't reject Promise.all. */
const settle = <T>(p: Promise<T>): Promise<Settled<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

/** Activity errors arrive wrapped in an ActivityFailure; include the underlying cause's message. */
const errorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
};

/**
 * Fetches both suppliers in parallel, keeps the best offer per hotel, and caches the result.
 * One supplier failing yields a partial result; both failing fails the workflow (non-retryable).
 */
export async function hotelOffersWorkflow({ city }: HotelOffersInput): Promise<HotelOffer[]> {
  const [a, b] = await Promise.all([settle(fetchSupplierA(city)), settle(fetchSupplierB(city))]);

  if (!a.ok && !b.ok) {
    log.error('All suppliers failed', { city, supplierA: errorMessage(a.error), supplierB: errorMessage(b.error) });
    throw ApplicationFailure.create({
      message: ALL_SUPPLIERS_UNAVAILABLE_MESSAGE,
      type: ALL_SUPPLIERS_UNAVAILABLE,
      nonRetryable: true,
    });
  }
  if (!a.ok) log.warn('Supplier A failed; returning partial result', { city, error: errorMessage(a.error) });
  if (!b.ok) log.warn('Supplier B failed; returning partial result', { city, error: errorMessage(b.error) });

  const empty: SupplierHotel[] = [];
  const offers = selectBestOffers(a.ok ? a.value : empty, b.ok ? b.value : empty);

  try {
    await saveToRedis(city, offers);
  } catch (error) {
    // The offers are still correct; a cache failure shouldn't fail the request.
    log.warn('Caching offers failed', { city, error: errorMessage(error) });
  }

  return offers;
}
