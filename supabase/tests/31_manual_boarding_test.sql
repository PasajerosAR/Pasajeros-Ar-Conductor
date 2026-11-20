\set ON_ERROR_STOP on
-- continua de 27: pasaje de Ana Gomez (DNI 28999111) vendido en ventanilla en el viaje del conductor 2
create temp table mb as
 select k.trip_id, k.id as ticket_id, k.qr_code from public.sale_tickets k where regexp_replace(k.passenger_dni,'\D','','g') = '28999111' order by k.created_at desc limit 1;
grant all on mb to authenticated;
alter table public.trips disable trigger user;
update public.trips set status = 'completed', ended_at = now() where driver_id = 'a2000000-0000-0000-0000-000000000001' and status = 'in_progress';
update public.trips set status = 'in_progress', started_at = now() where id = (select trip_id from mb);
alter table public.trips enable trigger user;
select t.login('a2000000-0000-0000-0000-000000000001');
select t.expect_eq((public.lookup_ticket_by_dni((select trip_id from mb), '1234'))->>'title', 'DNI inválido', 'DNI inválido');
select t.expect_eq((public.lookup_ticket_by_dni((select trip_id from mb), '11111111'))->>'title', 'Sin pasaje', 'sin pasaje');
select t.expect_eq((public.lookup_ticket_by_dni((select trip_id from mb), '28.999.111'))->>'passenger_name', 'Ana Gomez', 'encuentra al pasajero por DNI');
select t.expect_eq(((public.lookup_ticket_by_dni((select trip_id from mb), '28999111'))->>'can_board')::boolean, true, 'puede subir');
-- QR leido sin GPS: el conductor confirma
select t.expect_eq((public.confirm_ticket_boarding((select trip_id from mb), 'no-existe', null, gen_random_uuid()))->>'code', 'INVALID_TICKET', 'QR desconocido');
select t.expect_eq(((public.confirm_ticket_boarding((select trip_id from mb), (select qr_code from mb), null, gen_random_uuid()))->>'ok')::boolean, true, 'confirma el ascenso sin GPS');
select t.expect_eq((select status from public.sale_tickets where id = (select ticket_id from mb)), 'boarded', 'el pasaje queda abordado');
select t.expect_eq((select boarding_override from public.sale_tickets where id = (select ticket_id from mb)), true, 'queda registrado como autorizado a mano');
select t.expect_eq(((public.lookup_ticket_by_dni((select trip_id from mb), '28999111'))->>'can_board')::boolean, false, 'ya no se puede volver a subir');
select t.expect_eq((public.board_ticket_by_dni((select trip_id from mb), '28999111', null, gen_random_uuid()))->>'code', 'INVALID_TICKET', 'no hay mas pendientes con ese DNI');
select t.logout();
-- otro conductor no ve ni valida ese viaje
select t.login('a3000000-0000-0000-0000-000000000001');
select t.expect_fail(format($q$select public.lookup_ticket_by_dni(%L, '28999111')$q$, (select trip_id from mb)), 'NOT_FOUND');
select t.logout();
select 'PRUEBAS DE ASCENSO MANUAL PASARON';
