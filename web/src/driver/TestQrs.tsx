import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';
import { friendly } from '../lib/errors';
import { must, useQuery } from '../lib/useQuery';
import { Loading } from '../ui';
import { DriverCompany } from './DriverCompany';

interface Ticket { code: string; passenger_name: string; status: 'valid' | 'boarded' | 'cancelled'; boarding: { name: string } | null; alighting: { name: string } | null }
const STATUS: Record<Ticket['status'], string> = { valid: 'Vigente', boarded: 'Ya subió', cancelled: 'Anulado' };

// MODO PRUEBA: genera pasajes de prueba del viaje y muestra su QR para escanearlos desde otra pantalla (otro celular o la computadora).
export function TestQrs() {
  const { id = '' } = useParams();
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgs, setImgs] = useState<Record<string, string>>({});

  const tickets = useQuery(async () => must(await supabase.from('tickets')
    .select('code,passenger_name,status,boarding:route_stops!tickets_boarding_stop_id_fkey(name),alighting:route_stops!tickets_alighting_stop_id_fkey(name)')
    .eq('trip_id', id).order('created_at')) as unknown as Ticket[], [id, tick]);

  useEffect(() => {
    void Promise.all((tickets.data ?? []).map(async (k) => [k.code, await QRCode.toDataURL(k.code, { margin: 2, width: 220 })] as const))
      .then((e) => setImgs(Object.fromEntries(e)));
  }, [tickets.data]);

  const generate = async () => {
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc('create_test_tickets', { p_trip: id, p_count: 8 });
    setBusy(false);
    if (e) setError(friendly(e)); else setTick((n) => n + 1);
  };

  return (
    <div className="driver-app">
      <DriverCompany />
      <div className="row" style={{ alignItems: 'center' }}>
        <Link to={`/conductor/viaje/${id}`}><button style={{ minHeight: 48 }}>Volver</button></Link>
        <h1 style={{ fontSize: 18, flex: 1 }}>Pasajes de prueba</h1>
      </div>
      <div className="notice">Modo prueba. Generá pasajes para este viaje y escaneá sus QR desde otra pantalla. Cada pasaje tiene su parada de subida y de bajada; uno viene anulado para ver el rechazo, y leer dos veces el mismo muestra "ya usado".</div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="primary big" disabled={busy} onClick={generate}>Generar 8 pasajes de prueba</button>
      {tickets.loading ? <Loading /> : (tickets.data ?? []).map((k) => (
        <div key={k.code} className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center', opacity: k.status === 'valid' ? 1 : 0.6 }}>
          {imgs[k.code] ? <img src={imgs[k.code]} alt={`QR de ${k.passenger_name}`} width={120} height={120} style={{ background: '#fff', borderRadius: 8 }} /> : <div style={{ width: 120, height: 120 }} />}
          <div>
            <b>{k.passenger_name}</b>
            <div className="muted">{k.boarding?.name} → {k.alighting?.name}</div>
            <div className="muted">{STATUS[k.status]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
