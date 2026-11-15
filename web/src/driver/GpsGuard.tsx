import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useGps } from './useGps';
import { isNativeApp } from '../lib/deviceStatus';

// App del conductor: el GPS tiene que estar encendido y con permiso todo el tiempo. Si no, una pantalla bloquea la app
// hasta que se active (reintenta sola). Los teléfonos dedicados lo dejan fijo; acá se impide usar la app sin él.
// Estado del GPS compartido con la barra superior (así no se abre un segundo seguimiento de ubicación).
export interface GpsStatus { hasFix: boolean; error: 'denied' | 'unavailable' | 'timeout' | null }
const GpsStatusContext = createContext<GpsStatus>({ hasFix: false, error: null });
export const useGpsStatus = (): GpsStatus => useContext(GpsStatusContext);

function Probe({ onState, onStatus }: { onState: (e: 'denied' | 'unavailable' | null) => void; onStatus: (s: GpsStatus) => void }) {
  const g = useGps(true);
  useEffect(() => { onStatus({ hasFix: g.pos !== null, error: g.error }); }, [g.pos, g.error, onStatus]);
  useEffect(() => {
    if (g.error === 'denied' || g.error === 'unavailable') onState(g.error);
    else if (g.pos) onState(null);
  }, [g.error, g.pos, onState]);
  return null;
}

export function GpsGuard({ children }: { children: ReactNode }) {
  const [problem, setProblem] = useState<'denied' | 'unavailable' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<GpsStatus>({ hasFix: false, error: null });
  useEffect(() => {
    if (!problem) return;
    const t = setInterval(() => setAttempt((n) => n + 1), 3000);   // reintenta: apenas se activa, se desbloquea
    return () => clearInterval(t);
  }, [problem]);
  return (
    <>
      <Probe key={attempt} onState={setProblem} onStatus={setStatus} />
      <GpsStatusContext.Provider value={status}>{children}</GpsStatusContext.Provider>
      {problem && isNativeApp() && (   // en el navegador (pruebas) no bloquea; solo en la app instalada
        <div role="alertdialog" aria-modal="true" aria-labelledby="gps-block-title"
          style={{ position: 'fixed', inset: 0, zIndex: 100000, display: 'grid', placeItems: 'center', padding: 24, background: '#0b1422f2', color: '#f4f7fa', textAlign: 'center' }}>
          <div style={{ maxWidth: 360 }}>
            <h1 id="gps-block-title" style={{ fontSize: 24 }}>GPS apagado</h1>
            <p>{problem === 'denied'
              ? 'La app no tiene permiso de ubicación. Activalo en Ajustes > Aplicaciones > Pasajeros.ar Conductor > Permisos > Ubicación.'
              : 'La ubicación del teléfono está apagada. Activá el GPS desde el panel rápido o en Ajustes > Ubicación.'}</p>
            <p style={{ opacity: 0.8 }}>La app se desbloquea sola cuando el GPS esté encendido.</p>
          </div>
        </div>
      )}
    </>
  );
}
