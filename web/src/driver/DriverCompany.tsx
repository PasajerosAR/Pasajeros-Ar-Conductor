import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { must, useQuery } from '../lib/useQuery';
import { useAuth } from '../auth/AuthProvider';
import { DriverThemeToggle } from './DriverTheme';

interface Msg { id: string; level: 'info' | 'important' | 'urgent'; body: string; created_at: string }
const LEVEL: Record<Msg['level'], string> = { info: 'Informativo', important: 'Importante', urgent: 'Urgente' };
const hhmm = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function DriverCompany() {
  const { profile, signOut } = useAuth();
  const company = useQuery(async () => profile?.company_id
    ? must(await supabase.from('companies').select('name').eq('id', profile.company_id).maybeSingle()) as { name: string } | null
    : null, [profile?.company_id]);
  const [panel, setPanel] = useState<'inbox' | 'profile' | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((v) => v + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const inbox = useQuery(async () => {
    if (!profile) return [];
    const msgs = must(await supabase.from('driver_messages').select('id,level,body,created_at').order('created_at', { ascending: false }).limit(30)) as Msg[];
    const reads = must(await supabase.from('driver_message_reads').select('message_id')) as { message_id: string }[];
    const readSet = new Set(reads.map((r) => r.message_id));
    return msgs.map((m) => ({ ...m, read: readSet.has(m.id) }));
  }, [tick, panel, profile?.id]);
  const messages = inbox.data ?? [];
  const unread = messages.filter((m) => !m.read);
  const hasUrgent = unread.some((m) => m.level === 'urgent');
  // un mensaje urgente nuevo abre el buzón solo
  useEffect(() => { if (hasUrgent) setPanel((p) => p ?? 'inbox'); }, [hasUrgent]);
  const openInbox = () => {
    const next = panel === 'inbox' ? null : 'inbox';
    setPanel(next);
    if (next && unread.length) void supabase.rpc('mark_messages_read', { p_ids: unread.map((m) => m.id) }).then(() => inbox.reload());
  };

  return (
    <header className="driver-company" aria-label="Pasajeros.ar y empresa del conductor">
      <div className="driver-company-mark" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 30 30" fill="none">
          <path d="M4.5 10.5h21v11h-21z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
          <path d="m8 10.5 3-4h8l3 4M8 16h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="9" cy="22" r="2" fill="currentColor"/>
          <circle cx="21" cy="22" r="2" fill="currentColor"/>
        </svg>
      </div>
      <div className="driver-company-info">
        <strong className="driver-brand-title">PASAJEROS<span>.AR</span></strong>
        <span className="driver-company-label">EMPRESA · {company.loading ? 'Cargando…' : company.error ? 'No se pudo cargar' : company.data?.name ?? 'No asignada'}</span>
      </div>
      <DriverThemeToggle />
      <button className="driver-avatar driver-inbox-btn" type="button" aria-label={`Mensajes${unread.length ? `, ${unread.length} sin leer` : ''}`} title="Mensajes" onClick={openInbox}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
        {unread.length > 0 && <span className="driver-badge">{unread.length}</span>}
      </button>
      <button className="driver-avatar" type="button" aria-label="Opciones" title="Opciones" onClick={() => setPanel(panel === 'profile' ? null : 'profile')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
      </button>
      {panel === 'inbox' && (
        <div className="driver-sheet" role="dialog" aria-label="Mensajes">
          <h3>Mensajes</h3>
          {inbox.error && <div className="notice error">{inbox.error}</div>}
          {messages.length === 0 && <p className="muted">No tenés mensajes.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`driver-msg ${m.level}${m.read ? ' read' : ''}`}>
              <small>{LEVEL[m.level]} · {hhmm(m.created_at)}</small>
              <div>{m.body}</div>
            </div>
          ))}
        </div>
      )}
      {panel === 'profile' && (
        <div className="driver-sheet" role="dialog" aria-label="Mis datos">
          <h3>Mis datos</h3>
          <dl>
            <dt>Nombre</dt><dd>{profile?.full_name}</dd>
            <dt>Legajo</dt><dd>{profile?.legajo ?? 'Sin asignar'}</dd>
            {profile?.dni && <><dt>DNI</dt><dd>{profile.dni}</dd></>}
            {profile?.phone && <><dt>Teléfono</dt><dd>{profile.phone}</dd></>}
            <dt>Empresa</dt><dd>{company.data?.name ?? '-'}</dd>
          </dl>
          <button type="button" className="danger" onClick={signOut}>Cerrar sesión</button>
        </div>
      )}
    </header>
  );
}
