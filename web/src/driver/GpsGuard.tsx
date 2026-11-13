import { useEffect, useState, type ReactNode } from 'react';
import { useGps } from './useGps';

// App del conductor: el GPS tiene que estar encendido y con permiso todo el tiempo. Si no, una pantalla bloquea la app
// hasta que se active (reintenta sola). Los teléfonos dedicados lo dejan fijo; acá se impide usar la app sin él.
function Probe({ onState }: { onState: (e: 'denied' | 'unavailable' | null) => void }) {
  const g = useGps(true);
  useEffect(() => {
    if (g.error === 'denied' || g.error === 'unavailable') onState(g.error);
    else if (g.pos) onState(null);
  }, [g.error, g.pos, onState]);
  return null;
}

export function GpsGuard({ children }: { children: ReactNode }) {
  const [problem, setProblem] = useState<'denied' | 'unavailable' | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!problem) return;
    const t = setInterval(() => setAttempt((n) => n + 1), 3000);   // reintenta: apenas se activa, se desbloquea
    return () => clearInterval(t);
  }, [problem]);
  return (
    <>
      <Probe key={attempt} onState={setProblem} />
      {children}
      {problem && (
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
