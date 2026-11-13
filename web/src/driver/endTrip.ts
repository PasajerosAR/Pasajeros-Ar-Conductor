import { supabase } from '../lib/supabase';
import { errorCode, friendly } from '../lib/errors';

// Finaliza un viaje, siempre con confirmación. Si quedan pasajeros a bordo pide confirmación antes de forzar el cierre.
// Devuelve null si terminó, o el mensaje de error.
export async function endTripConfirm(tripId: string): Promise<string | null> {
  if (!window.confirm('¿Seguro que querés finalizar el viaje? Si fue un error, podés retomarlo desde "Iniciar servicio".')) return null;
  const { error } = await supabase.rpc('end_trip', { p_trip: tripId, p_force: false });
  if (!error) return null;
  if (errorCode(error) === 'ONBOARD_REMAINING') {
    if (!window.confirm(`${friendly(error)}. Finalizar el viaje igual?`)) return null;
    const forced = await supabase.rpc('end_trip', { p_trip: tripId, p_force: true });
    return forced.error ? friendly(forced.error) : null;
  }
  return friendly(error);
}
