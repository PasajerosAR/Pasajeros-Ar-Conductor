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
  if (elapsedSeconds <= 0 || elapsedSeconds > 20 || previous.accuracyM > 50 || current.accuracyM > 50) return null;
  const distance = distanceM(previous.pos, current.pos);
  const minDistance = Math.max(10, Math.min(30, (previous.accuracyM + current.accuracyM) * 0.45));
  if (distance < minDistance || distance / elapsedSeconds < 0.8) return null;
  return bearingDeg(previous.pos, current.pos);
}

export function smoothHeading(previous: number | null, next: number, amount?: number): number {
  if (previous === null) return next;
  const delta = ((next - previous + 540) % 360) - 180;
  const smoothing = amount ?? (Math.abs(delta) > 35 ? 0.45 : 0.2);
  return (previous + delta * smoothing + 360) % 360;
}

export function speedKmhBetween(previous: HeadingFix, current: HeadingFix, reportedMps?: number | null): number | null {
  const elapsedSeconds = (current.timestamp - previous.timestamp) / 1000;
  if (elapsedSeconds <= 0 || elapsedSeconds > 20 || previous.accuracyM > 50 || current.accuracyM > 50) return null;
  if (reportedMps !== null && reportedMps !== undefined && Number.isFinite(reportedMps) && reportedMps >= 0 && reportedMps <= 45) {
    return reportedMps * 3.6;
  }
  const distance = distanceM(previous.pos, current.pos);
  const minDistance = Math.max(4, Math.min(15, (previous.accuracyM + current.accuracyM) * 0.3));
  if (distance < minDistance) return 0;
  const speedKmh = distance / elapsedSeconds * 3.6;
  return speedKmh <= 160 ? speedKmh : null;
}

export function smoothSpeed(previous: number | null, next: number, amount = 0.25): number {
  if (previous === null) return next;
  const bounded = Math.max(previous - 20, Math.min(previous + 20, next));
  return Math.max(0, previous + (bounded - previous) * amount);
}
