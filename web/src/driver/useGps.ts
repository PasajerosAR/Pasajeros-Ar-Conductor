import { useEffect, useState } from 'react';
import type { LatLng } from '../lib/routePath';
import { bearingDeg } from '../lib/bearing';
import { distanceM } from '../lib/tripPlan';

export interface GpsState {
  pos: LatLng | null;
  heading: number | null;
  accuracyM: number | null;
  timestamp: number | null;
  error: 'denied' | 'unavailable' | 'timeout' | null;   // timeout: sin señal por el momento (no es un GPS apagado)
}

// La posición del teléfono se usa en pantalla y, al validar un QR, como dato transitorio; no se guarda.
export function useGps(active: boolean): GpsState {
  const [state, setState] = useState<GpsState>({ pos: null, heading: null, accuracyM: null, timestamp: null, error: null });
  useEffect(() => {
    if (!active) return;
    if (!('geolocation' in navigator)) { setState({ pos: null, heading: null, accuracyM: null, timestamp: null, error: 'unavailable' }); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => setState((s) => {
        const pos: LatLng = [p.coords.latitude, p.coords.longitude];
        // rumbo: el del GPS si viene; si no, el del último desplazamiento (más de 8 m); si está quieto, se conserva el anterior
        const own = p.coords.heading;
        const heading = own !== null && Number.isFinite(own) ? own : s.pos && distanceM(s.pos, pos) > 8 ? bearingDeg(s.pos, pos) : s.heading;
        return { pos, heading, accuracyM: p.coords.accuracy, timestamp: p.timestamp, error: null };
      }),
      (e) => setState((s) => ({ ...s, error: e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable' })),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  return state;
}
