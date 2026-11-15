import { Capacitor, registerPlugin } from '@capacitor/core';

// Estado del teléfono para la barra superior. En la app Android lo da el plugin nativo DeviceStatus;
// en el navegador se usa lo que el navegador ofrece (batería y tipo de conexión) y el resto queda sin dato.
export interface SimStatus { slot: number; carrier: string; level: number; type: string; data: boolean }
export interface DeviceStatus {
  battery: { level: number | null; charging: boolean };            // level 0 a 100
  wifi: { enabled: boolean; connected: boolean; level: number };   // level 0 a 4, -1 sin dato
  sims: SimStatus[];                                               // level 0 a 4, -1 sin dato
  mobileConnected: boolean;
  gpsEnabled: boolean | null;
  phonePermission: boolean;
  cutout: Cutout | null;                                           // cámara frontal en el borde superior (px CSS)
}
export interface Cutout { left: number; right: number; bottom: number }

interface NativeStatus {
  battery: { level: number; charging: boolean };
  wifi: { enabled: boolean; connected: boolean; level: number };
  sims: SimStatus[];
  mobileConnected: boolean;
  gpsEnabled: boolean;
  phonePermission: boolean;
  cutout: Partial<Cutout>;
}
interface DeviceStatusPlugin {
  getStatus(): Promise<NativeStatus>;
  checkPermissions(): Promise<{ phone: string }>;
  requestPermissions(): Promise<{ phone: string }>;
}

const Native = registerPlugin<DeviceStatusPlugin>('DeviceStatus');
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

// Pide el permiso de teléfono (señal y operadora de cada SIM). Una sola vez; si se rechaza, se muestra una red móvil sin nombre.
export async function askPhonePermission(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const p = await Native.checkPermissions();
    if (p.phone === 'prompt' || p.phone === 'prompt-with-rationale') await Native.requestPermissions();
  } catch {
    // sin permiso la barra sigue funcionando con menos datos
  }
}

interface BrowserBattery { level: number; charging: boolean }
interface BrowserConnection { type?: string; effectiveType?: string }

export async function readDeviceStatus(): Promise<DeviceStatus> {
  if (isNativeApp()) {
    const s = await Native.getStatus();
    const c = s.cutout;
    const cutout = c && c.left !== undefined && c.right !== undefined && c.bottom !== undefined ? { left: c.left, right: c.right, bottom: c.bottom } : null;
    return { ...s, cutout, battery: { level: s.battery.level >= 0 ? s.battery.level : null, charging: s.battery.charging } };
  }
  let battery: DeviceStatus['battery'] = { level: null, charging: false };
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BrowserBattery>; connection?: BrowserConnection };
    if (nav.getBattery) { const b = await nav.getBattery(); battery = { level: Math.round(b.level * 100), charging: b.charging }; }
    const type = nav.connection?.type;
    return {
      battery, wifi: { enabled: true, connected: type === 'wifi' || (!type && navigator.onLine), level: -1 },
      sims: [], mobileConnected: type === 'cellular', gpsEnabled: null, phonePermission: false, cutout: null
    };
  } catch {
    return { battery, wifi: { enabled: true, connected: navigator.onLine, level: -1 }, sims: [], mobileConnected: false, gpsEnabled: null, phonePermission: false, cutout: null };
  }
}
