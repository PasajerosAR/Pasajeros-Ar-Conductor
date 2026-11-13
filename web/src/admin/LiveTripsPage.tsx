import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../lib/supabase';
import { must, useQuery } from '../lib/useQuery';
import { Loading, Notice, formatTime } from '../ui';
import { useAuth } from '../auth/AuthProvider';
import type { Company } from '../lib/types';
import type { LatLng } from '../lib/routePath';
import { liveProgress, type LiveStop } from '../lib/gpsProgress';
import { formatPunctuality, punctualityState } from '../lib/punctuality';

interface ScheduledStop {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  minutes_from_start: number | null;
  dwell_minutes: number;
}

interface TripSchedule { trip_id: string; route_stops: ScheduledStop[] }

interface LiveTrip {
  trip_id: string;
  company_id: string;
  company_name: string;
  service_code: string;
  service_date: string;
  scheduled_departure: string;
  started_at: string | null;
  route_id: string;
  route_name: string;
  route_path: LatLng[] | null;
  vehicle_number: string | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  heading: number | null;
  location_at: string | null;
}

const ARGENTINA: L.LatLngTuple = [-31.7333, -60.5236];
const ROUTE_COLORS = ['#0f5c8c', '#9b4dca', '#d97706', '#15803d', '#be123c', '#475569'];
const validPoint = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

