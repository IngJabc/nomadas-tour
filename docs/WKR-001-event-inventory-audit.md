# WKR-001 — Auditoría de inventario de eventos y candidatos a workers

**Tipo:** Auditoría arquitectónica (solo análisis, sin implementación)
**Fecha:** 2026-08-04
**Referencia:** [ROADMAP.md](ROADMAP.md) — Fase 3 (Sistema de Workers), [TASKS.md](../TASKS.md)
**Alcance:** Backend (`backend/src`), Frontend (`app/`, `lib/`, `hooks/`), Base de datos (`supabase/migrations`), Documentación (`docs/`, ADRs).

---

## 1. Resumen ejecutivo

El sistema **no tiene infraestructura formal de eventos**. No existe event bus, cola, workers ni outbox. Los efectos secundarios de dominio (emails, notificaciones, auditoría, métricas) se ejecutan dentro del ciclo HTTP como operaciones síncronas o *fire-and-forget* (`.catch` + `console.error`), y el trabajo programado se limita a **dos timers `setInterval` embebidos** en `backend/src/index.ts`.

### Estado actual

- **Backend:** Express + TypeScript, 61 archivos, acceso privilegiado vía `supabaseAdmin` (service_role, BYPASSRLS). Dos procesos periódicos en proceso: liberación de locks de asientos (60 s) y auto-completado de viajes (1 h).
- **Frontend:** Realtime de Supabase como mecanismo de actualización; patrón dominante `realtime event → refetch REST` (el realtime actúa como "bandera de suciedad", no como fuente de verdad).
- **Base de datos:** 48 migraciones, 2 funciones SECURITY DEFINER de negocio (`create_agency_reservation`, `boarding_toggle`), 3 triggers, 10 tablas en la publicación realtime. **No hay outbox ni event store**, y no existen extensiones `pg_cron`/`pg_net`.
- **Email:** Resend (único proveedor). Todos los envíos son *fire-and-forget* sin retry, sin dead-letter queue y sin historial de entrega.
- **Notificaciones:** tabla `notifications` como artefacto más cercano a un outbox, pero sin máquina de entrega (sin `delivered_at`, retries, actor ni estado).

### Problemas encontrados

1. Efectos secundarios dentro del request (PNG de ticket, emails, notificaciones) → latencia, fallo parcial e inconsistencia si falla el side effect después del commit.
2. Scheduler embebido en el proceso de la API → no durable, no escalable a múltiples instancias, sin historial de ejecución.
3. Dominio acoplado a la entrega → los servicios llaman directamente a `email.service` y `notification.service` en lugar de emitir eventos.
4. Sin retries ni DLQ → emails y notificaciones se pierden silenciosamente.
5. Lagunas de auditoría y trazabilidad (tablas `trips`, `routes`, `agencies` sin timestamps; `notifications` sin actor).

### Motivación de la Fase 3

El [ROADMAP.md](ROADMAP.md:94-109) declara como **segunda prioridad** incorporar procesamiento asíncrono desacoplado del ciclo HTTP (recordatorios de viajes para pasajeros y agencias, limpieza automática, emails diferidos, alertas operativas y métricas). La fase es de **evaluación, no de implementación acelerada** ([TASKS.md:24](../TASKS.md)). Este documento inventaría dónde introducir eventos y procesamiento asíncrono, sin elegir aún tecnología de cola ni modificar arquitectura.

---

## 2. Estado actual de arquitectura

### 2.1 Backend

**Stack:** Express + TypeScript (`backend/src`). Acceso a datos por PostgREST con `@supabase/supabase-js` (service_role). Sin driver `pg` directo ni conexiones transaccionales crudas.

**Servicios principales** (`backend/src/services/`):

