import { describe, expect, it } from 'vitest';
import { courseBetween, smoothHeading, smoothSpeed, speedKmhBetween } from './gpsHeading';

describe('rumbo GPS por desplazamiento', () => {
  it('ignora cambios pequeños por error de posicion o GPS impreciso', () => {
    expect(courseBetween(
      { pos: [-31.7, -60.5], timestamp: 1000, accuracyM: 10 },
      { pos: [-31.70001, -60.5], timestamp: 5000, accuracyM: 10 }
    )).toBeNull();
    expect(courseBetween(
      { pos: [-31.7, -60.5], timestamp: 1000, accuracyM: 10 },
      { pos: [-31.699, -60.5], timestamp: 5000, accuracyM: 60 }
    )).toBeNull();
  });

  it('calcula el rumbo de desplazamiento y suaviza el cruce 360/0', () => {
    const course = courseBetween(
      { pos: [-31.7, -60.5], timestamp: 1000, accuracyM: 5 },
      { pos: [-31.7, -60.499], timestamp: 5000, accuracyM: 5 }
    );
    expect(course).not.toBeNull();
    expect(course).toBeGreaterThan(89);
    expect(course).toBeLessThan(91);
    expect(smoothHeading(350, 10, 0.5)).toBeCloseTo(0);
    expect(smoothHeading(10, 350, 0.5)).toBeCloseTo(0);
  });

  it('responde antes a un giro amplio sin amplificar variaciones chicas', () => {
    expect(smoothHeading(0, 90)).toBeCloseTo(40.5);
    expect(smoothHeading(0, 10)).toBeCloseTo(2);
  });

  it('ignora saltos de tiempo y ubicación al estimar rumbo o velocidad', () => {
    const previous = { pos: [-31.7, -60.5] as [number, number], timestamp: 1000, accuracyM: 8 };
    expect(courseBetween(previous, { ...previous, pos: [-31.7, -60.49], timestamp: 30_000 })).toBeNull();
    expect(speedKmhBetween(previous, { ...previous, pos: [-31.7, -60.49], timestamp: 30_000 })).toBeNull();
    expect(speedKmhBetween(previous, { ...previous, timestamp: 6000, accuracyM: 10 })).toBe(0);
  });

  it('prefiere la velocidad GPS válida y suaviza variaciones grandes', () => {
    const previous = { pos: [-31.7, -60.5] as [number, number], timestamp: 1000, accuracyM: 8 };
    expect(speedKmhBetween(previous, { ...previous, timestamp: 6000 }, 10)).toBe(36);
    expect(smoothSpeed(20, 100)).toBe(25);
    expect(smoothSpeed(20, 0)).toBe(15);
  });
});
