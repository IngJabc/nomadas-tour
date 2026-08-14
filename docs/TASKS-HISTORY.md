# Historial de tareas completadas

> **Archivo histórico.** Este documento preserva el detalle de sprints ya ejecutados.  
> **Sprint actual y próximas tareas:** [`TASKS.md`](../TASKS.md)  
> **Visión de producto:** [`ROADMAP.md`](ROADMAP.md)

---

[x] ActivityWidget — Reemplazar toggle "Ver más/menos" por paginación tipo Gmail (flechas + "1–4 de N")
[x] ActivityWidget — Agregar animación Framer Motion en transición de página
[x] ActivityWidget — AnimatePresence mode="wait" con slide horizontal (direccional según flecha)
[x] Realtime callback — Corregir stale closure: agregar userIdRef, usar refs en lugar de closure
[x] Realtime callback — Eliminar console.log de debug
[x] ReservationChart — Cambiar título a "Reservas de <Mes actual>" con date-fns locale es
[x] ReservationChart — Backend: cambiar query de últimos 30 días a mes calendario actual

# COMPLETADAS

## DESIGN SYSTEM

[x] Sprint 1 - Foundation

[x] Sprint 2 - UI Components

[x] Sprint 2.1 — Cleanup Design System

- EmptyState: ` <a> → <Link>` para navegación SPA
- Input: soporte `icon` y `iconPosition` (left/right)
- Reservations: input de búsqueda migrado a `<Input icon={<Search />} />`
- Trips: `ActionButton`/`MobileActionButton` eliminados, reemplazados por `<Button>`
- Scan: input QR manual migrado a `<Input>` (ya usaba componente)
- Imports no usados eliminados (`ArrowRight`)

[x] Sprint 3 — Layout

- `components/layout/Topbar.tsx` — barra contextual con saludo, fecha/hora en vivo, notificaciones
- `components/layout/DashboardLayout.tsx` — wrapper sidebar + main content area
- Layouts admin/agency refactorizados para usar DashboardLayout
- Admin dashboard: Topbar + zonas Quick Actions / Información viva / Actividad reciente (4-zone)
- Agency dashboard: Topbar + StatCards + secciones de viajes + Actividad reciente
- Padding unificado a `max-w-[1600px] mx-auto px-8 py-8`

[x] Sprint 3.1 — Dashboard Polish + Design System Compliance

- `DashboardLayout.tsx`: `bg-[#f1f5f9]` → `bg-[var(--color-page-bg)]` — token correcto
- `Topbar.tsx`: `rounded-lg` → `rounded-xl` (consistencia border-radius), `bg-slate-100` → `bg-[#f1f5f9]`
- `lib/utils/greeting.ts`: helper `getGreeting()` con saludo según hora (mañana/tarde/noche)
- `admin/page.tsx` + `agency/page.tsx`: greetings dinámicos, `notificationCount` eliminado (no hardcodeado)
- `agency/page.tsx`: EmptyState sin CTA corregido — ahora redirige a /agency/reservations
- `admin/bookings/page.tsx`: migrado al DS — PageHeader, StatCard, Badge, Button, Input, EmptyState, Lucide icons, CSS variables
- `admin/agencies/page.tsx`: migrado al DS — PageHeader, Button, Badge, EmptyState, Lucide icons, CSS variables, modales estilizados con tokens
- `admin/scan/page.tsx`: migrado al DS — Card, Button, Badge, Input, SectionTitle, Spinner, Lucide icons, CSS variables
- `admin/page.tsx`: migrado a `adminApi.getDashboard()` (endpoint único), `console.error` agregado al catch

[x] Sprint 3.2 — Design System Hardening

- **Button**: agregado `feedback` prop (`'success' | 'error' | null`) con iconos Check/X y colores de estado
- **Input**: `icon`/`iconPosition` reemplazado por `leftIcon`/`rightIcon`, agregado `helperText`
- **EmptyState**: verificado — ya usa `<Link>` para navegación SPA
- **Card**: verificado — `borderLeft`/`borderColor` y `hover` props funcionan correctamente
- **Colores hardcodeados reemplazados** (12 archivos):
  - `Topbar.tsx`: `bg-[#f1f5f9]` → `bg-[var(--color-page-bg)]`
  - `BookingPanel.tsx`: `#f1f5f9` → `var(--color-page-bg)`
  - `admin/trips/page.tsx`: `bg-[#f1f5f9]` → `bg-[var(--color-page-bg)]`
  - `admin/routes/page.tsx`: `bg-[#f1f5f9]` → `bg-[var(--color-page-bg)]`
  - `admin/scan/page.tsx`: `#00D4FF`/`#0080FF` → `var(--color-brand-cyan)`/`var(--color-brand-blue)`, `bg-[#f1f5f9]` → `bg-[var(--color-page-bg)]`
  - `admin/bookings/page.tsx`: `bg-[#f1f5f9]` → `bg-[var(--color-page-bg)]`
  - `admin/agencies/page.tsx`: `bg-[#f1f5f9]` → `bg-[var(--color-page-bg)]`
  - `agency/scan/page.tsx`: `#00D4FF`/`#0080FF` → `var(--color-brand-cyan)`/`var(--color-brand-blue)`
