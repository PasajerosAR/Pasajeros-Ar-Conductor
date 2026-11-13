import type { LatLng } from './routePath';

export interface Maneuver {
  lat: number;
  lng: number;
  type: string;
  modifier: string | null;
  name: string;
  exit: number | null;
}

export interface TurnNotice { maneuver: Maneuver; meters: number; bucket: number | null }
export interface Prepared { path: LatLng[]; cum: number[]; maneuvers: Maneuver[]; along: number[]; hint: number }

export const ALERT_METERS = [300, 200, 100, 50] as const;
const OFF_ROUTE_M = 60;
const METERS_PER_DEGREE_LAT = 111320;

const flat = (point: LatLng, reference: LatLng): [number, number] =>
  [
    (point[1] - reference[1]) * METERS_PER_DEGREE_LAT * Math.cos(reference[0] * Math.PI / 180),
    (point[0] - reference[0]) * METERS_PER_DEGREE_LAT
  ];

export function locate(
  prepared: Pick<Prepared, 'path' | 'cum'>,
  position: LatLng,
  from = 0,
  to = Infinity
): { along: number; off: number; seg: number } | null {
  const end = Math.min(prepared.path.length - 1, to);
  let best: { along: number; off: number; seg: number } | null = null;

  for (let i = Math.max(0, from); i < end; i++) {
    const a = flat(prepared.path[i], position);
    const b = flat(prepared.path[i + 1], position);
    const dx = b[0] - a[0], dy = b[1] - a[1], lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / lengthSquared));
    const off = Math.hypot(a[0] + fraction * dx, a[1] + fraction * dy);
    if (!best || off < best.off) {
      best = { along: prepared.cum[i] + fraction * (prepared.cum[i + 1] - prepared.cum[i]), off, seg: i };
    }
  }
  return best;
}

export function prepare(path: LatLng[], maneuvers: Maneuver[]): Prepared {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    const [x, y] = flat(path[i], path[i - 1]);
    cum.push(cum[i - 1] + Math.hypot(x, y));
  }

  const along: number[] = [];
  let segment = 0;
  for (const maneuver of maneuvers) {
    const point = locate({ path, cum }, [maneuver.lat, maneuver.lng], segment);
    along.push(point ? point.along : Infinity);
    if (point) segment = point.seg;
  }
  return { path, cum, maneuvers, along, hint: 0 };
}

export function bucketOf(meters: number): number | null {
  if (meters > ALERT_METERS[0]) return null;
  let bucket: number = ALERT_METERS[0];
  for (const threshold of ALERT_METERS) {
    if (meters <= threshold) bucket = threshold;
  }
  return bucket;
}

export function nextTurn(prepared: Prepared, position: LatLng): { notice: TurnNotice | null; off: boolean } {
  let point = locate(prepared, position, Math.max(0, prepared.hint - 3), prepared.hint + 250);
  if (!point || point.off > OFF_ROUTE_M) point = locate(prepared, position);
  if (!point || point.off > OFF_ROUTE_M) return { notice: null, off: true };

  prepared.hint = point.seg;
  const index = prepared.along.findIndex((distance) => distance > point.along - 5);
  if (index < 0) return { notice: null, off: false };

  const meters = Math.max(0, prepared.along[index] - point.along);
  return {
    notice: { maneuver: prepared.maneuvers[index], meters, bucket: bucketOf(meters) },
    off: false
  };
}

const MODIFIER_ES: Record<string, string> = {
  left: 'a la izquierda',
  right: 'a la derecha',
  'slight left': 'leve a la izquierda',
  'slight right': 'leve a la derecha',
  'sharp left': 'cerrado a la izquierda',
  'sharp right': 'cerrado a la derecha',
  uturn: 'en U',
  straight: 'derecho'
};

export function turnText(maneuver: Maneuver): string {
  const side = maneuver.modifier ? MODIFIER_ES[maneuver.modifier] ?? '' : '';
  const street = maneuver.name ? ` por ${maneuver.name}` : '';
  switch (maneuver.type) {
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return `Rotonda: salida ${maneuver.exit ?? ''}${street}`.replace('salida  ', 'salida ');
    case 'fork':
      return `Bifurcación ${side}${street}`.replace('  ', ' ').trim();
    case 'merge':
      return `Incorporate ${side}${street}`.replace('  ', ' ').trim();
    case 'off ramp':
    case 'on ramp':
      return `Tomá la salida ${side}${street}`.replace('  ', ' ').trim();
    default:
      if (maneuver.modifier === 'uturn') return `Hacé el retorno${street}`;
      if (maneuver.modifier === 'straight') return `Seguí derecho${street}`;
      return `Doblá ${side}${street}`.replace('  ', ' ').trim();
  }
}

export function turnAngle(maneuver: Maneuver): number {
  switch (maneuver.modifier) {
    case 'right': return 90;
    case 'slight right': return 45;
    case 'sharp right': return 135;
    case 'left': return -90;
    case 'slight left': return -45;
    case 'sharp left': return -135;
    case 'uturn': return 180;
    default: return 0;
  }
}

interface OsrmManeuver {
  type?: unknown;
  modifier?: unknown;
  exit?: unknown;
  location?: unknown;
}

interface OsrmStep { name?: unknown; ref?: unknown; maneuver?: OsrmManeuver }

export function parseManeuvers(data: unknown): Maneuver[] {
  if (!data || typeof data !== 'object') return [];
  const response = data as { routes?: { legs?: { steps?: OsrmStep[] }[] }[] };
  const output: Maneuver[] = [];

  for (const leg of response.routes?.[0]?.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const maneuver = step.maneuver;
      if (typeof maneuver?.type !== 'string' || !Array.isArray(maneuver.location) || maneuver.location.length < 2) continue;
      const [lng, lat] = maneuver.location;
      if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)
        || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

      const type = maneuver.type;
      if (type === 'depart' || type === 'arrive') continue;
      const turn = type === 'turn' || type === 'end of road' || type === 'fork' || type === 'merge'
        || type === 'on ramp' || type === 'off ramp' || type === 'roundabout' || type === 'rotary'
        || type === 'roundabout turn';
      const keep = turn || ((type === 'new name' || type === 'continue')
        && typeof maneuver.modifier === 'string' && maneuver.modifier !== 'straight');
      if (!keep || (type === 'merge' && maneuver.modifier === 'straight')) continue;
      if (maneuver.modifier === 'straight' && !type.startsWith('round') && type !== 'rotary' && type !== 'fork') continue;

      output.push({
        lat: Math.round(lat * 1e5) / 1e5,
        lng: Math.round(lng * 1e5) / 1e5,
        type,
        modifier: typeof maneuver.modifier === 'string' ? maneuver.modifier : null,
        name: typeof step.name === 'string' ? step.name.trim() : typeof step.ref === 'string' ? step.ref.trim() : '',
        exit: typeof maneuver.exit === 'number' && Number.isFinite(maneuver.exit) ? maneuver.exit : null
      });
    }
  }
  return output;
}
