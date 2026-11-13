\set ON_ERROR_STOP on

insert into public.vehicles (id, company_id, kind, internal_number, plate)
values ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'combi', '13', 'AA222AA');

select t.login('a1000000-0000-0000-0000-000000000001');
select public.save_service(null, '218', true,
  '[{"route_id":"33333333-0000-0000-0000-000000000001","time":"05:00","day_types":["saturday"]},
    {"route_id":"33333333-0000-0000-0000-000000000001","time":"06:00","day_types":["saturday"]}]'::jsonb,
  '[{"route_stop_id":"44444444-0000-0000-0000-000000000001","minutes_from_start":0},
    {"route_stop_id":"44444444-0000-0000-0000-000000000002","minutes_from_start":20},
    {"route_stop_id":"44444444-0000-0000-0000-000000000003","minutes_from_start":100}]'::jsonb);
select public.generate_trips(date '2026-11-14', 'saturday');
select t.logout();

create temp table advance_fixture as
select s.id as service_id,
       (select d.id from public.service_departures d where d.service_id = s.id and d.departure_time = time '05:00') as current_departure,
       (select d.id from public.service_departures d where d.service_id = s.id and d.departure_time = time '06:00') as next_departure
  from public.services s
 where s.code = '218';
grant all on advance_fixture to authenticated;

select t.login('a3000000-0000-0000-0000-000000000001');
select public.start_shift();
select public.start_service(
  (select service_id from advance_fixture),
  (select current_departure from advance_fixture),
  'saturday',
  '22222222-0000-0000-0000-000000000002',
  'Inicio de prueba automatica',
  date '2026-11-14'
);
create temp table active_fixture as
select id from public.trips
 where departure_id = (select current_departure from advance_fixture)
   and service_date = date '2026-11-14';
grant all on active_fixture to authenticated;

select public.register_count((select id from active_fixture), 'board', 1,
  '44444444-0000-0000-0000-000000000001', gen_random_uuid());
select t.expect_fail(format(
  $q$select public.advance_service_trip(%L, %L, false)$q$,
  (select id from active_fixture),
  (select next_departure from advance_fixture)
), 'ONBOARD_REMAINING');

create temp table advanced_fixture as
select public.advance_service_trip(
  (select id from active_fixture),
  (select next_departure from advance_fixture),
  true
) as trip;
grant all on advanced_fixture to authenticated;

select t.expect_eq((select status::text from public.trips where id = (select id from active_fixture)), 'completed',
  'cierra el viaje anterior');
select t.expect_eq(public.trip_onboard((select id from active_fixture)), 1,
  'conserva en el viaje cerrado el conteo que se forzo');
select t.expect_eq((select status::text from public.trips
  where departure_id = (select next_departure from advance_fixture) and service_date = date '2026-11-14'), 'in_progress',
  'inicia automaticamente la siguiente salida');
select t.expect_eq(public.trip_onboard((select id from public.trips
  where departure_id = (select next_departure from advance_fixture) and service_date = date '2026-11-14')), 0,
  'el siguiente viaje comienza con el conteo en cero');
select t.expect_eq((select (trip).id from advanced_fixture),
  (select id from public.trips where departure_id = (select next_departure from advance_fixture) and service_date = date '2026-11-14'),
  'devuelve el nuevo viaje para abrir la pantalla de navegacion');
select t.expect_eq((select driver_id::text from public.trips
  where departure_id = (select next_departure from advance_fixture) and service_date = date '2026-11-14'), auth.uid()::text,
  'conserva el conductor al cambiar de viaje');
select t.expect_eq((select vehicle_id::text from public.trips
  where departure_id = (select next_departure from advance_fixture) and service_date = date '2026-11-14'),
  '22222222-0000-0000-0000-000000000002', 'conserva la unidad al cambiar de viaje');
select t.expect_eq((select started_manually from public.trips
  where departure_id = (select next_departure from advance_fixture) and service_date = date '2026-11-14'), true,
  'deja constancia de que el conductor forzo el sentido');
select t.expect_eq((select start_reason from public.trips
  where departure_id = (select next_departure from advance_fixture) and service_date = date '2026-11-14'),
  'Cambio de sentido forzado durante el viaje', 'registra el motivo del cambio forzado');
select t.expect_eq((select count(*) from public.trips where service_id = (select service_id from advance_fixture)
  and service_date = date '2026-11-14'), 2::bigint, 'no duplica los viajes del servicio');
select t.logout();

\echo 'PRUEBAS DE CAMBIO AUTOMATICO DE VIAJE PASARON'
