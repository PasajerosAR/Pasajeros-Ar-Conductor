import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import { supabase } from '../lib/supabase';
import { friendly } from '../lib/errors';
import type { CountResult } from '../lib/types';
import { loadCounts } from './counts';
import { readPrefs, writePrefs, type ScanMode, type ScanPos, type ScannerPrefs } from './scannerPrefs';
import { DriverCompany } from './DriverCompany';
import { useQuery } from '../lib/useQuery';

interface ScanResult {
  ok: boolean;
  title: string;
  detail: string;
  code?: string;
  can_override?: boolean;
  boarding_stop?: string;
  actual_stop?: string;
  actual_stop_id?: string;
  onboard?: number;
  capacity?: number;
  over_capacity?: boolean;
  boarding_override?: boolean;
}
interface PendingOverride { code: string; event: string; stopId: string; boardingStop: string; actualStop: string }
interface ManualLookupResult {
  ok: boolean;
  title: string;
  detail: string;
  can_board: boolean;
  passenger_name?: string;
  boarding_stop?: string | null;
  alighting_stop?: string | null;
}
interface GpsFix { latitude: number; longitude: number; accuracyM: number; timestamp: number }
interface Props { tripId: string; layoutId: string | null; stopId: string; stopName: string; gpsFix: GpsFix | null; onBack: () => void; onCounted: () => void }

const COOLDOWN_MS = 2500;   // pausa entre lecturas (evita contar dos veces el mismo QR que sigue frente a la cámara)
const ARMED_MS = 6000;      // en modo manual, tiempo que la cámara queda atenta después de tocar el botón
const GPS_MAX_AGE_MS = 15_000;
const GPS_MAX_ACCURACY_M = 50;

function usableGpsFix(fix: GpsFix | null, now = Date.now()): fix is GpsFix {
  return fix !== null
    && now - fix.timestamp >= -5000
    && now - fix.timestamp <= GPS_MAX_AGE_MS
    && Number.isFinite(fix.latitude)
    && Number.isFinite(fix.longitude)
    && Number.isFinite(fix.accuracyM)
    && fix.accuracyM > 0
    && fix.accuracyM <= GPS_MAX_ACCURACY_M;
}

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

function parseScanResult(value: unknown): ScanResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (typeof result.ok !== 'boolean' || typeof result.title !== 'string' || typeof result.detail !== 'string') return null;
  if (result.code !== undefined && typeof result.code !== 'string') return null;
  if (result.can_override !== undefined && typeof result.can_override !== 'boolean') return null;
  if (result.boarding_stop !== undefined && typeof result.boarding_stop !== 'string') return null;
  if (result.actual_stop !== undefined && typeof result.actual_stop !== 'string') return null;
  if (result.actual_stop_id !== undefined && typeof result.actual_stop_id !== 'string') return null;
  if (result.onboard !== undefined && typeof result.onboard !== 'number') return null;
  if (result.capacity !== undefined && typeof result.capacity !== 'number') return null;
  if (result.over_capacity !== undefined && typeof result.over_capacity !== 'boolean') return null;
  if (result.boarding_override !== undefined && typeof result.boarding_override !== 'boolean') return null;
  return value as ScanResult;
}