- **font-family inline**: auditado — UI components ya usan `var(--font-body)`/`var(--font-heading)`, páginas complejas no se modificaron por seguridad
- **tailwind-merge + cn()**: verificado — funciona con tokens personalizados y variantes CVA sin problemas
- **Migración Input API**: `admin/bookings/page.tsx` y `agency/reservations/page.tsx` actualizados de `icon` → `leftIcon`
- **npm run typecheck**: 0 errores
- **npm run build**: Compiled successfully, 19 rutas, 0 errores

[x] Sprint 4 — Dashboard Intelligence

- MetricWidget (reutilizado StatCard existente)
- ActivityWidget
- Timeline
- ListWidget
- ReservationChart con Recharts
- OccupancyChart con Recharts
- Admin Dashboard con métricas reales
- Agency Dashboard con métricas reales
- Endpoint GET /api/admin/dashboard extendido
- Endpoint GET /api/agency/dashboard creado con aislamiento multi-tenant
- Dashboard filtrado correctamente por agencia autenticada

[x] Sprint 7 — Refinamiento y Calidad del Producto

- **7.1 Responsive**: `px-8` → `px-4 sm:px-8` en admin/agency dashboards y bookings; KPI grid `grid-cols-3` → `grid-cols-1 sm:grid-cols-3` en agency/reservations; mobile card fallback para tablas en agency/reservations y admin/invitations
- **7.2 Accesibilidad**: `<main>` landmark agregado a 8 páginas; `<div onClick>` en admin/bookings convertido a `role="button"` con teclado (`tabIndex`, `onKeyDown`); `focus-visible` outlines en elementos interactivos
- **7.3 Skeletons & Loading**: Spinner centrado reemplazado por `TableSkeleton` en admin/trips y admin/routes; inline skeletons reemplazados por `CardSkeleton` en admin/agencies y agency/reservations; raw CSS spinner reemplazado por `CardSkeleton` en admin/trips/new; `loading` prop agregado a StatCards en agency/reservations
- **7.4 Empty States**: admin/invitations migrado de custom inline empty state a `EmptyState` compartido con icono `Mail`, CTA `Crear primera invitación`; header y botón migrados a `PageHeader` + `Button`
- **7.5 Performance**: Auditado — sin renders innecesarios evidentes, sin componentes client excesivos
- **7.6 Limpieza**: `loadingState` muerto eliminado de `BookingPanel.tsx` (variable setteada pero nunca leída); sin `console.log` en frontend
- **Validaciones**: `tsc --noEmit` ✓ 0 errores, `next build` ✓ Compiled successfully, 19 rutas

[x] Sprint 5 — Form System

- **Componentes creados**: `components/form/Field`, `Label`, `HelperText`, `ErrorText`, `FormSection`, `FormGrid`
- **Formularios migrados**:
  - `app/admin/agencies/page.tsx`: create/edit modal — labels reemplazadas por `Field`
  - `app/admin/routes/page.tsx`: create form — error reemplazado por `ErrorText`
  - `components/admin/TripForm.tsx`: labels reemplazadas por `Field`, grid reemplazado por `FormGrid`, error reemplazado por `ErrorText`
- **Validaciones**: `tsc --noEmit` ✓ 0 errores, `next build` ✓ Compiled successfully, 19 rutas

[x] Sprint 6 — Migración de páginas al DS

- admin/: ✅ Topbar + Quick Actions + KPI + Actividad reciente
- admin/trips: ✅ PageHeader, Badge, Button, EmptyState, ConfirmModal
- admin/routes: ✅ SectionTitle, Input, EmptyState, Button
- admin/bookings: ✅ PageHeader, StatCard, Badge, Input, EmptyState, Lucide
- admin/agencies: ✅ PageHeader, Button, Badge, EmptyState, Lucide, modales con tokens
- admin/scan: ✅ Card, Button, Badge, Input, SectionTitle, Spinner, Lucide
- agency/: ✅ Topbar + Quick Actions + StatCards + viajes + Actividad reciente
- agency/reservations: ✅ PageHeader, StatCard, Badge, Button, Input, EmptyState
- agency/scan: ✅ Card, Button, Badge, Input, SectionTitle, Spinner, Lucide

[x] Sprint - Vehicle Layout System

Actualizar BusLayout para soportar layouts físicos reales según tipo de transporte.

Tipos soportados:

- kia → 10 puestos
- bus → 31 puestos

Objetivos:

- Eliminar distribución dinámica actual.
- Eliminar lógica basada en capacidad.
- Implementar layouts estáticos por vehículo.
- Mantener selección, estados y reservas existentes.

Validaciones:

Kia:

- Pasillo izquierdo.
- Todos los asientos al lado derecho.
- A1 y A2 junto a puerta/conductor.
- A10 al fondo.

Bus:

- Última fila superior con 5 puestos.
- Pasillo central vacío.
- A1 y A2 junto a puerta/conductor.
- A31 al fondo.
- No renderizar puestos inexistentes.

[x] Backend separado

[x] Arquitectura multi-tenant

[x] Nuevo modelo de reservas

[x] Sistema de pasajeros

[x] Boarding parcial

[x] QR compartido

[x] Scanner por agencia

[x] Invitaciones de agencias

[x] Seguridad multi-tenant

[x] Stored Procedure transaccional

[x] Sprint 8 — Agency Reservation Flow