function LiveTripsMap({ trips, selectedId, onSelect }: { trips: LiveTrip[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const latest = useRef({ onSelect });
  const lastTripSet = useRef('');
  const focusedTrip = useRef<string | null>(null);
  latest.current = { onSelect };

  useEffect(() => {
    if (!element.current || map.current) return;
    const instance = L.map(element.current).setView(ARGENTINA, 7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(instance);
    layers.current = L.layerGroup().addTo(instance);
    map.current = instance;
    const timer = window.setTimeout(() => instance.invalidateSize(), 0);
    return () => { window.clearTimeout(timer); instance.remove(); map.current = null; layers.current = null; };
  }, []);

  useEffect(() => {
    const mapInstance = map.current;
    const layer = layers.current;
    if (!mapInstance || !layer) return;
    layer.clearLayers();
    const allPoints: L.LatLngTuple[] = [];

    trips.forEach((trip, index) => {
      const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
      const path = (trip.route_path ?? []).filter(([lat, lng]) => validPoint(lat, lng));
      if (path.length > 1) {
        L.polyline(path, { color, weight: 4, opacity: 0.65 }).addTo(layer);
        allPoints.push(...path);
      }

      if (trip.latitude !== null && trip.longitude !== null && validPoint(trip.latitude, trip.longitude)) {
        const point: L.LatLngTuple = [trip.latitude, trip.longitude];
        allPoints.push(point);
        const stale = !trip.location_at || Date.now() - new Date(trip.location_at).getTime() > 90_000;
        const marker = L.circleMarker(point, {
          radius: selectedId === trip.trip_id ? 10 : 8,
          color: '#fff',
          weight: 2,
          fillColor: stale ? '#64748b' : color,
          fillOpacity: stale ? 0.65 : 1
        }).addTo(layer);
        marker.on('click', () => latest.current.onSelect(trip.trip_id));
        const tooltip = document.createElement('span');
        tooltip.textContent = `Servicio #${trip.service_code} · ${trip.company_name} · ${trip.driver_name ?? 'Sin conductor'}${stale ? ' · Ubicación desactualizada' : ''}`;
        marker.bindTooltip(tooltip);
      }
    });

    const tripSet = trips.map((trip) => trip.trip_id).sort().join('|');
    if (tripSet && tripSet !== lastTripSet.current && allPoints.length) {
      mapInstance.fitBounds(L.latLngBounds(allPoints).pad(0.15), { maxZoom: 14 });
    }
    lastTripSet.current = tripSet;
  }, [trips, selectedId]);

  useEffect(() => {
    const trip = trips.find((item) => item.trip_id === selectedId);
    const mapInstance = map.current;
    if (!trip || !mapInstance || focusedTrip.current === selectedId || trip.latitude === null || trip.longitude === null || !validPoint(trip.latitude, trip.longitude)) return;
    mapInstance.setView([trip.latitude, trip.longitude], Math.max(mapInstance.getZoom(), 12));
    focusedTrip.current = selectedId;
  }, [selectedId, trips]);

  return <div ref={element} className="live-trips-map" role="application" aria-label="Mapa de seguimiento GPS de servicios activos" />;
}

export function LiveTripsPage() {
  const { profile } = useAuth();
  const platformAdmin = profile?.role === 'platform_admin';
  const [companyId, setCompanyId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setRefreshTick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const companies = useQuery(async () => platformAdmin
    ? must(await supabase.from('companies').select('id,name,active,created_at').order('name')) as Company[]
    : [], [platformAdmin]);
  const trips = useQuery(async () => must(await supabase.rpc('admin_live_trips', {
    p_company_id: platformAdmin ? companyId || null : null
  })) as LiveTrip[], [platformAdmin, companyId, refreshTick]);
  const schedules = useQuery(async () => must(await supabase.rpc('admin_live_trip_schedule', {
    p_company_id: platformAdmin ? companyId || null : null
  })) as TripSchedule[], [platformAdmin, companyId, refreshTick]);
  const rows = trips.data ?? [];
  const scheduleByTrip = new Map((schedules.data ?? []).map((item) => [item.trip_id, item.route_stops]));
  const activeSelectedId = rows.some((trip) => trip.trip_id === selectedId) ? selectedId : rows[0]?.trip_id ?? null;
  const selected = rows.find((trip) => trip.trip_id === activeSelectedId);

  const locationStatus = (trip: LiveTrip) => {
    if (!trip.location_at) return 'Esperando ubicación del conductor';
    const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(trip.location_at).getTime()) / 1000));
    if (ageSeconds > 90) return `Ubicación desactualizada · hace ${Math.floor(ageSeconds / 60)} min`;
    return `Actualizado ${formatTime(trip.location_at)} · precisión ±${Math.round(trip.accuracy_m ?? 0)} m`;
  };
  const punctuality = (trip: LiveTrip) => {
    if (trip.latitude === null || trip.longitude === null || !trip.location_at) return { text: 'Sin ubicación GPS', kind: 'warn' as const };
    if (Date.now() - new Date(trip.location_at).getTime() > 90_000) return { text: 'GPS desactualizado', kind: 'warn' as const };
    const stops: LiveStop[] = (scheduleByTrip.get(trip.trip_id) ?? []).flatMap((stop) =>
      stop.lat !== null && stop.lng !== null && stop.minutes_from_start !== null
        ? [{ ...stop, lat: Number(stop.lat), lng: Number(stop.lng), minutes_from_start: Number(stop.minutes_from_start), dwell_minutes: Number(stop.dwell_minutes) }]
        : []);
    if (stops.length < 2) return { text: 'Faltan horarios o coordenadas de paradas', kind: 'warn' as const };
    const savedPath = (trip.route_path ?? []).filter(([lat, lng]) => validPoint(lat, lng));
    const path = savedPath.length > 1 ? savedPath : stops.map((stop) => [stop.lat, stop.lng] as LatLng);
    if (path.length < 2) return { text: 'Faltan datos del recorrido', kind: 'warn' as const };
    const now = new Date();
    const scheduled = new Date(trip.scheduled_departure);
    const progress = liveProgress(path, stops, scheduled, now, [trip.latitude, trip.longitude]);
    if (progress.offRoute || progress.mins === null) return { text: 'Fuera del recorrido', kind: 'warn' as const };
    const state = punctualityState(progress.mins);
    return {
      text: formatPunctuality(progress.mins, now.getTime() < scheduled.getTime()),
      kind: state === 'late' ? 'bad' as const : state === 'early' ? 'info' as const : 'ok' as const
    };
  };

  return (
    <>
      <h1>Seguimiento GPS</h1>
      <p className="muted" style={{ margin: 0 }}>Posición actual de los viajes en curso. Se actualiza cada 15 segundos; no se guarda un historial de ubicaciones.</p>
      <div className="row">
        {platformAdmin && (
          <label>Empresa
            <select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="">Todas las empresas</option>
              {(companies.data ?? []).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
        )}
        <button className="secondary" onClick={trips.reload}>Actualizar ahora</button>
      </div>
      {companies.error && <Notice>{companies.error}</Notice>}
      {trips.error && <Notice>{trips.error}</Notice>}
      {schedules.error && <Notice>{schedules.error}</Notice>}
      <div className="card">
        {(trips.loading || schedules.loading) && !trips.data ? <Loading /> : rows.length === 0
          ? <p className="muted" role="status">No hay servicios en curso para esta selección.</p>
          : <LiveTripsMap trips={rows} selectedId={activeSelectedId} onSelect={setSelectedId} />}
      </div>
      {(trips.loading || schedules.loading) && trips.data && <p className="muted" role="status">Actualizando posiciones…</p>}
      {rows.length > 0 && (
        <div className="live-trip-list" aria-label="Servicios en curso">
          {rows.map((trip) => (
            <button key={trip.trip_id} type="button" className={`card live-trip-card${trip.trip_id === activeSelectedId ? ' selected' : ''}`}
              aria-pressed={trip.trip_id === activeSelectedId} onClick={() => setSelectedId(trip.trip_id)}>
              <span><b>{trip.company_name} · Servicio #{trip.service_code}</b><br />{trip.route_name}</span>
              <span><b>{trip.vehicle_number ? `Interno ${trip.vehicle_number}` : 'Sin unidad'}</b>{trip.vehicle_plate ? ` · Patente ${trip.vehicle_plate}` : ''}<br />{trip.driver_name ?? 'Sin conductor'}</span>
              <span><span className={`pill ${punctuality(trip).kind}`}>{punctuality(trip).text}</span><br />
                <small>{locationStatus(trip)} · salida {formatTime(trip.scheduled_departure)}</small></span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <section className="card live-trip-detail" aria-label="Detalle del servicio seleccionado">
          <h2>{selected.company_name} · Servicio #{selected.service_code}</h2>
          <div className="live-trip-detail-grid">
            <div><span className="muted">Recorrido</span><b>{selected.route_name}</b></div>
            <div><span className="muted">Unidad</span><b>{selected.vehicle_number ? `Interno ${selected.vehicle_number}` : 'Sin asignar'}{selected.vehicle_plate ? ` · Patente ${selected.vehicle_plate}` : ''}</b></div>
            <div><span className="muted">Conductor</span><b>{selected.driver_name ?? 'Sin asignar'}</b></div>
            <div><span className="muted">Puntualidad</span><b><span className={`pill ${punctuality(selected).kind}`}>{punctuality(selected).text}</span></b></div>
            <div><span className="muted">Salida programada</span><b>{formatTime(selected.scheduled_departure)}</b></div>
            <div><span className="muted">GPS</span><b>{locationStatus(selected)}</b></div>
          </div>
        </section>
      )}
    </>
  );
}
