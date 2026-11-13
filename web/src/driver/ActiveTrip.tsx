import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { must, useQuery } from '../lib/useQuery';
import { formatTime } from '../ui';
import { endTripConfirm } from './endTrip';

interface Active {
  id: string; scheduled_departure: string;
  vehicles: { internal_number: string } | null;
  services: { code: string } | null;
  service_departures: { routes: { name: string } | null } | null;
}

// Aviso de un viaje en curso del conductor (de hoy o de un día anterior): se puede continuar o finalizar desde acá.
// Mientras haya uno en curso no se puede iniciar otro servicio ni cerrar la jornada.
export function ActiveTrip({ onChange }: { onChange?: () => void }) {
  const active = useQuery(async () => must(await supabase.from('trips')
    .select('id,scheduled_departure,vehicles(internal_number),services(code),service_departures(routes(name))')
    .eq('status', 'in_progress').order('started_at', { ascending: false })) as unknown as Active[], []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = async (id: string) => {
    setBusy(id); setError(null);
    const e = await endTripConfirm(id);
    setBusy(null);
    if (e) setError(e);
    active.reload(); onChange?.();
  };

  if (!active.data?.length) return null;
  return (
    <section className="driver-active-trips" aria-label="Servicio en curso">
      <div className="driver-section-heading">
        <h2>Tu servicio en curso</h2>
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {active.data.map((t) => (
        <article key={t.id} className="panel driver-active-card">
          <div className="driver-active-topline">
            <span className="driver-status-badge in_progress"><i />En curso</span>
            <span className="muted">Unidad <b>{t.vehicles?.internal_number ?? '—'}</b></span>
          </div>
          <h3>{t.service_departures?.routes?.name ?? `Servicio ${t.services?.code ?? '-'}`}</h3>
          <p>Servicio {t.services?.code ?? '-'} · Salida programada {formatTime(t.scheduled_departure)}</p>
          <div className="driver-active-actions">
            <Link to={`/conductor/viaje/${t.id}`} className="driver-continue-link">
              <button className="primary" style={{ width: '100%' }}>Continuar viaje <span aria-hidden="true">›</span></button>
            </Link>
            <button className="driver-finish-link" disabled={busy === t.id} onClick={() => finish(t.id)}>
              {busy === t.id ? 'Finalizando…' : 'Finalizar viaje'}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