- **Fase 3**: Pantalla /agency/reservations/new + BusLayout (selector de viaje + mapa de asientos)
- **Fase 4**: PassengerForm (formulario multi-pasajero con validación inline)
- **Fase 5**: ReservationSummary (resumen previo a confirmar con loading/error states)
- **Fase 6**: Integrar con endpoint createReservation + nueva ruta GET /agency/trips/:tripId
- **Fase 7**: Resultado QR + resumen post-reserva (pantalla de éxito con QR img)
- **Fase 8**: Integrar en Dashboard + navegación (Quick Action "Nueva reserva" + botón en lista de reservas)
- Validación: tsc --noEmit ✓, next build ✓

[x] Sprint 8.1 — QA / Hardening Agency Reservation Flow

- **Fase 1** — Auditoría flujo completo: corregido empty filtered trips list, unused import removido
- **Fase 2** — Concurrencia asientos: stored procedure OK con FOR UPDATE row lock → 409
- **Fase 3** — Multi-tenant: agency_id siempre de req.ctx, schema sin agency_id, SP valida trip_agencies → 403
- **Fase 4** — Validación seats: SP rejecta seats inexistentes (404), de otro viaje (404), ocupados (409)
- **Fase 5** — Persistencia frontend: refresh → estado fresco (correcto para SPA), back nav preserva estado
- **Fase 6** — UX Mobile: responsive correcto en 320/375/768, BusLayout escala, formulario colapsa
- **Fase 7** — Doble click: botón con disabled+loading previene doble envío
- **Fase 8** — QR + Boarding: bugfix — createAgencyReservation ahora retorna qr_data_url (imagen PNG base64) además de qr_code (texto); scanner compatible
- Validación final: tsc --noEmit ✓, next build ✓, 20 rutas

[x] Sprint 8.2 — Agency Reservation Flow Audit & Hardening

Auditoría completa del flujo de reservas de agencia (sin bugs nuevos encontrados):

1. **Flujo completo UI** — navegación correcta, loading (CardSkeleton/spinner), error (red box/summary), empty (EmptyState), back navigation preserva estado, refresh resetea (esperado SPA)
2. **Selección de asientos** — solo seats existentes (generación atómica via VEHICLE_CONFIG), statuses correctos (available clickable, reserved/blocked/boarded no), limpieza al cambiar viaje
3. **Seguridad multi-tenant** — agency_id solo de req.ctx, schema Zod no incluye agency_id, SP valida trip_agencies → 403
4. **Backend validation** — Zod schema valida tipos, SP valida existencia/estado/pertenencia, rollback en todos los fallos
5. **Concurrencia** — FOR UPDATE row lock en SP garantiza atomicidad
6. **QR Flow** — qr_code almacenado en DB, qr_data_url generado (bugfix 8.1), imagen visible en frontend
7. **Responsive** — OK en 320-1440px, BusLayout escala, formulario colapsa, botones accesibles
8. **Design System** — CSS variables, Lucide icons, Poppins/Montserrat, tokens correctos

Validación: tsc --noEmit ✓, next build ✓

[x] Sprint 9 — Agency Reservation Management (backend + frontend)

- Backend: `getAgencyReservations()` mejorado con `reservation_passengers` y `trips(vehicle_type)`
- Backend: `getAgencyReservationById(id, agencyId)` con validación multi-tenant
- Backend: `cancelAgencyReservation(id, agencyId)` — solo `confirmed` → `cancelled`, libera seats vía `seat_id`
- Frontend: `/agency/reservations` migrado a nuevo schema (booker_name, passengers, seat codes, filtro, skeleton)
- Frontend: `/agency/reservations/[id]` — Cards viaje/reservador/pasajeros/QR, cancelar con `ConfirmModal`
- Frontend: `authApi.acceptInvitation` con `confirm_password`, página `/accept-invitation`
- Fix: `admin/agencies/page.tsx` — `pending` status display corregido
- Fix: eliminado `getAgencyReservationsOld` (stale controller)
- Validación: tsc --noEmit ✓, next build ✓

[x] Sprint 10 — Realtime Seat Locking

- Backend: `lockSeat`, `unlockSeat`, `unlockAllSeats`, `releaseExpiredLocks` service + controller + routes
- Backend: auto-expiration cron cada 60s (libera locks > 5 min)
- Frontend: `agencyApi.lockSeat`, `unlockSeat`, `unlockAllSeats`
- Frontend: `Seat.tsx` — estilo locked (morado `#7c3aed`)
- Frontend: flujo lock-first en `/agency/reservations/new` (click → POST lock → selectedSeats)
- Frontend: Realtime subscription a `seats` filtrado por `trip_id`
- Frontend: cleanup en unmount, beforeunload, pagehide, visibilitychange
- Fix: locked-by-me ahora se renderiza como selected (naranja) y es clickable
- Fix: Realtime handler no remueve de selectedSeats si locked_by es el usuario actual
- Validación: tsc --noEmit ✓, next build ✓

[x] Auto complete expired trips

- `backend/src/services/trip.service.ts` — `completeExpiredTrips()` creado
  - Busca viajes con `status != 'completed'` y `departure_time < hace 3 días`
  - Actualiza `status = 'completed'` vía `supabaseAdmin`
  - Log: `[TripCleanup] Completed N expired trip(s)`
- `backend/src/index.ts` — scheduler cada 1 hora vía `setInterval`
  - Sigue el mismo patrón que el lock cleanup existente
  - No depende de request context, agency_id ni usuario autenticado
