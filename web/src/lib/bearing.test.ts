import { describe, expect, it } from 'vitest';
import { bearingDeg } from './bearing';

describe('bearingDeg', () => {
  it('norte, este, sur y oeste', () => {
    expect(Math.round(bearingDeg([0, 0], [1, 0]))).toBe(0);
    expect(Math.round(bearingDeg([0, 0], [0, 1]))).toBe(90);
    expect(Math.round(bearingDeg([0, 0], [-1, 0]))).toBe(180);
    expect(Math.round(bearingDeg([0, 0], [0, -1]))).toBe(270);
  });
});