| Servicio | Responsabilidad |
|---|---|
| `reservation.service.ts` | Reservas, pasajeros, boarding, locks, dashboards |
| `superadmin.service.ts` | Trips, agencias, rutas, métricas |
| `trip.service.ts` | Auto-completado de viajes |
| `auth.service.ts` | Login, invitaciones, password reset |
| `notification.service.ts` | Insert de notificaciones in-app + targeting |
| `notification-delivery.policy.ts` | Gating de canales según preferencias de agencia |
| `notification-preference.service.ts` | Preferencias de notificación |
| `email.service.ts` | Envío de emails vía Resend |
| `boarding-attempts.service.ts` | Telemetría de intentos de boarding (auditoría de seguridad) |
| `boarding.guard.ts` | Autorización operacional de boarding (trip_agencies) |
| `agency-settings.service.ts` | Branding y preferencias de agencia |
| `logo.service.ts` | Upload de logo (storage) |

**Timers `setInterval` existentes** (`backend/src/index.ts`):

| Timer | Frecuencia | Lógica | Riesgo |
|---|---|---|---|
| Liberación de locks | `setInterval` 60 s (`index.ts:10-27`) | `UPDATE seats SET status='available' ... WHERE status='locked' AND locked_at < NOW() - LOCK_TTL_SECONDS` | No durable: muere con el proceso; sin safety net en DB |
| Auto-completado de viajes | `setInterval` 1 h (`index.ts:34-38`, + boot `:30-32`) | `completeExpiredTrips()` (`trip.service.ts:4-57`): marca `completed` viajes con `departure_time < now - 3 días` y emite notificación `trip_auto_completed` | Mismo riesgo de durabilidad; sin historial |

Existe además una Edge Function `supabase/functions/release-expired-locks/index.ts` con el mismo UPDATE, cuyo cron (`*/5 * * * *`) se registra por CLI de despliegue y **no está versionado en el repo**.

**Ausencias confirmadas:** no hay `jobs/`, no hay cron libs (`node-cron`), no hay colas (Bull/Agenda/Bee), no hay worker loops, no hay event emitter, no hay outbox.

### 2.2 Frontend

**Stack:** Next.js 16 + `@supabase/ssr` + `@supabase/supabase-js`. Sin SWR/React Query; toda la reactividad es realtime o usuario-accionada.

**Realtime:** módulo único de fábricas `lib/realtime/subscriptions.ts` (9 canales `postgres_changes`) + canales inline en `hooks/useTripRealtime.ts`. Tablas suscritas: `seats`, `reservations`, `reservation_passengers`, `trips`, `boarding_logs`, `trip_agencies`, `routes`, `agencies`, `notifications`.

**Patrón actual (`realtime event → refetch REST`):**
- `app/agency/scan/page.tsx:307,329` → refetch tras evento de boarding/cambio de viaje.
- `app/admin/bookings/page.tsx:250-277` → refetch con debounce.
- `app/admin/trips/page.tsx:184` → refetch del conteo boarded.
- `app/admin/agencies/page.tsx:69`, `app/admin/routes/page.tsx` → refetch de campos calculados.
- `components/notifications/NotificationProvider.tsx` → campana de notificaciones vía realtime.

El backend **no emite** eventos realtime; Supabase los emite como `postgres_changes` sobre las tablas publicadas. El único *polling* de datos es el refresh de TTL de locks cada 4 min (`hooks/useSeatLocking.ts:85-86`).

### 2.3 Base de datos

**Tablas relacionadas (48 migraciones, `001..048`):**

| Tabla | Columnas de estado | Timestamps |
|---|---|---|
| `routes` | `status IN ('active','inactive')` | **ninguno** |
| `trips` | `status IN ('active','cancelled','completed','archived')`; `postponed_from` | `departure_time` (sin `created_at/updated_at`) |
| `seats` | `status IN ('available','locked','reserved','blocked','guide')` | `locked_at`, `updated_at` (trigger) |
| `reservations` | `status IN ('confirmed','cancelled','partial','completed','boarded')` | `created_at`, `ticket_email_sent_at` |
| `reservation_passengers` | `status IN ('active','cancelled')`; `boarded` BOOL | `boarded_at` (sin `created_at/updated_at`) |
| `boarding_logs` | `action IN ('board','unboard','correction')` | `created_at`; `state_before/state_after` (044) |
| `boarding_attempts` | `operation IN ('lookup','board','unboard')`; `outcome IN ('success','no_change','denied','not_found','error')` | `created_at` |
| `notifications` | `type` (10 valores); `recipient_role`; `read_at` | `created_at` |
| `agencies` | `status IN ('active','inactive','pending')` | **ninguno** |
| `agency_invitations` | sin columna de estado (se infiere de `used_at`/`expires_at`) | `created_at`, `expires_at` |

