import { bearingDeg } from './bearing';
import { distanceM } from './tripPlan';
import type { LatLng } from './routePath';

export interface HeadingFix {
  pos: LatLng;
  timestamp: number;
  accuracyM: number;
}

export function courseBetween(previous: HeadingFix, current: HeadingFix): number | null {
  const elapsedSeconds = (current.timestamp - previous.timestamp) / 1000;
  if (elapsedSeconds <= 0 || current.accuracyM > 50) return null;
  const distance = distanceM(previous.pos, current.pos);
  if (distance < 10 || distance / elapsedSeconds < 0.8) return null;
  return bearingDeg(previous.pos, current.pos);
}

export function smoothHeading(previous: number | null, next: number, amount = 0.25): number {
  if (previous === null) return next;
  const delta = ((next - previous + 540) % 360) - 180;
  return (previous + delta * amount + 360) % 360;
}
