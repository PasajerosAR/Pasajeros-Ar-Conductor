import { supabase } from '../lib/supabase';

// Pasajeros a bordo y capacidad del vehículo del viaje.
export async function loadCounts(tripId: string, layoutId: string | null | undefined): Promise<{ onboard: number; capacity: number }> {
  const [o, c] = await Promise.all([
    supabase.rpc('trip_onboard', { p_trip: tripId }),
    layoutId ? supabase.from('seat_layout_capacity').select('seats').eq('layout_id', layoutId).maybeSingle() : Promise.resolve({ data: null, error: null })
  ]);
  return { onboard: Number(o.data ?? 0), capacity: Number((c.data as { seats: number } | null)?.seats ?? 0) };
}