**Funciones SQL de negocio (SECURITY DEFINER):**
- `create_agency_reservation` (014, redefinida en 047): reserva atómica con `SELECT ... FOR UPDATE`, devuelve `{reservation_id, qr_code, ticket_code}`.
- `boarding_toggle` (046): boarding/unboarding transaccional con locks ordenados anti-deadlock, idempotente, recalcula `reservations.status` e inserta `boarding_logs`.
- Helpers RLS: `private.auth_app_role()` / `private.auth_app_agency_id()` (039).

**Triggers (3):** `seats_updated_t` (011), `agency_settings_updated_at` (041), `trg_locked_notification_categories` (032).

**Tablas realtime (10):** `seats`, `boarding_logs`, `reservations`, `trips`, `reservation_passengers`, `trip_agencies`, `routes`, `agencies`, `notifications`, `agency_settings`. Explícitamente fuera: `boarding_attempts`, `users`, `password_resets`, `agency_invitations`, `agency_notification_preferences`.

**Ausencias de infraestructura de eventos:** no hay outbox, no hay event store, no hay `pg_cron`/`pg_net`, no hay `config.toml` que declare extensiones, no hay migración de limpieza de `boarding_attempts` (retención 90 días documentada pero sin purge).

### 2.4 Email

**Proveedor:** Resend (`backend/src/config/email.ts`, `EMAIL_FROM`, `FRONTEND_URL`). API key en `env`.

**Puntos de envío (7, todos en `email.service.ts`):**

| Llamador | Evento | Comportamiento |
|---|---|---|
| `superadmin.service.ts:136` | Invitación a nueva agencia | fire-and-forget |
| `superadmin.service.ts:485-506` | Viaje asignado (loop por agencia) | fire-and-forget |
| `superadmin.service.ts:1074-1094` | Viaje pospuesto (loop por agencia) | fire-and-forget |
| `superadmin.service.ts:1306-1324` | Viaje cancelado (loop por agencia) | fire-and-forget |
| `auth.service.ts:90-92` | Password reset | fire-and-forget |
| `auth.service.ts:257-259` | Registro completado (invitación aceptada) | fire-and-forget |
| `reservation.service.ts:225` | Ticket de reserva (opt-in, con PNG adjunto) | fire-and-forget con riesgo de *unhandled rejection* (`:224-239`) |

**Comportamiento actual:** un único `resend.emails.send` por llamada, log de error y throw. **Sin retries, sin backoff, sin DLQ, sin idempotency key.** El único mecanismo idempotente-adyacente es `reservations.ticket_email_sent_at` (guard `.is('ticket_email_sent_at', null)`).

### 2.5 Notificaciones

**Tabla `notifications`** (029/030/032/033): `type` (10 valores CHECK), `title`, `body`, `entity_type/entity_id` (polimórfico, **sin FK**), `agency_id`, `recipient_role`, `read_at`, `created_at`, `action_url`, `metadata`.

**Limitaciones actuales:**
- Sin máquina de entrega: no hay `delivered_at`, contador de retries ni estado de envío.
- Sin campo `actor` (no se registra quién ejecutó la acción).
- Insert solo vía service_role (correcto) y sin policy de borrado.
- Targeting y preferencias: `notification-delivery.policy.ts` gatea por canal (`in_app`/`email`) y categoría (`trip_assignments`, `trip_schedule_changes`, `trip_status_updates`, `trip_cancellations`); `trip_cancellations` está bloqueada para desactivarse (trigger 032). Las notificaciones de reserva/pasajero no son gateadas por preferencias (mapean a `null` en `notification-categories.ts:22-24`).
- Los inserts son **best-effort**: errores se loguean y tragan (`notification.service.ts:62-77`).

