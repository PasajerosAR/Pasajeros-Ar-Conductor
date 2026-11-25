import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { must, useQuery } from '../lib/useQuery';
import { friendly } from '../lib/errors';
import type { RouteStop } from '../lib/types';
import {
  columnTemplate, formatMoney, priceFor, seatClassName, seatOccupied, seatsLeft, seatState, summarize,
  type TaquillaCell, type TaquillaPrice, type TaquillaRange
} from '../lib/taquilla';
import { DriverCompany } from './DriverCompany';

interface Props {
  tripId: string;
  layoutId: string | null;
  routeId: string;
  stops: RouteStop[];
  suggestedStopId: string;
  onboard: number | null;      // pasajeros a bordo según el contador
  capacity: number | null;     // lugares del vehículo
  onSold: () => void;          // para que el viaje refresque sus datos
  onBack: () => void;
}

type Method = 'cash' | 'transfer' | 'mp';
const METHODS: { key: Method; label: string }[] = [
  { key: 'cash', label: 'Efectivo' }, { key: 'transfer', label: 'Transferencia' }, { key: 'mp', label: 'QR Mercado Pago' }
];
const REFRESH_MS = 8000;   // los asientos se vuelven a consultar cada tanto: ventas de ventanilla, web u otro conductor

const QR_SECONDS = 5 * 60;
const CELL_LABEL: Record<string, string> = { door: 'Puerta', stairs: 'Escalera', driver: 'Conductor', toilet: 'Baño', trunk: 'Bodega' };

// QR de vista previa: dibujo fijo, NO es un código válido ni cobra nada.
function PreviewQr() {
  const n = 29;
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const rects: JSX.Element[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let on: boolean;
    if (finder(x, y)) {
      const ax = x < 7 ? x : x - (n - 7); const ay = y < 7 ? y : y - (n - 7);
      on = ax === 0 || ax === 6 || ay === 0 || ay === 6 || (ax >= 2 && ax <= 4 && ay >= 2 && ay <= 4);
    } else {
      const r = Math.sin((y * n + x) * 12.9898) * 43758.5453;
      on = r - Math.floor(r) > 0.52;
    }
    if (on) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
  }
  return <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} role="img" aria-label="QR de vista previa" shapeRendering="crispEdges" fill="#111">{rects}</svg>;
}