- Validaciones:
  - Viaje con departure_time hoy → sigue `active` (no cumple 3 días)
  - Viaje con departure_time hace 4 días → pasa a `completed`
  - Viaje ya `completed` → no se modifica (`.neq('status', 'completed')`)
  - Viajes completados no aparecen en endpoints que filtran por `status = 'active'`
  - Reservas existentes no se afectan
- Validación: tsc --noEmit ✓, next build ✓

---

## Sprint 11.2 — Agency Trip Management Frontend

[x] `lib/api.ts` — agregado `agencyApi.getTrips()` como alias semántico
[x] `components/agency/AgencyTripCard.tsx` — nuevo componente de card para viaje:
  - Muestra ruta, fecha, hora, vehículo, capacidad, disponibles, reservados
  - Estado disponible (available > 0): card hovereable con botón "Nueva Reserva" → `/agency/reservations/new?trip=<id>`
  - Estado completo (available === 0): card con opacidad reducida, badge "Completo", botón "Ver información" → `/agency/trips/<id>`
  - Muestra asientos en proceso (locked) cuando existen
[x] `app/agency/trips/page.tsx` — página listado:
  - Fetch via `agencyApi.getTrips()` (GET /api/agency/trips)
  - Estados: loading (CardSkeleton), empty (EmptyState con icono Bus), error (banner rojo)
  - Grid de AgencyTripCard responsive
[x] `app/agency/trips/[id]/page.tsx` — página detalle de viaje (solo info):
  - Fetch via `agencyApi.getTrip(id)` (GET /api/agency/trips/:tripId)
  - Breadcrumb: Agencia / Viajes
  - Muestra ruta, fecha, hora, vehículo, capacidad, disponibles (cyan), reservados
  - Stats computados desde `seats[]` del endpoint (available = filter status === 'available', reserved = filter reserved/boarded)
  - Badge "Completo" cuando available = 0
  - Sin acciones administrativas, QR, ni boarding (pendiente otro sprint)
[x] `app/agency/page.tsx` — Quick Actions: agregado "Mis viajes" con icono Bus
[x] Validación: next build ✓ (TypeScript + compilación exitosa)

---

## Sprint 11.3 — Deep Link Reservation Flow

[x] `app/agency/reservations/new/page.tsx` — soporte para `?trip=<uuid>`:
  - Nuevo estado `deepLinkError` para manejar errores de deep link
  - `loadDeepLinkTrip()`: valida que el viaje exista, no esté `completed`, y pertenezca a la agencia
  - Si falla validación: muestra EmptyState con mensaje "Este viaje ya no está disponible" y botón "Volver a Mis Viajes" → `/agency/trips`
  - Si éxito: salta directamente al paso `select_seats` (mapa de asientos)
  - Step indicator oculta el paso 1 (Viaje) cuando se accede por deep link
  - Sin modificar el flujo normal sin query param

## Fixes adicionales

[x] Fix route name en trip selector (`app/agency/reservations/new/page.tsx:407`): `trip.routes` → `trip.route` (Sprint 11.1 cambió el endpoint a `route` singular, el frontend no se había actualizado)

[x] Fix superadmin bookings pasajeros vacíos (`backend/src/services/reservation.service.ts`):
  - `getAllReservations` ahora incluye `reservation_passengers(*, seats(seat_code))` en la query
  - Flatten post-query: cada passenger de agencia se expande a su propia fila con `customer_name`/`passenger_cedula`/`seat_code`
  - Reservas legacy (flat) se mantienen sin cambios
  - Frontend `app/admin/bookings/page.tsx` sin cambios (el tipo `ReservationRow` sigue igual)

[x] Fix ActivityWidget paginación (`components/dashboard/ActivityWidget.tsx`):
  - Muestra solo las últimas 4 actividades por defecto
  - Botón "Ver las N actividades" / "Ver menos" con toggle interno
  - Sin límite de crecimiento infinito

[x] Fix agencia greeting (`backend/src/services/reservation.service.ts` + `app/agency/page.tsx`):
  - Backend: query a `agencies` table para obtener `name`
  - Response incluye `agency_name` en el dashboard
  - Frontend: `Buenos/as días/tardes/noches, {agency_name}` en vez de ", Agencia" hardcodeado

---

## Sprint 11.3.1 — Deep Link UX Polish

[x] Eliminar flash del Step 1:
  - `step` se inicializa desde `searchParams.trip` (prop de página) en lugar de hardcodear `'select_trip'`
  - SSR y primer render ya tienen el step correcto → sin parpadeo del selector de viajes
  - `tripLoading` inicia como `true` para deep links (spinner hasta que se resuelva loadDeepLinkTrip)

[x] Ocultar "Volver a viajes" en Deep Link:
  - Botón envuelto en `{!isDeepLinkFlow && (...)}` en `renderSelectSeats()`
  - Solo visible cuando el usuario inició el flujo normal (sin ?trip=)

[x] Renderizar deepLinkError:
  - Early return con `<EmptyState>` antes del step indicator y del contenido principal
  - Mensaje: "Este viaje ya no está disponible. El viaje ya no existe, fue finalizado o no pertenece a tu agencia."
  - Botón: "Volver a Mis Viajes" → `/agency/trips`
  - No muestra errores rojos, ni flujo de reserva, ni selector de viajes

