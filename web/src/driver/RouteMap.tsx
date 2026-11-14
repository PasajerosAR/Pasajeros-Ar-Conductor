import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@tomickigrzegorz/leaflet-rotate';
import { turnAngle, turnText, type TurnNotice } from '../lib/turnGuide';
import { distanceM } from '../lib/tripPlan';
import { formatSigned } from '../lib/punctuality';

interface Props {
  stops: { id: string; name: string; lat: number | null; lng: number | null }[];
  path: [number, number][] | null;
  highlightId?: string | null;
  height?: number;
  pos?: [number, number] | null;   // posición de la unidad (flecha)
  heading?: number | null;        // rumbo en grados
  speedKmh?: number | null;
  punctualityText?: string;
  punctualityMinutes?: number | null;
  punctualityState?: 'early' | 'on_time' | 'late' | null;
  turn?: TurnNotice | null;
}

const FOLLOW_ZOOM = 16;
const FOLLOW_PAN_METERS = 8;
const pinHtml = (active: boolean) =>
  `<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39C15 39 2 24 2 14a13 13 0 0 1 26 0c0 10-13 25-13 25z" fill="${active ? '#b00020' : '#e53935'}" stroke="#fff" stroke-width="2.5"/><circle cx="15" cy="14" r="${active ? 6 : 4.5}" fill="#fff"/></svg>`;
const arrowHtml = () =>
  `<div style="width:44px;height:44px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))"><svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"><path d="M22 3 36 39 22 31 8 39z" fill="#1e88e5" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg></div>`;

