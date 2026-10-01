import { SUPPLIER_IDS } from '../../domain/types';
import type { SupplierId } from '../../domain/types';

type UpDown = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  suppliers: Record<SupplierId, UpDown>;
  redis: UpDown;
  temporal: UpDown;
}

export interface HealthDeps {
  supplierBaseUrl: string;
  pingRedis: () => Promise<unknown>;
  pingTemporal: () => Promise<unknown>;
  timeoutMs?: number;
}

export type HealthChecker = () => Promise<HealthReport>;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);

const probe = async (check: () => Promise<unknown>, ms: number): Promise<UpDown> => {
  try {
    await withTimeout(check(), ms);
    return 'up';
  } catch {
    return 'down';
  }
};

export const createHealthChecker = ({
  supplierBaseUrl,
  pingRedis,
  pingTemporal,
  timeoutMs = 2000,
}: HealthDeps): HealthChecker => {
  const pingSupplier = async (id: SupplierId): Promise<void> => {
    const res = await fetch(new URL(`/${id}/hotels`, supplierBaseUrl), { signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel();
    if (!res.ok) throw new Error(`${id} responded ${res.status}`);
  };

  return async () => {
    // All probes run in parallel so /health takes at most ~timeoutMs.
    const [supplierA, supplierB, redis, temporal] = await Promise.all([
      probe(() => pingSupplier('supplierA'), timeoutMs),
      probe(() => pingSupplier('supplierB'), timeoutMs),
      probe(pingRedis, timeoutMs),
      probe(pingTemporal, timeoutMs),
    ]);
    const suppliers = { supplierA, supplierB };
    const suppliersDown = SUPPLIER_IDS.filter((id) => suppliers[id] === 'down').length;

    const status: HealthReport['status'] =
      suppliersDown === SUPPLIER_IDS.length || redis === 'down' || temporal === 'down'
        ? 'down'
        : suppliersDown > 0
          ? 'degraded'
          : 'ok';

    return { status, suppliers, redis, temporal };
  };
};