---

## 3. Inventario actual de eventos

> **Aclaración crítica:** el sistema no tiene eventos de dominio formales. Lo que existe son **materializaciones** (filas de notificación, logs de auditoría, cambios realtime de tablas). Ninguna tiene productor canónico, contrato de eventos, persistencia propia ni consumidores desacoplados.

### Eventos explícitos de dominio

**0.**

No existe emisión explícita de eventos de dominio (sin `publish`, sin outbox, sin cola, sin event emitter).

### Eventos implícitos / materializados

| Artefacto | Origen | Consumidores | Persistencia | Naturaleza |
|---|---|---|---|---|
| Tipos de notificación (9: `trip_created`, `trip_cancelled`, `trip_completed`, `trip_auto_completed`, `trip_postponed`, `trip_archived`, `reservation_created`, `reservation_cancelled`, `passenger_cancelled`) | `notification.service.ts:4-14` | Frontend (campana, RLS), superadmin/agency | Tabla `notifications` | Materialización síncrona dentro del request (fire-and-forget). El tipo muerto `trip_deleted` fue eliminado (migración 058) |
| `boarding_logs` | Único escritor: RPC `boarding_toggle` (046) | Dashboards (`reservation.service.ts:907`, `superadmin.service.ts:1513`), realtime (048), scanner | Tabla `boarding_logs` | Auditoría de estado, escrita en transacción SQL |
| `boarding_attempts` | `boarding-attempts.service.ts` (TS, telemetría) | Solo auditoría/forense (sin lectores de negocio) | Tabla `boarding_attempts` | Auditoría de seguridad, best-effort |
| Cambios realtime de tablas (10 tablas publicadas) | Supabase Realtime (publicación `supabase_realtime`) | Frontend (`lib/realtime/subscriptions.ts`) | Emisión efímera (sin persistencia de eventos) | Cambios de fila, no eventos de dominio |
| `action_url` + `metadata` (030) | Notificaciones | Frontend (navegación) | Tabla `notifications` | Enriquecimiento de la materialización |

**Conclusión:** estos artefactos son señales útiles para rediseñar como eventos, pero **no constituyen un sistema de eventos**: no hay productor de dominio, no hay contrato versionado, no hay entrega garantizada, no hay retries ni idempotencia entre consumidores.

---

## 4. Eventos candidatos de dominio

| Acción actual | Evento candidato | Consumidores futuros | Prioridad |
|---|---|---|---|
| Reserva creada (`createAgencyReservation`) | `reservation.created` | Email ticket (con retry), notificación a agencia propietaria, métricas, auditoría | **Alta** |
| Reserva cancelada (`cancelAgencyReservation`) | `reservation.cancelled` | Email a booker/agencia, notificación, liberación de inventario, métricas | **Alta** |
| Pasajero cancelado (`cancelPassenger`) | `passenger.cancelled` | Notificación, liberación de asiento, métricas | Media |
| Pasajero abordado (`boarding_toggle`) | `passenger.boarded` | Notificación propietaria vs operadora (ADR-001:103-104), métricas en vivo, historial | **Alta** |
| Pasajero desabordado (`boarding_toggle`) | `passenger.unboarded` | Notificación, métricas, historial | **Alta** |
| Viaje creado (`createTrip`) | `trip.created` | Email de asignación a agencias, notificación, métricas | **Alta** |
| Viaje editado (no-pospuesta) (`updateTrip`) | `trip.updated` | Notificación a agencias asignadas (hoy **silenciosa**), auditoría | Media |
| Viaje pospuesto (`updateTrip` + postpone) | `trip.postponed` | Email, notificación a agencias (viejas + nuevas), reminder re-agendado | **Alta** |
| Viaje cancelado (`updateTripStatus`) | `trip.cancelled` | Email, notificación, liberación de asientos, refresco de reminders | **Alta** |
| Viaje completado manual (`updateTripStatus`) | `trip.completed` | Notificación, métricas | Media |
| Viaje auto-completado (`completeExpiredTrips`) | `trip.auto_completed` | Notificación a agencias + superadmin, métricas | Media |
| Agencia creada (`createAgency`) | `agency.created` | Email de invitación, seed de preferencias, métricas | Media |
| Usuario invitado / invitación aceptada (`acceptInvitation`) | `user.invited` / `user.activated` | Email de registro, métricas de onboarding, auditoría | Media |
| Viaje próximo a salir (T-24h/T-2h) | `trip.reminder_due` | Reminders a booker/agencia, alertas operativas | **Alta** |
| Lock de asiento expirado | `seat.lock_expired` | Liberación de inventario (hoy vía cron), telemetría de abandono | Media |
| Edición administrativa de reserva por superadmin | `reservation.status_changed` | Notificación (hoy **silenciosa**, D19), auditoría | Media |

