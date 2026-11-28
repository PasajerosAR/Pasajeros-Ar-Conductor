import { supabase } from './supabase';
import { readDeviceStatus, isNativeApp } from './deviceStatus';

// Marcaje de entrada y salida: foto con la cámara frontal + ubicación del teléfono. La hora oficial la pone el servidor.
// La ubicación es una evidencia (el GPS puede tener error o ser manipulado): se envía junto con la precisión informada.

export type PunchKind = 'in' | 'out';
export interface Fix { lat: number; lng: number; accuracy: number; at: number }
export interface PunchItem { key: string; kind: PunchKind; companyId: string; driverId: string; photo: Blob; fix: Fix }

// Errores propios del paso a paso (mensajes para el conductor)
export class ClockError extends Error {
  constructor(readonly code: 'CAMERA_DENIED' | 'CAMERA_UNAVAILABLE' | 'GPS_DENIED' | 'GPS_OFF' | 'GPS_TIMEOUT', message: string) { super(message); }
}

const GOOD_ACCURACY_M = 100;      // precisión buscada: si no se logra, el marcaje queda señalado como "baja precisión"
const FIX_WAIT_MS = 20_000;       // tiempo máximo esperando una mejor precisión

// ---------------------------------------------------------------- cámara
export async function capturePhoto(video: HTMLVideoElement): Promise<Blob> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new ClockError('CAMERA_DENIED', 'La app no tiene permiso para usar la cámara. Activalo en Ajustes > Aplicaciones > Pasajeros.ar Conductor > Permisos > Cámara.');
    throw new ClockError('CAMERA_UNAVAILABLE', 'No se pudo abrir la cámara frontal. Revisá que el teléfono la tenga y que ninguna otra app la esté usando.');
  }
  try {
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 900));   // un instante para que la cámara ajuste luz y enfoque
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) throw new ClockError('CAMERA_UNAVAILABLE', 'La cámara no entregó imagen. Probá de nuevo.');
    const scale = Math.min(1, 640 / w);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
    if (!blob) throw new ClockError('CAMERA_UNAVAILABLE', 'No se pudo guardar la foto. Probá de nuevo.');
    return blob;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}

// ---------------------------------------------------------------- ubicación
export async function currentFix(): Promise<Fix> {
  if (isNativeApp()) {
    try { if ((await readDeviceStatus()).gpsEnabled === false) throw new ClockError('GPS_OFF', 'El GPS está apagado. Activalo desde el panel rápido o en Ajustes > Ubicación y volvé a intentar.'); }
    catch (e) { if (e instanceof ClockError) throw e; /* sin dato del plugin: se intenta igual */ }
  }
  if (!('geolocation' in navigator)) throw new ClockError('GPS_OFF', 'Este teléfono no ofrece ubicación.');
  return new Promise<Fix>((resolve, reject) => {
    let best: Fix | null = null;
    let done = false;
    const finish = (fn: () => void) => { if (done) return; done = true; navigator.geolocation.clearWatch(id); clearTimeout(timer); fn(); };
    const timer = setTimeout(() => finish(() => (best ? resolve(best)
      : reject(new ClockError('GPS_TIMEOUT', 'No se pudo obtener la ubicación. Salí a un lugar abierto y probá de nuevo.')))), FIX_WAIT_MS);
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const fix: Fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() };
        if (!best || fix.accuracy < best.accuracy) best = fix;
        if (fix.accuracy <= GOOD_ACCURACY_M) finish(() => resolve(fix));
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) finish(() => reject(new ClockError('GPS_DENIED', 'La app no tiene permiso de ubicación. Activalo en Ajustes > Aplicaciones > Pasajeros.ar Conductor > Permisos > Ubicación.')));
        else if (e.code === e.POSITION_UNAVAILABLE) finish(() => reject(new ClockError('GPS_OFF', 'No se detecta el GPS. Activá la ubicación del teléfono y volvé a intentar.')));
        // TIMEOUT: se sigue esperando hasta FIX_WAIT_MS
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: FIX_WAIT_MS }
    );
  });
}

// ---------------------------------------------------------------- envío (foto al almacenamiento privado + marcaje en el servidor)
export const newKey = (): string => crypto.randomUUID();
const photoPath = (i: PunchItem) => `${i.companyId}/${i.driverId}/${i.key}-${i.kind}.jpg`;

export interface PunchResult { status: 'ok' | 'duplicate'; inside: boolean; zone_name: string | null; low_accuracy?: boolean; server_at: string }

// Un error de red se reintenta más tarde; cualquier otra respuesta del servidor es definitiva.
export function isNetworkError(e: unknown): boolean {
  const raw = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return !navigator.onLine || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(raw) && !/^[A-Z_]{4,}:/.test(raw);
}

export async function sendPunch(item: PunchItem): Promise<PunchResult> {
  const up = await supabase.storage.from('punch-photos').upload(photoPath(item), item.photo, { contentType: 'image/jpeg', upsert: false });
  if (up.error && !/already exists|duplicate|409/i.test(`${up.error.message} ${(up.error as { statusCode?: string }).statusCode ?? ''}`)) throw up.error;
  const { data, error } = await supabase.rpc('punch_shift', {
    p_kind: item.kind, p_client_key: item.key, p_lat: item.fix.lat, p_lng: item.fix.lng,
    p_accuracy: item.fix.accuracy, p_captured_at: new Date(item.fix.at).toISOString()
  });
  if (error) throw error;
  return data as PunchResult;
}

// ---------------------------------------------------------------- cola local: no se pierde un marcaje ya capturado
const DB = 'pasajerosar-clock';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('queue', { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = run(d.transaction('queue', mode).objectStore('queue'));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export const queueAdd = (i: PunchItem) => tx('readwrite', (s) => s.put(i));
export const queueRemove = (key: string) => tx('readwrite', (s) => s.delete(key));
export const queueAll = () => tx<PunchItem[]>('readonly', (s) => s.getAll());

export type FlushOutcome = { key: string; kind: PunchKind; ok: true; result: PunchResult } | { key: string; kind: PunchKind; ok: false; error: unknown };
// Reenvía lo pendiente de este conductor. Si falla por red, queda en la cola; si el servidor lo rechaza, se descarta y se informa.
export async function flushQueue(driverId: string): Promise<FlushOutcome[]> {
  const out: FlushOutcome[] = [];
  const items = (await queueAll().catch(() => [] as PunchItem[])).filter((i) => i.driverId === driverId).sort((a, b) => a.fix.at - b.fix.at);
  for (const item of items) {
    try {
      const result = await sendPunch(item);
      await queueRemove(item.key);
      out.push({ key: item.key, kind: item.kind, ok: true, result });
    } catch (error) {
      if (isNetworkError(error)) break;           // sigue sin conexión: se reintenta después
      await queueRemove(item.key);
      out.push({ key: item.key, kind: item.kind, ok: false, error });
    }
  }
  return out;
}
