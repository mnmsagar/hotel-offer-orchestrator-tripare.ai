import { normalizeKey } from './types';
import type { HotelOffer, SupplierHotel, SupplierName } from './types';

// Lower rank wins the final tie-break.
const SUPPLIER_RANK: Record<SupplierName, number> = { 'Supplier A': 0, 'Supplier B': 1 };

const toOffer = (hotel: SupplierHotel, supplier: SupplierName): HotelOffer => ({
  name: hotel.name.trim(),
  price: hotel.price,
  supplier,
  commissionPct: hotel.commissionPct,
});

/**
 * Returns true when `candidate` should replace `current`:
 * lower price → higher commission → Supplier A.
 */
const isBetter = (candidate: HotelOffer, current: HotelOffer): boolean => {
  if (candidate.price !== current.price) return candidate.price < current.price;
  if (candidate.commissionPct !== current.commissionPct) {
    return candidate.commissionPct > current.commissionPct;
  }
  return SUPPLIER_RANK[candidate.supplier] < SUPPLIER_RANK[current.supplier];
};

const compareOffers = (x: HotelOffer, y: HotelOffer): number => {
  if (x.price !== y.price) return x.price - y.price;
  // Plain code-point comparison (not localeCompare) keeps ordering identical on every machine.
  const xName = normalizeKey(x.name);
  const yName = normalizeKey(y.name);
  if (xName !== yName) return xName < yName ? -1 : 1;
  return SUPPLIER_RANK[x.supplier] - SUPPLIER_RANK[y.supplier];
};

/**
 * De-duplicates hotels across suppliers (by normalized name) and keeps the best offer per hotel.
 *
 * Pure and deterministic: safe to call from Temporal workflow code.
 */
export const selectBestOffers = (
  supplierA: readonly SupplierHotel[],
  supplierB: readonly SupplierHotel[],
): HotelOffer[] => {
  const best = new Map<string, HotelOffer>();

  const candidates = [
    ...supplierA.map((h) => toOffer(h, 'Supplier A')),
    ...supplierB.map((h) => toOffer(h, 'Supplier B')),
  ];

  for (const offer of candidates) {
    const key = normalizeKey(offer.name);
    const current = best.get(key);
    if (!current || isBetter(offer, current)) best.set(key, offer);
  }

  return [...best.values()].sort(compareOffers);
};
