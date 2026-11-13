import { describe, expect, it } from 'vitest';
import { bucketOf, nextTurn, parseManeuvers, prepare, turnText, type Maneuver } from './turnGuide';
import type { LatLng } from './routePath';

const metersToDegrees = 1 / 111320;
const path: LatLng[] = [[0, 0], [0, 500 * metersToDegrees], [0, 1000 * metersToDegrees], [500 * metersToDegrees, 1000 * metersToDegrees]];
const maneuvers: Maneuver[] = [{ lat: 0, lng: 1000 * metersToDegrees, type: 'turn', modifier: 'left', name: 'Calle Mitre', exit: null }];

describe('indicaciones de giro', () => {
  it('escalona los avisos a 300, 200, 100 y 50 metros', () => {
    expect(bucketOf(500)).toBeNull();
    expect(bucketOf(300)).toBe(300);
    expect(bucketOf(250)).toBe(300);
    expect(bucketOf(199)).toBe(200);
    expect(bucketOf(100)).toBe(100);
    expect(bucketOf(60)).toBe(100);
    expect(bucketOf(30)).toBe(50);
  });

  it('calcula la distancia al próximo giro y deja de avisar después de pasarlo', () => {
    const before = nextTurn(prepare(path, maneuvers), [0, 800 * metersToDegrees]);
    expect(before.off).toBe(false);
    expect(Math.round(before.notice!.meters)).toBe(200);
    expect(before.notice!.bucket).toBe(200);

    const after = nextTurn(prepare(path, maneuvers), [300 * metersToDegrees, 1000 * metersToDegrees]);
    expect(after.notice).toBeNull();
  });

  it('no muestra un giro si el GPS está fuera del recorrido', () => {
    const result = nextTurn(prepare(path, maneuvers), [0.01, 0.01]);
    expect(result).toEqual({ notice: null, off: true });
  });

  it('interpreta giros, rotondas y calles de la respuesta de OSRM', () => {
    const parsed = parseManeuvers({ routes: [{ legs: [{ steps: [
      { name: 'A', maneuver: { type: 'depart', location: [0, 0] } },
      { name: 'B', maneuver: { type: 'turn', modifier: 'right', location: [-60.5, -31.7] } },
      { name: 'C', maneuver: { type: 'new name', modifier: 'straight', location: [-60.4, -31.7] } },
      { name: 'D', maneuver: { type: 'roundabout', modifier: 'right', exit: 2, location: [-60.3, -31.7] } },
      { name: '', maneuver: { type: 'arrive', location: [-60.2, -31.7] } }
    ] }] }] });

    expect(parsed.map((maneuver) => maneuver.name)).toEqual(['B', 'D']);
    expect(turnText(parsed[0])).toBe('Doblá a la derecha por B');
    expect(turnText(parsed[1])).toBe('Rotonda: salida 2 por D');
  });

  it('ignora una respuesta de maniobras inválida', () => {
    expect(parseManeuvers(null)).toEqual([]);
    expect(parseManeuvers({ routes: [{ legs: [{ steps: [
      { maneuver: { type: 'turn', modifier: 'left', location: [200, 100] } }
    ] }] }] })).toEqual([]);
  });
});
