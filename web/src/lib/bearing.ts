import type { LatLng } from './routePath';

// Rumbo en grados (0 = norte, 90 = este) del punto a hacia el punto b.
export function bearingDeg(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLng = (b[1] - a[1]) * rad;
  const y = Math.sin(dLng) * Math.cos(b[0] * rad);
  const x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
