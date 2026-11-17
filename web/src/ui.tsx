import type { ReactNode } from 'react';

export function Notice({ kind = 'error', children }: { kind?: 'error' | 'warn' | 'ok'; children: ReactNode }) {
  return <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

// Pantalla de carga completa (al abrir la app o iniciar sesión). Usa el tema elegido por el conductor.
export function SplashLoading() {
  let theme = 'dark';
  try { theme = window.localStorage.getItem('transporte.driverTheme') === 'light' ? 'light' : 'dark'; } catch { /* sin almacenamiento: tema oscuro */ }
  return (
    <div className="splash" data-theme={theme} role="status" aria-live="polite">
      <span className="splash-spinner" aria-hidden="true" />
      <span>Cargando</span>
    </div>
  );
}

export function Loading() {
  return <p className="muted">Cargando...</p>;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
