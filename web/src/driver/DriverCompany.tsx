import { supabase } from '../lib/supabase';
import { must, useQuery } from '../lib/useQuery';
import { useAuth } from '../auth/AuthProvider';
import { DriverThemeToggle } from './DriverTheme';

export function DriverCompany() {
  const { profile, signOut } = useAuth();
  const company = useQuery(async () => profile?.company_id
    ? must(await supabase.from('companies').select('name').eq('id', profile.company_id).maybeSingle()) as { name: string } | null
    : null, [profile?.company_id]);
  const initials = profile?.full_name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '??';

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
      <button className="driver-avatar" type="button" aria-label={`Cerrar sesión de ${profile?.full_name ?? 'conductor'}`}
        title="Cerrar sesión" onClick={signOut}>{initials}</button>
    </header>
  );
}
