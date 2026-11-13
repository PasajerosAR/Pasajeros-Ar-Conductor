import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2018' },   // compatible con WebView de Android más viejos
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.trycloudflare.com', '.loca.lt']
  },
  test: {
    environment: 'node'
  }
});