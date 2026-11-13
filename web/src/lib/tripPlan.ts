import { WINDOW_MINUTES, minutesToDeparture } from './startWindow';

export type LatLng = [number, number];
export const NEAR_ORIGIN_M = 5000;   // a menos de esta distancia de la parada de origen se sugiere ese sentido

// Distancia en metros entre dos puntos (haversine).
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Sentido más probable según dónde está el conductor: el de la parada de origen más cercana.
export function nearestOrigin<T extends { lat: number | null; lng: number | null }>(pos: LatLng, origins: T[]): { origin: T; meters: number } | null {
  let best: { origin: T; meters: number } | null = null;
  for (const o of origins) {
    if (o.lat === null || o.lng === null) continue;
    const m = distanceM(pos, [o.lat, o.lng]);
    if (!best || m < best.meters) best = { origin: o, meters: m };
  }
  return best;
}

export interface NextDep { id: string; route_id: string; departure_time: string }

export function serviceScheduleReferenceTime(serviceDate: string, scheduledDeparture: string, now: Date): Date {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return serviceDate > today ? new Date(scheduledDeparture) : now;
}

// Siguiente salida del servicio después de terminar un viaje: prefiere el sentido contrario (la vuelta).
// Toma la más próxima que todavía esté dentro de la ventana de inicio; si no queda ninguna hoy, la primera de mañana.
export function nextDeparture<T extends NextDep>(deps: T[], currentRouteId: string | undefined, now: Date): { dep: T; minutes: number; tomorrow: boolean } | null {
  const opposite = deps.filter((d) => d.route_id !== currentRouteId);
  const pool = opposite.length ? opposite : deps;
  const timed = pool.map((dep) => ({ dep, minutes: minutesToDeparture(dep.departure_time, now) }));
  const upcoming = timed.filter((item) => item.minutes >= 0).sort((a, b) => a.minutes - b.minutes)[0];
  if (upcoming) return { ...upcoming, tomorrow: false };

  const recent = timed.filter((item) => item.minutes >= -WINDOW_MINUTES)
    .sort((a, b) => Math.abs(a.minutes) - Math.abs(b.minutes))[0];
  if (recent) return { ...recent, tomorrow: false };

  const tomorrow = timed.map((item) => ({ ...item, minutes: item.minutes + 1440 }))
    .sort((a, b) => a.minutes - b.minutes)[0];
  return tomorrow ? { ...tomorrow, tomorrow: true } : null;
}

export function nextDepartureForRoute<T extends NextDep>(deps: T[], routeId: string, now: Date): { dep: T; minutes: number; tomorrow: boolean } | null {
  return nextDeparture(deps.filter((departure) => departure.route_id === routeId), undefined, now);
}