### Explicación breve por evento de alta prioridad

- **`reservation.created`** — Ocurrió una venta confirmada con pasajeros y asientos asignados. Lo consumen el email/ticket (hoy fire-and-forget con riesgo de pérdida), la notificación a superadmin, y las métricas. Útil porque desacopla el "hecho de vender" de la entrega del ticket.
- **`reservation.cancelled` / `passenger.cancelled`** — Ocurrió liberación de inventario. Hoy **no hay email** al cliente ni a la agencia; un evento permitiría avisar y alimentar métricas de cancelación.
- **`passenger.boarded` / `passenger.unboarded`** — Ocurrió una transición de estado de boarding. Ya hay logs (`boarding_logs` + `boarding_attempts`); el evento permitiría notificar a la **agencia propietaria** de la reserva (distinta de la operadora que escanea, según ADR-001) y alimentar dashboards en vivo sin depender de leer `boarding_logs`.
- **`trip.created/postponed/cancelled`** — Ocurrió un cambio de ciclo de vida del viaje. Hoy los emails se envían en loop por agencia dentro del request; un evento permitiría fan-out fiable con retry y re-agendar reminders.
- **`trip.reminder_due`** — Ocurrió que un viaje está dentro de la ventana de recordatorio (T-24h/T-2h). No existe hoy; es el caso piloto más claro de la Fase 3.

---

## 5. Anti-patrones actuales detectados

### 5.1 Side effects dentro del request HTTP

**Ejemplo — flujo de creación de reserva (`reservation.service.ts`):**

```
DB commit (RPC create_agency_reservation)
→ generar ticket PNG (CPU, síncrono, post-commit)
→ enviar email (fire-and-forget)
→ crear notificación (fire-and-forget)
```

**Problemas:**
- Si el email falla, queda una reserva confirmada sin ticket entregado, sin retry ni rastro de re-intento. La inconsistencia es silenciosa.
- La generación del PNG (`utils/ticket-png.ts`, satori + resvg) ocurre **síncronamente en el request después del commit** (`reservation.service.ts:170`): un fallo de render rompe la respuesta aunque la reserva ya exista (ventana de fallo parcial).
- Aumenta la latencia del request y el tiempo de bloqueo del cliente.
- Existe además un **unhandled promise rejection** en el ticket email (`reservation.service.ts:224-239`): el `.then` interno no se retorna al `.catch` externo, por lo que un fallo del email o del update `ticket_email_sent_at` no se loguea.

### 5.2 Scheduler embebido en API

**Ejemplo — `backend/src/index.ts`:**

```
setInterval(releaseExpiredLocks, 60_000)
setInterval(completeExpiredTrips, 60 * 60 * 1000)
```

**Problemas:**
- **No durable:** si el proceso cae, los locks expiran y los viajes no se auto-completan. No hay safety net en la base de datos.
- **Múltiples instancias:** con más de una réplica, los timers se duplican (carreras en `UPDATE`s sin locking) o se solapan.
- **Sin historial de ejecución:** no se registra cuándo corrió, cuánto duró ni qué liberó/completó.
- El mismo patrón duplicado en la Edge Function `release-expired-locks` tiene su cron registrado por CLI fuera del repositorio (no versionado, no auditable).

