import { describe, expect, it } from 'vitest';
import { distanceM, nearestOrigin, nextDeparture, nextDepartureForRoute, serviceScheduleReferenceTime } from './tripPlan';

const at = (h: number, m: number) => new Date(2026, 10, 11, h, m, 0);

describe('distancia y sentido por ubicación', () => {
  it('Paraná y Santa Fe están a unos 25-30 km', () => {
    const d = distanceM([-31.7333, -60.5236], [-31.6333, -60.7]);
    expect(d).toBeGreaterThan(18000);
    expect(d).toBeLessThan(30000);
  });
  it('elige el origen más cercano', () => {
    const origins = [{ id: 'pf', lat: -31.7333, lng: -60.5236 }, { id: 'fp', lat: -31.6333, lng: -60.7 }];
    expect(nearestOrigin([-31.735, -60.52], origins)?.origin.id).toBe('pf');
    expect(nearestOrigin([-31.63, -60.69], origins)?.origin.id).toBe('fp');
  });
  it('ignora paradas sin coordenadas', () => {
    expect(nearestOrigin([-31.7, -60.5], [{ lat: null, lng: null }])).toBeNull();
  });
});

describe('siguiente salida del servicio', () => {
  const deps = [
    { id: 'i1', route_id: 'ida', departure_time: '06:00:00' }, { id: 'i2', route_id: 'ida', departure_time: '12:00:00' },
    { id: 'v1', route_id: 'vuelta', departure_time: '07:30:00' }, { id: 'v2', route_id: 'vuelta', departure_time: '13:30:00' }
  ];
  it('después de una ida, propone la próxima vuelta', () => {
    const r = nextDeparture(deps, 'ida', at(12, 40));
    expect(r?.dep.id).toBe('v2');
    expect(r?.minutes).toBe(50);
    expect(r?.tomorrow).toBe(false);
  });
  it('usa la fecha del servicio cuando se simula un viaje programado para mañana', () => {
    const now = new Date(2026, 10, 13, 15, 10, 0);
    const scheduled = new Date(2026, 10, 14, 6, 0, 0);
    const reference = serviceScheduleReferenceTime('2026-11-14', scheduled.toISOString(), now);
    const sixTrips = [
      { id: 'i1', route_id: 'ida', departure_time: '06:00:00' },
      { id: 'v1', route_id: 'vuelta', departure_time: '07:00:00' },
      { id: 'i2', route_id: 'ida', departure_time: '08:00:00' }
    ];
    expect(nextDeparture(sixTrips, 'ida', reference)?.dep.id).toBe('v1');
    expect(nextDeparture(sixTrips, 'ida', reference)?.tomorrow).toBe(false);
  });
  it('alterna ida y vuelta durante las seis salidas del servicio', () => {
    const sixTrips = [
      { id: 'i1', route_id: 'ida', departure_time: '05:00:00' },
      { id: 'v1', route_id: 'vuelta', departure_time: '06:00:00' },
      { id: 'i2', route_id: 'ida', departure_time: '07:00:00' },
      { id: 'v2', route_id: 'vuelta', departure_time: '08:00:00' },
      { id: 'i3', route_id: 'ida', departure_time: '09:00:00' },
      { id: 'v3', route_id: 'vuelta', departure_time: '10:00:00' }
    ];
    expect(nextDeparture(sixTrips, 'ida', at(5, 50))?.dep.id).toBe('v1');
    expect(nextDeparture(sixTrips, 'vuelta', at(6, 50))?.dep.id).toBe('i2');
    expect(nextDeparture(sixTrips, 'ida', at(7, 50))?.dep.id).toBe('v2');
    expect(nextDeparture(sixTrips, 'vuelta', at(8, 50))?.dep.id).toBe('i3');
    expect(nextDeparture(sixTrips, 'ida', at(9, 50))?.dep.id).toBe('v3');
  });
  it('al forzar un sentido, elige la próxima salida de ese recorrido', () => {
    const r = nextDepartureForRoute(deps, 'vuelta', at(12, 40));
    expect(r?.dep.id).toBe('v2');
    expect(r?.minutes).toBe(50);
    expect(r?.tomorrow).toBe(false);
  });
  it('una salida dentro de la ventana todavía cuenta (ya es hora)', () => {
    const r = nextDeparture(deps, 'ida', at(13, 40));
    expect(r?.dep.id).toBe('v2');
    expect(r?.minutes).toBe(-10);
  });
  it('prefiere la próxima salida futura a otra pasada que aún está en ventana', () => {
    const r = nextDeparture([...deps, { id: 'v3', route_id: 'vuelta', departure_time: '14:00:00' }], 'ida', at(13, 50));
    expect(r?.dep.id).toBe('v3');
    expect(r?.minutes).toBe(10);
  });
  it('si no quedan salidas hoy, la primera de mañana', () => {
    const r = nextDeparture(deps, 'ida', at(20, 0));
    expect(r?.dep.id).toBe('v1');
    expect(r?.tomorrow).toBe(true);
    expect(r?.minutes).toBe(11 * 60 + 30);
  });
  it('un servicio con un solo sentido propone su próxima salida', () => {
    const r = nextDeparture(deps.filter((d) => d.route_id === 'ida'), 'ida', at(8, 0));
    expect(r?.dep.id).toBe('i2');
  });
  it('sin salidas no hay propuesta', () => { expect(nextDeparture([], 'ida', at(8, 0))).toBeNull(); });
});
