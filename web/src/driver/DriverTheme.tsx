import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type DriverTheme = 'dark' | 'light';

interface DriverThemeState {
  theme: DriverTheme;
  toggleTheme: () => void;
}

const STORAGE_KEY = 'transporte.driverTheme';
const ThemeContext = createContext<DriverThemeState | null>(null);

function initialTheme(): DriverTheme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function DriverThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<DriverTheme>(initialTheme);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // The selected theme remains active for the current session when storage is unavailable.
    }
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div className="driver-shell" data-theme={theme}>{children}</div>
    </ThemeContext.Provider>
  );
}

export function useDriverTheme(): DriverThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useDriverTheme fuera de DriverThemeProvider');
  return context;
}

export function DriverThemeToggle() {
  const { theme, toggleTheme } = useDriverTheme();

  return (
    <button className="driver-theme-toggle" type="button" onClick={toggleTheme}
      aria-pressed={theme === 'light'}
      aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo nocturno'}
      title={theme === 'dark' ? 'Activar modo claro' : 'Activar modo nocturno'}>
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" />
        </svg>
      )}
    </button>
  );
}
