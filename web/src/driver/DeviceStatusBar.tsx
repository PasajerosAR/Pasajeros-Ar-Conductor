import { useEffect, useState, type CSSProperties } from 'react';
import { askPhonePermission, readDeviceStatus, type DeviceStatus, type SimStatus } from '../lib/deviceStatus';
import { useGpsStatus } from './GpsGuard';

const REFRESH_MS = 5000;
const MIN_BAR_H = 22;

// 4 barritas de señal: level 0 a 4; -1 = sin dato (todas apagadas)
function Bars({ level, label }: { level: number; label: string }) {
  return (
    <span className="signal-bars" role="img" aria-label={`${label}: ${level < 0 ? 'sin señal' : `${level} de 4`}`}>
      {[1, 2, 3, 4].map((n) => <i key={n} className={level >= n ? 'on' : ''} style={{ height: 3 + n * 3 }} />)}
    </span>
  );
}

// compact: con la cámara en el medio queda poco lugar a cada lado, así que se muestra el número de SIM en vez del nombre
function Sim({ sim, single, compact }: { sim: SimStatus; single: boolean; compact: boolean }) {
  const name = sim.carrier || (single ? 'Datos' : `SIM ${sim.slot}`);
  const text = compact ? (single ? '' : String(sim.slot)) : name;
  return (
    <span className={`status-item${sim.data ? ' data' : ''}`} title={`SIM ${sim.slot}: ${sim.carrier}`}>
      {text && <span className="status-text">{text}</span>}
      <Bars level={sim.level} label={name} />
      {sim.type && <span className="net-type">{sim.type}</span>}
    </span>
  );
}

// Barra superior fija: GPS, WiFi, red móvil de cada SIM y batería. Si el teléfono tiene la cámara frontal en el medio,
// la barra se parte en dos mitades y deja libre esa zona.
export function DeviceStatusBar() {
  const gps = useGpsStatus();
  const [status, setStatus] = useState<DeviceStatus | null>(null);

  useEffect(() => {
    let alive = true;
    void askPhonePermission();
    const read = () => readDeviceStatus().then((s) => { if (alive) setStatus(s); }).catch(() => undefined);
    read();
    const id = setInterval(read, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const gpsState = gps.error === 'denied' || gps.error === 'unavailable' || status?.gpsEnabled === false ? 'off' : gps.hasFix ? 'ok' : 'search';
  const gpsText = gpsState === 'off' ? 'GPS apagado' : gpsState === 'ok' ? 'GPS' : 'GPS...';
  const battery = status?.battery;
  const pct = battery?.level ?? null;
  const batteryClass = pct === null ? '' : pct <= 15 ? 'low' : pct <= 30 ? 'mid' : '';
  const sims = status?.sims ?? [];
  const cut = status?.cutout ?? null;

  const gpsItem = <span className={`status-item gps ${gpsState}`}><i className="dot" />{gpsText}</span>;
  const wifiItem = (
    <span className={`status-item${status?.wifi.connected ? '' : ' off'}`}>
      <span className="status-text">WiFi</span>
      <Bars level={status?.wifi.connected ? status.wifi.level : -1} label="WiFi" />
    </span>
  );
  const simItems = sims.map((s) => <Sim key={s.slot} sim={s} single={sims.length === 1} compact={cut !== null} />);
  const dataItem = sims.length === 0 && status?.mobileConnected
    ? <span className="status-item"><span className="status-text">Datos</span><Bars level={-1} label="Datos móviles" /></span> : null;
  const batteryItem = (
    <span className={`status-item battery ${batteryClass}`} aria-label={`Batería ${pct ?? 'sin dato'}%`}>
      <span className="battery-body"><i style={{ width: `${pct ?? 0}%` }} /></span>
      <span className="status-text">{battery?.charging ? '⚡' : ''}{pct === null ? '--' : `${pct}%`}</span>
    </span>
  );

  if (!cut) {
    return <div className="device-bar" role="status" aria-label="Estado del teléfono">{gpsItem}{wifiItem}{simItems}{dataItem}{batteryItem}</div>;
  }
  // Con muesca: izquierda hasta la cámara y derecha desde la cámara; la altura de la barra es la de la zona de la cámara.
  const style = { '--cut-left': `${cut.left}px`, '--cut-gap': `${Math.max(0, cut.right - cut.left)}px`, '--bar-h': `${Math.max(MIN_BAR_H, cut.bottom)}px` } as CSSProperties;
  return (
    <div className="device-bar split" style={style} role="status" aria-label="Estado del teléfono">
      <div className="bar-left">{gpsItem}{wifiItem}</div>
      <div className="bar-gap" aria-hidden="true" />
      <div className="bar-right">{simItems}{dataItem}{batteryItem}</div>
    </div>
  );
}
