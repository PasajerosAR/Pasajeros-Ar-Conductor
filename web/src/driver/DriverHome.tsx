import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { friendly } from '../lib/errors';
import { must, useQuery } from '../lib/useQuery';
import { useAuth } from '../auth/AuthProvider';
import { Loading, formatTime, todayLocal } from '../ui';
import { formatPunctuality, punctualityMinutes } from '../lib/punctuality';
import { ActiveTrip } from './ActiveTrip';
import { DriverCompany } from './DriverCompany';
import { STATUS_LABEL, type Shift, type TripStatus } from '../lib/types';

interface TripRow {
  id: string; status: TripStatus; scheduled_departure: string;
  vehicles: { internal_number: string } | null;
  services: { code: string } | null;
  service_departures: { routes: { name: string } | null } | null;
}

export function DriverHome() {
  const { profile } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAllTrips, setShowAllTrips] = useState(false);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);

  const shift = useQuery(async () => must(await supabase.from('shifts').select('*').is('ended_at', null).maybeSingle()) as Shift | null, []);
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  const trips = useQuery(async () => must(await supabase.from('trips')
    .select('id,status,scheduled_departure,vehicles(internal_number),services(code),service_departures(routes(name))')
    .or(`service_date.eq.${todayLocal()},status.eq.in_progress,and(scheduled_departure.gte.${dayStart.toISOString()},scheduled_departure.lt.${dayEnd.toISOString()})`).order('scheduled_departure')) as unknown as TripRow[], []);

  const toggleShift = async () => {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc(shift.data ? 'end_shift' : 'start_shift');
    setBusy(false);
    if (e) setError(friendly(e)); else shift.reload();
  };

  const name = profile?.full_name.trim() ?? '';
  const firstName = name.split(/\s+/)[0] || 'conductor';
  const greeting = now.getHours() < 12 ? 'Buen día' : now.getHours() < 20 ? 'Buenas tardes' : 'Buenas noches';
  const upcoming = (trips.data ?? []).filter((trip) => trip.status === 'scheduled');
  const visibleTrips = showAllTrips ? (trips.data ?? []).filter((trip) => trip.status !== 'in_progress') : upcoming.slice(0, 3);

  return (
    <div className="driver-app driver-home">
      <DriverCompany />

      {error && <div className="notice error" role="alert">{error}</div>}

      <header className="driver-greeting">
        <div className="driver-date">{now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1>¡{greeting}, {firstName}!</h1>
        <p>Tu jornada, de un vistazo.</p>
      </header>

      <div className="panel driver-shift-card">
        {shift.loading ? <Loading /> : (
          <>
            <div className="driver-shift-main">
              <span className={`driver-shift-icon${shift.data ? ' active' : ''}`} aria-hidden="true">{shift.data ? '✓' : '○'}</span>
              <div className="driver-shift-copy">
                <span className="driver-eyebrow">Jornada</span>
                <strong>{shift.data ? `Desde las ${formatTime(shift.data.started_at)}` : 'Sin iniciar'}</strong>
              </div>
              <span className={`driver-status-badge${shift.data ? ' active' : ''}`}><i />{shift.data ? 'En turno' : 'Inactiva'}</span>
            </div>
            <div className="driver-shift-footer">
              <span>{shift.data ? 'Acordate de cerrar la jornada al terminar.' : 'Iniciá tu jornada para empezar.'}</span>
              <button className={shift.data ? 'secondary' : 'primary'} disabled={busy} onClick={toggleShift}>
                {busy ? 'Procesando…' : shift.data ? 'Cerrar' : 'Iniciar'}
              </button>
            </div>
          </>
        )}
      </div>

      <ActiveTrip onChange={() => { trips.reload(); shift.reload(); }} />

      {trips.error && <div className="notice error">{trips.error}</div>}
      <section className="driver-upcoming" aria-label="Próximos servicios">
        <div className="driver-section-heading">
          <h2>{showAllTrips ? 'Servicios de hoy' : 'Próximos servicios'}</h2>
          {(trips.data ?? []).filter((trip) => trip.status !== 'in_progress').length > 3 && (
            <button className="driver-text-button" type="button" onClick={() => setShowAllTrips(!showAllTrips)}>
              {showAllTrips ? 'Ver próximos' : 'Ver todos'}
            </button>
          )}
        </div>
        {trips.loading ? <Loading /> : visibleTrips.length === 0 ? (
          <div className="panel driver-empty-state">
            {upcoming.length ? 'No hay más servicios programados para hoy.' : 'No tenés próximos servicios asignados para hoy.'}
            {!showAllTrips && (trips.data ?? []).some((trip) => trip.status !== 'in_progress') && (
              <button className="driver-text-button" type="button" onClick={() => setShowAllTrips(true)}>Ver servicios de hoy</button>
            )}
          </div>
        ) : (
          <div className="driver-service-list">
            {visibleTrips.map((trip) => {
              const mins = punctualityMinutes(new Date(trip.scheduled_departure), now);
              return (
                <Link key={trip.id} to={`/conductor/viaje/${trip.id}`} className="driver-service-card">
                  <span className="driver-service-time">
                    <strong>{formatTime(trip.scheduled_departure)}</strong>
                    <small>HOY</small>
                  </span>
                  <span className="driver-service-info">
                    <strong>Servicio {trip.services?.code ?? '-'}</strong>
                    <small>{trip.service_departures?.routes?.name ?? 'Recorrido sin nombre'} · Unidad {trip.vehicles?.internal_number ?? 'sin asignar'}</small>
                    {trip.status === 'scheduled' && <small className={mins < 0 ? 'late' : 'early'}>{formatPunctuality(mins, mins >= 0)}</small>}
                  </span>
                  <span className={`driver-status-badge driver-trip-status ${trip.status}${trip.status === 'scheduled' && mins < 0 ? ' late' : ''}`} title={STATUS_LABEL[trip.status]}>
                    {trip.status === 'scheduled' ? (mins < 0 ? 'Demorado' : 'A tiempo') : STATUS_LABEL[trip.status]}
                  </span>
                  <span className="driver-service-arrow" aria-hidden="true">›</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="driver-start-service">
        <Link to="/conductor/iniciar">
          <button className="primary big" style={{ width: '100%' }} disabled={!shift.data}>Iniciar servicio</button>
        </Link>
        {!shift.loading && !shift.data && <div className="muted">Iniciá la jornada para poder iniciar un servicio.</div>}
      </div>
    </div>
  );
}
