import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { friendly } from '../lib/errors';
import { must, useQuery } from '../lib/useQuery';
import { Loading, Notice } from '../ui';
import { useAuth } from '../auth/AuthProvider';
import type { SeatLayout } from '../lib/types';

interface LayoutDeleteResult {
  deleted: boolean;
  replacement_id: string | null;
  reassigned_vehicles: number;
  retained_for_history: boolean;
}

function isLayoutDeleteResult(value: unknown): value is LayoutDeleteResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return typeof result.deleted === 'boolean'
    && (result.replacement_id === null || typeof result.replacement_id === 'string')
    && Number.isInteger(result.reassigned_vehicles)
    && typeof result.retained_for_history === 'boolean';
}

export function LayoutsPage() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'company_admin';
  const [pendingDelete, setPendingDelete] = useState<SeatLayout | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const [createCopy, setCreateCopy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const layouts = useQuery(async () => must(await supabase.from('seat_layouts').select('*').order('name').order('version', { ascending: false })) as SeatLayout[], []);
  const caps = useQuery(async () => must(await supabase.from('seat_layout_capacity').select('layout_id,seats')) as { layout_id: string; seats: number }[], []);
  const vehicles = useQuery(async () => must(await supabase.from('vehicles').select('id,internal_number,layout_id')) as { id: string; internal_number: string; layout_id: string | null }[], []);
  const config = useQuery(async () => {
    const [floorsResult, classesResult] = await Promise.all([
      supabase.from('layout_floors').select('layout_id,floor'),
      supabase.from('layout_cells').select('layout_id,seat_class').eq('kind', 'seat')
    ]);
    return {
      floors: must(floorsResult) as { layout_id: string; floor: number }[],
      classes: must(classesResult) as { layout_id: string; seat_class: string }[]
    };
  }, []);
  const seatsOf = (id: string) => caps.data?.find((c) => c.layout_id === id)?.seats ?? 0;
  const assignedVehiclesOf = (id: string) => (vehicles.data ?? []).filter((vehicle) => vehicle.layout_id === id);
  const configOf = (id: string) => {
    const floorCount = new Set((config.data?.floors ?? []).filter((f) => f.layout_id === id).map((f) => f.floor)).size;
    const classes = [...new Set((config.data?.classes ?? []).filter((c) => c.layout_id === id).map((c) => c.seat_class))];
    return `${floorCount || '-'} ${floorCount === 1 ? 'piso' : 'pisos'} · ${classes.join(', ') || 'Sin asientos'}`;
  };

  const openDelete = (layout: SeatLayout) => {
    setPendingDelete(layout);
    setReplacementId('');
    setCreateCopy(false);
    setActionMsg(null);
  };

  const deleteLayout = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setActionMsg(null);
    const { data, error } = await supabase.rpc('delete_seat_layout', {
      p_layout: pendingDelete.id,
      p_replacement: createCopy ? null : replacementId || null,
      p_create_copy: createCopy
    });
    setDeleting(false);
    if (error) {
      setActionMsg({ kind: 'error', text: friendly(error) });
      return;
    }
    if (!isLayoutDeleteResult(data)) {
      setActionMsg({ kind: 'error', text: 'El servidor devolvió una respuesta inválida al eliminar la disposición.' });
      return;
    }

    const changed = data.reassigned_vehicles;
    const text = data.deleted
      ? changed > 0 ? `Disposición eliminada. ${changed} ${changed === 1 ? 'unidad reasignada' : 'unidades reasignadas'}.` : 'Disposición eliminada.'
      : `Se reasignaron ${changed} ${changed === 1 ? 'unidad' : 'unidades'}. La disposición se conserva para los viajes históricos.`;
    setActionMsg({ kind: 'ok', text });
    setPendingDelete(null);
    layouts.reload();
    caps.reload();
    config.reload();
    vehicles.reload();
  };

  const canDelete = (layout: SeatLayout) => !layouts.loading && !caps.loading && !vehicles.loading && !config.loading
    && !layouts.error && !caps.error && !vehicles.error && !config.error
    && (!layout.locked_at || assignedVehiclesOf(layout.id).length > 0);

  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <h1>Disposiciones de asientos</h1>
        {canEdit && <Link to="/admin/disposiciones/nueva"><button>Nueva disposición</button></Link>}
      </div>
      {layouts.error && <Notice>{layouts.error}</Notice>}
      {caps.error && <Notice>{caps.error}</Notice>}
      {vehicles.error && <Notice>{vehicles.error}</Notice>}
      {config.error && <Notice>{config.error}</Notice>}
      {actionMsg && <Notice kind={actionMsg.kind}>{actionMsg.text}</Notice>}
      {pendingDelete && (
        <section className="card stack" role="region" aria-labelledby="delete-layout-title">
          <h2 id="delete-layout-title">Eliminar {pendingDelete.name} · v{pendingDelete.version}</h2>
          {assignedVehiclesOf(pendingDelete.id).length > 0 ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {assignedVehiclesOf(pendingDelete.id).length} {assignedVehiclesOf(pendingDelete.id).length === 1 ? 'unidad usa' : 'unidades usan'} esta disposición. Elegí otra disposición con asientos o creá una copia; no se dejarán unidades sin plano.
                {pendingDelete.locked_at && ' Los viajes anteriores conservarán su plano y esta disposición se mantendrá como histórico.'}
              </p>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="radio" name="layout-replacement" checked={!createCopy} onChange={() => setCreateCopy(false)} style={{ width: 18, minHeight: 18 }} />
                Reasignar a una disposición existente
              </label>
              <select aria-label="Disposición de reemplazo" value={replacementId} disabled={createCopy} onChange={(event) => setReplacementId(event.target.value)}>
                <option value="">Elegir disposición...</option>
                {(layouts.data ?? []).filter((layout) => layout.id !== pendingDelete.id && seatsOf(layout.id) > 0).map((layout) => (
                  <option key={layout.id} value={layout.id}>{layout.name} (v{layout.version})</option>
                ))}
              </select>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="radio" name="layout-replacement" checked={createCopy} onChange={() => setCreateCopy(true)} style={{ width: 18, minHeight: 18 }} />
                Crear una copia de esta disposición y asignarla a las unidades
              </label>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No hay unidades asignadas.
              {pendingDelete.locked_at
                ? ' No puede eliminarse porque hay viajes históricos asociados.'
                : ' Se borrará el plano guardado.'}
            </p>
          )}
          <div className="row">
            <button type="button" className="danger" onClick={() => { void deleteLayout(); }}
              disabled={deleting || (pendingDelete.locked_at && assignedVehiclesOf(pendingDelete.id).length === 0)
                || (assignedVehiclesOf(pendingDelete.id).length > 0 && !createCopy && !replacementId)}>
              {deleting ? 'Procesando...' : pendingDelete.locked_at ? 'Reasignar unidades y conservar histórico' : 'Confirmar eliminación'}
            </button>
            <button type="button" className="secondary" disabled={deleting} onClick={() => setPendingDelete(null)}>Cancelar</button>
          </div>
        </section>
      )}
      <div className="card table-wrap">
        {layouts.loading ? <Loading /> : (
          <table>
            <thead><tr><th>Nombre</th><th>Versión</th><th>Asientos</th><th>Pisos y categorías</th><th>Unidades</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {(layouts.data ?? []).length === 0 && <tr><td colSpan={7} className="muted">Todavía no hay disposiciones. Creá una para cada tipo de vehículo.</td></tr>}
              {(layouts.data ?? []).map((l) => (
                <tr key={l.id}>
                  <td><b>{l.name}</b></td>
                  <td>v{l.version}</td>
                  <td>{seatsOf(l.id)}</td>
                  <td>{configOf(l.id)}</td>
                  <td>{assignedVehiclesOf(l.id).length}</td>
                  <td>{l.locked_at ? <span className="pill warn">Viajes asociados: histórico inmutable</span> : <span className="pill ok">Editable</span>}</td>
                  <td>
                    <div className="row">
                      <Link to={`/admin/disposiciones/${l.id}`}><button className="secondary">{canEdit ? 'Abrir' : 'Ver'}</button></Link>
                      {canEdit && <button type="button" className="danger" disabled={!canDelete(l)} onClick={() => openDelete(l)}>Eliminar</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
