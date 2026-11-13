import { describe, expect, it } from 'vitest';
import { checkTestQr } from './qrCheck';

const route = 'Paraná - Santa Fe';
describe('validación de QR de prueba', () => {
  it('un código OK es válido', () => {
    const r = checkTestQr('PRUEBA:OK3', new Set(), route);
    expect(r.ok).toBe(true);
    expect(r.code).toBe('OK3');
    expect(r.title).toContain('Pasajero de prueba 3');
  });
  it('el mismo código dos veces: la segunda es "ya usado"', () => {
    const used = new Set(['OK3']);
    const r = checkTestQr('PRUEBA:OK3', used, route);
    expect(r.ok).toBe(false);
    expect(r.title).toBe('QR ya usado');
  });
  it('rechazos con su motivo', () => {
    expect(checkTestQr('PRUEBA:OTROSENTIDO', new Set(), route).detail).toMatch(/otro sentido/);
    expect(checkTestQr('PRUEBA:TRAMO', new Set(), route).detail).toMatch(/tramo/);
    expect(checkTestQr('PRUEBA:ANULADO', new Set(), route).detail).toMatch(/anulado/);
    expect(checkTestQr('PRUEBA:OTROSERVICIO', new Set(), route).ok).toBe(false);
  });
  it('un QR ajeno o desconocido es inválido', () => {
    expect(checkTestQr('https://ejemplo.com', new Set(), route).title).toBe('QR inválido');
    expect(checkTestQr('PRUEBA:XYZ', new Set(), route).title).toBe('QR inválido');
  });
  it('no distingue mayúsculas ni espacios', () => {
    expect(checkTestQr('  prueba:ok7 ', new Set(), route).ok).toBe(true);
  });
});
