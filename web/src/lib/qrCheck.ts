// Validación de QR en MODO PRUEBA: todavía no existen los pasajes reales.
// Cuando haya pasajes, checkTestQr se reemplaza por una función del servidor que devuelva el mismo ScanResult.
export interface ScanResult { ok: boolean; title: string; detail: string }

export const TEST_PREFIX = 'PRUEBA:';
// Códigos de prueba que no son pasajes válidos: sirven para ver cada rechazo.
export const TEST_REJECTS: Record<string, string> = {
  OTROSERVICIO: 'Pasaje de otro servicio o de otro día',
  OTROSENTIDO: 'Pasaje del otro sentido',
  TRAMO: 'Su tramo no incluye esta parada',
  ANULADO: 'Pasaje anulado'
};

// used: códigos ya leídos en este viaje (el que llama agrega el código cuando el resultado es ok).
export function checkTestQr(payload: string, used: ReadonlySet<string>, route: string): ScanResult & { code: string | null } {
  const text = payload.trim();
  if (!text.toUpperCase().startsWith(TEST_PREFIX)) return { ok: false, title: 'QR inválido', detail: 'No es un pasaje de esta plataforma', code: null };
  const code = text.slice(TEST_PREFIX.length).trim().toUpperCase();
  if (TEST_REJECTS[code]) return { ok: false, title: 'Rechazado', detail: TEST_REJECTS[code], code };
  if (used.has(code)) return { ok: false, title: 'QR ya usado', detail: 'Este pasaje ya fue leído en este viaje', code };
  const n = /^OK(\d+)$/.exec(code);
  if (!n) return { ok: false, title: 'QR inválido', detail: 'Código de prueba desconocido', code };
  return { ok: true, title: `OK - Pasajero de prueba ${n[1]}`, detail: `${route} (prueba)`, code };
}
