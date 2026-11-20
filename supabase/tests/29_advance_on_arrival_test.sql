\set ON_ERROR_STOP on
-- continua de 12: servicio 218 sabado; viaje de las 06:00 en curso (forzado). Se prueba la llegada automatica.
select t.login('a1000000-0000-0000-0000-000000000001');
select public.save_service(null, '219', true,
  '[{"route_id":"33333333-0000-0000-0000-000000000001","time":"07:00","day_types":["saturday"]},
    {"route_id":"33333333-0000-0000-0000-000000000001","time":"08:00","day_types":["saturday"]}]'::jsonb,
  '[{"route_stop_id":"44444444-0000-0000-0000-000000000001","minutes_from_start":0},
    {"route_stop_id":"44444444-0000-0000-0000-000000000002","minutes_from_start":20},
    {"route_stop_id":"44444444-0000-0000-0000-000000000003","minutes_from_start":100}]'::jsonb);
select public.generate_trips(date '2026-11-14', 'saturday');
select t.logout();
create temp table arr as
select s.id as service_id,
       (select d.id from public.service_departures d where d.service_id = s.id and d.departure_time = time '07:00') as cur,
       (select d.id from public.service_departures d where d.service_id = s.id and d.departure_time = time '08:00') as nxt
  from public.services s where s.code = '219';
grant all on arr to authenticated;
-- libera el viaje en curso que dejo la prueba 12
alter table public.trips disable trigger user;
update public.trips set status = 'completed', ended_at = now() where driver_id = 'a3000000-0000-0000-0000-000000000001' and status = 'in_progress';
alter table public.trips enable trigger user;
select t.login('a3000000-0000-0000-0000-000000000001');
select public.start_service((select service_id from arr), (select cur from arr), 'saturday',
  '22222222-0000-0000-0000-000000000002', 'Inicio de prueba de llegada', date '2026-11-14');
select public.register_count((select id from public.trips where departure_id = (select cur from arr) and service_date = date '2026-11-14'),
  'board', 2, '44444444-0000-0000-0000-000000000001', gen_random_uuid());
-- sin llegada ni forzado: sigue frenando
select t.expect_fail(format($q$select public.advance_service_trip(%L, %L, false)$q$,
  (select id from public.trips where departure_id = (select cur from arr) and service_date = date '2026-11-14'), (select nxt from arr)), 'ONBOARD_REMAINING');
-- llegada a la ultima parada: avanza igual con pasajeros a bordo
select public.advance_service_trip((select id from public.trips where departure_id = (select cur from arr) and service_date = date '2026-11-14'),
  (select nxt from arr), false, true);
select t.expect_eq((select status::text from public.trips where departure_id = (select nxt from arr) and service_date = date '2026-11-14'), 'in_progress', 'la llegada inicia el siguiente aunque queden pasajeros');
select t.expect_eq((select started_manually from public.trips where departure_id = (select nxt from arr) and service_date = date '2026-11-14'), false, 'la llegada automatica no queda como forzada');
select t.expect_eq((select status::text from public.trips where departure_id = (select cur from arr) and service_date = date '2026-11-14'), 'completed', 'cierra el viaje anterior');
select t.logout();
\echo 'PRUEBAS DE LLEGADA AUTOMATICA PASARON'
