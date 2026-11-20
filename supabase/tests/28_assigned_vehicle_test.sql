\set ON_ERROR_STOP on
select t.login('a1000000-0000-0000-0000-000000000001');
create temp table sv as select s.id as service_id, d.id as dep, d.departure_time
  from public.services s join public.service_departures d on d.service_id = s.id
 where s.company_id = 'aaaaaaaa-0000-0000-0000-000000000001' and d.active and s.active limit 1;
grant all on sv to authenticated;
select public.generate_trips(date '2027-05-04', 'weekday');
select t.logout();
select t.login('a1000000-0000-0000-0000-000000000001');
-- el admin publica y asigna unidad sin conductor
update public.trips set vehicle_id = '22222222-0000-0000-0000-000000000001', driver_id = null, published_at = now()
 where service_id = (select service_id from sv) and service_date = date '2027-05-04' and status = 'scheduled';
select t.logout();
-- cualquier conductor de la empresa ve la unidad asignada al servicio
select t.login('a3000000-0000-0000-0000-000000000001');
select t.expect_eq((select count(*) > 0 from public.service_assigned_vehicles((select service_id from sv), date '2027-05-04')), true, 'el conductor ve la unidad asignada al servicio');
select t.logout();
-- otra empresa no ve nada
select t.login('b1000000-0000-0000-0000-000000000001');
select t.expect_eq((select count(*) from public.service_assigned_vehicles((select service_id from sv), date '2027-05-04')), 0::bigint, 'otra empresa no ve unidades ajenas');
select t.logout();
\echo 'PRUEBAS DE UNIDAD ASIGNADA PASARON'
