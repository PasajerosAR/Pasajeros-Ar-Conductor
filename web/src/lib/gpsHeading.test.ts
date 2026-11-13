import { describe, expect, it } from 'vitest';
import { courseBetween, smoothHeading } from './gpsHeading';

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
});
