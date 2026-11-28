import { useEffect, useRef, useState } from 'react';
import { friendly } from '../lib/errors';
import { formatTime } from '../ui';
import { ClockError, capturePhoto, currentFix, isNetworkError, newKey, queueAdd, queueRemove, sendPunch, type Fix, type PunchItem, type PunchKind, type PunchResult } from '../lib/clock';

const INTRO_KEY = 'pasajerosar-clock-intro';
const seenIntro = () => { try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return false; } };

type Step = 'intro' | 'camera' | 'preview' | 'gps' | 'confirm' | 'sending' | 'done' | 'queued' | 'error';
interface Props { kind: PunchKind; companyId: string; driverId: string; onClose: (changed: boolean) => void }

// Marcar: "Iniciar" o "Cerrar" → foto con la cámara frontal → se ve la foto (repetir o usar) → ubicación → confirmar → envío.
// Hasta confirmar se puede cancelar; una vez registrado el marcaje no se modifica.
export function ClockFlow({ kind, companyId, driverId, onClose }: Props) {
  const [step, setStep] = useState<Step>(seenIntro() ? 'camera' : 'intro');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PunchResult | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [confirmAt, setConfirmAt] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const running = useRef(false);
  const word = kind === 'in' ? 'entrada' : 'salida';

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const fail = (e: unknown) => { setError(e instanceof ClockError ? e.message : friendly(e)); setStep('error'); };

  const takePhoto = async () => {
    if (running.current || !video.current) return;
    running.current = true;
    setError('');
    try {
      setStep('camera');
      const blob = await capturePhoto(video.current);
      setPhoto(blob); setPhotoUrl(URL.createObjectURL(blob)); setFix(null);
      setStep('preview');
    } catch (e) { fail(e); } finally { running.current = false; }
  };

  const locate = async () => {
    if (running.current) return;
    running.current = true;
    setError(''); setStep('gps');
    try {
      setFix(await currentFix());
      setConfirmAt(new Date().toISOString());
      setStep('confirm');
    } catch (e) { fail(e); } finally { running.current = false; }
  };

  const send = async () => {
    if (running.current || !photo || !fix) return;
    running.current = true;
    const item: PunchItem = { key: newKey(), kind, companyId, driverId, photo, fix };
    try {
      await queueAdd(item).catch(() => undefined);     // queda guardado en el teléfono por si se corta la conexión
      setStep('sending');
      const r = await sendPunch(item);
      await queueRemove(item.key).catch(() => undefined);
      setResult(r); setStep('done');
    } catch (e) {
      if (isNetworkError(e)) setStep('queued');
      else {
        await queueRemove(item.key).catch(() => undefined);   // el servidor lo rechazó: no se reintenta solo
        fail(e);
      }
    } finally { running.current = false; }
  };

  useEffect(() => { if (step === 'camera' && !running.current) void takePhoto(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [step === 'camera']);

  const accept = () => { try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* sin almacenamiento */ } setStep('camera'); };
  const retry = () => { if (photo) void locate(); else setStep('camera'); };   // con foto ya aceptada, solo se repite la ubicación

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="clock-title"
      style={{ position: 'fixed', inset: 0, zIndex: 90000, display: 'grid', placeItems: 'center', padding: 24, background: '#0b1422f2', color: '#f4f7fa', textAlign: 'center' }}>
      <div style={{ maxWidth: 380, width: '100%' }}>
        <h1 id="clock-title" style={{ fontSize: 22 }}>Marcar {word}</h1>
        <video ref={video} playsInline muted style={{ width: 160, height: 120, objectFit: 'cover', borderRadius: 12, background: '#000', display: step === 'camera' ? 'inline-block' : 'none', transform: 'scaleX(-1)' }} />

        {step === 'intro' && (
          <>
            <p>Para marcar la jornada la app necesita:</p>
            <ul style={{ textAlign: 'left' }}>
              <li><b>Cámara:</b> saca una foto tuya con la cámara frontal como constancia.</li>
              <li><b>Ubicación (GPS):</b> registra dónde estás para comprobar que marcás en la zona de tu empresa.</li>
            </ul>
            <p style={{ opacity: 0.8 }}>La hora la registra el servidor. La foto y la ubicación las ve solo tu empresa. Si el teléfono pide permiso, tocá “Permitir”.</p>
            <button className="primary big" style={{ width: '100%' }} onClick={accept}>Entendido, continuar</button>
            <p><button className="driver-text-button" type="button" onClick={() => onClose(false)}>Cancelar</button></p>
          </>
        )}
        {step === 'camera' && <p>Sacando la foto… mirá a la pantalla.</p>}
        {step === 'preview' && (
          <>
            <img src={photoUrl} alt="Foto tomada para el marcaje" style={{ width: 240, maxWidth: '100%', borderRadius: 12, transform: 'scaleX(-1)' }} />
            <p>¿Se te ve bien?</p>
            <button className="primary big" style={{ width: '100%' }} onClick={() => void locate()}>Usar esta foto</button>
            <p><button className="driver-text-button" type="button" onClick={() => setStep('camera')}>Repetir foto</button></p>
            <p><button className="driver-text-button" type="button" onClick={() => onClose(false)}>Cancelar</button></p>
          </>
        )}
        {step === 'confirm' && (
          <>
            <img src={photoUrl} alt="Foto del marcaje" style={{ width: 120, borderRadius: 10, transform: 'scaleX(-1)' }} />
            <p style={{ fontSize: 18 }}>Marcar {word} · {formatTime(confirmAt)}</p>
            <p style={{ opacity: 0.8 }}>Ubicación obtenida. La hora definitiva la registra el servidor.</p>
            <button className="primary big" style={{ width: '100%' }} onClick={() => void send()}>Confirmar {word}</button>
            <p><button className="driver-text-button" type="button" onClick={() => onClose(false)}>Cancelar</button></p>
          </>
        )}
        {step === 'gps' && <p>Buscando tu ubicación… puede tardar unos segundos.</p>}
        {step === 'sending' && <p>Enviando el marcaje…</p>}
        {step === 'done' && result && (
          <>
            <p style={{ fontSize: 18 }}>✓ {kind === 'in' ? 'Entrada' : 'Salida'} registrada a las {formatTime(result.server_at)}{result.zone_name ? ` · ${result.zone_name}` : ''}.</p>
            {!result.inside && <p>Quedó registrada <b>fuera de la zona</b>: tu empresa la va a revisar.</p>}
            {result.low_accuracy && <p style={{ opacity: 0.8 }}>La precisión del GPS fue baja: puede quedar para revisión.</p>}
            <button className="primary big" style={{ width: '100%' }} onClick={() => onClose(true)}>Listo</button>
          </>
        )}
        {step === 'queued' && (
          <>
            <p style={{ fontSize: 18 }}>Sin conexión.</p>
            <p>El marcaje de {word} quedó guardado en el teléfono y se envía solo apenas haya internet. La jornada se {kind === 'in' ? 'inicia' : 'cierra'} cuando el servidor lo reciba.</p>
            <button className="primary big" style={{ width: '100%' }} onClick={() => onClose(true)}>Entendido</button>
          </>
        )}
        {step === 'error' && (
          <>
            <p role="alert" style={{ fontSize: 17 }}>{error}</p>
            <button className="primary big" style={{ width: '100%' }} onClick={retry}>Reintentar</button>
            <p><button className="driver-text-button" type="button" onClick={() => onClose(false)}>Cancelar</button></p>
          </>
        )}
      </div>
    </div>
  );
}
