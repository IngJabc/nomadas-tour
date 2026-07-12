# Backend — Sistema de Reservas de Viajes (API)

API que gestiona rutas, viajes, cupos por agencia y usuarios (superadmin / agencias / pasajeros) para la plataforma de reserva de boletos. Fuente de verdad del modelo de datos y las reglas de negocio; el frontend consume esta API.

## Stack

- Lenguaje: TypeScript estricto
- Framework / runtime: Node.js 22 + Express 5 (ajustar si el proyecto real usa Fastify/Nest)
- Base de datos: Supabase (PostgreSQL) + Row Level Security (RLS)
- Auth: Supabase Auth (JWT), roles gestionados vía tabla `profiles` + políticas RLS
- Tests: Vitest

## Comandos

- `npm run dev` — arranca el servidor en local
- `npm run test` — ejecuta los tests (deben pasar antes de cada commit)
- `npm run lint` — revisa el estilo (antes de cada PR)
- `npm run build` — compila para producción
- `npm run db:migrate` — aplica migraciones de Supabase (`supabase db push` o equivalente)

## Estructura del proyecto

- `src/routes/` — definición de endpoints Express, agrupados por dominio (auth, agencies, routes, trips, reservations)
- `src/controllers/` — orquestan request → service → response, sin lógica de negocio
- `src/services/` — lógica de negocio (asignación de cupos, validación de agencias, generación de invitaciones)
- `src/middlewares/` — auth (verificación JWT), authorize (chequeo de rol), error handler
- `src/db/` — cliente Supabase, migraciones SQL, políticas RLS versionadas
- `src/types/` — tipos compartidos (Role, Trip, Route, Agency, Invite, SeatAllocation)
- `src/errors/` — clases de error propias

## Modelo de datos y reglas de negocio (resumen para planificar)

**Roles** (`profiles.role`): `user` | `admin` | `superadmin`.

> Nota: se mantiene el valor interno `admin` en base de datos para no romper políticas RLS existentes; en el frontend ese rol se **muestra** como "Agencia". El superadmin es, conceptualmente, también una agencia (puede autoasignarse viajes).

**Tablas nuevas / modificadas:**

- `routes` (origin, destination, created_by → superadmin, timestamps). CRUD exclusivo de `superadmin`.
- `trips` (route_id FK, departure_time, total_seats, status, created_by). CRUD exclusivo de `superadmin`.
- `trip_agencies` (tabla puente): `trip_id`, `agency_id` (profiles.id con role=admin), `seats_assigned`. Constraint a nivel de servicio (y check en BD si es viable): `SUM(seats_assigned) <= trips.total_seats` por trip.
- `agency_invites`: `id`, `token` (único, aleatorio o JWT firmado), `created_by` (superadmin), `expires_at`, `used_at`, `used_by`. Es el único mecanismo válido para que un `admin`/agencia se autorregistre.

**Reglas de negocio clave:**

1. Solo `superadmin` puede crear/editar/borrar `routes`, `trips` y usuarios `admin` (agencias).
2. Un viaje se crea **después** de su ruta y siempre referencia una `route_id` existente.
3. Al crear/editar un viaje, el superadmin asigna una o más agencias vía búsqueda (select buscador), y un `seats_assigned` por cada una. Validar en el servicio que la suma no exceda `total_seats` antes de persistir.
4. **Aislamiento de datos entre agencias:** una agencia solo puede leer sus propias filas en `trip_agencies` (y, más adelante, sus propias reservas). Esto se refuerza con política RLS: `agency_id = auth.uid()` para role `admin`; `superadmin` sin restricción.
5. Registro de agencias: dos caminos —
   - Superadmin crea la agencia directamente (`POST /admin/agencies`).
   - Agencia se autorregistra vía link/QR: el link contiene un `token` de `agency_invites`; el endpoint de registro valida token no usado y no expirado, crea el `profile` con role `admin`, marca el token como usado. **No debe existir ningún registro de rol `admin` sin pasar por este flujo o por el superadmin.**
6. Reservas de asientos por agencia (pasajeros): fuera de alcance por ahora, dejar la tabla `trip_agencies` lista para que `reservations` referencie `trip_id` + `agency_id` más adelante.

## Endpoints previstos (nivel de planificación, ajustar nombres al confirmar)

- `POST /auth/register-agency?token=...` — autorregistro de agencia vía invitación
- `POST /admin/invites` — (superadmin) genera token + link/QR de invitación
- `GET|POST|PUT|DELETE /admin/agencies` — CRUD de agencias (superadmin)
- `GET /admin/agencies/:id` — detalle de agencia con sus viajes asignados
- `GET|POST|PUT|DELETE /admin/routes` — CRUD de rutas (superadmin)
- `GET|POST|PUT|DELETE /admin/trips` — CRUD de viajes (superadmin)
- `PUT /admin/trips/:id/agencies` — asigna/actualiza agencias + cupos de un viaje
- `GET /agency/trips` — viajes asignados a la agencia autenticada, con **solo su propio cupo** visible

## Convenciones

- camelCase para variables/funciones, PascalCase para tipos/clases.
- Tests al lado del archivo: `foo.service.ts` + `foo.service.test.ts`.
- Toda entrada de usuario se valida con Zod antes de tocar la base de datos.
- Errores de negocio como clases propias en `src/errors/` (ej. `SeatsExceededError`, `InvalidInviteTokenError`).
- Toda query sensible a rol pasa primero por RLS, no solo por chequeo en el controller (defensa en profundidad).

## No hagas

- No permitir que un rol `admin` (agencia) haga CRUD de `routes`, `trips` o de otras agencias — eso quedó exclusivo de `superadmin`.
- No exponer `seats_assigned` de una agencia a otra agencia en ninguna respuesta.
- No crear usuarios con role `admin` fuera del flujo de invitación o del panel de superadmin.
- No instalar dependencias nuevas sin avisar.
- No subir archivos `.env*` al repositorio.
- No usar `any` en TypeScript sin justificarlo en un comentario.

## Flujo de trabajo

- Antes de una tarea no trivial, propón un plan y espera mi OK.
- Una tarea a la vez; al terminar, dime qué cambiaste para que lo revise.
- Si no estás seguro al 80%, pregunta. No inventes el esquema de datos.

## Documentación

- Esquema y políticas RLS: `src/db/migrations/`
- Repo hermano (frontend): ver `frontend-AGENT.md`
