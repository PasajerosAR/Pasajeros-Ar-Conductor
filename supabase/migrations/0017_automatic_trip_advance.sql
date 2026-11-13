-- Cierra un viaje y comienza el siguiente del mismo servicio en una transaccion.
-- El conductor y la unidad se conservan; los conteos siguen separados por viaje.
create function public.advance_service_trip(p_trip uuid, p_next_departure uuid, p_force boolean default false) returns public.trips
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_trip public.trips;
  v_next public.trips;
  v_departure public.service_departures;
  v_vehicle public.vehicles;
  v_onboard int;
  v_scheduled timestamptz;
  v_next_exists boolean := false;
begin
  if public.current_user_role() <> 'driver' then raise exception 'FORBIDDEN'; end if;

  select * into v_trip
    from public.trips
   where id = p_trip and driver_id = auth.uid() and company_id = v_company
   for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_trip.status <> 'in_progress' then raise exception 'INVALID_STATE: el viaje no esta en curso'; end if;
  if v_trip.vehicle_id is null then raise exception 'NO_VEHICLE: el viaje no tiene unidad asignada'; end if;
  if not exists (select 1 from public.shifts where driver_id = auth.uid() and ended_at is null) then
    raise exception 'NO_OPEN_SHIFT: inicie la jornada primero';
  end if;
  if exists (select 1 from public.trips where driver_id = auth.uid() and status = 'in_progress' and id <> p_trip) then
    raise exception 'TRIP_IN_PROGRESS: ya tiene otro viaje en curso';
  end if;
  if exists (select 1 from public.trips where vehicle_id = v_trip.vehicle_id and status = 'in_progress' and id <> p_trip) then
    raise exception 'VEHICLE_BUSY: la unidad ya tiene otro viaje en curso';
  end if;

  v_onboard := public.trip_onboard(p_trip);
  if v_onboard > 0 and not p_force then
    raise exception 'ONBOARD_REMAINING: quedan % pasajeros registrados a bordo', v_onboard;
  end if;

  select d.* into v_departure
    from public.service_departures d
    join public.services s on s.id = d.service_id
   where d.id = p_next_departure
     and d.service_id = v_trip.service_id
     and d.company_id = v_company
     and d.active and s.active
     and v_trip.day_type = any(d.day_types);
  if not found then raise exception 'NEXT_TRIP_INVALID: la proxima salida no pertenece al servicio o no circula hoy'; end if;
  if p_next_departure = v_trip.departure_id then
    raise exception 'NEXT_TRIP_INVALID: la proxima salida debe ser distinta al viaje actual';
  end if;

  v_scheduled := (v_trip.service_date + v_departure.departure_time) at time zone 'America/Argentina/Buenos_Aires';
  if v_scheduled <= v_trip.scheduled_departure then
    raise exception 'NEXT_TRIP_INVALID: el horario siguiente debe ser posterior al viaje actual';
  end if;

  select * into v_vehicle from public.vehicles
   where id = v_trip.vehicle_id and company_id = v_company;
  if not found then raise exception 'NO_VEHICLE: no se encontro la unidad del viaje'; end if;

  select * into v_next from public.trips
   where departure_id = p_next_departure and service_date = v_trip.service_date
   for update;
  v_next_exists := found;
  if v_next_exists then
    if v_next.status <> 'scheduled' then
      raise exception 'NEXT_TRIP_UNAVAILABLE: la proxima salida ya fue iniciada o finalizada';
    end if;
    if v_next.driver_id is not null and v_next.driver_id <> auth.uid() then
      raise exception 'NEXT_TRIP_TAKEN: la proxima salida esta asignada a otro conductor';
    end if;
    if v_next.vehicle_id is not null and v_next.vehicle_id <> v_trip.vehicle_id then
      raise exception 'NEXT_TRIP_VEHICLE: la proxima salida esta asignada a otra unidad';
    end if;
  end if;

  perform set_config('app.trip_rpc', 'on', true);
  update public.trips set status = 'completed', ended_at = now()
   where id = p_trip;

  if v_next_exists then
    update public.trips
       set driver_id = auth.uid(),
           vehicle_id = v_trip.vehicle_id,
           layout_id = v_vehicle.layout_id,
           day_type = v_trip.day_type,
           status = 'in_progress',
           started_at = now(),
           ended_at = null,
           started_manually = p_force,
           start_reason = case when p_force then 'Cambio de sentido forzado durante el viaje' end
     where id = v_next.id
     returning * into v_next;
  else
    insert into public.trips (
      company_id, service_id, departure_id, service_date, scheduled_departure,
      day_type, vehicle_id, layout_id, driver_id, status, started_at, started_manually, start_reason
    )
    values (
      v_company, v_trip.service_id, p_next_departure, v_trip.service_date, v_scheduled,
      v_trip.day_type, v_trip.vehicle_id, v_vehicle.layout_id, auth.uid(), 'in_progress', now(),
      p_force, case when p_force then 'Cambio de sentido forzado durante el viaje' end
    )
    returning * into v_next;
  end if;

  return v_next;
end $$;

revoke all on function public.advance_service_trip(uuid, uuid, boolean) from public, anon;
grant execute on function public.advance_service_trip(uuid, uuid, boolean) to authenticated;
notify pgrst, 'reload schema';
