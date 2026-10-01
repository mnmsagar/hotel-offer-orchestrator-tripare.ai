import { ApplicationFailure, Context } from '@temporalio/activity';
import { z } from 'zod';
import { SUPPLIER_BAD_RESPONSE, SUPPLIER_CLIENT_ERROR } from '../../domain/errors';
import type { SupplierHotel, SupplierId } from '../../domain/types';
import type { Logger } from '../../lib/logger';

export interface SupplierActivityDeps {
  supplierBaseUrl: string;
  /** Per-request HTTP timeout; keep it below the activity's startToCloseTimeout. */
  supplierTimeoutMs: number;
  logger: Logger;
}

const supplierHotelsSchema = z.array(
  z.object({
    hotelId: z.string(),
    name: z.string().min(1),
    price: z.number().nonnegative(),
    city: z.string(),
    commissionPct: z.number().nonnegative(),
  }),
);

/** Activity context is only available when running inside a worker; tests may call activities directly. */
const activityContext = (): Context | undefined => {
  try {
    return Context.current();
  } catch {
    return undefined;
  }
};

export const createSupplierActivities = ({ supplierBaseUrl, supplierTimeoutMs, logger }: SupplierActivityDeps) => {
  const fetchSupplier = async (supplier: SupplierId, city: string): Promise<SupplierHotel[]> => {
    const ctx = activityContext();
    const log = logger.child({
      supplier,
      city,
      workflowId: ctx?.info.workflowExecution?.workflowId,
      attempt: ctx?.info.attempt,
    });

    const url = new URL(`/${supplier}/hotels`, supplierBaseUrl);
    url.searchParams.set('city', city);

    // Abort on our own timeout, or when Temporal cancels the activity.
    const timeout = AbortSignal.timeout(supplierTimeoutMs);
    const signal = ctx ? AbortSignal.any([timeout, ctx.cancellationSignal]) : timeout;

    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      // Network errors and timeouts are transient: throw a plain Error so Temporal retries.
      log.warn({ err: (err as Error).message }, 'supplier request failed');
      throw new Error(`${supplier} request failed: ${(err as Error).message}`, { cause: err });
    }

    if (res.status >= 400 && res.status < 500) {
      log.warn({ status: res.status }, 'supplier rejected request');
      // A 4xx means our request is wrong; retrying the same request can't succeed.
      throw ApplicationFailure.nonRetryable(`${supplier} responded ${res.status}`, SUPPLIER_CLIENT_ERROR);
    }
    if (!res.ok) {
      log.warn({ status: res.status }, 'supplier server error');
      throw new Error(`${supplier} responded ${res.status}`);
    }

    const parsed = supplierHotelsSchema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) {
      log.warn('supplier returned an invalid payload');
      throw ApplicationFailure.nonRetryable(`${supplier} returned an invalid payload`, SUPPLIER_BAD_RESPONSE);
    }

    log.debug({ count: parsed.data.length }, 'supplier responded');
    return parsed.data;
  };

  return {
    fetchSupplierA: (city: string) => fetchSupplier('supplierA', city),
    fetchSupplierB: (city: string) => fetchSupplier('supplierB', city),
  };
};
