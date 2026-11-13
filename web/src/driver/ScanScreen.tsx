import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import { supabase } from '../lib/supabase';
import { friendly } from '../lib/errors';
import { must, useQuery } from '../lib/useQuery';
import { Loading } from '../ui';
import { checkTestQr, type ScanResult } from '../lib/qrCheck';
import type { CountResult, TripStatus } from '../lib/types';
import { loadCounts } from './counts';
import { readPrefs, writePrefs, type ScanMode, type ScanPos, type ScannerPrefs } from './scannerPrefs';

interface TripInfo { id: string; status: TripStatus; layout_id: string | null; services: { code: string } | null; service_departures: { routes: { name: string } | null } | null }

const COOLDOWN_MS = 2500;   // pausa entre lecturas (evita contar dos veces el mismo QR que sigue frente a la cámara)
const ARMED_MS = 6000;      // en modo manual, tiempo que la cámara queda atenta después de tocar el botón

let audio: AudioContext | null = null;
function feedback(ok: boolean) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    o.frequency.value = ok ? 880 : 220;
    o.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + (ok ? 0.12 : 0.35));
  } catch { /* sin audio */ }
  try { navigator.vibrate?.(ok ? 60 : [120, 60, 120]); } catch { /* sin vibración */ }
}

const POSITIONS: { v: ScanPos; label: string }[] = [
  { v: 'center', label: 'Centro' }, { v: 'left', label: 'Izquierda' }, { v: 'right', label: 'Derecha' }, { v: 'both', label: 'Ambos' }
];

