import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { errorCode, friendly } from '../lib/errors';
import { must, useQuery } from '../lib/useQuery';
import { Loading, todayLocal } from '../ui';
import { ActiveTrip } from './ActiveTrip';
import { DAY_TYPES, DAY_TYPE_LABEL, dayTypeOf, type DayType } from '../lib/dayType';
import { WINDOW_MINUTES, minutesToDeparture, nearestDeparture, needsReason } from '../lib/startWindow';
import { formatSpan } from '../lib/punctuality';
import { NEAR_ORIGIN_M, nearestOrigin, distanceM, type LatLng } from '../lib/tripPlan';
import type { Route, Service, ServiceDeparture, Vehicle } from '../lib/types';
import { DriverCompany } from './DriverCompany';

const UNAVAILABLE = ['maintenance', 'out_of_service', 'retired'];
const LAST_VEHICLE = 'transporte.lastVehicle';
const readLast = () => { try { return localStorage.getItem(LAST_VEHICLE) ?? ''; } catch { return ''; } };

// El conductor declara qué servicio va a hacer: número, tipo de día, sentido, salida y unidad.
export function StartService() {
  const nav = useNavigate();
  const [now, setNow] = useState(() => new Date());
  // al terminar un viaje, la pantalla del viaje manda acá con el siguiente ya elegido (?servicio=&tipo=&sentido=&salida=)
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('servicio') ?? '');
  const [serviceDate, setServiceDate] = useState(() => {
    const requested = params.get('fecha');
    return requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayLocal();
  });
  const [dayType, setDayType] = useState<DayType>(() => (DAY_TYPES as string[]).includes(params.get('tipo') ?? '')
    ? params.get('tipo') as DayType
    : dayTypeOf(new Date(`${serviceDate}T12:00:00`)));
  const [routePick, setRoutePick] = useState<string | null>(params.get('sentido'));
  const [autoDirection, setAutoDirection] = useState(params.get('autoSentido') === '1');
  const [forcedDirection, setForcedDirection] = useState(params.get('forzadoSentido') === '1');
  const [depPick, setDepPick] = useState<string | null>(params.get('salida'));
  const [pos, setPos] = useState<LatLng | null>(null);

  // ubicación (una sola vez) para sugerir el sentido según dónde está el conductor
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => setPos([p.coords.latitude, p.coords.longitude]), () => setPos(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }, []);
  const [vehicleId, setVehicleId] = useState(readLast);
  const [vehicleTouched, setVehicleTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [takeover, setTakeover] = useState(false); // el viaje está en curso con otro conductor: pide motivo
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const services = useQuery(async () => must(await supabase.from('services').select('id,code,active').eq('active', true).order('code')) as Service[], []);
  const routes = useQuery(async () => must(await supabase.from('routes').select('id,name')) as Pick<Route, 'id' | 'name'>[], []);
  const vehicles = useQuery(async () => must(await supabase.from('vehicles').select('id,internal_number,plate,status').order('internal_number')) as Pick<Vehicle, 'id' | 'internal_number' | 'plate' | 'status'>[], []);
  // unidades que tiene cada servicio con disposición de asientos: {servicio: [unidades]}. Sin entrada = cualquier unidad.
  const compat = useQuery(async () => must(await supabase.rpc('service_layout_vehicles')) as Record<string, string[]>, []);
  // salidas activas de todos los servicios: la lista solo muestra los que tienen salidas para el tipo de día elegido
  const allDeps = useQuery(async () => must(await supabase.from('service_departures').select('service_id,day_types').eq('active', true)) as Pick<ServiceDeparture, 'service_id' | 'day_types'>[], []);
  const available = (services.data ?? []).filter((s) => (allDeps.data ?? []).some((d) => d.service_id === s.id && d.day_types.includes(dayType)));
  const service = (services.data ?? []).find((s) => s.code.toLowerCase() === code.trim().toLowerCase()) ?? null;
  const deps = useQuery(async () => service
    ? must(await supabase.from('service_departures').select('*').eq('service_id', service.id).eq('active', true).order('departure_time')) as ServiceDeparture[]
    : [], [service?.id]);
  // último viaje del día de este conductor: se sugiere el sentido contrario
  const last = useQuery(async () => must(await supabase.from('trips').select('service_id,service_departures(route_id)')
    .eq('status', 'completed').eq('service_date', serviceDate).order('ended_at', { ascending: false }).limit(1).maybeSingle()) as unknown as
    { service_id: string; service_departures: { route_id: string } | null } | null, [serviceDate]);

  // unidad que el administrador asignó al servicio (no depende del conductor)
  const assigned = useQuery(async () => service
    ? must(await supabase.rpc('service_assigned_vehicles', { p_service: service.id, p_date: serviceDate })) as { departure_id: string; vehicle_id: string }[]
    : [], [service?.id, serviceDate]);
  const origins = useQuery(async () => must(await supabase.from('route_stops').select('route_id,name,lat,lng').eq('position', 1)) as
    { route_id: string; name: string; lat: number | null; lng: number | null }[], []);
  // si el tipo de día cambia y el servicio elegido ya no corresponde, se limpia
  useEffect(() => {
    if (allDeps.data && code && !available.some((s) => s.code.toLowerCase() === code.trim().toLowerCase())) setCode('');
  }, [dayType, allDeps.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const forType = (deps.data ?? []).filter((d) => d.day_types.includes(dayType));
  const routeIds = [...new Set(forType.map((d) => d.route_id))];
  const suggested = last.data && service && last.data.service_id === service.id
    ? routeIds.find((r) => r !== last.data?.service_departures?.route_id) : undefined;
  const near = pos ? nearestOrigin(pos, (origins.data ?? []).filter((o) => routeIds.includes(o.route_id))) : null;
  const byGps = near && near.meters <= NEAR_ORIGIN_M ? near.origin.route_id : undefined;
  const sentido = routePick && routeIds.includes(routePick) ? routePick : byGps ?? suggested ?? routeIds[0] ?? null;
  const originOfSentido = (origins.data ?? []).find((o) => o.route_id === sentido);
  const farFromOrigin = pos && originOfSentido && originOfSentido.lat !== null && originOfSentido.lng !== null
    ? distanceM(pos, [originOfSentido.lat, originOfSentido.lng]) : null;
  const options = forType.filter((d) => d.route_id === sentido);
  const picked = options.find((d) => d.id === depPick) ?? nearestDeparture(options, now, serviceDate);
  const minutes = picked ? minutesToDeparture(picked.departure_time, now, serviceDate) : 0;
  const forced = picked ? needsReason(minutes) : false;
  const routeName = (id: string | null) => routes.data?.find((r) => r.id === id)?.name ?? '-';
  const allowedVehicles = service ? compat.data?.[service.id] : undefined;
  const freeVehicles = (vehicles.data ?? []).filter((v) => !UNAVAILABLE.includes(v.status) && (!allowedVehicles || allowedVehicles.includes(v.id)));
  const assignedId = (assigned.data ?? []).find((t) => t.departure_id === picked?.id)?.vehicle_id ?? null;
  const assignedVehicle = (vehicles.data ?? []).find((v) => v.id === assignedId) ?? null;
  const assignedUsable = !!assignedVehicle && freeVehicles.some((v) => v.id === assignedVehicle.id);
  const reasonNeeded = forced || takeover || reopening;
  const ready = !!(service && picked && serviceDate && vehicleId && freeVehicles.some((v) => v.id === vehicleId) && (!reasonNeeded || reason.trim().length >= 3));

  // la unidad asignada aparece elegida de entrada; el conductor puede cambiarla
  useEffect(() => {
    if (assignedId && assignedUsable && !vehicleTouched) setVehicleId(assignedId);
  }, [assignedId, assignedUsable, vehicleTouched]);

  // la última unidad usada puede no servir para este servicio: se limpia
  useEffect(() => {
    if (service && vehicles.data && compat.data && vehicleId && !freeVehicles.some((v) => v.id === vehicleId)) setVehicleId('');
  }, [service?.id, vehicles.data, compat.data, vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetReasonState = () => {
    setReason('');
    setTakeover(false);
    setReopening(false);
  };

  const invert = () => {
    const i = routeIds.indexOf(sentido ?? '');
    setRoutePick(routeIds[(i + 1) % routeIds.length]); setDepPick(null); setAutoDirection(false); setForcedDirection(false); resetReasonState();
  };

  const changeServiceDate = (value: string) => {
    setServiceDate(value);
    if (value) {
      const [year, month, day] = value.split('-').map(Number);
      setDayType(dayTypeOf(new Date(year, month - 1, day)));
    }
    setRoutePick(null);
    setDepPick(null);
    setAutoDirection(false);
    setForcedDirection(false);
    resetReasonState();
  };

  const start = async () => {
    if (!service || !picked || !serviceDate) return;
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.rpc('start_service', {
      p_service: service.id, p_departure: picked.id, p_day_type: dayType, p_vehicle: vehicleId,
      p_reason: reasonNeeded && reason.trim() ? reason.trim() : null, p_service_date: serviceDate
    });
    setBusy(false);
    if (e) {
      const code = errorCode(e);
      setTakeover(code === 'TAKEOVER_REASON_REQUIRED');
      setReopening(code === 'REOPEN_REASON_REQUIRED');
      setError(friendly(e));
      return;
    }
    try { localStorage.setItem(LAST_VEHICLE, vehicleId); } catch { /* sin almacenamiento: no pasa nada */ }
    nav(`/conductor/viaje/${(data as { id: string }).id}`);
  };

  return (
    <div className="driver-app">
      <DriverCompany />
      <div className="row" style={{ alignItems: 'center' }}>
        <Link to="/conductor"><button style={{ minHeight: 48 }}>Volver</button></Link>
        <h1 style={{ fontSize: 20, flex: '1 1 140px' }}>Iniciar servicio</h1>
      </div>
      <ActiveTrip />
      {error && <div className="notice error" role="alert">{error}</div>}
      {services.loading ? <Loading /> : (
        <>
          <div>
            <div className="muted" style={{ marginBottom: 6 }}>Tipo de día</div>
            <div className="seg" role="group" aria-label="Tipo de día">
              {DAY_TYPES.map((t) => (
                <button key={t} type="button" className={t === dayType ? 'primary' : ''} aria-pressed={t === dayType}
                  onClick={() => { setDayType(t); setRoutePick(null); setDepPick(null); setAutoDirection(false); setForcedDirection(false); resetReasonState(); }}>{DAY_TYPE_LABEL[t]}</button>
              ))}
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="muted">Fecha del servicio</span>
            <input type="date" value={serviceDate} onChange={(e) => changeServiceDate(e.target.value)} required />
            <span className="muted">Elegí el día en que comienza el viaje. Para una salida a las 00:00, seleccioná la fecha del día que empieza.</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="muted">Servicio ({DAY_TYPE_LABEL[dayType].toLowerCase()})</span>
            <select value={service?.code ?? ''} disabled={allDeps.loading}
              onChange={(e) => { setCode(e.target.value); setRoutePick(null); setDepPick(null); setAutoDirection(false); setForcedDirection(false); setVehicleTouched(false); resetReasonState(); }}>
              <option value="">{available.length === 0 ? 'No hay servicios para este día' : 'Elegir servicio...'}</option>
              {available.map((x) => <option key={x.id} value={x.code}>{x.code}</option>)}
            </select>
          </label>

          {service && (deps.loading ? <Loading /> : forType.length === 0 ? (
            <div className="notice warn">El servicio {service.code} no tiene salidas para {DAY_TYPE_LABEL[dayType].toLowerCase()}. Probá con otro tipo de día.</div>
          ) : (
            <>
              <div className="panel">
                <div className="direction-heading">
                  <div className="muted">Sentido</div>
                  {routeIds.length > 1 && <button type="button" className="direction-switch" onClick={invert}
                    aria-label="Cambiar sentido manualmente" title="Cambiar manualmente el sentido">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" /></svg>
                  </button>}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 8px' }}>{routeName(sentido)}</div>
                {autoDirection && <div className="muted" role="status">Próximo sentido y salida seleccionados automáticamente según el viaje anterior.</div>}
                {forcedDirection && <div className="muted" role="status">Sentido y próximo horario forzados manualmente durante el viaje anterior.</div>}
                {!routePick && byGps && sentido === byGps && <div className="muted" style={{ marginTop: 6 }}>Sugerido por tu ubicación: estás cerca de {originOfSentido?.name}.</div>}
                {!routePick && !byGps && suggested && sentido === suggested && <div className="muted" style={{ marginTop: 6 }}>Sugerido: el contrario al viaje que acabás de terminar.</div>}
                {farFromOrigin !== null && farFromOrigin > NEAR_ORIGIN_M && (
                  <div className="notice warn" style={{ marginTop: 8 }}>Estás a {(farFromOrigin / 1000).toFixed(1)} km de la parada de origen ({originOfSentido?.name}). ¿Es el sentido correcto?</div>
                )}
              </div>

              <div>
                <div className="muted" style={{ marginBottom: 6 }}>Salida</div>
                <div className="seg" role="group" aria-label="Salida">
                  {options.map((d) => {
                    const m = minutesToDeparture(d.departure_time, now, serviceDate);
                    return (
                      <button key={d.id} type="button" className={d.id === picked?.id ? 'primary' : ''} aria-pressed={d.id === picked?.id} onClick={() => { setDepPick(d.id); resetReasonState(); }}>
                        {d.departure_time.slice(0, 5)}
                        <span style={{ display: 'block', fontSize: 12, fontWeight: 500 }}>{m === 0 ? 'ahora' : m > 0 ? `en ${formatSpan(m)}` : `hace ${formatSpan(-m)}`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {reasonNeeded && (
                <div className="notice warn">
                  {takeover && <div>Este viaje está en curso con otro conductor. Para relevarlo, escribí el motivo; quedará registrado.</div>}
                  {reopening && <div>Este viaje ya se había cerrado. Para retomarlo, escribí el motivo; quedará registrado.</div>}
                  {forced && <div>Esta salida está fuera de horario (más de {WINDOW_MINUTES} minutos); también requiere un motivo.</div>}
                  <input style={{ width: '100%', marginTop: 8, boxSizing: 'border-box' }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" aria-label="Motivo del inicio, relevo o reapertura" />
                </div>
              )}

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="muted">Unidad</span>
                <select value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setVehicleTouched(true); }}>
                  <option value="">Elegir...</option>
                  {[...freeVehicles].sort((a, b) => Number(b.id === assignedId) - Number(a.id === assignedId)).map((v) => (
                    <option key={v.id} value={v.id}>Interno {v.internal_number} ({v.plate}){v.id === assignedId ? ' · asignada' : ''}</option>
                  ))}
                </select>
                {assignedVehicle && assignedUsable && (
                  <span className={vehicleId === assignedId ? 'muted' : 'notice warn'} role="status">
                    {vehicleId === assignedId
                      ? `Unidad asignada a este servicio: Interno ${assignedVehicle.internal_number} (${assignedVehicle.plate}). Podés elegir otra unidad.`
                      : `Elegiste otra unidad. La asignada era el Interno ${assignedVehicle.internal_number} (${assignedVehicle.plate}).`}
                  </span>
                )}
                {assignedVehicle && !assignedUsable && <span className="notice warn" role="status">La unidad asignada (Interno {assignedVehicle.internal_number}) no está disponible. Elegí otra.</span>}
                {allowedVehicles && <span className="muted" role="status">Este servicio tiene una disposición de asientos definida: solo se ofrecen las unidades que la tienen.</span>}
                {allowedVehicles && freeVehicles.length === 0 && <span className="notice warn" role="status">No hay unidades disponibles con la disposición de este servicio. Avisale a la empresa.</span>}
              </label>

              <button className="primary big" disabled={!ready || busy} onClick={start}>Iniciar viaje</button>
            </>
          ))}
        </>
      )}
    </div>
  );
}
