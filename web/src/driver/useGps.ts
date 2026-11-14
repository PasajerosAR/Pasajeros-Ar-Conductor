import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '../lib/routePath';
import { courseBetween, smoothHeading, smoothSpeed, speedKmhBetween, type HeadingFix } from '../lib/gpsHeading';

export interface GpsState {
  pos: LatLng | null;
  heading: number | null;
  speedKmh: number | null;
  accuracyM: number | null;
  timestamp: number | null;
  error: 'denied' | 'unavailable' | 'timeout' | null;   // timeout: sin señal por el momento (no es un GPS apagado)
}

// La posición del teléfono se usa en pantalla y, al validar un QR, como dato transitorio; no se guarda.
export function useGps(active: boolean): GpsState {
  const [state, setState] = useState<GpsState>({ pos: null, heading: null, speedKmh: null, accuracyM: null, timestamp: null, error: null });
  const headingAnchor = useRef<HeadingFix | null>(null);
  const speedAnchor = useRef<HeadingFix | null>(null);
  const filteredHeading = useRef<number | null>(null);
  const filteredSpeed = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      headingAnchor.current = null;
      speedAnchor.current = null;
      filteredHeading.current = null;
      filteredSpeed.current = null;
      setState({ pos: null, heading: null, speedKmh: null, accuracyM: null, timestamp: null, error: null });
      return;
    }
    if (!('geolocation' in navigator)) { setState({ pos: null, heading: null, speedKmh: null, accuracyM: null, timestamp: null, error: 'unavailable' }); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const pos: LatLng = [p.coords.latitude, p.coords.longitude];
        const fix = { pos, timestamp: p.timestamp, accuracyM: p.coords.accuracy };
        if (fix.accuracyM <= 50) {
          if (!headingAnchor.current) {
            headingAnchor.current = fix;
          } else if (fix.timestamp - headingAnchor.current.timestamp > 20_000) {
            headingAnchor.current = fix;
          } else {
            const course = courseBetween(headingAnchor.current, fix);
            if (course !== null) {
              filteredHeading.current = smoothHeading(filteredHeading.current, course);
              headingAnchor.current = fix;
            }
          }
          if (!speedAnchor.current) {
            speedAnchor.current = fix;
          } else {
            const speed = speedKmhBetween(speedAnchor.current, fix, p.coords.speed);
            if (speed !== null) {
              filteredSpeed.current = smoothSpeed(filteredSpeed.current, speed);
            }
            if (fix.timestamp > speedAnchor.current.timestamp) speedAnchor.current = fix;
          }
        }
        setState((previous) => ({
          pos,
          heading: filteredHeading.current ?? previous.heading,
          speedKmh: filteredSpeed.current ?? previous.speedKmh,
          accuracyM: p.coords.accuracy,
          timestamp: p.timestamp,
          error: null
        }));
      },
      (e) => setState((s) => ({ ...s, error: e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable' })),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  return state;
}