// Lector de pasajes: cámara arriba, resultado abajo. No se sale hasta tocar Volver.
// MODO PRUEBA: valida códigos de prueba (ver lib/qrCheck.ts) y cada lectura OK suma un pasajero a bordo.
export function ScanScreen() {
  const { id = '' } = useParams();
  const video = useRef<HTMLVideoElement>(null);
  const [prefs, setPrefs] = useState<ScannerPrefs>(readPrefs);
  const [showPrefs, setShowPrefs] = useState(false);
  const [armed, setArmed] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<(ScanResult & { warn?: string }) | null>(null);
  const [counts, setCounts] = useState<{ onboard: number; capacity: number } | null>(null);

  const armedRef = useRef(false);
  const armTimer = useRef<number | undefined>(undefined);
  const lastAt = useRef(0);
  const used = useRef(new Set<string>());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const trip = useQuery(async () => must(await supabase.from('trips')
    .select('id,status,layout_id,services(code),service_departures(routes(name))').eq('id', id).maybeSingle()) as unknown as TripInfo | null, [id]);
  const t = trip.data;
  const active = t?.status === 'in_progress';
  const routeName = t?.service_departures?.routes?.name ?? '';
  const routeRef = useRef(routeName);
  routeRef.current = routeName;

  useEffect(() => { if (t) void loadCounts(t.id, t.layout_id).then(setCounts); }, [t?.id, t?.layout_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const disarm = useCallback(() => { armedRef.current = false; setArmed(false); window.clearTimeout(armTimer.current); }, []);
  const arm = () => {
    armedRef.current = true; setArmed(true);
    window.clearTimeout(armTimer.current);
    armTimer.current = window.setTimeout(disarm, ARMED_MS);
  };

  const handle = useCallback(async (payload: string) => {
    const manual = prefsRef.current.mode === 'manual';
    if (manual && !armedRef.current) return;
    const now = Date.now();
    if (now - lastAt.current < COOLDOWN_MS) return;
    lastAt.current = now;
    if (manual) disarm();

    const r = checkTestQr(payload, used.current, routeRef.current);
    if (!r.ok || !r.code) { setResult(r); feedback(false); return; }
    used.current.add(r.code);
    // cada lectura válida suma un pasajero a bordo (el mismo registro que el botón "Suben")
    const { data, error } = await supabase.rpc('register_count', { p_trip: id, p_kind: 'board', p_quantity: 1, p_stop: null, p_event: crypto.randomUUID() });
    if (error) {
      used.current.delete(r.code);
      setResult({ ok: false, title: 'No se pudo registrar', detail: friendly(error) }); feedback(false); return;
    }
    const c = data as CountResult;
    setCounts({ onboard: c.onboard, capacity: c.capacity });
    setResult({ ...r, warn: c.over_capacity ? `Atención: hay ${c.onboard} a bordo y la capacidad es ${c.capacity}.` : undefined });
    feedback(true);
  }, [id, disarm]);

  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    if (!active || !video.current) return;
    const scanner = new QrScanner(video.current, (r) => { void handleRef.current(r.data); },
      { preferredCamera: 'environment', maxScansPerSecond: 5, returnDetailedScanResult: true, highlightScanRegion: true });
    scanner.start().then(() => setCameraError(null)).catch((e: unknown) =>
      setCameraError(String(e).includes('Permission') || String(e).includes('NotAllowed') ? 'Permití el acceso a la cámara para escanear.' : 'No se pudo abrir la cámara.'));
    return () => { scanner.stop(); scanner.destroy(); window.clearTimeout(armTimer.current); };
  }, [active]);

  const setPref = (p: Partial<ScannerPrefs>) => { const next = { ...prefs, ...p }; setPrefs(next); writePrefs(next); if (p.mode) disarm(); };

  if (trip.loading) return <div className="driver-app"><Loading /></div>;
  if (!t) return <div className="driver-app"><div className="notice error">No se encontró el viaje.</div></div>;

  const free = counts && counts.capacity > 0 ? Math.max(counts.capacity - counts.onboard, 0) : null;
  const fab = (key: string) => (
    <button key={key} className="scan-fab primary" onClick={arm} aria-label="Escanear" disabled={!active || prefs.mode === 'auto'}
      style={{ visibility: prefs.mode === 'auto' ? 'hidden' : 'visible' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
      </svg>
    </button>
  );
  const justify = prefs.pos === 'both' ? 'space-between' : prefs.pos === 'left' ? 'flex-start' : prefs.pos === 'right' ? 'flex-end' : 'center';

  return (
    <div className="driver-app">
      <div className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
        <Link to={`/conductor/viaje/${id}`}><button style={{ minHeight: 48 }}>Volver</button></Link>
        <h1 style={{ fontSize: 18, flex: 1 }}>Lector de pasajes</h1>
        <button aria-label="Configuración del escáner" aria-expanded={showPrefs} style={{ minHeight: 48 }} onClick={() => setShowPrefs(!showPrefs)}>⚙</button>
      </div>

      {showPrefs && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Modo</div>
            <div className="seg" role="group" aria-label="Modo de lectura">
              {(['manual', 'auto'] as ScanMode[]).map((m) => (
                <button key={m} type="button" className={m === prefs.mode ? 'primary' : ''} aria-pressed={m === prefs.mode} onClick={() => setPref({ mode: m })}>{m === 'manual' ? 'Manual' : 'Automático'}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Posición del botón</div>
            <div className="seg" role="group" aria-label="Posición del botón de escanear">
              {POSITIONS.map((p) => (
                <button key={p.v} type="button" className={p.v === prefs.pos ? 'primary' : ''} aria-pressed={p.v === prefs.pos} onClick={() => setPref({ pos: p.v })}>{p.label}</button>
              ))}
            </div>
          </div>
          <Link to="/conductor/prueba-qr" className="muted">Códigos QR de prueba</Link>
        </div>
      )}

      {!active ? (
        <div className="notice warn">El viaje no está en curso. Iniciá el viaje para escanear pasajes.</div>
      ) : (
        <>
          <div className="scan-cam">
            <video ref={video} muted playsInline />
            {cameraError && <div className="scan-cam-msg">{cameraError}</div>}
            {!cameraError && <div className="scan-cam-msg scan-cam-hint">{prefs.mode === 'auto' ? 'Leyendo automáticamente...' : armed ? 'Apuntá al QR...' : 'Tocá el botón para escanear'}</div>}
          </div>

          <div className="seg" role="group" aria-label="Modo de lectura">
            {(['manual', 'auto'] as ScanMode[]).map((m) => (
              <button key={m} type="button" className={m === prefs.mode ? 'primary' : ''} aria-pressed={m === prefs.mode} onClick={() => setPref({ mode: m })}>{m === 'manual' ? 'Manual' : 'Automático'}</button>
            ))}
          </div>

          <div className={`scan-result ${result ? (result.ok ? 'ok' : 'bad') : ''}`} role="status" aria-live="assertive">
            {result ? (<><b>{result.title}</b><div>{result.detail}</div>{result.warn && <div>{result.warn}</div>}</>) : <span className="muted">Esperando lectura</span>}
          </div>

          <div className="grid4">
            <div className="panel"><b>{counts?.onboard ?? '-'}</b><span className="muted">A bordo</span></div>
            <div className="panel"><b>{free ?? '-'}</b><span className="muted">Libres</span></div>
            <div className="panel"><b>{counts?.capacity || '-'}</b><span className="muted">Capacidad</span></div>
          </div>

          <div className="scan-bar" style={{ justifyContent: justify }}>
            {prefs.pos === 'both' ? [fab('l'), fab('r')] : fab('one')}
          </div>
        </>
      )}
    </div>
  );
}
