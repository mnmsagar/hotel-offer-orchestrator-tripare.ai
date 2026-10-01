/**
 * Failure identifiers shared by the workflow (which raises them) and the API (which maps them to HTTP).
 * Kept in domain/ because workflow code may only import pure, deterministic modules.
 */
export const ALL_SUPPLIERS_UNAVAILABLE = 'AllSuppliersUnavailable';
export const ALL_SUPPLIERS_UNAVAILABLE_MESSAGE = 'All suppliers unavailable';

/** Failure type for a supplier answering with a 4xx (our request is wrong, so retrying won't help). */
export const SUPPLIER_CLIENT_ERROR = 'SupplierClientError';
/** Failure type for a supplier returning a payload that doesn't match the expected schema. */
export const SUPPLIER_BAD_RESPONSE = 'SupplierBadResponse';