[x] Validación: next build ✓ (TypeScript + compilación exitosa, 22 rutas)

---

## Sprint 12 — Realtime Global Synchronization

[x] Auditoría Realtime existente:
  - `seats` (UPDATE): subscription inline en `/agency/reservations/new` + hook `useRealtimeSeats`
  - Tablas en publicación: `seats`, `boarding_logs`
  - Faltantes: `reservations`, `trips`, `reservation_passengers`

[x] `lib/realtime/subscriptions.ts` — funciones reutilizables:
  - `subscribeToSeats(tripId, callback)` — cambios de asientos por viaje
  - `subscribeToTripSeats(tripIds, callback)` — cambios de asientos multi-viaje
  - `subscribeToReservations(callback, agencyId?)` — cambios de reservas (con filtro multi-tenant)
  - `subscribeToTrips(callback)` — cambios de viajes
  - `subscribeToBoardingLogs(callback, tripId?)` — boarding en vivo
  - Cleanup automático en unmount, sin memory leaks, sin subscriptions duplicadas

[x] `supabase/migrations/012_realtime_global.sql` — agregar tablas a publicación:
  - `ALTER PUBLICATION supabase_realtime ADD TABLE reservations`
  - `ALTER PUBLICATION supabase_realtime ADD TABLE trips`
  - `ALTER PUBLICATION supabase_realtime ADD TABLE reservation_passengers`

[x] `/agency/trips` — Realtime seats:
  - Suscripción a `subscribeToTripSeats` con todos los `trip_ids` del listado
  - Al recibir evento: refetch vía `agencyApi.getTrip(tripId)` y actualiza solo ese card
  - Sin recargar todos los viajes

[x] `/agency` (Dashboard agencia) — Realtime:
  - Suscripción a `subscribeToReservations` filtrada (INSERT → +1 total/today)
  - Suscripción a `subscribeToTripSeats` (UPDATE → actualiza Timeline + OccupancyChart)
  - Contadores y charts se actualizan sin recargar

[x] `/admin` (Dashboard superadmin) — Realtime:
  - Suscripción a `subscribeToReservations` (INSERT → +1 total/today, UPDATE → full refresh)
  - Suscripción a `subscribeToTripSeats` (UPDATE → actualiza OccupancyChart en vivo)
  - KPI cards, actividad reciente y occupancy chart se actualizan sin recargar

[x] Multi-tenant y seguridad:
  - `subscribeToReservations` acepta `agencyId` opcional para filtrar por agencia
  - RLS policies existentes protegen los datos a nivel DB
  - Realtime respeta las RLS policies de Supabase

[x] Validación: `tsc --noEmit` ✓, `next build` ✓ (22 rutas, 0 errores)

[x] Sprint 12.2 — Realtime Infrastructure Fixes

- `lib/realtime/subscriptions.ts` — filtro `subscribeToTripSeats` corregido de `trip_id=eq.id1,trip_id=eq.id2` (inválido) a `trip_id=in.(id1,id2)` (válido, operador `in` confirmado en docs oficiales)
- `app/agency/trips/page.tsx` — eliminado `useRef`/`loadedRef`/`tripIdsRef`, reemplazado por `useState` + dep `[tripIds]` para que la subscription se cree tras el fetch
- `app/admin/page.tsx` — eliminado `initializedRef.current` como dep, reemplazado por estado `initialized` + dep `[initialized]`
- `app/agency/page.tsx` — mismo patrón que admin
- Validación: `tsc --noEmit` ✓, `next build` ✓ (22 rutas, 0 errores)

[x] Sprint 12.3 — Realtime Event Flow Fix

- Auditoría con logs temporales confirmó: infraestructura Realtime funciona correctamente (evento → subscription → callback → API)
- Bug encontrado: `agencyApi.getTrip()` retorna `{ ...trip, seats: [] }` sin `available_seats`/`reserved_seats` directos
- Fix: en `app/agency/trips/page.tsx` — calcular los valores desde `fresh.seats[]` antes de actualizar estado:
  ```
  seats.filter(s => s.status === 'available').length
  seats.filter(s => s.status === 'reserved' || s.status === 'boarded').length
  ```
- Logs de depuración eliminados de todos los archivos
- Validación: `tsc --noEmit` ✓, `next build` ✓ (22 rutas, 0 errores)

[x] Sprint 12.7 — Realtime New Reservation Trip Selector

- Selector de viajes en `/agency/reservations/new` actualizado en tiempo real
- Reutiliza `subscribeToTripSeats` de `lib/realtime/subscriptions.ts`
- useEffect activo solo cuando `step === 'select_trip'`
- Al recibir evento: `agencyApi.getTrip(tripId)` → computa counts desde `fresh.seats[]` → `setTrips()`
- Cleanup al cambiar de step o desmontar componente
- Sin modificar: subscriptions.ts, backend, endpoints, componentes compartidos
- Validación: `tsc --noEmit` ✓, `next build` ✓ (22 rutas, 0 errores)

---

## Sprint 13 — Boarding por pasajero individual (cross-agency QR scanner)

[x] `supabase/migrations/018_boarding_agency_audit.sql` — agregar columnas `scanned_by_agency_id` y `reservation_passenger_id` a `boarding_logs`
[x] `backend/src/services/reservation.service.ts` — `lookupPassengerByQR(qrCode, agencyId)` con validación vía `trip_agencies` (cross-agency)
[x] `backend/src/services/reservation.service.ts` — `toggleBoarding(passengerId, boarded, userId, agencyId)` con actualización de `reservation_passengers` + auditoría `boarding_logs` + ajuste automático de `reservation.status`
[x] `backend/src/controllers/reservation.controller.ts` — `lookupPassengerByQR` + `toggleBoarding` con validación Zod
[x] `backend/src/routes/agency/index.ts` — `GET /boarding/:qrCode` + `PATCH /boarding/:passengerId`
[x] `backend/src/types/index.ts` — actualizar `BoardingLog` con nuevos campos
[x] `lib/api.ts` — `agencyApi.lookupPassengerByQR(qrCode)` + `agencyApi.toggleBoarding(passengerId, boarded)`
[x] `app/agency/boarding/page.tsx` — nueva página con:
  - QR scanner (Html5Qrcode) + entrada manual de código
  - Vista de resultado con info del viaje, reserva y lista de pasajeros
  - ToggleSwitch por pasajero para marcar/desmarcar abordaje
  - Realtime subscription a `reservation_passengers` para actualizaciones en vivo
  - Estados: scanner, loading, error, success, resultado
[x] `components/layout/AgencySidebar.tsx` — agregado enlace "Abordaje" con icono ScanLine
[x] Validación: `tsc --noEmit` ✓ (0 errores), `next build` ✓ (23 rutas compiladas)

---

## Sprint 14 — WKR-007 Trip / Notification Event Workers (2026-08-11)

Cierre de la fase WKR de infra de workers (WKR-001…006.4 quedaron marcados completados en TASKS.md; este sprint ejecutó el wiring a producción y el cierre documental).

[x] **WKR-007 — Trip / notification event workers** (wiring a producción + cutover realizado)
- **Eventos de dominio trip.\* v1** (7 contratos: created, updated, postponed, cancelled, completed, auto_completed, archived) en `backend/src/events/`, auditados (WKR-007.3)
- **RPCs transaccionales** (migración `057_trip_events_rpc.sql`): `create_trip`, `update_trip`, `set_trip_status`, `complete_trip`, `archive_trip` — emisión atómica de eventos + scope guard
- **Adopción en service layer** detrás del flag `TRIP_EFFECTS_VIA_OUTBOX`:
  - `superadmin.service.ts` (C2): createTrip/updateTrip/updateTripStatus/archiveTrip → RPCs; mapeo de errores centralizado `mapTripRpcError`
  - `trip.service.ts` (C3): `completeExpiredTrips` → `complete_trip(source='auto')`, emite `trip.auto_completed`
- **Handlers de fanout** (C4/C5): `notification-fanout.handler.ts` (notificaciones con `source_event_id`, idempotente) y `email-fanout.handler.ts` (`email_delivery_log` pending→sent, PK idempotente), registrados en `handlers/index.ts`
- **Flag** `TRIP_EFFECTS_VIA_OUTBOX` (env, default `false`): cutover realizado (`true` en entorno tras soak en staging); default `false` en código como postura de rollback
- **Cleanup legacy**: tipo de notificación `trip_deleted` removido (emisor muerto tras el archivo de trips) — migración `058_remove_trip_deleted_notification_type.sql` + `notification.service.ts`/`notification-categories.ts`/frontend `notification-config.ts`/`NotificationProvider.tsx`
- **Documentación de cierre**: registro de implementación C1–C8 en `docs/WKR-007-wiring-implementation-plan.md` (EJECUTADO); audit de arranque de WKR-008 conservado en `docs/WKR-008-reminder-workers-audit.md` (KEEP AS HISTORICAL RECORD); Apéndice B de referencia en el design doc; TASKS/ROADMAP actualizados (WKR-007 ✅, WKR-008 siguiente)
- **Validación:** `tsc --noEmit` ✓ exit 0, suite backend **326/326** ✓, suites WKR-007 ✓

---

## Sprint 15 — WKR-008 Trip Reminder Workers (2026-08-12)

Cierre de reminders proactivos sobre Transactional Outbox + worker Node existente (sin pg_cron ni segundo proceso).

[x] **WKR-008 — Trip Reminder Workers** (completado; PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED)
- **Objetivo:** emitir y entregar recordatorios automáticos T-48h / T-24h (sin T-2h) para viajes `active` próximos a salir
- **Scheduler durable** en el worker Node (`reminder-scheduler.ts` + `runner.ts`) → RPC `schedule_trip_reminders(p_batch)`
- **Evento** `trip.reminder_due.v1` (`window: 't48' | 't24'`, payload sin PII, `tenant_id` NULL)
- **Idempotencia** vía `dedup_key = trip.reminder_due:{trip_id}:{window}:{departure_time_utc}` (`emit_trip_event` / `ON CONFLICT DO NOTHING`)
- **Catch-up:** si el worker vuelve en T-24h, emite solo `t24` (nunca T-48h retrospectivo)
- **Postponement / restore:** nuevo `departure_time` → nuevas keys; restaurar el horario exacto reutiliza la key histórica (no reenvía)
- **Fanout:** booker + agency email (`email_delivery_log`, tipos `trip_reminder_t48` / `trip_reminder_t24`) + in-app `trip_reminder` (`source_event_id`)
- **Migración** `059_schedule_trip_reminders.sql` (tipo/categoría de notificación + RPC); aplicada en staging
- **Harness SQL** `supabase/tests/wkr_008_verification.sql` (casos A–K) ejecutado en staging: `success. no rows returned`
- **Flag** `TRIP_REMINDER_VIA_OUTBOX` (default `false` en código): cutover realizado — `true` en Render; flujo real de reminders validado en producción (evidencia operativa de cierre; no verificable desde el repo)
- **Remediación de cierre:** F-01 `t22` falso positivo; F-02 pre-filtro `NOT EXISTS` inline; F-03 TOCTOU `FOR UPDATE` + revalidación; F-04 harness comportamental — todos CLOSED; sin blockers técnicos
- **Documentación de cierre:** [`docs/WKR-008-reminder-workers-audit.md`](WKR-008-reminder-workers-audit.md); TASKS/ROADMAP actualizados (WKR-008 ✅, WKR-009 siguiente)
- **Validación:** WKR-008 unit **20/20** ✓, boarding WKR-008 **14/14** ✓, WKR-007 fase2 **21/21** ✓, backend **352/352** ✓, `tsc --noEmit` ✓, backend build ✓, root build ✓

---

## Sprint 16 — WKR-009 Outbox Retention Worker (2026-08-12)

Cierre de purga automática de `outbox_events` `completed` ≥30d sobre el worker Node existente (sin pg_cron ni segundo proceso; sin automation bridge / Fase 4 / timers).

[x] **WKR-009 — Outbox Retention Worker** (completado; PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED)
- **Objetivo:** purgar automáticamente filas `outbox_events` con `status = 'completed'` y `COALESCE(processed_at, updated_at) < now() - 30 days`
- **Scope IN:** RPC DEFINER + scheduler en worker existente + flag + batch + SKIP LOCKED + tests + harness + rollout
- **Scope OUT:** automation bridge / Fase 4; `LockCleanup` / `completeExpiredTrips`; `boarding_attempts`; pg_cron; segundo worker; DLQ nueva; auto-purga `failed`/`pending`/`processing`; eventos/emails/templates nuevos; índice obligatorio
- **Migración** `060_purge_completed_outbox_events.sql` — RPC `purge_completed_outbox_events(p_batch, p_older_than_days)`; aplicada en producción
- **RPC:** SECURITY DEFINER, `search_path=public`, EXECUTE solo `service_role`; clamp batch ≤1000 y days ≥30; predicado completed-only; CTE `picked` + `DELETE … USING` + `FOR UPDATE SKIP LOCKED`; JSON `{deleted, batch, older_than_days, cutoff}`
- **Remediación:** cuerpo inicial `RETURN (WITH…DELETE…)` → `0A000`; corregido a `SELECT … INTO v_result` + `RETURN v_result` (repo sincronizado con prod)
- **Scheduler** `retention-scheduler.ts` + wire en `runner.ts` (paralelo a reminder; `Promise.all` en shutdown)
- **Flag** `OUTBOX_RETENTION_VIA_WORKER` (default `false` en código): soak `false` → cutover `true` en Render
- **Config:** poll 24h (`86400000`), batch 1000, days 30
- **Harness SQL** `supabase/tests/wkr_009_verification.sql` (A–J) ejecutado en producción: `Success. No rows returned` (BEGIN/ROLLBACK)
- **EXPLAIN** producción: Seq Scan; ~30 filas; 0 elegibles; ~0.99 ms → **sin índice** (D6)
- **Smoke / dry-run:** `eligible_completed = 0`; smoke RPC `deleted: 0`
- **Cutover Render:** tick `status: ok`, `deleted: 0`, `batch: 1000`, `duration_ms: 894`; sin errores de retention/relay/fatal
- **Documentación de cierre:** [`docs/WKR-009-outbox-retention-workers-design.md`](WKR-009-outbox-retention-workers-design.md), [`docs/WKR-009-outbox-retention-workers-audit.md`](WKR-009-outbox-retention-workers-audit.md); TASKS/ROADMAP actualizados (WKR-009 ✅, Fase 4 siguiente)
- **Validación:** backend **361/361** ✓, boarding WKR-009/008/007-fase2 **47/47** ✓, `tsc --noEmit` ✓, backend build ✓

---

## Sprint 17 — F4-001 Agency Daily Digest (2026-08-12)

Primer ticket de **Fase 4**. Digest diario email a agencias activas (sin PII, sin in-app).

[x] **F4-001 — Agency Daily Digest** (implementado y habilitado en Render)
- **Scheduler** `digest-scheduler.ts` en el worker Node (07:00 America/Caracas) → RPC `schedule_agency_digests` + `emit_agency_event`
- **Evento** `agency.digest.due.v1` (`aggregate_type=agency`, payload `{ agency_id, digest_date }`)
- **Handler** email-only + `email_delivery_log` (`email_type=agency_digest`); prefs `ops_digest`
- **Migración** `061_schedule_agency_digests.sql` — aplicada en producción
- **Flag** `AGENCY_DIGEST_VIA_WORKER` (default `false` en código): soak → `true` en Render
- **Diseño:** [`docs/F4-001-agency-daily-digest-design.md`](F4-001-agency-daily-digest-design.md)
- **Siguiente:** F4-002 Superadmin Daily Digest

---

## Sprint 18 — F4-002 Superadmin Daily Digest (2026-08-13)

