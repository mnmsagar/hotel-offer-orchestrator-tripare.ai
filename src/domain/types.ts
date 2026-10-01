/** Display name of a supplier, as returned to API clients. */
export type SupplierName = 'Supplier A' | 'Supplier B';

/** Internal supplier identifier, used in routes, config and health output. */
export type SupplierId = 'supplierA' | 'supplierB';

export const SUPPLIER_NAMES: Record<SupplierId, SupplierName> = {
  supplierA: 'Supplier A',
  supplierB: 'Supplier B',
};

export const SUPPLIER_IDS: readonly SupplierId[] = ['supplierA', 'supplierB'];

/** What a supplier returns. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** What the API returns. */
export interface HotelOffer {
  name: string;
  price: number;
  supplier: SupplierName;
  commissionPct: number;
}

/** Optional inclusive price bounds; a missing bound means unbounded. */
export interface PriceRange {
  minPrice?: number;
  maxPrice?: number;
}

/** Normalizes a city or hotel name into a stable lookup key. */
export const normalizeKey = (value: string): string => value.trim().toLowerCase();