### 5.3 Dominio acoplado a delivery

**Ejemplo:** los servicios de dominio llaman directamente a `email.service` y `notification.service` (p. ej. `superadmin.service.ts:485-530`, `reservation.service.ts:190-225`, `auth.service.ts:90-92`).

**Problema:** el dominio conoce el canal de entrega, las preferencias y el proveedor de email. Cualquier cambio de canal (push, SMS, digests), de proveedor o de regla de entrega obliga a tocar el servicio de dominio. Idealmente:

```
Dominio genera evento  →  Worker de notificación  →  entrega (in-app/email/push)
```

---

## 6. Procesos que deben desacoplarse

| Proceso | Prioridad | Motivo |
|---|---|---|
| Emails de reserva (ticket + confirmación) | **CRÍTICO** | Fire-and-forget con *unhandled rejection*; pérdida silenciosa de tickets; sin retry ni idempotencia |
| Generación de ticket PNG | **CRÍTICO** | CPU pesada (satori + resvg) síncrona post-commit; fallo parcial del request |
| Emails masivos de viajes (asignado/pospuesto/cancelado) | **CRÍTICO** | Loop por agencia dentro del request; latencia proporcional al nº de agencias; sin retry por destinatario |
| Notificaciones in-app | MEDIO | Inserts best-effort (errores tragados); sin máquina de entrega; afectan a UX de campana |
| Invitaciones (agencia) | MEDIO | Email de invitación dentro del request; sin retry |
| Reset emails (password) | MEDIO | Bajo volumen, pero mismo patrón sin retry; crítico para recuperación de acceso |
| Emails de registro (invitación aceptada) | MEDIO | Mismo patrón fire-and-forget |
| Liberación de locks expirados | MEDIO | Ya es cron, pero no durable ni multi-instancia seguro |
| Auto-completado de viajes | MEDIO | Ya es cron, pero no durable ni con historial |
| Recordatorios de viajes (T-24h/T-2h) | BAJO (no existe) | Requiere worker nuevo; caso piloto de Fase 3 |
| Métricas nocturnas / digests / alertas | BAJO (no existe) | Dependen de infraestructura de workers previa |
| Logos / branding / storage | BAJO | Operación pequeña y síncrona aceptable hoy |

---

## 7. Workers candidatos

| Worker | Trigger | Frecuencia | Problema actual |
|---|---|---|---|
| **EmailDeliveryWorker** | `email_required` (evento de dominio o fila de cola) | Continuo (cola) | Emails fire-and-forget sin retry ni DLQ; pérdidas silenciosas |
| **TicketGenerationWorker** | `reservation.created` (requiere `send_ticket_email`) | Continuo (cola) | PNG síncrono post-commit; bloquea el request |
| **LockCleanupWorker** | Cron | Cada minuto | `setInterval` embebido no durable; sin safety net en DB |
| **TripAutoCompleteWorker** | Cron | Cada hora | `setInterval` embebido no durable; sin historial |
| **TripReminderWorker** | Cron (match con `departure_time` en ventana) | Cada hora | No existe; caso piloto de recordatorios |
| **NotificationFanoutWorker** | Evento de dominio (trip/reservation/passenger) | Continuo (cola) | Notificaciones best-effort insertadas en el request |
| **RetentionWorker** | Cron | Diario | `boarding_attempts` sin purge (retención 90 días sin implementar); logs sin limpieza |
| **AlertWorker** | Cron / evento | Cada hora | Alertas operativas (ocupación, viajes próximos, anomalías) inexistentes |

---

## 8. Eventos, notificaciones y auditoría

### 8.1 Separación dominio / entrega

Un evento de dominio expresa **"algo ocurrió"** y es inmutable:

- **Dominio:** `reservation.created` ("una reserva fue confirmada con estos pasajeros y asientos").
- **Consumidores** (independientes, eventualmente consistentes):
  - Email (ticket, confirmación).
  - Notificación in-app (campana).
  - Métricas y dashboards.
  - Auditoría.

