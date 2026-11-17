import { describe, expect, it } from 'vitest';
import { columnTemplate, priceFor, seatOccupied, seatsLeft, seatState, summarize, type TaquillaCell, type TaquillaRange } from './taquilla';

const cell = (over: Partial<TaquillaCell> = {}): TaquillaCell => ({
  id: 'c', floor: 1, row_idx: 0, col_idx: 0, kind: 'seat', label: '1A', seat_class: 'Cama', blocked: false, unusable: false, ...over
});

describe('precio del tramo', () => {
  const prices = [
    { from_pos: 1, to_pos: 3, price: '7000.00', seat_class: 'Cama' },
    { from_pos: 1, to_pos: 3, price: 5000, seat_class: null }
  ];
  it('usa el precio del tipo de asiento sin importar tildes ni mayúsculas', () => {
    expect(priceFor(prices, 1, 3, 'cama')).toBe(7000);
  });
  it('cae al precio general y devuelve null si el tramo no tiene tarifa', () => {
    expect(priceFor(prices, 1, 3, 'Común')).toBe(5000);
    expect(priceFor(prices, 1, 4, 'Cama')).toBeNull();
  });
});

describe('ocupación por tramo', () => {
  const r = (over: Partial<TaquillaRange> = {}): TaquillaRange => ({ seat_label: '1A', from_pos: 1, to_pos: 2, kind: 'sold', mine: false, expires_at: null, ...over });
  it('un pasaje de A a B no ocupa el asiento de B a C', () => {
    expect(seatOccupied([r()], '1A', 1, 2)).toBe(true);
    expect(seatOccupied([r()], '1A', 2, 3)).toBe(false);
    expect(seatOccupied([r()], '1B', 1, 2)).toBe(false);
  });
  it('la reserva propia no bloquea, la de otro y la compra en la web sí', () => {
    expect(seatOccupied([r({ kind: 'hold', mine: true })], '1A', 1, 2)).toBe(false);
    expect(seatOccupied([r({ kind: 'hold' })], '1A', 1, 2)).toBe(true);
    expect(seatOccupied([r({ kind: 'web' })], '1A', 1, 2)).toBe(true);
  });
});

describe('capacidad', () => {
  it('lugares libres según el contador; sin capacidad no hay dato', () => {
    expect(seatsLeft(40, 38)).toBe(2);
    expect(seatsLeft(40, 41)).toBe(-1);
    expect(seatsLeft(0, 5)).toBeNull();
  });
});

describe('estado del asiento', () => {
  it('bloqueado o sin tarifa queda deshabilitado; ocupado gana sobre elegido libre', () => {
    expect(seatState(cell({ blocked: true }), false, 100, false)).toBe('off');
    expect(seatState(cell(), false, null, false)).toBe('off');
    expect(seatState(cell(), true, 100, false)).toBe('busy');
    expect(seatState(cell(), false, 100, true)).toBe('selected');
    expect(seatState(cell(), false, 100, false)).toBe('free');
  });
});

describe('plano y resumen', () => {
  it('las columnas sin asientos se angostan', () => {
    const cells = [cell({ col_idx: 0 }), cell({ col_idx: 1 }), cell({ col_idx: 2, kind: 'aisle', label: null }), cell({ col_idx: 3 })];
    expect(columnTemplate(cells, 4)).toBe('minmax(0, 1fr) minmax(0, 1fr) 18px minmax(0, 1fr)');
  });
  it('agrupa por tipo de asiento', () => {
    expect(summarize([{ label: '1A', seatClass: 'Cama', price: 7000 }, { label: '1B', seatClass: 'Cama', price: 7000 }, { label: '9A', seatClass: 'Común', price: 4000 }]))
      .toEqual([{ seatClass: 'Cama', count: 2, subtotal: 14000 }, { seatClass: 'Común', count: 1, subtotal: 4000 }]);
  });
});
