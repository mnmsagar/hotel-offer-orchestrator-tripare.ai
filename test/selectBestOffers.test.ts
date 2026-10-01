import { describe, expect, it } from 'vitest';
import { selectBestOffers } from '../src/domain/selectBestOffers';
import type { SupplierHotel } from '../src/domain/types';

const hotel = (name: string, price: number, commissionPct = 10, hotelId = name): SupplierHotel => ({
  hotelId,
  name,
  price,
  city: 'delhi',
  commissionPct,
});

describe('selectBestOffers', () => {
  it('returns [] when both inputs are empty', () => {
    expect(selectBestOffers([], [])).toEqual([]);
  });

  it('keeps hotels offered by only one supplier', () => {
    const result = selectBestOffers([hotel('Only A', 100)], [hotel('Only B', 200)]);
    expect(result).toEqual([
      { name: 'Only A', price: 100, supplier: 'Supplier A', commissionPct: 10 },
      { name: 'Only B', price: 200, supplier: 'Supplier B', commissionPct: 10 },
    ]);
  });

  it('picks the cheaper offer when a hotel is in both lists', () => {
    const result = selectBestOffers([hotel('Taj', 6000)], [hotel('Taj', 5500)]);
    expect(result).toEqual([{ name: 'Taj', price: 5500, supplier: 'Supplier B', commissionPct: 10 }]);
  });

  it('works when Supplier A is cheaper too', () => {
    const result = selectBestOffers([hotel('Taj', 5000)], [hotel('Taj', 5500)]);
    expect(result[0]?.supplier).toBe('Supplier A');
  });

  it('on equal price, the higher commission wins', () => {
    const result = selectBestOffers([hotel('Leela', 7000, 10)], [hotel('Leela', 7000, 15)]);
    expect(result).toEqual([{ name: 'Leela', price: 7000, supplier: 'Supplier B', commissionPct: 15 }]);
  });

  it('on equal price and commission, Supplier A wins regardless of input order', () => {
    const result = selectBestOffers([hotel('Oberoi', 8000, 12)], [hotel('Oberoi', 8000, 12)]);
    expect(result).toEqual([{ name: 'Oberoi', price: 8000, supplier: 'Supplier A', commissionPct: 12 }]);
  });

  it('dedupes names that differ only by case and whitespace, keeping the winner’s spelling', () => {
    const result = selectBestOffers([hotel('  the LALIT ', 6500)], [hotel('The Lalit', 6400)]);
    expect(result).toEqual([{ name: 'The Lalit', price: 6400, supplier: 'Supplier B', commissionPct: 10 }]);
  });

  it('trims the returned name', () => {
    const result = selectBestOffers([hotel('  Hyatt  ', 4000)], []);
    expect(result[0]?.name).toBe('Hyatt');
  });

  it('sorts by price ascending, then by name', () => {
    const result = selectBestOffers(
      [hotel('Zeta', 3000), hotel('Alpha', 5000)],
      [hotel('Beta', 3000), hotel('Gamma', 1000)],
    );
    expect(result.map((o) => o.name)).toEqual(['Gamma', 'Beta', 'Zeta', 'Alpha']);
  });

  it('does not mutate its inputs', () => {
    const a = Object.freeze([hotel('X', 1)]);
    const b = Object.freeze([hotel('X', 2)]);
    expect(() => selectBestOffers(a, b)).not.toThrow();
    expect(a[0]?.price).toBe(1);
  });
});