La notificación **no es el evento**: es una **proyección** del evento hacia un canal. La tabla `notifications` debe seguir existiendo como *read model* de la campana, no como mecanismo de transporte.

### 8.2 Decisión

> **No se recomienda Event Sourcing completo.** La necesidad actual es **confiabilidad de side effects** mediante **Transactional Outbox + Workers**.

Racional:
- El estado de negocio ya está materializado correctamente en `reservations`, `reservation_passengers`, `seats`, `trips` (fuente de verdad).
- Lo que falla hoy es la **entrega de efectos secundarios** (emails, notificaciones, métricas), no el registro del estado.
- Event Sourcing completo exigiría reconstruir todo el estado desde un log, sin aportar valor al dominio actual (sin proyecciones complejas ni CQRS real).

### 8.3 Outbox recomendado

```
Dominio (servicio / RPC)
        │  (misma transacción de negocio)
        ▼
DB transaction ──► outbox_events ──► worker (relay) ──► acciones externas
                        │                                  (email, notif, métricas)
                        ▼
                 idempotencia: clave única de evento
                 (correlation_id + type + aggregate_id)
```

Propiedades del outbox:
- El evento se persiste **en la misma transacción** que el cambio de negocio → garantiza que "si el estado cambió, el evento existe" (sin doble escritura manual).
- Un worker relay publica los eventos pendientes y marca `published_at` (o los mueve a un estado procesado).
- Fallos del consumidor → reintentos con backoff → DLQ.
- Retención y purge bajo responsabilidad de un `RetentionWorker`.

### 8.4 Auditoría ligera

Sin implementar event sourcing, se recomienda ampliar la auditoría existente con hechos inmutables para acciones que hoy **no dejan rastro**:
- Cambio de estado administrativo de reserva por superadmin (hoy silencioso).
- Edición de viaje no-pospuesta (hoy silenciosa).
- Cambios de agencia/activación.
- Se reutilizan como base: `boarding_logs` (046), `boarding_attempts` (045) y se recomienda añadir columnas de actor a `notifications`.

---

## 9. Arquitectura futura recomendada

> **No se elige tecnología todavía.** [ROADMAP.md:100](ROADMAP.md) lo declara explícitamente: esta fase documenta la necesidad y los casos iniciales, no el vehículo de implementación.

### Fase inicial (monolito + Postgres como cola)

```
Postgres (outbox_events)
        │
        ▼
Worker Node separado (mismo deploy, proceso independiente)
        │
        ▼
Acciones externas (Resend, notifications, métricas)
```

- Migración de los `setInterval` a un proceso worker dedicado con cron duradero.
- Outbox en Postgres como fuente de eventos; el worker Node hace de relay.
- Aprovecha el stack existente (service_role, RLS, `boarding_toggle`/`create_agency_reservation` como productores atómicos).

### Fase futura (cola/broker y workers distribuidos)

```
Publisher (servicios / triggers)
        │
        ▼
Queue / Broker
        │
        ▼
Workers distribuidos (email, tickets, reminders, alertas, métricas)
```

- Se evalúa cuando el volumen o los requisitos de fan-out lo exijan.
- Opciones a evaluar sin comprometer (pendiente decisión en WKR-002): BullMQ + Redis, Postgres-as-queue, Supabase Edge Functions + `pg_cron`, Temporal.

### Conceptos necesarios (en ambas fases)

- **Retries:** reintento con política de backoff exponencial + jitter.
- **Backoff:** retraso progresivo entre reintentos para evitar thundering herd.
- **DLQ (dead-letter queue):** eventos que exceden reintentos → partición de inspección sin pérdida.
- **Idempotencia:** cada consumidor procesa un evento una sola vez (clave única `(type, aggregate_id, correlation_id)`, unique constraint en outbox y en consumidores).
- **correlation_id:** trazabilidad de una cadena de eventos originada en una acción de usuario.
- **Observabilidad:** estado de eventos (pendiente/procesado/fallido/DLQ), métricas de throughput y latencia, logs estructurados con `correlation_id`.

---

## 10. Roadmap recomendado

