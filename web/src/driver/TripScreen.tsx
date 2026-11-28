import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { errorCode, friendly } from '../lib/errors';
import { must, useQuery } from '../lib/useQuery';
import { Loading, formatTime } from '../ui';
import { formatPunctuality, formatSigned, punctualityMinutes, punctualityState } from '../lib/punctuality';
import { INCIDENT_LABEL, STATUS_LABEL, type CountResult, type IncidentKind, type RouteStop, type TripStatus } from '../lib/types';
import { DAY_TYPE_LABEL, type DayType } from '../lib/dayType';
import { nextScheduledStop, type TimedStop } from '../lib/tripProgress';
import { liveProgress, type LiveStop } from '../lib/gpsProgress';
import type { LatLng } from '../lib/routePath';
import { useGps } from './useGps';
import { RouteMap } from './RouteMap';
import { nextTurn, prepare, type Maneuver, type Prepared, type TurnNotice } from '../lib/turnGuide';
import { endTripConfirm } from './endTrip';
import { loadCounts } from './counts';
import { ScanPanel } from './ScanPanel';
import { TaquillaPanel } from './TaquillaPanel';
import { useAuth } from '../auth/AuthProvider';
import { distanceM, nextDeparture, serviceScheduleReferenceTime } from '../lib/tripPlan';
import { formatSpan } from '../lib/punctuality';
import { DriverCompany } from './DriverCompany';

interface TripDetail {
  id: string; service_id: string; service_date: string; day_type: DayType | null; status: TripStatus; scheduled_departure: string; started_at: string | null; ended_at: string | null; layout_id: string | null;
  services: { code: string } | null;
  service_departures: { route_id: string; routes: { name: string; path: [number, number][] | null; maneuvers: Maneuver[] | null } | null } | null;
  vehicles: { internal_number: string } | null;
}

const preparedRoutes = new WeakMap<Maneuver[], Prepared>();
const prepareRoute = (path: [number, number][], maneuvers: Maneuver[]): Prepared => {
  let prepared = preparedRoutes.get(maneuvers);
  if (!prepared) {
    prepared = prepare(path, maneuvers);
    preparedRoutes.set(maneuvers, prepared);
  }
  return prepared;
};

function TripClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const time = new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(now);
  const date = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit'
  }).format(now);

  return (
    <time className="driver-trip-clock" dateTime={now.toISOString()} aria-label={`Hora ${time}, fecha ${date}`}>
      <strong>{time}</strong>
      <span>{date}</span>
    </time>
  );
}