// Lector de pasajes: cámara arriba, resultado abajo. No se sale hasta tocar Volver.
// La validación la hace el servidor (scan_ticket): cada lectura válida sube al pasajero en la parada actual.
export function ScanPanel({ tripId: id, layoutId, stopId, stopName, gpsFix, onBack, onCounted }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [prefs, setPrefs] = useState<ScannerPrefs>(readPrefs);
  const [showPrefs, setShowPrefs] = useState(false);
  const [armed, setArmed] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<(ScanResult & { warn?: string }) | null>(null);
  const [pendingOverride, setPendingOverride] = useState<PendingOverride | null>(null);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [counts, setCounts] = useState<{ onboard: number; capacity: number } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDni, setManualDni] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualBoarding, setManualBoarding] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualResult, setManualResult] = useState<ManualLookupResult | null>(null);

  const armedRef = useRef(false);
  const armTimer = useRef<number | undefined>(undefined);
  const lastAt = useRef(0);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const stopRef = useRef(stopId);
  stopRef.current = stopId;

  useEffect(() => { void loadCounts(id, layoutId).then(setCounts); }, [id, layoutId]);
  const sold = useQuery(async () => {
    const result = await supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('trip_id', id).neq('status', 'cancelled');
    if (result.error) throw new Error(result.error.message);
    return result.count ?? 0;
  }, [id]);

  const disarm = useCallback(() => { armedRef.current = false; setArmed(false); window.clearTimeout(armTimer.current); }, []);
  const arm = () => {
    armedRef.current = true; setArmed(true);
    window.clearTimeout(armTimer.current);
    armTimer.current = window.setTimeout(disarm, ARMED_MS);
  };

  const handle = useCallback(async (payload: string) => {
    if (manualOpen || pendingOverride) return;
    const manual = prefsRef.current.mode === 'manual';
    if (manual && !armedRef.current) return;
    const now = Date.now();
    if (now - lastAt.current < COOLDOWN_MS) return;
    lastAt.current = now;
    if (manual) disarm();
    setPendingOverride(null);

    if (!usableGpsFix(gpsFix, now)) {
      setResult({ ok: false, code: 'GPS_REQUIRED', title: 'No se pudo verificar la parada', detail: 'Se necesita una ubicación GPS reciente y precisa (máximo 50 m). Activá la ubicación y volvé a escanear.' });
      feedback(false);
      return;
    }

    const event = crypto.randomUUID();
    const { data, error } = await supabase.rpc('scan_ticket', {
      p_trip: id,
      p_code: payload,
      p_event: event,
      p_lat: gpsFix.latitude,
      p_lng: gpsFix.longitude,
      p_accuracy_m: gpsFix.accuracyM,
      p_fix_at: new Date(gpsFix.timestamp).toISOString()
    });
    if (error) { setResult({ ok: false, title: 'No se pudo validar', detail: friendly(error) }); feedback(false); return; }
    const r = parseScanResult(data);
    if (!r) {
      setResult({ ok: false, title: 'No se pudo validar', detail: 'El servidor devolvió una respuesta inválida.' });
      feedback(false);
      return;
    }
    if (r.code === 'BOARDING_STOP_MISMATCH' && r.can_override && r.actual_stop_id) {
      setPendingOverride({
        code: payload,
        event,
        stopId: r.actual_stop_id,
        boardingStop: r.boarding_stop ?? 'la parada indicada en el pasaje',
        actualStop: r.actual_stop ?? stopName
      });
    }
    if (!r.ok) { setResult(r); feedback(false); return; }
    setCounts({ onboard: r.onboard ?? 0, capacity: r.capacity ?? 0 });
    onCounted();
    setResult({ ...r, warn: r.over_capacity ? `Atención: hay ${r.onboard} a bordo y la capacidad es ${r.capacity}.` : undefined });
    feedback(true);
  }, [id, disarm, onCounted, manualOpen, pendingOverride, stopName, gpsFix]);

  const allowBoarding = async () => {
    if (!pendingOverride || overrideBusy) return;
    const now = Date.now();
    if (!usableGpsFix(gpsFix, now)) {
      setResult({ ok: false, code: 'GPS_REQUIRED', title: 'No se pudo verificar la parada', detail: 'Necesitamos una ubicación GPS reciente y precisa para autorizar el ascenso.' });
      return;
    }
    setOverrideBusy(true);
    const { data, error } = await supabase.rpc('override_ticket_boarding', {
      p_trip: id,
      p_code: pendingOverride.code,
      p_stop: pendingOverride.stopId,
      p_event: pendingOverride.event,
      p_lat: gpsFix.latitude,
      p_lng: gpsFix.longitude,
      p_accuracy_m: gpsFix.accuracyM,
      p_fix_at: new Date(gpsFix.timestamp).toISOString()
    });
    setOverrideBusy(false);
    if (error) {
      setResult({ ok: false, title: 'No se pudo autorizar el ascenso', detail: friendly(error) });
      feedback(false);
      return;
    }
    const r = parseScanResult(data);
    if (!r) {
      setResult({ ok: false, title: 'No se pudo autorizar el ascenso', detail: 'El servidor devolvió una respuesta inválida.' });
      feedback(false);
      return;
    }
    if (!r.ok) {
      setResult(r);
      setPendingOverride(null);
      feedback(false);
      return;
    }
    setCounts({ onboard: r.onboard ?? 0, capacity: r.capacity ?? 0 });
    onCounted();
    setResult({ ...r, warn: r.over_capacity ? `Atención: hay ${r.onboard} a bordo y la capacidad es ${r.capacity}.` : undefined });
    setPendingOverride(null);
    feedback(true);
  };

  const lookupManual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dni = manualDni.replace(/\D/g, '');
    if (!/^\d{7,8}$/.test(dni)) {
      setManualError('Ingresá un DNI válido de 7 u 8 números.');
      setManualResult(null);
      return;
    }

    setManualLoading(true);
    setManualError(null);
    setManualResult(null);
    const { data, error } = await supabase.rpc('lookup_ticket_by_dni', { p_trip: id, p_dni: dni });
    setManualLoading(false);
    if (error) {
      setManualError(error.code === 'PGRST202'
        ? 'La validación manual por DNI todavía no está habilitada en el servidor.'
        : friendly(error));
      return;
    }
    if (!data || typeof data !== 'object' || !('ok' in data) || typeof data.ok !== 'boolean'
      || !('title' in data) || typeof data.title !== 'string'
      || !('detail' in data) || typeof data.detail !== 'string'
      || !('can_board' in data) || typeof data.can_board !== 'boolean') {
      setManualError('El servidor devolvió una respuesta inválida.');
      return;
    }
    setManualResult(data as ManualLookupResult);
  };

  const boardManual = async () => {
    if (!manualResult?.can_board) return;
    const dni = manualDni.replace(/\D/g, '');
    setManualBoarding(true);
    setManualError(null);
    const { data, error } = await supabase.rpc('board_ticket_by_dni', {
      p_trip: id,
      p_dni: dni,
      p_stop: stopRef.current || null,
      p_event: crypto.randomUUID(),
    });
    setManualBoarding(false);
    if (error) {
      setManualError(error.code === 'PGRST202'
        ? 'El registro manual todavía no está habilitado en el servidor.'
        : friendly(error));
      return;
    }
    if (!data || typeof data !== 'object' || !('ok' in data) || typeof data.ok !== 'boolean'
      || !('title' in data) || typeof data.title !== 'string'
      || !('detail' in data) || typeof data.detail !== 'string') {
      setManualError('El servidor devolvió una respuesta inválida.');
      return;
    }
    const boarded = data as ScanResult & Partial<CountResult>;
    if (!boarded.ok) {
      setManualResult({ ...manualResult, ok: false, title: boarded.title, detail: boarded.detail, can_board: false });
      feedback(false);
      return;
    }
    setCounts({ onboard: boarded.onboard ?? 0, capacity: boarded.capacity ?? 0 });
    setManualResult({ ...manualResult, ok: true, title: boarded.title, detail: boarded.detail, can_board: false });
    onCounted();
    feedback(true);
  };

  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    if (!video.current) return;
    const scanner = new QrScanner(video.current, (r) => { void handleRef.current(r.data); },
      { preferredCamera: 'environment', maxScansPerSecond: 5, returnDetailedScanResult: true, highlightScanRegion: true });
    scanner.start().then(() => setCameraError(null)).catch((e: unknown) =>
      setCameraError(String(e).includes('Permission') || String(e).includes('NotAllowed') ? 'Permití el acceso a la cámara para escanear.' : 'No se pudo abrir la cámara.'));
    return () => { scanner.stop(); scanner.destroy(); window.clearTimeout(armTimer.current); };
  }, []);

  const setPref = (p: Partial<ScannerPrefs>) => { const next = { ...prefs, ...p }; setPrefs(next); writePrefs(next); if (p.mode) disarm(); };

  const free = counts && counts.capacity > 0 ? Math.max(counts.capacity - counts.onboard, 0) : null;
  const fab = (key: string) => (
    <button key={key} className="scan-fab primary" onClick={arm} aria-label="Escanear" disabled={prefs.mode === 'auto'}
      style={{ visibility: prefs.mode === 'auto' ? 'hidden' : 'visible' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
      </svg>
    </button>
  );
  const justify = prefs.pos === 'both' ? 'space-between' : prefs.pos === 'left' ? 'flex-start' : prefs.pos === 'right' ? 'flex-end' : 'center';

  return (
    <div className="driver-app">
      <DriverCompany />
      <div className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
        <button type="button" className="scan-back-button"
          aria-label={showPrefs ? 'Volver al escáner' : 'Volver al viaje'}
          title={showPrefs ? 'Volver al escáner' : 'Volver al viaje'}
          onClick={() => showPrefs ? setShowPrefs(false) : onBack()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
        </button>
        <h1 style={{ fontSize: 18, flex: 1 }}>Lector de pasajes<div className="muted" style={{ fontSize: 13, fontWeight: 400 }}>Parada sugerida: {stopName || '-'}</div></h1>
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
          <Link to={`/conductor/viaje/${id}/pasajes-prueba`} className="muted">Pasajes de prueba (QR)</Link>
        </div>
      )}

      {(
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

          {pendingOverride && (
            <div className="panel" role="group" aria-labelledby="boarding-override-title">
              <b id="boarding-override-title">¿Autorizar el ascenso en esta parada?</b>
              <div>El pasaje indica ascenso en: <b>{pendingOverride.boardingStop}</b></div>
              <div>La unidad está en: <b>{pendingOverride.actualStop}</b></div>
              <p className="muted" style={{ margin: 0 }}>
                Si autorizás, se registrará esta parada como el lugar real de ascenso. La acción queda auditada.
              </p>
              <div className="row">
                <button type="button" className="primary" onClick={() => { void allowBoarding(); }} disabled={overrideBusy}>
                  {overrideBusy ? 'Registrando…' : 'Permitir ascenso aquí'}
                </button>
                <button type="button" className="secondary" onClick={() => setPendingOverride(null)} disabled={overrideBusy}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            className="secondary"
            aria-expanded={manualOpen}
            onClick={() => {
              setManualOpen(!manualOpen);
              setManualError(null);
              setManualResult(null);
            }}
          >
            {manualOpen ? 'Cerrar validación por DNI' : '¿No lee el QR? Validar por DNI'}
          </button>
          {manualOpen && (
            <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p className="muted" style={{ margin: 0 }}>
                Buscá el pasaje de este servicio. Confirmá el ascenso solo después de verificar los datos del pasajero.
              </p>
              <form onSubmit={(event) => { void lookupManual(event); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label htmlFor="manual-ticket-dni">DNI del pasajero</label>
                <input
                  id="manual-ticket-dni"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={10}
                  disabled={manualLoading || manualBoarding}
                  value={manualDni}
                  onChange={(event) => {
                    setManualDni(event.target.value);
                    setManualError(null);
                    setManualResult(null);
                  }}
                  placeholder="Solo números"
                  aria-describedby="manual-ticket-help"
                />
                <span id="manual-ticket-help" className="muted">La búsqueda se limita al servicio activo.</span>
                <button type="submit" className="primary" disabled={manualLoading || manualBoarding}>
                  {manualLoading ? 'Buscando…' : 'Buscar pasaje'}
                </button>
              </form>

              {manualError && <div className="notice error" role="alert">{manualError}</div>}
              {manualResult && (
                <div className={`scan-result ${manualResult.ok ? 'ok' : 'bad'}`} role="status" aria-live="polite">
                  <b>{manualResult.title}</b>
                  <div>{manualResult.detail}</div>
                  {manualResult.passenger_name && <div>Pasajero: {manualResult.passenger_name}</div>}
                  {manualResult.boarding_stop && <div>Asciende en: {manualResult.boarding_stop}</div>}
                  {manualResult.alighting_stop && <div>Desciende en: {manualResult.alighting_stop}</div>}
                  {manualResult.can_board && (
                    <button type="button" className="primary" onClick={() => { void boardManual(); }} disabled={manualBoarding}>
                      {manualBoarding ? 'Registrando…' : 'Confirmar ascenso manual'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {sold.error && <div className="notice error" role="alert">{sold.error}</div>}
          <div className="grid4 driver-stats">
            <div className="panel"><b>{sold.data ?? '-'}</b><span className="muted">Vendidos</span></div>
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
