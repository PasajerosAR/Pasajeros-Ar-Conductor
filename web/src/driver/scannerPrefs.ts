export type ScanMode = 'manual' | 'auto';
export type ScanPos = 'center' | 'left' | 'right' | 'both';
export interface ScannerPrefs { mode: ScanMode; pos: ScanPos }

const KEY = 'transporte.scanner';
const DEFAULTS: ScannerPrefs = { mode: 'manual', pos: 'center' };

// Se guarda en el celular de cada chofer; si no hay almacenamiento, se usan los valores iniciales.
export function readPrefs(): ScannerPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ScannerPrefs>;
    return {
      mode: p.mode === 'auto' ? 'auto' : 'manual',
      pos: p.pos === 'left' || p.pos === 'right' || p.pos === 'both' ? p.pos : 'center'
    };
  } catch { return DEFAULTS; }
}
export function writePrefs(p: ScannerPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ } }
