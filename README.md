# Plataforma de transporte - Fase 1 (nucleo operativo)

Stack: TypeScript + React (Vite) + Supabase (Postgres, Auth, Edge Functions).

## Que incluye

- **Base de datos** (`supabase/migrations`): empresas, perfiles y roles, flota, disposiciones de asientos
  versionadas, recorridos, servicios, viajes, jornadas, contador de pasajeros, QR de prueba y auditoria. Aislamiento
  entre empresas con RLS; la logica critica esta en funciones del servidor.
- **Panel admin** (`/admin`): operacion del dia, servicios, recorridos, flota, editor visual de
  disposiciones de asientos, conductores y seguimiento GPS en vivo.
- **App del conductor** (`/conductor`): jornada, viajes del dia, iniciar y finalizar viaje, puntualidad,
  contador y QR de prueba. Durante un viaje en curso, el conductor puede forzar el sentido de la
  proxima salida. Cuando el GPS confiable detecta que la unidad permanecio en la ultima parada, si hay otra
  salida del mismo dia, el sistema finaliza el viaje actual e inicia el siguiente en una operacion atomica,
  conservando conductor y unidad. Cada viaje mantiene su propio conteo; un cambio forzado avisa si quedan
  pasajeros registrados, conserva ese conteo en el viaje cerrado e inicia el siguiente en cero. El ultimo
  viaje se finaliza manualmente y la jornada permanece abierta hasta su cierre por separado.
- Los servicios se eliminan por completo solo si no tienen viajes asociados; el inicio del conductor permite elegir la fecha, incluso para salidas de medianoche.

**Puntualidad:** el horario a cumplir es el de la carga del servicio (salida programada + minutos de cada parada).
Antes de la salida se muestra la cuenta regresiva (+11, +10 ... 0). Desde la hora programada el adelanto (+) o atraso (-)
lo calcula el GPS del telefono contra ese horario. La hora en que el chofer se conecto es solo referencia. No hay horas
estimadas. Para seguimiento administrativo solo se conserva la ultima ubicacion del viaje activo (se actualiza cada 15
segundos y se elimina al finalizarlo o cambiar de conductor); no se guarda un historial GPS.

No incluye todavia: venta comercial de pasajes, pagos, pasajero, offline ni la app Android (Capacitor). Los pasajes y QR disponibles en esta fase son exclusivamente de prueba.

## Puesta en marcha

1. Crear un proyecto en Supabase.
2. Aplicar en orden `0001_core.sql` a `0017_automatic_trip_advance.sql` de `supabase/migrations` (SQL Editor o `supabase db push`). No usar `supabase/setup_completo.sql`: es un instalador legado que no incluye las migraciones nuevas. En especial, `0009_seat_classes_and_vehicle_kinds.sql` agrega `layout_cells.seat_class`; si el panel muestra que falta esa columna, esa migración aún no se aplicó. La `0011` habilita borrar servicios sin viajes y seleccionar la fecha al iniciarlos. La `0012` agrega QR únicamente de prueba y permite autorizar desde el escáner un ascenso en otra parada; conserva la parada comprada, la real y quién autorizó. El servidor obtiene la parada real desde el GPS, exige una ubicación reciente (15 segundos), precisa (hasta 50 m) y a no más de 80 m de una parada, y rechaza recorridos con coordenadas incompletas o paradas ambiguas. Esa ubicación se usa solo durante la validación QR. La `0013` permite relevar o retomar un viaje con motivo obligatorio; mantiene el mismo viaje y sus conteos, y deja el cambio auditado. Las migraciones `0014` y `0015` habilitan seguimiento GPS administrativo: solo aceptan posiciones recientes del conductor asignado al viaje activo, mantienen una fila por viaje, entregan los horarios y coordenadas necesarios para calcular puntualidad, y eliminan la posición al finalizar o relevarlo. La `0016` habilita guardar indicaciones de giro calculadas al trazar cada recorrido; para poblar recorridos existentes, abrirlos y guardarlos nuevamente en el editor. La `0017` agrega el cambio atomico al siguiente viaje y conserva conductor y unidad; cada viaje conserva su propio conteo y el cambio forzado queda auditado, incluso si hay pasajeros registrados a bordo. El GPS del teléfono puede falsificarse y no es una prueba criptográfica. Si ya existe `tickets`, la `0012` la actualiza agregando campos sin borrar sus datos. No conecta ventas reales ni acepta los QR JSON del prototipo público.
3. Desplegar las funciones: `supabase functions deploy create-driver` y `supabase functions deploy create-company-admin`.
4. Copiar `web/.env.example` a `web/.env.local` y completar URL y anon key.
5. Crear el administrador general (una sola vez): crear el usuario en Authentication > Users y en el SQL Editor:
   ```sql
   insert into profiles (id, company_id, role, full_name)
   values ('<id del usuario>', null, 'platform_admin', 'Tu nombre');
   ```
   Desde ahi, las empresas y sus administradores se crean en el panel (`/admin`, seccion Empresas).
6. `cd web && npm install && npm run dev`.

## Quien hace que

- Administrador general (vos): crea empresas y su administrador, carga las localidades (origen/destino que elige el pasajero) y los recorridos (paradas con localidad y coordenadas, trazado por calles y puntos de paso), cada uno asignado en exclusiva a una empresa. En seguimiento GPS ve solo viajes activos y su ultima ubicacion.
- Administrador de empresa: crea flota, disposiciones, conductores y servicios. Cada servicio (por ejemplo "214") agrupa varias salidas de ida y vuelta, cada una con su horario y sus días; los tiempos por parada se definen por sentido.
- Las disposiciones asignadas a unidades se pueden eliminar tras reasignar esas unidades a otra grilla o a una copia. Las vinculadas a viajes anteriores se conservan para no perder la configuración histórica.

## Pruebas

- Logica de asientos y puntualidad: `cd web && npm test`
- Base de datos (Postgres local, sin Supabase): `supabase/tests/run.sh`
  Simula el esquema `auth` de Supabase y prueba aislamiento entre empresas, bloqueo y versionado de
  disposiciones, jornada, viajes, contador y pasajes de prueba (idempotencia, autorización auditada,
  QR inválidos/anulados/reutilizados, relevo/reapertura auditados, seguimiento GPS, cambio atomico de viaje
  y aislamiento entre empresas).

## Que NO esta probado

- Las pantallas contra un proyecto de Supabase real (solo se probo que compilan y cargan).
- Las Edge Functions `create-driver` y `create-company-admin` (necesitan un proyecto real).
- Los permisos de la tabla `auth.users` y la configuracion de roles propia de Supabase: el arnes local los imita.

## Pendiente conocido

- Franjas manana/tarde/noche fijas en la app del conductor (el prompt las pide configurables por empresa).
- Correccion de conteos por un administrador (hoy el contador solo agrega registros).
- Administracion general de la plataforma (rol `platform_admin`).