| Iteración | Alcance | Salida |
|---|---|---|
| **WKR-001** | Auditoría de inventario de eventos y candidatos a workers | Este documento |
| **WKR-002** | **ADR** de arquitectura de eventos/workers: decidir outbox, scheduler, cola y workers | ADR aprobado (documentar en `docs/architecture.md` tras decidir) |
| **WKR-003** | **Email delivery worker**: outbox para emails + ticket PNG + retries/DLQ | Elimina el anti-patrón 5.1 y la pérdida silenciosa |
| **WKR-004** | **Schedulers externos**: locks expirados y auto-completado de viajes fuera de `index.ts` | Elimina el anti-patrón 5.2 |
| **WKR-005** | **Recordatorios automáticos**: `trip.reminder_due` (T-24h/T-2h) para pasajeros y agencias | Caso piloto de Fase 3 |
| **WKR-006** | **Alertas y métricas**: alertas operativas, métricas nocturnas, digests | Fase 4 de ROADMAP |

Precedencia técnica: WKR-003 (fiabilidad inmediata) y WKR-004 (durabilidad) antes de WKR-005/006, porque dependen de la infraestructura de outbox/scheduler.

---

## 11. Validaciones finales

### Archivos revisados

- **Backend:** `backend/src/services/*` (reservation, superadmin, trip, auth, notification, notification-delivery.policy, notification-preference, email, boarding-attempts, boarding.guard, agency-settings, logo), `backend/src/controllers/*`, `backend/src/routes/{agency,superadmin,auth}/index.ts`, `backend/src/index.ts`, `backend/src/config/{database,email,env}.ts`, `backend/src/templates/*`, `backend/src/utils/{qr,ticket-png}.ts`.
- **Frontend:** `lib/realtime/subscriptions.ts`, `hooks/useTripRealtime.ts`, `hooks/useSeatLocking.ts`, `app/agency/scan/page.tsx`, `app/admin/*`, `app/agency/*`, `components/notifications/*`, `components/layout/Topbar.tsx`.
- **Base de datos:** `supabase/migrations/001..048` (esquema, funciones, triggers, realtime, RLS), `supabase/functions/release-expired-locks`.
- **Documentación:** `docs/ROADMAP.md`, `docs/architecture.md`, `docs/system-spec.md`, `docs/business-rules.md`, `docs/permissions.md`, `docs/decisions/ADR-001-*.md`, `docs/TASKS-HISTORY.md`, `TASKS.md`, serie `docs/AUD-020*.md`.

### Resultado

**Eventos de dominio explícitos:** 0

**Eventos implícitos/materializados:**
- 10 tipos de notificación (`notification.service.ts:4-14`).
- `boarding_logs` (escritor único: RPC `boarding_toggle`, 046).
- `boarding_attempts` (045, telemetría TS).
- Cambios realtime de 10 tablas publicadas (`lib/realtime/subscriptions.ts`).

**Workers recomendados (8):**
`EmailDeliveryWorker`, `TicketGenerationWorker`, `LockCleanupWorker`, `TripAutoCompleteWorker`, `TripReminderWorker`, `NotificationFanoutWorker`, `RetentionWorker`, `AlertWorker`.

**Procesos críticos (3):**
Emails de reserva (ticket), generación de ticket PNG, emails masivos de viajes. Seguidos por la liberación de locks y el auto-completado de viajes (crons no durables).

**Decisiones pendientes:**
- Tecnología de cola (WKR-002): BullMQ+Redis vs Postgres-as-queue vs Edge Functions+pg_cron vs Temporal.
- Estrategia de outbox (misma transacción vs publicador en servicios vs triggers).
- Scheduler durable (worker Node cron vs Edge Functions con cron versionado).
- Política de retries/backoff y DLQ.
- Mecanismo de idempotencia (`correlation_id` + claves únicas en consumidores).
- Agregar timestamps a `trips`, `routes`, `agencies` y `reservation_passengers` (migración futura, pendiente de aprobación).

---

**Restricciones respetadas:** este documento no modifica backend, frontend, SQL, migraciones ni tests. Solo crea documentación.