export function TaquillaPanel({ tripId, layoutId, routeId, stops, suggestedStopId, onboard, capacity, onSold, onBack }: Props) {
  const [fromId, setFromId] = useState(suggestedStopId || stops[0]?.id || '');
  const [toId, setToId] = useState(stops[stops.length - 1]?.id ?? '');
  const [floor, setFloor] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);       // ids de celdas elegidas
  const [qrLeft, setQrLeft] = useState<number | null>(null);   // null = todavía no se generó
  const [method, setMethod] = useState<Method>('cash');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [received, setReceived] = useState<{ total: number; seats: string[]; method: Method } | null>(null);
  const [pax, setPax] = useState<Record<string, { name: string; dni: string }>>({});   // por asiento
  const [holdUntil, setHoldUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const cells = useQuery(async () => layoutId
    ? must(await supabase.from('layout_cells')
      .select('id,floor,row_idx,col_idx,kind,label,seat_class,blocked,unusable').eq('layout_id', layoutId)) as TaquillaCell[]
    : [], [layoutId]);
  const floors = useQuery(async () => layoutId
    ? must(await supabase.from('layout_floors').select('floor,rows,cols').eq('layout_id', layoutId).order('floor')) as { floor: number; rows: number; cols: number }[]
    : [], [layoutId]);
  // la tarifa depende del tipo de día del viaje (hábil, sábado, domingo, feriado)
  const prices = useQuery(async () => {
    const trip = must(await supabase.from('trips').select('day_type').eq('id', tripId).single()) as { day_type: string };
    return must(await supabase.from('ticket_prices')
      .select('from_pos,to_pos,price,seat_class').eq('route_id', routeId).eq('day_type', trip.day_type).eq('active', true)) as TaquillaPrice[];
  }, [routeId, tripId]);
  const reservations = useQuery(async () => must(await supabase.rpc('taquilla_seat_status', { p_trip: tripId })) as TaquillaRange[], [tripId]);
  // refresca el estado de los asientos mientras la pantalla está abierta
  const reloadRanges = reservations.reload;
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) reloadRanges(); }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [reloadRanges]);

  const posOf = (id: string) => stops.find((s) => s.id === id)?.position ?? 0;
  const fromPos = posOf(fromId);
  const toPos = posOf(toId);
  const validTrip = fromPos > 0 && toPos > fromPos;

  // al cambiar el tramo, lo elegido deja de valer
  useEffect(() => { setPicked([]); }, [fromId, toId]);
  // al salir de la pantalla se libera lo reservado
  useEffect(() => () => { void supabase.rpc('taquilla_hold_seats', { p_trip: tripId, p_seats: [] }); }, [tripId]);
  useEffect(() => {
    if (holdUntil === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [holdUntil]);
  // el cobro en pantalla vence solo
  useEffect(() => {
    if (qrLeft === null || qrLeft <= 0) return;
    const id = window.setTimeout(() => setQrLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [qrLeft]);

  const all = cells.data ?? [];
  const floorList = floors.data ?? [];
  const dims = floorList.find((f) => f.floor === floor) ?? floorList[0];
  const floorCells = useMemo(() => all.filter((c) => c.floor === (dims?.floor ?? 1)), [all, dims?.floor]);
  const cellAt = useMemo(() => new Map(floorCells.map((c) => [`${c.row_idx}:${c.col_idx}`, c])), [floorCells]);

  const stateOf = (c: TaquillaCell) => seatState(
    c, validTrip && seatOccupied(reservations.data ?? [], c.label, fromPos, toPos),
    validTrip ? priceFor(prices.data ?? [], fromPos, toPos, c.seat_class) : null, picked.includes(c.id));
  const chosen = picked.map((id) => all.find((c) => c.id === id)).filter((c): c is TaquillaCell => !!c)
    .map((c) => ({ label: c.label ?? '?', seatClass: seatClassName(c), price: priceFor(prices.data ?? [], fromPos, toPos, c.seat_class) ?? 0 }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true }));
  // reserva unos minutos lo elegido para que no se venda por otro lado mientras se cobra
  const pickedLabels = chosen.map((c) => c.label).join('|');
  const holdSeq = useRef(0);
  useEffect(() => {
    const seq = ++holdSeq.current;
    if (!validTrip) return;
    const seats = pickedLabels ? pickedLabels.split('|').map((l) => ({ seat_label: l, from_stop_id: fromId, to_stop_id: toId })) : [];
    void supabase.rpc('taquilla_hold_seats', { p_trip: tripId, p_seats: seats }).then(({ data, error }) => {
      if (seq !== holdSeq.current) return;
      if (error) { setActionError(friendly(error)); setHoldUntil(null); reloadRanges(); return; }
      setHoldUntil(data ? new Date(data as string).getTime() : null);
    });
  }, [pickedLabels, fromId, toId, tripId, validTrip, reloadRanges]);
  const total = chosen.reduce((n, s) => n + s.price, 0);
  const floorClass = (n: number) => {
    const classes = [...new Set(all.filter((c) => c.floor === n && c.kind === 'seat' && !c.blocked && !c.unusable).map(seatClassName))];
    return classes.length === 0 ? '' : classes.length === 1 ? classes[0] : 'Varios tipos';
  };

  const left = seatsLeft(capacity ?? 0, onboard ?? 0);
  const holdLeft = holdUntil === null ? null : Math.max(Math.ceil((holdUntil - now) / 1000), 0);

  // cobro en efectivo / transferencia: emite los pasajes
  const receivePayment = async () => {
    if (busy || chosen.length === 0) return;
    const missing = chosen.find((s) => (pax[s.label]?.name ?? '').trim().length < 2 || (pax[s.label]?.dni ?? '').replace(/\D/g, '').length < 6);
    if (missing) { setActionError(`Cargá nombre y apellido y DNI del pasajero del asiento ${missing.label}.`); return; }
    setBusy(true); setActionError(null);
    try {
      const seats = chosen.map((s) => ({
        seat_label: s.label, from_stop_id: fromId, to_stop_id: toId,
        passenger_name: pax[s.label].name.trim(), passenger_dni: pax[s.label].dni.replace(/\D/g, '')
      }));
      must(await supabase.rpc('taquilla_sell', { p_trip: tripId, p_payment_method: method, p_seats: seats }));
      setReceived({ total, seats: chosen.map((s) => s.label), method });
      setPicked([]); setPax({}); setHoldUntil(null); reloadRanges(); onSold();
    } catch (e) {
      setActionError(friendly(e)); reloadRanges();
    } finally { setBusy(false); }
  };

  const toggle = (c: TaquillaCell) => {
    const state = stateOf(c);
    if (state === 'busy' || state === 'off') return;
    setActionError(null);
    setPicked((p) => (p.includes(c.id) ? p.filter((id) => id !== c.id) : [...p, c.id]));
  };
  const minutes = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const loading = cells.loading || floors.loading || prices.loading || (reservations.loading && !reservations.data);
  const loadError = cells.error || floors.error || prices.error || reservations.error;

  // ---------------------------------------------------------------- pago recibido
  if (received) {
    return (
      <div className="driver-app">
        <DriverCompany />
        <h1 style={{ fontSize: 18 }}>Pago recibido</h1>
        <div className="taquilla-total">{formatMoney(received.total)}</div>
        <div className="notice ok" role="status">
          {received.method === 'cash' ? 'Efectivo' : 'Transferencia'} · asiento{received.seats.length === 1 ? '' : 's'} {received.seats.join(', ')}
        </div>
        <button className="primary big" onClick={() => setReceived(null)}>Listo</button>
      </div>
    );
  }

  // ---------------------------------------------------------------- QR de cobro (vista previa)
  if (qrLeft !== null) {
    return (
      <div className="driver-app">
        <DriverCompany />
        <div className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
          <button type="button" className="scan-back-button" aria-label="Volver a los asientos" title="Volver a los asientos" onClick={() => setQrLeft(null)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
          </button>
          <h1 style={{ fontSize: 18, flex: 1 }}>Cobrar con Mercado Pago
            <div className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{chosen.map((s) => s.label).join(', ')} · {stops.find((s) => s.id === fromId)?.name} → {stops.find((s) => s.id === toId)?.name}</div>
          </h1>
        </div>
        <div className="taquilla-total">{formatMoney(total)}</div>
        <div className="muted" style={{ textAlign: 'center' }}>Pedile al pasajero que escanee con la app de Mercado Pago</div>
        <div className="taquilla-qr"><PreviewQr /></div>
        <div className="notice warn" role="status">
          {qrLeft > 0 ? `Vista de prueba: este QR todavía no cobra. Vence en ${minutes(qrLeft)}` : 'El QR venció. Volvé a generarlo.'}
        </div>
        <button className="secondary" onClick={() => setQrLeft(null)}>{qrLeft > 0 ? 'Cancelar cobro' : 'Volver'}</button>
        <div className="muted" style={{ textAlign: 'center', fontSize: 13 }}>Cuando se habilite el cobro, al acreditarse el pago los asientos pasan a ocupados y se emite el pasaje.</div>
      </div>
    );
  }

  // ---------------------------------------------------------------- elegir asientos
  return (
    <div className="driver-app taquilla">
      <DriverCompany />
      <div className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
        <button type="button" className="scan-back-button" aria-label="Volver al viaje" title="Volver al viaje" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
        </button>
        <h1 style={{ fontSize: 18, flex: 1 }}>Taquilla<div className="muted" style={{ fontSize: 13, fontWeight: 400 }}>Elegí los asientos y el tramo</div></h1>
      </div>

      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <label className="taquilla-stop"><span className="muted">Sube en</span>
          <select id="taquilla-from" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="taquilla-stop"><span className="muted">Baja en</span>
          <select id="taquilla-to" value={toId} onChange={(e) => setToId(e.target.value)}>
            {stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      {!validTrip && <div className="notice warn">La parada de bajada tiene que ser posterior a la de subida.</div>}

      {loadError && <div className="notice error">{loadError}</div>}
      {left !== null && left <= 0 && <div className="notice warn" role="status">El vehículo va lleno según el contador: {onboard} a bordo de {capacity}. Hay pasajeros sin pasaje.</div>}
      {left !== null && left > 0 && chosen.length > left && <div className="notice warn" role="status">Según el contador quedan {left} lugar{left === 1 ? '' : 'es'} y elegiste {chosen.length}.</div>}
      {loading && <div className="muted">Cargando asientos...</div>}
      {!loading && !loadError && !layoutId && <div className="notice warn">Este viaje no tiene una disposición de asientos asignada.</div>}

      {floorList.length > 0 && (
        <div className="taquilla-floors" role="tablist" aria-label="Piso">
          {floorList.map((f) => (
            <button key={f.floor} type="button" role="tab" aria-selected={(dims?.floor ?? 1) === f.floor}
              className={(dims?.floor ?? 1) === f.floor ? 'is-active' : ''} onClick={() => setFloor(f.floor)}>
              Piso {f.floor}<small>{floorClass(f.floor)}</small>
            </button>
          ))}
        </div>
      )}

      <div className="taquilla-legend" aria-label="Referencias">
        <span><i className="free" />Disponible</span><span><i className="busy" />Ocupado</span>
        <span><i className="off" />No habilitado</span><span><i className="selected" />Elegido</span>
      </div>

      {dims && (
        <div className="taquilla-plan" style={{ gridTemplateColumns: columnTemplate(floorCells, dims.cols) }}>
          {Array.from({ length: dims.rows * dims.cols }, (_, i) => {
            const row = Math.floor(i / dims.cols); const col = i % dims.cols;
            const c = cellAt.get(`${row}:${col}`);
            if (!c || c.kind === 'empty' || c.kind === 'aisle') return <div key={i} />;
            if (c.kind !== 'seat') return <div key={i} className="taquilla-cell">{CELL_LABEL[c.kind] ?? ''}</div>;
            const state = stateOf(c);
            return (
              <button key={i} type="button" className={`taquilla-seat ${state}`} aria-pressed={state === 'selected'}
                aria-label={`Asiento ${c.label ?? ''}, ${seatClassName(c)}, ${state === 'busy' ? 'ocupado' : state === 'off' ? 'no habilitado' : state === 'selected' ? 'elegido' : 'disponible'}`}
                disabled={state === 'busy' || state === 'off'} onClick={() => toggle(c)}>
                {c.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="muted" style={{ fontSize: 12 }}>En gris: asientos bloqueados por la empresa o sin tarifa para este tramo.</div>

      <div className="taquilla-bottom">
        {chosen.length === 0
          ? <div className="muted">Tocá un asiento para elegirlo.</div>
          : (
            <div className="taquilla-summary">
              {summarize(chosen).map((r) => (
                <div key={r.seatClass}><span>{r.seatClass} × {r.count} <span className="muted">({chosen.filter((s) => s.seatClass === r.seatClass).map((s) => s.label).join(', ')})</span></span><b>{formatMoney(r.subtotal)}</b></div>
              ))}
              <div className="taquilla-sum-total"><span>Total</span><b>{formatMoney(total)}</b></div>
            </div>
          )}
        {chosen.length > 0 && holdLeft !== null && (
          <div className="muted" style={{ fontSize: 13 }}>{holdLeft > 0 ? `Asientos reservados ${minutes(holdLeft)}` : 'La reserva venció: otro puede tomar estos asientos.'}</div>
        )}
        {method !== 'mp' && chosen.length > 0 && (
          <div className="taquilla-pax">
            {chosen.map((s) => (
              <fieldset key={s.label}>
                <legend>Asiento {s.label}</legend>
                <input aria-label={`Nombre y apellido, asiento ${s.label}`} placeholder="Nombre y apellido" autoComplete="off" maxLength={150}
                  value={pax[s.label]?.name ?? ''} onChange={(e) => setPax((p) => ({ ...p, [s.label]: { name: e.target.value, dni: p[s.label]?.dni ?? '' } }))} />
                <input aria-label={`DNI, asiento ${s.label}`} placeholder="DNI" inputMode="numeric" autoComplete="off" maxLength={12}
                  value={pax[s.label]?.dni ?? ''} onChange={(e) => setPax((p) => ({ ...p, [s.label]: { name: p[s.label]?.name ?? '', dni: e.target.value } }))} />
              </fieldset>
            ))}
          </div>
        )}
        {actionError && <div className="notice error" role="alert">{actionError}</div>}
        <div className="taquilla-methods" role="radiogroup" aria-label="Forma de pago">
          {METHODS.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={method === m.key}
              className={method === m.key ? 'is-active' : ''} onClick={() => setMethod(m.key)}>{m.label}</button>
          ))}
        </div>
        {method === 'mp'
          ? <button className="primary big" disabled={chosen.length === 0 || !validTrip} onClick={() => setQrLeft(QR_SECONDS)}>Generar QR de Mercado Pago</button>
          : <button className="primary big" disabled={chosen.length === 0 || !validTrip || busy} onClick={() => void receivePayment()}>
              {busy ? 'Registrando...' : `Recibir pago${chosen.length ? ` · ${formatMoney(total)}` : ''}`}
            </button>}
      </div>
    </div>
  );
}
