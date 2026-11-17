import type { CellKind } from './seatGrid';

// Lógica pura de la taquilla del conductor (sin React ni red), para poder probarla.

export interface TaquillaCell {
  id: string; floor: number; row_idx: number; col_idx: number;
  kind: CellKind; label: string | null; seat_class: string | null; blocked: boolean; unusable: boolean;
}
export interface TaquillaPrice { from_pos: number; to_pos: number; price: number | string; seat_class: string | null }
// Tramo ocupado de un asiento (RPC taquilla_seat_status): 'sold' vendido, 'web' compra pendiente en la web, 'hold' reserva de taquilla.
export interface TaquillaRange { seat_label: string; from_pos: number; to_pos: number; kind: 'sold' | 'web' | 'hold'; mine: boolean; expires_at: string | null }
// Lugares libres según el contador de a bordo (null = sin dato de capacidad).
export function seatsLeft(capacity: number, onboard: number): number | null {
  return capacity > 0 ? capacity - onboard : null;
}
export type SeatState = 'free' | 'busy' | 'off' | 'selected';

// Compara tipos de asiento sin importar mayúsculas ni tildes (igual que el panel de ventas del admin).
const normalizeSeatClass = (value: string | null | undefined): string | null =>
  value?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() || null;

/** Precio del tramo para el tipo de asiento; si no hay uno específico, el que aplica a todos. null = sin tarifa. */
export function priceFor(prices: TaquillaPrice[], fromPos: number, toPos: number, seatClass: string | null): number | null {
  const matches = prices.filter((p) => p.from_pos === fromPos && p.to_pos === toPos);
  const match = matches.find((p) => normalizeSeatClass(p.seat_class) === normalizeSeatClass(seatClass))
    ?? matches.find((p) => p.seat_class === null);
  return match ? Number(match.price) : null;
}

/** Un asiento está ocupado si un pasaje vigente suyo se superpone con el tramo elegido. */
export function seatOccupied(ranges: TaquillaRange[], label: string | null, fromPos: number, toPos: number): boolean {
  if (!label) return false;
  return ranges.some((r) => r.seat_label === label && !(r.kind === 'hold' && r.mine) && r.from_pos < toPos && r.to_pos > fromPos);
}

export function seatState(
  cell: TaquillaCell, occupied: boolean, price: number | null, selected: boolean
): SeatState {
  if (cell.blocked || cell.unusable || price === null) return 'off';
  if (occupied) return 'busy';
  return selected ? 'selected' : 'free';
}

/** Columnas que solo tienen pasillo u otras celdas sin asiento se dibujan angostas. */
export function columnTemplate(cells: TaquillaCell[], cols: number): string {
  const withSeat = new Set(cells.filter((c) => c.kind === 'seat').map((c) => c.col_idx));
  return Array.from({ length: cols }, (_, i) => (withSeat.has(i) ? 'minmax(0, 1fr)' : '18px')).join(' ');
}

export const formatMoney = (n: number): string => `$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;

/** Tipo de asiento que se muestra al elegir: el nombre tal cual lo cargó la empresa en la disposición. */
export const seatClassName = (cell: Pick<TaquillaCell, 'seat_class'>): string => cell.seat_class?.trim() || 'Común';

/** Resume los asientos elegidos por tipo y precio: "Cama × 2 · $ 14.000". */
export function summarize(chosen: { label: string; seatClass: string; price: number }[]): { seatClass: string; count: number; subtotal: number }[] {
  const byClass = new Map<string, { seatClass: string; count: number; subtotal: number }>();
  for (const s of chosen) {
    const row = byClass.get(s.seatClass) ?? { seatClass: s.seatClass, count: 0, subtotal: 0 };
    row.count += 1; row.subtotal += s.price;
    byClass.set(s.seatClass, row);
  }
  return [...byClass.values()];
}
