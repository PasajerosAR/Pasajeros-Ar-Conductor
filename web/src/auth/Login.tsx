import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider';
import { Notice } from '../ui';
import { DriverThemeToggle } from '../driver/DriverTheme';

interface Props {
  audience: 'admin' | 'driver';
}

export function Login({ audience }: Props) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await signIn(email.trim(), password));
    setBusy(false);
  };

  return (
    <main className="driver-app login-app">
      <header className="driver-company" aria-label={audience === 'admin' ? 'Pasajeros.ar, admin' : 'Pasajeros.ar, conductor'}>
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
          <span className="driver-company-label">{audience === 'admin' ? '#Admin' : '#CONDUCTOR'}</span>
        </div>
        <DriverThemeToggle />
      </header>
      <form className="panel login-form" onSubmit={submit}>
        <div className="login-heading">
          <h1>Ingresar</h1>
          <p className="muted">{audience === 'admin' ? 'Accedé al panel de administración' : 'Accedé al sistema de conducción'}</p>
        </div>
        {error && <Notice>{error}</Notice>}
        <label>Correo<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="primary login-submit" type="submit" disabled={busy}>{busy ? 'Ingresando...' : 'Ingresar'}</button>
      </form>
    </main>
  );
}