// Mapa de solo lectura: recorrido por calles, paradas con pin rojo (la próxima, más grande y oscura) y la flecha de la unidad. Por defecto sigue a la unidad con zoom cercano.
export function RouteMap({
  stops, path, highlightId, height = 320, pos = null, heading = null, speedKmh = null,
  punctualityText = 'Buscando señal GPS', punctualityMinutes = null, punctualityState = null,
  turn = null
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const arrow = useRef<L.Marker | null>(null);
  const [follow, setFollow] = useState(true);
  const [rotationFollow, setRotationFollow] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const followRef = useRef(true);
  followRef.current = follow;
  const posRef = useRef(pos);
  posRef.current = pos;
  const programmaticMove = useRef(false);
  const followStarted = useRef(false);
  const lastHeading = useRef<number | null>(null);
  const displayPos = useRef<[number, number] | null>(null);
  const fitted = useRef('');        // recorrido ya encuadrado

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      zoomControl: true,
      rotate: true,
      rotateControl: false,
      dragRotate: false,
      shiftKeyRotate: false,
      touchRotate: false,
      attributionControl: false,
      preventPageGestures: false
    }).setView([-31.7333, -60.5236], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; colaboradores de OpenStreetMap' }).addTo(m);
    map.current = m;
    const manual = () => {
      if (programmaticMove.current) return;
      m.stopHeadingUp();
      m.setBearing(0);
      followRef.current = false;
      setFollow(false);
    };
    const manualPointer = () => {
      if (programmaticMove.current) return;
      m.stop();
      manual();
    };
    el.current.addEventListener('pointerdown', manualPointer, true);
    m.on('dragstart', manual);
    m.on('zoomstart', manual);
    return () => {
      el.current?.removeEventListener('pointerdown', manualPointer, true);
      m.remove();
      map.current = null;
      arrow.current = null;
      displayPos.current = null;
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    if (fullscreen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', onKeyDown);
    }
    const frame = window.requestAnimationFrame(() => map.current?.invalidateSize());
    return () => {
      window.cancelAnimationFrame(frame);
      if (fullscreen) {
        document.body.style.overflow = previousOverflow;
        window.removeEventListener('keydown', onKeyDown);
      }
    };
  }, [fullscreen]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const g = L.layerGroup().addTo(m);
    const pts: L.LatLngTuple[] = [];
    stops.forEach((s, i) => {
      if (s.lat === null || s.lng === null) return;
      pts.push([s.lat, s.lng]);
      const active = s.id === highlightId;
      const pin = L.marker([s.lat, s.lng], {
        title: s.name,
        zIndexOffset: active ? 500 : 0,
        icon: L.divIcon({ className: '', iconSize: [30, 40], iconAnchor: [15, 38], html: pinHtml(active) })
      }).addTo(g);
      pin.bindTooltip(`${i + 1}. ${s.name}`, { direction: 'top', offset: [0, -34] });
    });
    const line: L.LatLngTuple[] = path && path.length > 1 ? path : pts;
    if (line.length > 1) L.polyline(line, { color: '#2f7fc1', weight: 4, opacity: 0.85, dashArray: path && path.length > 1 ? undefined : '6 8' }).addTo(g);
    const all = [...line, ...pts];
    // sin GPS se encuadra todo el recorrido (una vez por recorrido); con GPS manda el seguimiento
    const key = `${stops.length}:${path?.length ?? 0}`;
    if (all.length && !posRef.current && fitted.current !== key) {
      fitted.current = key;
      programmaticMove.current = true;
      try {
        m.fitBounds(L.latLngBounds(all), { padding: [24, 24], maxZoom: 16 });
      } finally {
        programmaticMove.current = false;
      }
    }
    return () => { g.remove(); };
  }, [stops, path, highlightId]);

  // En navegación, el mapa gira al rumbo y la flecha se contrarota para seguir apuntando hacia arriba.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pos) {
      arrow.current?.remove();
      arrow.current = null;
      displayPos.current = null;
      followStarted.current = false;
      lastHeading.current = null;
      m.stopHeadingUp();
      m.setBearing(0);
      return;
    }
    if (!displayPos.current) displayPos.current = pos;
    else {
      const distance = distanceM(displayPos.current, pos);
      if (distance >= 3) {
        const amount = distance > 40 ? 0.65 : 0.4;
        displayPos.current = [
          displayPos.current[0] + (pos[0] - displayPos.current[0]) * amount,
          displayPos.current[1] + (pos[1] - displayPos.current[1]) * amount
        ];
      }
    }
    const icon = L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22], html: arrowHtml() });
    const rotation = heading ?? 0;
    if (arrow.current) {
      arrow.current.options.rotation = rotation;
      arrow.current.setLatLng(displayPos.current).setIcon(icon);
    } else {
      arrow.current = L.marker(displayPos.current, { icon, interactive: false, zIndexOffset: 1000, rotation, rotateWithView: true }).addTo(m);
    }
    if (follow) {
      programmaticMove.current = true;
      try {
        if (!followStarted.current) {
          m.setView(pos, FOLLOW_ZOOM, { animate: false });
          followStarted.current = true;
        } else {
          const center = m.getCenter();
          if (distanceM([center.lat, center.lng], pos) >= FOLLOW_PAN_METERS) {
            m.panTo(pos, { animate: true, duration: 0.35 });
          }
        }
        if (rotationFollow && heading !== null && Number.isFinite(heading)) {
          const delta = lastHeading.current === null ? 180 : Math.abs(((heading - lastHeading.current + 540) % 360) - 180);
          if (lastHeading.current === null || delta >= 3) {
            m.setHeading(heading);
            lastHeading.current = heading;
          }
        }
      } finally {
        programmaticMove.current = false;
      }
    } else {
      m.stopHeadingUp();
    }
  }, [pos, heading, follow, rotationFollow]);

  const showAll = () => {
    const m = map.current;
    if (!m) return;
    followRef.current = false;
    setFollow(false);
    followStarted.current = false;
    const pts: L.LatLngTuple[] = path && path.length > 1 ? path : stops.flatMap((s) => (s.lat !== null && s.lng !== null ? [[s.lat, s.lng] as L.LatLngTuple] : []));
    programmaticMove.current = true;
    try {
      m.stopHeadingUp();
      m.setBearing(0);
      if (pts.length) {
        m.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 16 });
      }
    } finally {
      programmaticMove.current = false;
    }
  };

  const resumeFollowing = () => {
    followRef.current = true;
    followStarted.current = false;
    setFollow(true);
  };

  const toggleRotationFollow = () => {
    const enabled = !rotationFollow;
    setRotationFollow(enabled);
    if (!enabled) {
      map.current?.stopHeadingUp();
      map.current?.setBearing(0);
      lastHeading.current = null;
    }
  };
  const formatTurnDistance = (meters: number) => meters >= 1000
    ? `${(meters / 1000).toFixed(1).replace('.', ',')} km`
    : `${Math.round(meters)} m`;

  return (
    <div className={`route-map-view${fullscreen ? ' fullscreen' : ''}`}>
      {fullscreen && (
        <>
          <div className="route-map-navigation-status" role="group" aria-label="Velocidad y puntualidad GPS">
            <div className="route-map-speed">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 17a8 8 0 1 1 15 0M12 13l4-4M7 17h10" />
                <circle cx="12" cy="13" r="1" />
              </svg>
              <div><strong>{speedKmh === null ? '--' : Math.round(speedKmh)}</strong><span>km/h</span></div>
            </div>
            <div className={`route-map-punctuality${punctualityState ? ` ${punctualityState}` : ''}`}>
              <span className="route-map-status-dot" />
              <span>{punctualityMinutes === null ? punctualityText : `${formatSigned(punctualityMinutes)} min`}</span>
            </div>
          </div>
        </>
      )}
      <div ref={el} className="map route-map-canvas" style={fullscreen ? undefined : { height }} role="region" aria-label="Mapa del recorrido" />
      {turn && (
        <div className="turn-banner" role="status" aria-live="off">
          <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${turnAngle(turn.maneuver)}deg)` }}>
            <path d="M12 21V6m0 0-6 6m6-6 6 6" />
          </svg>
          <div>
            <b>{turn.meters <= 25 ? 'Ahora' : `En ${formatTurnDistance(turn.meters)}`}</b>
            <span>{turnText(turn.maneuver)}</span>
          </div>
        </div>
      )}
      <div className="route-map-controls">
        <button type="button" className="route-map-icon-button"
            aria-label={fullscreen ? 'Minimizar mapa' : 'Usar mapa en pantalla completa'}
            title={fullscreen ? 'Minimizar mapa' : 'Usar mapa en pantalla completa'}
            onClick={() => setFullscreen(!fullscreen)}>
          {fullscreen ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" />
            </svg>
          )}
        </button>
        <button type="button" className={`route-map-icon-button${pos && follow && rotationFollow ? ' is-active' : ''}`}
            disabled={!pos || !follow}
            aria-pressed={Boolean(pos && follow && rotationFollow)}
            aria-label={!pos ? 'Rotación no disponible: sin señal GPS' : !follow ? 'Seguí la unidad para activar la brújula' : rotationFollow ? 'Desactivar rotación del mapa' : 'Activar rotación del mapa'}
            title={!pos ? 'Rotación no disponible: sin señal GPS' : !follow ? 'Seguí la unidad para activar la brújula' : rotationFollow ? 'Desactivar rotación del mapa' : 'Activar rotación del mapa'}
            onClick={toggleRotationFollow}>
            {pos && follow && rotationFollow ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 11a8 8 0 0 0-14-5L4 8M4 4v4h4" />
                <path d="m12 7 3 6-6 3z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="m15.5 8.5-2 5-5 2 2-5z" />
              </svg>
            )}
        </button>
        <button type="button" className="route-map-icon-button"
            disabled={!pos}
            aria-pressed={!follow}
            aria-label={!pos ? 'Seguir unidad: sin señal GPS' : follow ? 'Ver recorrido completo' : 'Seguir unidad'}
            title={!pos ? 'Seguir unidad: sin señal GPS' : follow ? 'Ver recorrido completo' : 'Seguir unidad'}
            onClick={() => (follow ? showAll() : resumeFollowing())}>
            {follow && pos ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8" />
                <circle cx="12" cy="12" r="2" />
                <path d="M12 2v2m0 16v2M2 12h2m16 0h2" />
              </svg>
            )}
        </button>
      </div>
      <a className="route-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
      {!pos && !fullscreen && <div className="muted route-map-gps-note" style={{ position: 'absolute', zIndex: 1000, left: 8, background: '#0009', padding: '4px 8px', borderRadius: 6, fontSize: 13 }}>Sin posición GPS: la flecha aparece cuando hay señal</div>}
    </div>
  );
}