Digest diario email a superadmins (sin PII, sin in-app de digest).

[x] **F4-002 — Superadmin Daily Digest** (**CLOSED** / operativo en Render)
- **Migración** `062_schedule_superadmin_digest.sql` — aplicada en producción
- **Harness SQL** `supabase/tests/f4_002_verification.sql` (BEGIN/ROLLBACK) — PASS
- **Flag** `SUPERADMIN_DIGEST_VIA_WORKER` (default `false` en código): soak → cutover `true` en Render (worker)
- **Evidencia operativa:** worker operativo; primer email real recibido ~2026-08-13 07:31 America/Caracas
- **Diseño:** [`docs/F4-002-superadmin-daily-digest-design.md`](F4-002-superadmin-daily-digest-design.md)
- **Siguiente:** F4-003 Occupancy Alerts

---

## Sprint 19 — F4-003 Occupancy Alerts (in-app) (2026-08-14)

Alertas in-app `near_full` / `underbooked` sobre viajes `active` futuros (agencia asociada + superadmin), sin email v1.

[x] **F4-003 — Occupancy Alerts** (**CLOSED** / operativo en Render)
- **Design / scope-lock** (P1–P5) — [`docs/F4-003-occupancy-alerts-design.md`](F4-003-occupancy-alerts-design.md)
- **Implementation:** estado `trip_occupancy_alert_state` (Estrategia B), RPC `evaluate_occupancy_alerts`, evento `trip.occupancy_alert.due.v1`, scheduler en worker, NotificationFanout, widget agencia, deep-links por rol
- **Ajustes post-audit (copy):** badge/título «Casi lleno» / «Pocas reservas»; destino sin origen; fila del widget clickeable
- **Migración** `063_evaluate_occupancy_alerts.sql` — aplicada en producción
- **Harness SQL** `supabase/tests/f4_003_verification.sql` (BEGIN/ROLLBACK) — PASS (incl. L exact-boundary con conteo real de elegibles)
- **Soak** `OCCUPANCY_ALERT_VIA_WORKER=false` → **cutover** `true` en Render (worker)
- **Primer ciclo real:** scanned=5, evaluated=5, emitted=4, skipped=1, skipped_invalid_occupancy=0, cleaned_up=0
- **Outbox / delivery:** 4 eventos `trip.occupancy_alert.due` completed/delivered; attempts=1; 0 retries; 0 failures
- **UI:** widget «Alertas de ocupación» en `/agency`; deep-link agencia → passengers; superadmin → `/admin/trips/{id}`
- **Resultado final:** **CLOSED**
- **Siguiente producto (Fase 4 resto, aún no descompuesto):** viajes sin acción / métricas nocturnas

---

## Sprint 20 — F4-004 Occupancy Urgency Alerts (in-app) (2026-08-14)

Escalación in-app de urgencia temporal (T-24h) sobre el estado persistido de F4-003, sin segundo detector, sin tabla nueva, sin email v1.

[x] **F4-004 — Occupancy Urgency Alerts** (**CLOSED** / operativo en Render)
- **Design / scope-lock** (P1–P9) — [`docs/F4-004-occupancy-urgency-alerts-design.md`](F4-004-occupancy-urgency-alerts-design.md)
- **Implementation:** migración `064` (extiende `evaluate_occupancy_alerts` con `p_urgency_enabled BOOLEAN DEFAULT FALSE`; emisión `trip.occupancy_urgency.due` dentro del mismo tick y transacción), evento `trip.occupancy_urgency.due.v1` (dedup `trip.occupancy_urgency:{id}:{type}:t24:{departure}`, payload sin PII, `tenant_id NULL`), NotificationFanout (agencia + superadmin, copy de urgencia), widget `/agency` (urgencias primero + departure ASC, badge «Sale mañana»), chip campana, tests y harness
- **Copy re-fijada (P9):** badge/pill/chip «Sale mañana»; títulos «Viaje casi lleno — sale mañana» / «Viaje con pocas reservas — sale mañana»; body `{destination} sale mañana · {pct}% ({reserved}/{total})`
- **Migración** `064_occupancy_urgency_alerts.sql` — aplicada en producción (tip; sin modificaciones a 001–063)
- **Harness SQL** `supabase/tests/f4_004_verification.sql` (BEGIN/ROLLBACK) — PASS (posture, grants, flag off/on, T-24, fuera de ventana, same-tick, no-state, dedup, postponement, cleanup, PII)
- **Soak** `OCCUPANCY_URGENCY_VIA_WORKER=false` → **cutover** `true` en Render (worker)
- **Primer ciclo real:** scanned=5, evaluated=5, emitted=0, skipped=5, cleaned_up=0, urgency_matches=1, urgency_emitted=1, already_escalated=0
- **Outbox / delivery:** 1× `trip.occupancy_urgency.due` completed/delivered; attempts=1; 0 retries; 0 failures
- **UI:** widget «Alertas de ocupación» con badge de urgencia «Sale mañana» en `/agency`; chip en campana; deep-link agencia → passengers; superadmin → `/admin/trips/{id}`
- **Regresión:** F4-001/002/003 (harness pasa con la firma extendida), WKR-007/008/009
- **Resultado final:** **CLOSED**
- **Siguiente producto (Fase 4 resto, aún no descompuesto):** métricas nocturnas (futuro / Fase 6 / reporting)