export function TripScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { blockedFeatures } = useAuth();   // funciones que el administrador general le bloqueó a la empresa
  const blocked = (feature: string) => blockedFeatures.includes(feature);

  // Tocar una función bloqueada no hace nada: solo avisa (el botón se ve opaco).
  const lockedTimer = useRef<number | undefined>(undefined);
  const showLocked = (name: string) => {
    setLockedMsg(`${name}: función bloqueada para tu empresa.`);
    window.clearTimeout(lockedTimer.current);
    lockedTimer.current = window.setTimeout(() => setLockedMsg(null), 3500);
  };
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [lockedMsg, setLockedMsg] = useState<string | null>(null);   // aviso al tocar una función bloqueada
  const [warn, setWarn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState(1);
  const [override, setOverride] = useState<{ stop: string; for: string } | null>(null); // parada elegida a mano; vale mientras la sugerida no cambie
  const [scanning, setScanning] = useState(false);
  const [taquilla, setTaquilla] = useState(false);
  const [tick, setTick] = useState(0);   // se suma al registrar para recargar los conteos por parada
  const [showMap, setShowMap] = useState(false);
  const [incOpen, setIncOpen] = useState(false);
  const [incKind, setIncKind] = useState<IncidentKind>('traffic');
  const [incNote, setIncNote] = useState('');
  const [counts, setCounts] = useState<{ onboard: number; capacity: number } | null>(null);
  const [countConfirmation, setCountConfirmation] = useState<{ kind: 'board' | 'alight'; quantity: number } | null>(null);
  const [gpsSyncError, setGpsSyncError] = useState<string | null>(null);
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  const lastGpsReport = useRef<{ tripId: string; requestedAt: number; recordedAt: number } | null>(null);
  const arrivalCandidate = useRef<{ tripId: string; firstAt: number; firstPos: LatLng; lastFixAt: number; fixes: number } | null>(null);
  const advanceAttempted = useRef<string | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    setAutoAdvancing(false);
    arrivalCandidate.current = null;
    advanceAttempted.current = null;
  }, [id]);

  const trip = useQuery(async () => must(await supabase.from('trips')
    .select('id,service_id,service_date,day_type,status,scheduled_departure,started_at,ended_at,layout_id,services(code),service_departures(route_id,routes(name,path,maneuvers)),vehicles(internal_number)')
    .eq('id', id).maybeSingle()) as unknown as TripDetail | null, [id]);
  const t = trip.data;
  const routeId = trip.data?.service_departures?.route_id;
  const stops = useQuery(async () => routeId
    ? must(await supabase.from('route_stops').select('*').eq('route_id', routeId).order('position')) as RouteStop[]
    : [], [routeId]);

  const serviceId = trip.data?.service_id;
  const times = useQuery(async () => serviceId
    ? must(await supabase.from('service_stops').select('route_stop_id,minutes_from_start,dwell_minutes').eq('service_id', serviceId)) as
      { route_stop_id: string; minutes_from_start: number; dwell_minutes: number }[]
    : [], [serviceId]);

  const stopCounts = useQuery(async () => must(await supabase.from('passenger_counts').select('stop_id,kind,quantity').eq('trip_id', id)) as
    { stop_id: string | null; kind: 'board' | 'alight'; quantity: number }[], [id, tick]);

  // Salidas y recorridos del servicio para preparar el siguiente viaje mientras este sigue en curso.
  const done = t?.status === 'completed';
  const canPrepareNext = done || t?.status === 'in_progress';
  const nextDeps = useQuery(async () => canPrepareNext && trip.data ? must(await supabase.from('service_departures').select('id,route_id,departure_time,next_day,day_types')
    .eq('service_id', trip.data.service_id).eq('active', true).order('departure_time')) as { id: string; route_id: string; departure_time: string; next_day: boolean; day_types: DayType[] }[] : [], [canPrepareNext, trip.data?.service_id]);
  const routeNames = useQuery(async () => canPrepareNext ? must(await supabase.from('routes').select('id,name')) as { id: string; name: string }[] : [], [canPrepareNext]);
  const nextOptions = t?.day_type
    ? (nextDeps.data ?? []).filter((departure) => departure.day_types.includes(t.day_type as DayType))
    : [];
  const scheduleNow = t ? serviceScheduleReferenceTime(t.service_date, t.scheduled_departure, now) : now;
  const automaticNext = nextOptions.length
    ? nextDeparture(nextOptions, t?.service_departures?.route_id, scheduleNow, t?.service_date)
    : null;
  const nextService = automaticNext;
  const nextRouteName = (routeId: string) => routeNames.data?.find((route) => route.id === routeId)?.name ?? '';
  const nextOrigin = useQuery(async () => nextService && !nextService.tomorrow
    ? must(await supabase.from('route_stops').select('name').eq('route_id', nextService.dep.route_id).eq('position', 1).maybeSingle()) as { name: string } | null
    : null, [nextService?.dep.route_id, nextService?.tomorrow]);

  // pasajes del viaje (con parada de subida y bajada): de acá sale lo previsto en cada parada
  // pasajes del viaje: los vendidos (web, ventanilla, taquilla) están en sale_tickets; los de prueba en tickets
  const tickets = useQuery(async () => {
    const real = must(await supabase.from('sale_tickets').select('from_stop_id,to_stop_id,status').eq('trip_id', id)) as
      { from_stop_id: string; to_stop_id: string; status: 'valid' | 'boarded' | 'cancelled' }[];
    const test = must(await supabase.from('tickets').select('boarding_stop_id,alighting_stop_id,status').eq('trip_id', id)) as
      { boarding_stop_id: string; alighting_stop_id: string; status: 'valid' | 'boarded' | 'cancelled' }[];
    return [...real.map((k) => ({ boarding_stop_id: k.from_stop_id, alighting_stop_id: k.to_stop_id, status: k.status })), ...test];
  }, [id, tick]);

  const gps = useGps(t?.status === 'in_progress');
  useEffect(() => {
    if (!t || t.status !== 'in_progress' || !t.day_type || nextDeps.loading
      || !gps.pos || gps.error || gps.accuracyM === null || gps.timestamp === null
      || gps.accuracyM > 50 || Date.now() - gps.timestamp > 15_000 || gps.timestamp - Date.now() > 5_000) {
      arrivalCandidate.current = null;
      return;
    }

    const upcoming = nextService;
    const destination = stops.data?.filter((stop) => stop.lat !== null && stop.lng !== null).at(-1);
    if (!upcoming || upcoming.tomorrow || !destination || destination.lat === null || destination.lng === null) {
      arrivalCandidate.current = null;
      return;
    }

    const destinationDistance = distanceM(gps.pos, [destination.lat, destination.lng]);
    if (destinationDistance > Math.max(50, gps.accuracyM * 1.5)) {
      arrivalCandidate.current = null;
      return;
    }

    const previous = arrivalCandidate.current;
    if (!previous || previous.tripId !== t.id || gps.timestamp <= previous.lastFixAt
      || distanceM(previous.firstPos, gps.pos) > 40) {
      arrivalCandidate.current = { tripId: t.id, firstAt: gps.timestamp, firstPos: gps.pos, lastFixAt: gps.timestamp, fixes: 1 };
      return;
    }

    previous.lastFixAt = gps.timestamp;
    previous.fixes += 1;
    if (previous.fixes < 2 || gps.timestamp - previous.firstAt < 15_000 || advanceAttempted.current === t.id) return;

    advanceAttempted.current = t.id;
    setAutoAdvancing(true);
    void Promise.resolve(supabase.rpc('advance_service_trip', {
      p_trip: t.id,
      p_next_departure: upcoming.dep.id,
      p_force: false,
      p_arrived: true   // última parada: los pasajeros a bordo descienden ahí
    }))
      .then(({ data, error: advanceError }) => {
        setAutoAdvancing(false);
        if (advanceError) {
          setError(friendly(advanceError));
          return;
        }
        navigate(`/conductor/viaje/${(data as { id: string }).id}`, { replace: true });
      })
      .catch((advanceError: unknown) => {
        setAutoAdvancing(false);
        setError(friendly(advanceError));
      });
  }, [t?.id, t?.status, t?.day_type, t?.service_departures?.route_id, t?.service_date,
    nextDeps.data, nextDeps.loading, stops.data, gps.pos, gps.accuracyM, gps.timestamp, gps.error,
    nextService?.dep.id, nextService?.tomorrow, now, navigate]);
  useEffect(() => {
    if (blockedFeatures.includes('gps')) return;   // la empresa no tiene seguimiento GPS: no se envía la posición
    if (!t || t.status !== 'in_progress' || !gps.pos || gps.accuracyM === null || gps.timestamp === null || gps.error) return;
    const nowMs = Date.now();
    if (gps.accuracyM > 100 || nowMs - gps.timestamp > 90_000 || gps.timestamp - nowMs > 30_000) return;
    const previous = lastGpsReport.current;
    if (previous?.tripId === t.id && (nowMs - previous.requestedAt < 15_000 || gps.timestamp <= previous.recordedAt)) return;
    lastGpsReport.current = { tripId: t.id, requestedAt: nowMs, recordedAt: gps.timestamp };
    void Promise.resolve(supabase.rpc('update_trip_live_position', {
      p_trip: t.id,
      p_latitude: gps.pos[0],
      p_longitude: gps.pos[1],
      p_accuracy_m: gps.accuracyM,
      p_heading: gps.heading,
      p_recorded_at: new Date(gps.timestamp).toISOString()
    })).then(({ error: syncError }) => {
      setGpsSyncError(syncError ? friendly(syncError) : null);
    }).catch((syncError: unknown) => setGpsSyncError(friendly(syncError)));
  }, [t?.id, t?.status, gps.pos, gps.accuracyM, gps.heading, gps.timestamp, gps.error, blockedFeatures]);
  const layoutId = t?.layout_id;
  const refreshCounts = async () => { if (t) setCounts(await loadCounts(t.id, layoutId)); };
  useEffect(() => { void refreshCounts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [t?.id, t?.status, layoutId]);

  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true); setError(null); setWarn(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) { setError(friendly(e)); return false; }
    return true;
  };

  const start = async () => { if (await act(() => supabase.rpc('start_trip', { p_trip: id }))) trip.reload(); };

  const sendIncident = async () => {
    if (await act(() => supabase.rpc('report_incident', { p_trip: id, p_kind: incKind, p_note: incNote.trim() || null }))) {
      setIncOpen(false); setIncNote(''); setWarn('Incidencia informada.');
    }
  };

  const register = async (kind: 'board' | 'alight', quantity: number) => {
    setBusy(true); setError(null); setWarn(null);
    const event = crypto.randomUUID();           // se reutiliza en el reintento: el servidor no lo cuenta dos veces
    const call = () => supabase.rpc('register_count', { p_trip: id, p_kind: kind, p_quantity: quantity, p_stop: stopId || null, p_event: event });
    let res = await call();
    if (res.error && errorCode(res.error) === null) res = await call();   // fallo de red: un reintento
    setBusy(false);
    if (res.error) { setError(friendly(res.error)); return; }
    const r = res.data as CountResult;
    setCounts({ onboard: r.onboard, capacity: r.capacity });
    setTick((n) => n + 1);
    if (r.over_capacity) setWarn(`Atención: hay ${r.onboard} a bordo y la capacidad es ${r.capacity}.`);
    setQty(1);
    setCountConfirmation(null);
  };

  if (trip.loading) return <div className="driver-app"><DriverCompany /><Loading /></div>;
  if (!t) return <div className="driver-app"><DriverCompany /><div className="notice error">No se encontró el viaje.</div><Link to="/conductor"><button style={{ width: '100%' }}>Volver</button></Link></div>;

  const scheduledAt = new Date(t.scheduled_departure);
  const beforeDeparture = now.getTime() < scheduledAt.getTime();
  const inTrip = t.status === 'in_progress';
  const nextWhen = (departure: NonNullable<typeof nextService>) => {
    const hhmm = departure.dep.departure_time.slice(0, 5);
    return departure.tomorrow ? `Mañana a las ${hhmm}` : departure.minutes > 0 ? `En ${formatSpan(departure.minutes)} (${hhmm})` : `Ya es hora (${hhmm})`;
  };
  const nextScheduleAt = (departure: NonNullable<typeof nextService>) => {
    const [hour, minute] = departure.dep.departure_time.split(':').map(Number);
    const [year, month, day] = t.service_date.split('-').map(Number);
    const scheduled = new Date(year, month - 1, day, hour, minute);
    if (departure.tomorrow) scheduled.setDate(scheduled.getDate() + 1);
    if (departure.dep.next_day) scheduled.setDate(scheduled.getDate() + 1);
    return scheduled;
  };
  const forceNextTrip = async () => {
    if (busy || autoAdvancing) return;
    if (!nextService || nextService.tomorrow) {
      window.alert('No hay otra salida de este servicio para cambiar de sentido hoy.');
      return;
    }
    const onboard = counts?.onboard ?? 0;
    const msg = `¿Forzar el cambio de sentido y comenzar ${nextRouteName(nextService.dep.route_id)} (${nextService.dep.departure_time.slice(0, 5)})?`
      + (onboard ? `\n\nFiguran ${onboard} pasajero${onboard === 1 ? '' : 's'} a bordo. El viaje cambiará igual y el próximo comienza con el conteo en cero.` : '');
    if (!window.confirm(msg)) return;
    setBusy(true);
    setError(null);
    advanceAttempted.current = t.id;
    try {
      const { data, error: advanceError } = await supabase.rpc('advance_service_trip', {
        p_trip: t.id,
        p_next_departure: nextService.dep.id,
        p_force: true
      });
      if (advanceError) {
        advanceAttempted.current = null;
        setError(friendly(advanceError));
        window.alert(`No se pudo cambiar de sentido: ${friendly(advanceError)}`);
        return;
      }
      navigate(`/conductor/viaje/${(data as { id: string }).id}`, { replace: true });
    } catch (advanceError: unknown) {
      advanceAttempted.current = null;
      setError(friendly(advanceError));
      window.alert(`No se pudo cambiar de sentido: ${friendly(advanceError)}`);
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      if (nextService && !nextService.tomorrow) {
        if (!window.confirm(`¿Finalizar este viaje y comenzar automáticamente ${nextRouteName(nextService.dep.route_id)} (${nextService.dep.departure_time.slice(0, 5)})?`)) return;
        const { data, error: advanceError } = await supabase.rpc('advance_service_trip', {
          p_trip: id,
          p_next_departure: nextService.dep.id,
          p_force: false
        });
        if (!advanceError) {
          navigate(`/conductor/viaje/${(data as { id: string }).id}`, { replace: true });
          return;
        }
        if (errorCode(advanceError) === 'ONBOARD_REMAINING') {
          if (!window.confirm(`${friendly(advanceError)}. ¿Finalizar este viaje sin iniciar automáticamente el siguiente?`)) return;
          const forcedEnd = await supabase.rpc('end_trip', { p_trip: id, p_force: true });
          if (forcedEnd.error) setError(friendly(forcedEnd.error)); else trip.reload();
          return;
        }
        if (!window.confirm(`No se pudo iniciar automáticamente el siguiente viaje: ${friendly(advanceError)}. ¿Finalizar solo el viaje actual?`)) {
          setError(friendly(advanceError));
          return;
        }
        let end = await supabase.rpc('end_trip', { p_trip: id, p_force: false });
        if (errorCode(end.error) === 'ONBOARD_REMAINING'
          && window.confirm(`${friendly(end.error)}. ¿Finalizar el viaje sin iniciar el siguiente?`)) {
          end = await supabase.rpc('end_trip', { p_trip: id, p_force: true });
        }
        if (end.error) setError(friendly(end.error)); else trip.reload();
        return;
      }
      const e = await endTripConfirm(id);
      if (e) setError(e); else trip.reload();
    } catch (finishError: unknown) {
      setError(friendly(finishError));
    } finally {
      setBusy(false);
    }
  };

  // Horarios a cumplir: los de la carga del servicio (salida programada + minutos de cada parada).
  const timed: TimedStop[] = (stops.data ?? []).flatMap((s) => {
    const x = times.data?.find((y) => y.route_stop_id === s.id);
    return x ? [{ id: s.id, name: s.name, position: s.position, minutes_from_start: x.minutes_from_start, dwell_minutes: x.dwell_minutes }] : [];
  });
  const liveStops: LiveStop[] = (stops.data ?? []).flatMap((s) => {
    const x = times.data?.find((y) => y.route_stop_id === s.id);
    return x && s.lat !== null && s.lng !== null
      ? [{ id: s.id, name: s.name, lat: s.lat, lng: s.lng, minutes_from_start: x.minutes_from_start, dwell_minutes: x.dwell_minutes }] : [];
  });
  const savedPath = t.service_departures?.routes?.path;
  const savedManeuvers = t.service_departures?.routes?.maneuvers;
  const gpsFixAt = gps.timestamp === null ? null : Date.now() - gps.timestamp;
  const turnPosition = gps.pos && !gps.error && gps.accuracyM !== null && gps.accuracyM <= 100
    && gpsFixAt !== null && gpsFixAt <= 90_000 && gpsFixAt >= -30_000
    ? gps.pos
    : null;
  const turn: TurnNotice | null = inTrip && !beforeDeparture && turnPosition && savedPath && savedPath.length > 1 && savedManeuvers?.length
    ? nextTurn(prepareRoute(savedPath, savedManeuvers), turnPosition).notice
    : null;
  const line: LatLng[] | null = savedPath && savedPath.length > 1 ? savedPath : liveStops.length > 1 ? liveStops.map((s) => [s.lat, s.lng] as LatLng) : null;

  // En ruta, el adelanto o atraso lo marca solo el GPS. La hora en que el chofer se conectó no cuenta.
  const live = inTrip && !beforeDeparture && gps.pos && line && liveStops.length > 1
    ? liveProgress(line, liveStops, scheduledAt, now, gps.pos) : null;
  const mins: number | null = inTrip && !beforeDeparture ? (live?.mins ?? null) : punctualityMinutes(scheduledAt, now);
  const state = mins === null ? null : punctualityState(mins);
  const dataReady = !stops.loading && !times.loading;
  const gpsMessage = !dataReady ? 'Cargando...'
    : !line || liveStops.length < 2 ? 'Faltan paradas con ubicación y horario'
    : gps.error === 'denied' ? 'Activá permiso de ubicación'
    : live?.offRoute ? 'Fuera del recorrido'
    : gps.pos ? '' : gps.error ? 'Sin señal GPS' : 'Buscando señal GPS...';

  // Próxima parada: con GPS manda la posición; sin GPS (o antes de salir) el reloj. Siempre con horario programado.
  let next: { id: string; name: string; scheduled: Date } | null = null;
  let arrived = false;
  if (inTrip && timed.length > 1) {
    const clock = nextScheduledStop(timed, scheduledAt, now);
    // Hasta la hora de salida se muestra la parada 1 (terminal o punto de encuentro), donde empieza el recorrido.
    const first = [...timed].sort((x, y) => x.position - y.position)[0];
    if (beforeDeparture && first) next = { id: first.id, name: first.name, scheduled: scheduledAt };
    else if (live && !live.offRoute) {
      if (live.nextIndex === null) arrived = true;
      else {
        const ls = liveStops[live.nextIndex];
        const tm = timed.find((x) => x.id === ls.id);
        if (tm) next = { id: tm.id, name: tm.name, scheduled: new Date(scheduledAt.getTime() + tm.minutes_from_start * 60000) };
      }
    }
    if (!arrived && !next && clock) next = { id: clock.stop.id, name: clock.stop.name, scheduled: clock.scheduled };
  }

  // Parada actual: la del lugar donde está el vehículo; en marcha, la próxima. El chofer puede corregirla a mano.
  const here = live && !live.offRoute && live.atIndex !== null ? liveStops[live.atIndex]?.id : undefined;
  const suggested = here ?? next?.id ?? stops.data?.[0]?.id ?? '';
  const stopId = override && override.for === suggested ? override.stop : suggested;
  const gpsFix = gps.pos && gps.accuracyM !== null && gps.timestamp !== null && !gps.error
    ? { latitude: gps.pos[0], longitude: gps.pos[1], accuracyM: gps.accuracyM, timestamp: gps.timestamp }
    : null;
  const rowsHere = (stopCounts.data ?? []).filter((c) => c.stop_id === stopId);
  const live_tk = (tickets.data ?? []).filter((k) => k.status !== 'cancelled');
  const expUp = (sid: string) => live_tk.filter((k) => k.boarding_stop_id === sid).length;
  const expDown = (sid: string) => live_tk.filter((k) => k.alighting_stop_id === sid).length;
  const toBoard = (sid: string) => live_tk.filter((k) => k.status === 'valid' && k.boarding_stop_id === sid).length;
  const upHere = rowsHere.filter((c) => c.kind === 'board').reduce((n, c) => n + c.quantity, 0);
  const downHere = rowsHere.filter((c) => c.kind === 'alight').reduce((n, c) => n + c.quantity, 0);
  const hm = (d: Date) => formatTime(d.toISOString());
  const panelSchedule = arrived
    ? nextService && !nextService.tomorrow ? nextScheduleAt(nextService) : null
    : next?.scheduled ?? null;
  const free = counts ? Math.max(counts.capacity - counts.onboard, 0) : 0;
  const sold = tickets.data?.filter((ticket) => ticket.status !== 'cancelled').length ?? null;

  if (taquilla && routeId) {
    return <TaquillaPanel tripId={id} layoutId={layoutId ?? null} routeId={routeId} stops={stops.data ?? []} suggestedStopId={suggested}
      onboard={counts?.onboard ?? null} capacity={counts?.capacity ?? null} onSold={() => { tickets.reload(); void refreshCounts(); stopCounts.reload(); }} onBack={() => setTaquilla(false)} />;
  }
  if (scanning && inTrip) {
    return <ScanPanel tripId={id} layoutId={layoutId ?? null} stopId={suggested} stopName={stops.data?.find((s) => s.id === suggested)?.name ?? ''} gpsFix={gpsFix}
      onBack={() => setScanning(false)} onCounted={() => { setTick((n) => n + 1); void refreshCounts(); }} />;
  }

  return (
    <div className="driver-app">
      <DriverCompany />
      <div className="row driver-trip-heading-row">
        <Link to="/conductor" aria-label="Volver a mis servicios" title="Volver a mis servicios">
          <button type="button" className="scan-back-button" aria-label="Volver a mis servicios">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
          </button>
        </Link>
        <TripClock />
        <div className="driver-trip-heading">
          <h1 style={{ fontSize: 18 }}>Servicio {t.services?.code} - {t.service_departures?.routes?.name}</h1>
          <span className="muted muted01">Unidad {t.vehicles?.internal_number ?? 'sin asignar'} - {STATUS_LABEL[t.status]}{t.day_type ? ` - ${DAY_TYPE_LABEL[t.day_type]}` : ''}</span>
        </div>
      </div>

      {error && <div className="notice error" role="alert">{error}</div>}
      {warn && <div className="notice warn" role="status">{warn}</div>}
      {tickets.error && <div className="notice error" role="alert">{tickets.error}</div>}

      {(t.status === 'scheduled' || inTrip) && (
        <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div className="muted muted02">{inTrip && !beforeDeparture ? 'Puntualidad' : 'Para la salida'}</div>
            <div className={`num ${state === 'late' ? 'late' : state === 'early' ? 'early' : ''}`}>{mins === null ? '-' : formatSigned(mins)}</div>
            <div>{mins === null ? gpsMessage : formatPunctuality(mins, beforeDeparture)}</div>
            {inTrip && gpsSyncError && <div className="notice error" role="alert">No se pudo sincronizar la ubicación: {gpsSyncError}</div>}
          </div>
         <div className="muted muted03" style={{ textAlign: 'right', lineHeight: 1.7 }}>
  <span style={{ fontSize: '12px' }}>Inicio</span>{' '}
  <b className="driver-strong">{formatTime(t.scheduled_departure)}</b>
  {/* {t.started_at && <><br /><b className="driver-strong">{formatTime(t.started_at)}</b></>} */}
</div>
        </div>
      )}

      {inTrip && (
        <div className="panel driver-trip-stop-panel">
          <div className="driver-trip-stop-main">
            {arrived && nextService && !nextService.tomorrow ? (
              <>
                <div className="muted muted04">Tiempo del próximo viaje · salida desde (parada 1)</div>
                <div className="driver-trip-stop-name">{nextOrigin.data?.name ?? nextRouteName(nextService.dep.route_id)}</div>
              </>
            ) : arrived ? (
              <>
                <div className="muted muted05">Llegaste al destino</div>
                <div>Finalizá {nextService?.tomorrow ? 'el último viaje de hoy' : 'este viaje'}.</div>
              </>
            ) : next ? (
              <>
                <div className="muted muted06">{beforeDeparture ? 'Salida desde (parada 1)' : 'Próxima parada'}</div>
                <div className="driver-trip-stop-name">{next.name}</div>
                {(tickets.data?.length ?? 0) > 0 && (
                  <div className="driver-passenger-flow" style={{ marginTop: 6 }} aria-label="Previsto en la próxima parada">
                    <span className="driver-up-count">▲ {toBoard(next.id)}<span className="muted muted07"></span></span>
                    <span className="driver-down-count">▼ {expDown(next.id)}<span className="muted muted08"></span></span>
                  </div>
                )}
              </>
            ) : (
              <div className="muted muted09">Viaje en curso</div>
            )}
          </div>
          <button type="button" className="direction-switch driver-trip-direction-switch"
            onClick={() => void forceNextTrip()}
            disabled={busy || autoAdvancing || nextDeps.loading}
            aria-label="Forzar el próximo viaje"
            title="Forzar el próximo viaje">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" /></svg>
          </button>
          {panelSchedule && (
            <div className="driver-trip-stop-time">
              <span className="muted muted10">Prog.</span>
              <b>{hm(panelSchedule)}</b>
            </div>
          )}
        </div>
      )}
      {inTrip && autoAdvancing && <div className="notice" role="status">Llegada confirmada. Iniciando el próximo viaje...</div>}

      {t.status === 'scheduled' && (
        <button className="primary big" disabled={busy || !t.vehicles} onClick={start}>Iniciar viaje</button>
      )}
      {t.status === 'scheduled' && !t.vehicles && <div className="notice warn">Todavía no tiene vehículo asignado. Avisale al administrador.</div>}

      {t.status === 'in_progress' && (
        <>
          <div className="grid4 driver-stats">
            <div className="panel"><b>{sold ?? '-'}</b><span className="muted muted11">Vendidos</span></div>
            <div className="panel"><b>{counts?.onboard ?? '-'}</b><span className="muted muted12">A bordo</span></div>
            <div className="panel"><b>{counts && counts.capacity > 0 ? free : '-'}</b><span className="muted muted13">Libres</span></div>
            <div className="panel"><b>{counts?.capacity || '-'}</b><span className="muted muted14">Capacidad</span></div>
          </div>

          {(nextDeps.error || routeNames.error || nextOrigin.error) && <div className="notice error" role="alert">{nextDeps.error ?? routeNames.error ?? nextOrigin.error}</div>}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="muted muted15">Parada para conteo manual</span>
            <select value={stopId} onChange={(e) => setOverride({ stop: e.target.value, for: suggested })}>
              {(stops.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.position}. {s.name}</option>)}
            </select>
            <span className="muted muted16">El escáner valida por GPS la parada real; esta selección solo afecta los conteos manuales.</span>
          </label>

          <div className="driver-passenger-flow" aria-label="Registrados en esta parada">
            <span className="driver-up-count">▲ {upHere}{expUp(stopId) > 0 && ` de ${expUp(stopId)}`}<span className="muted muted17"> subieron</span></span>
            <span className="driver-down-count">▼ {downHere}{expDown(stopId) > 0 && ` de ${expDown(stopId)}`}<span className="muted muted18"> bajaron</span></span>
          </div>

          {override && override.for === suggested && (
            <button type="button" onClick={() => setOverride(null)}>Volver a la parada automática</button>
          )}
          <details>
            <summary>&nbsp;&nbsp;&nbsp;Resumen por parada <span className="muted muted19"></span></summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 20 }}>
              {(stops.data ?? []).map((s) => {
                const rows = (stopCounts.data ?? []).filter((c) => c.stop_id === s.id);
                const up = rows.filter((c) => c.kind === 'board').reduce((n, c) => n + c.quantity, 0);
                const down = rows.filter((c) => c.kind === 'alight').reduce((n, c) => n + c.quantity, 0);
                return (
                  <button key={s.id} type="button" className={`driver-stop-summary-row${s.id === stopId ? ' primary' : ''}`}
                    onClick={() => setOverride({ stop: s.id, for: suggested })}>
                    <span className="driver-stop-summary-name">{s.position}. {s.name}</span>
                    <span className="driver-stop-summary-counts">
                      <span className="driver-up-count">▲ {up}{expUp(s.id) > 0 && `/${expUp(s.id)}`}</span>
                      <span className="driver-down-count">▼ {down}{expDown(s.id) > 0 && `/${expDown(s.id)}`}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </details>

          {!blocked('counter') && (
            <>
          <div className="passenger-controls" aria-label="Registrar pasajeros">
            <button type="button" className="count-action-button count-alight" aria-label="Registrar descenso de pasajeros"
              title="Bajan" disabled={busy || !!countConfirmation} onClick={() => setCountConfirmation({ kind: 'alight', quantity: qty })}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15m-6-6 6 6 6-6" /></svg>
            </button>
            <button type="button" className="count-step-button" aria-label="Restar un pasajero" title="Restar uno"
              disabled={busy || !!countConfirmation || qty <= 1} onClick={() => setQty(qty - 1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
            </button>
            <div className="passenger-quantity" aria-live="polite">{qty}</div>
            <button type="button" className="count-step-button" aria-label="Sumar un pasajero" title="Sumar uno"
              disabled={busy || !!countConfirmation} onClick={() => setQty(qty + 1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-7-7h14" /></svg>
            </button>
            <button type="button" className="count-action-button count-board" aria-label="Registrar ascenso de pasajeros"
              title="Suben" disabled={busy || !!countConfirmation} onClick={() => setCountConfirmation({ kind: 'board', quantity: qty })}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5m-6 6 6-6 6 6" /></svg>
            </button>
          </div>

          {countConfirmation && (
            <div className="panel count-confirmation" role="group" aria-label="Confirmar registro de pasajeros">
              <strong id="count-confirmation-title" aria-live="polite">
                Confirmar {countConfirmation.kind === 'alight' ? 'descenso' : 'ascenso'} de {countConfirmation.quantity} pasajero{countConfirmation.quantity === 1 ? '' : 's'}
              </strong>
              <div className="row">
                <button className="primary" disabled={busy} onClick={() => register(countConfirmation.kind, countConfirmation.quantity)}>Sí</button>
                <button className="secondary" disabled={busy} onClick={() => setCountConfirmation(null)}>No</button>
              </div>
            </div>
          )}
            </>
          )}

          <div className="trip-tool-actions" role="group" aria-label="Mapa e incidencias">
            <button type="button" className={`trip-tool-button map-tool${showMap ? ' is-active' : ''}`}
              aria-label={showMap ? 'Ocultar mapa' : 'Mostrar mapa'} title={showMap ? 'Ocultar mapa' : 'Mostrar mapa'}
              aria-pressed={showMap} onClick={() => setShowMap(!showMap)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15" />
              </svg>
              <span>Mapa</span>
            </button>
            <button type="button" className={`trip-tool-button incident-tool${incOpen && !blocked('incidents') ? ' is-active' : ''}${blocked('incidents') ? ' is-locked' : ''}`}
              aria-label={incOpen ? 'Cerrar incidencia' : 'Informar incidencia'} title={incOpen ? 'Cerrar incidencia' : 'Informar incidencia'}
              aria-disabled={blocked('incidents')} aria-pressed={blocked('incidents') ? undefined : incOpen}
              onClick={() => (blocked('incidents') ? showLocked('Incidencias') : setIncOpen(!incOpen))}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 2.8 19h18.4L12 3Z" />
                <path d="M12 9v4m0 3h.01" />
              </svg>
              <span>Incidencia</span>
            </button>
          </div>

          {showMap && <RouteMap
            stops={stops.data ?? []}
            path={savedPath ?? null}
            highlightId={next?.id ?? null}
            pos={gps.pos}
            heading={gps.heading}
            speedKmh={gpsFixAt !== null && gpsFixAt >= -30_000 && gpsFixAt <= 10_000 ? gps.speedKmh : null}
            punctualityText={mins === null ? gpsMessage : formatPunctuality(mins, beforeDeparture)}
            punctualityMinutes={mins}
            punctualityState={state}
            turn={turn}
          />}

          {incOpen && !blocked('incidents') && (
            <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="seg" role="group" aria-label="Tipo de incidencia">
                {(Object.keys(INCIDENT_LABEL) as IncidentKind[]).map((k) => (
                  <button key={k} type="button" className={k === incKind ? 'primary' : ''} aria-pressed={k === incKind} onClick={() => setIncKind(k)}>{INCIDENT_LABEL[k]}</button>
                ))}
              </div>
              <input value={incNote} onChange={(e) => setIncNote(e.target.value)} placeholder={incKind === 'other' ? 'Detalle (obligatorio)' : 'Detalle (opcional)'} aria-label="Detalle de la incidencia" />
              <button className="primary" disabled={busy || (incKind === 'other' && incNote.trim().length < 3)} onClick={sendIncident}>Informar</button>
            </div>
          )}

        </>
      )}

      {/* Finalizar va debajo de Mapa e Incidencia (y de sus paneles si están abiertos); no es fijo */}
      {t.status === 'in_progress' && (
        <button className="stop" style={{ width: '100%' }} disabled={busy || autoAdvancing} onClick={finish}>Finalizar viaje</button>
      )}

      {t.status === 'in_progress' && (
        <div className="driver-sticky-finish">
          {lockedMsg && <div className="notice warn" role="status">{lockedMsg}</div>}
          <div className="trip-tool-actions" role="group" aria-label="Taquilla y escáner">
            <button type="button" className={`trip-tool-button box-tool${blocked('fares') ? ' is-locked' : ''}`}
              aria-label="Taquilla" title="Taquilla" aria-disabled={blocked('fares')}
              onClick={() => (blocked('fares') ? showLocked('Taquilla') : setTaquilla(true))}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
                <path d="M14 5v2m0 3v2m0 3v2" />
              </svg>
              <span>Taquilla</span>
            </button>
            <button type="button" className={`trip-tool-button scan-tool${blocked('scanner') ? ' is-locked' : ''}`}
              aria-label="Escanear pasaje" title="Escanear pasaje" aria-disabled={blocked('scanner')}
              onClick={() => (blocked('scanner') ? showLocked('Escáner') : setScanning(true))}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3M4 12h16" />
              </svg>
              <span>Escáner</span>
            </button>
          </div>
        </div>
      )}

      {t.status === 'completed' && (
        <>
          <div className="panel">Viaje finalizado a las {t.ended_at ? formatTime(t.ended_at) : '-'}.</div>
          {(nextDeps.error || routeNames.error) && <div className="notice error" role="alert">{nextDeps.error ?? routeNames.error}</div>}
          {nextService && (
              <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="muted muted20">Siguiente viaje del servicio {t.services?.code}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{nextRouteName(nextService.dep.route_id)}</div>
                <div>{nextWhen(nextService)}</div>
                <Link to={`/conductor/iniciar?servicio=${encodeURIComponent(t.services?.code ?? '')}&tipo=${t.day_type}&sentido=${nextService.dep.route_id}&salida=${nextService.dep.id}&fecha=${t.service_date}&autoSentido=1&forzadoSentido=0`}>
                  <button className="primary big" style={{ width: '100%' }}>Iniciar siguiente viaje</button>
                </Link>
              </div>
          )}
        </>
      )}
    </div>
  );
}
