import type { CapacitorConfig } from '@capacitor/cli';

// App Android del conductor: la web compilada (carpeta dist) dentro de un WebView.
const config: CapacitorConfig = {
  appId: 'ar.pasajeros.conductor',
  appName: 'Pasajeros.ar Conductor',
  webDir: 'dist',
  server: { androidScheme: 'https' }   // origen https: la cámara y el GPS del WebView lo exigen
};

export default config;
