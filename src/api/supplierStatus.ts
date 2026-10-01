import type { SupplierId } from '../domain/types';

/**
 * In-memory "is this supplier down?" toggle used to simulate outages in dev/demo.
 * Lives in the API process (where the mock endpoints run), so it resets on restart.
 */
export class SupplierStatus {
  private readonly down: Record<SupplierId, boolean>;

  constructor(initial: Partial<Record<SupplierId, boolean>> = {}) {
    this.down = { supplierA: initial.supplierA ?? false, supplierB: initial.supplierB ?? false };
  }

  isDown(id: SupplierId): boolean {
    return this.down[id];
  }

  setDown(id: SupplierId, down: boolean): void {
    this.down[id] = down;
  }

  snapshot(): Record<SupplierId, boolean> {
    return { ...this.down };
  }
}
