# WKR-007 — Trip / Notification Event Workers · Documento de Diseño

**Tipo:** Diseño arquitectónico (sin implementación)
**Fecha:** 2026-08-08
**Auditor:** Agente de análisis (implementación posterior por Cursor)
**Referencias:** WKR-001, WKR-002, WKR-003, WKR-003.1, WKR-003.2, WKR-004, WKR-005, WKR-005.1, WKR-006.x, AUD-021, ADR-001, ROADMAP.md, TASKS.md
**Estado:** APROBADO — listo para implementación por fases (Sección 19)

> **Decisión de alcance del documento:** este archivo es el artefacto de diseño de WKR-007. No incluye código de aplicación, RPCs ni migraciones; solo las especificaciones que la implementación posterior deberá materializar.

---

## 1. Executive summary

La infraestructura de eventos (outbox + relay + worker + observabilidad) está operativa para **un solo evento** (`reservation.created.v1`). WKR-007 debe: (1) habilitar el dispatcher multi-evento, (2) emitir los eventos de ciclo de vida de viajes de forma **transaccional**, (3) construir un **NotificationFanoutWorker** y un **EmailFanout** que desacoplen del request HTTP todos los efectos secundarios de trips/notificaciones.

**Decisión arquitectónica aprobada:** reescribir las mutaciones de trips como **funciones SQL transaccionales (RPC `SECURITY DEFINER`)** que insertan el evento en el outbox **en la misma transacción** que el cambio de estado (patrón `create_agency_reservation`, migración 047). Es la única vía que garantiza atomicidad real, porque el service layer no puede ejecutar transacciones multi-sentencia vía PostgREST.

Las 6 decisiones de la sección 20 están **cerradas y aprobadas** (ver Sección 20). La implementación debe ejecutarse en el orden de la Sección 19, sin romper las invariantes de la Sección 4.2.

---

## 2. Estado real auditado

**Infraestructura (verificada en código):**

| Pieza | Ubicación | Estado |
|---|---|---|
| `outbox_events` | migración 049 | ✅ |
| Trigger `reservation.created.v1` (AFTER INSERT reservations) | 049 | ✅ |
| `claim_outbox_events(p_limit, p_event_type)` — `NULL` = todos los tipos | 050 | ✅ ya multi-tipo |
| `recover_stuck_outbox_events` | 051 | ✅ |
| Relay (`resolveClaimEventTypeFilter`: undefined→`reservation.created`, null→todos) | `backend/src/workers/outbox/relay.ts:38-43` | ✅ ya multi-tipo |
| `claim.ts` (passthrough del parámetro) | `workers/outbox/claim.ts` | ✅ |
| Registry handlers | `workers/handlers/index.ts:46-64` | ⚠️ solo `reservation.created:1` |
| Runner | `workers/runner.ts:188` | ⚠️ **hardcodea** `eventType: 'reservation.created'` |
| HandlerOutcome | `workers/outbox/types.ts:5-8` | `completed(sent\|already_sent\|skipped_no_email)` / `requeue` / `failed(permanent)` |
| Sin handler registrado → `failed` (DLQ) | relay | ⚠️ riesgo al pasar a `null` |
| Observabilidad, Sentry, DLQ, /healthz | WKR-006.x | ✅ |

**Eventos:** 1 implementado E2E (`reservation.created.v1`); 15 definidos en WKR-003.2 pero no emitidos; `trip.archived`/`trip.deleted` fuera del catálogo (gap).

**Efectos secundarios en request HTTP (candidatos a desacoplar):**

| Efecto | Ubicación |
|---|---|
| Notificación `reservation_created` (campana superadmin) | `reservation.service.ts:190` |
| Email ticket legacy (solo si `!EMAIL_VIA_OUTBOX`) | `reservation.service.ts:223-240` |
| Notificación `reservation_cancelled` | `reservation.service.ts:396` |
| Notificación `passenger_cancelled` | `reservation.service.ts:771` |
| Email loop `trip.created` + notificación `trip_created` | `superadmin.service.ts:477-507`, `510-530` |
| Email loop `trip.postponed` + notificación `trip_postponed` | `superadmin.service.ts:1066-1095`, `1104-1131` |
| Notificación `trip_archived` | `superadmin.service.ts:1207-1226` |
| Email loop `trip.cancelled` + notificación `trip_cancelled`/`trip_completed` | `superadmin.service.ts:1298-1325`, `1350-1383` |
| Notificación `trip_auto_completed` (timer API) | `trip.service.ts:44` |
| Timers LockCleanup (60s) y TripCleanup (1h) | `index.ts:37-62`, `65-81` |

**Datos críticos confirmados:**
- `trips` **NO tenía `created_at`** en el baseline post-reset (`010_drop_all` + `011_create_all`). La migración `006` añadió `updated_at` + trigger `trips_updated_at`, pero ese estado **no sobrevivió** al recreate de `011` (trips se recreó sin `created_at` ni `updated_at`, y sin reponer el trigger). Fase 0 / migración `052` asegura ambas columnas con `ADD COLUMN IF NOT EXISTS` y recrea `trips_updated_at` (idempotente).
- El feed de actividad del admin consulta `trips.created_at` (`superadmin.service.ts:1498-1503` y `1558`) → columna inexistente (pre-052) → PostgREST 400 en esa subconsulta → `recentTrips` null → **los viajes desaparecen silenciosamente del activity feed** (bug latente; mitigado por `052`).
- `trips` tiene `postponed_from` (028); el postpone real hace 2 UPDATEs separados (departure_time, luego postponed_from).
- `createTrip` = 3 INSERTs secuenciales sin transacción con compensación manual (DELETE trip/seats) en caso de error.
- `updateTripStatus(cancelled)` = UPDATE trips + UPDATE seats (liberación) en sentencias separadas.
- `getAgenciesWithEmail` / `formatDateForEmail` viven en `backend/src/utils/email-fanout.ts` (extraídos en Fase 0; misma semántica: `status='active' AND email`, locale `es-VE` / `America/Caracas`).
- `notificationDeliveryPolicy.shouldDeliver(agencyId, type, channel)` y `filterAgencyNotificationRows` existen y son reutilizables.
- `tenant_id` de `outbox_events` es un solo UUID → un evento `trip.*` (multi-agencia) debe usar `tenant_id = NULL` y llevar `agency_ids` en el payload.
- Sin handler → evento `failed` en el relay (política DLQ actual). Pasar a `eventType: null` exige que **todo tipo publicado tenga handler registrado**.
- `EMAIL_VIA_OUTBOX` default `false` (`env.ts:15-17`).
- `trip_deleted` existe en el tipo DB (029/033) y en `notification.service.ts`, pero **nunca se emite** (no hay endpoint de borrado; la baja es `archived`).

---

## 3. Problemas actuales

1. **No hay atomicidad** en las mutaciones de trips: `createTrip`, `updateTrip` (postpone), `updateTripStatus` (cancel/completed), `archiveTrip` hacen varias sentencias vía PostgREST con compensación manual. Un crash intermedio deja estado parcial.
2. **Emails por agencia síncronos en el request**: latencia ∝ nº de agencias, sin retry/DLQ, sin idempotencia por destinatario. Un fallo de Resend se pierde (`.catch` + log).
3. **Notificaciones best-effort en el request**: fire-and-forget, sin retry; si el insert falla, la campana no llega.
4. **Sin evento de dominio para trips**: el ciclo de vida de viajes no es observable (ni para auditoría ni para automatizaciones futuras).
5. **Dispatcher limitado**: runner hardcodeado a `reservation.created` (H1 AUD-021).
6. **Sin idempotencia de publicación** (H3): no hay constraint único ni `dedup_key`; con múltiples productores crece el riesgo de duplicados.
7. **`trips.created_at` inexistente** rompe el activity feed del admin y dificulta ordenar por creación.
8. **Gap de catálogo**: `trip.archived`/`trip.deleted` no resueltos como contratos; `trip_deleted` es código muerto.

---

## 4. Decisión arquitectónica (APROBADA)

### 4.1 Mecanismo de emisión: RPC transaccional (patrón `create_agency_reservation`)

Escribir funciones SQL `SECURITY DEFINER` (compatibles con Supabase, `SET search_path = public`) que realizan **toda la mutación + insert de outbox en una sola transacción**:

| Función | Operación que reemplaza | Evento que emite |
|---|---|---|
| `create_trip(p_route_id, p_departure_time, p_vehicle_type, p_agency_ids, p_created_by)` | INSERT trips + seats + trip_agencies + compensaciones | `trip.created.v1` (con `agency_ids`) |
| `postpone_trip(p_trip_id, p_new_departure_time)` | UPDATE departure_time + postponed_from | `trip.postponed.v1` |
| `set_trip_status(p_trip_id, p_status)` | UPDATE trips status + (si cancel) liberar seats | `trip.cancelled.v1` / `trip.completed.v1` |
| `complete_trip(p_trip_id, p_source)` | UPDATE trips status (=completed) | `trip.completed.v1` o `trip.auto_completed.v1` según `p_source` |
| `archive_trip(p_trip_id)` | UPDATE trips status (=archived) | `trip.archived.v1` |
| `update_trip(...)` | UPDATE campos no-pospuesta | `trip.updated.v1` (solo si no es postpone ni status) |

**Justificación (evidencia del repo):**
- El patrón RPC transaccional ya es idiomático: `create_agency_reservation` (014/047) y `boarding_toggle` (046) son `SECURITY DEFINER` con validaciones internas.
- El service layer **no puede** lograr atomicidad multi-sentencia vía PostgREST; la única forma de "estado cambió ⇔ evento existe" es una función que haga ambos dentro de la misma TX.
- El trigger sobre `trips` no puede resolver: contexto de agencias en `create`; intención `postpone` vs edición simple (la distinción vive en el flag `postpone` del service, no en el row change); fuente `auto` vs manual en `complete`; y en `cancel` el evento se emitiría antes de liberar asientos.
- Permite `dedup_key` idempotente dentro de la misma función (Sección 10).

**Regla de oro (invariante de implementación):** *todo evento de dominio se publica en la misma transacción que el cambio de estado; nunca desde el service layer vía una sentencia PostgREST separada.*

### 4.2 Invariantes no negociables

- No romper `reservation.created.v1` (trigger 049, parser, handler, `EMAIL_VIA_OUTBOX`).
- Payloads mínimos y sin PII (patrón `reservation-created.v1`, guard blocklist).
- Todo tipo publicado debe tener handler registrado (o pasa a DLQ).
- `tenant_id` de eventos multi-agencia = `NULL`; `agency_ids` en payload.
- Notificaciones = read model; **no diseñar eventos `notification.*`**.
- No modificar migraciones 001–051 (solo crear nuevas 052+).
- No modificar `reservation-created.v1.ts` ni su handler en WKR-007; se integrará mediante `composeHandlers` (Sección 7) sin editar ese módulo.
- No modificar `EMAIL_VIA_OUTBOX`.

### 4.3 Alternativas descartadas

| # | Opción | Veredicto | Por qué |
|---|---|---|---|
| 1 | Trigger AFTER INSERT ON `trips` | ❌ Descartada | Emite antes de que existan seats y `trip_agencies`; si falla el paso siguiente, la compensación borra el trip pero el evento ya se publicó (evento huérfano → worker falla `not found`); sin contexto de agencias en payload. |
| 2 | Trigger AFTER INSERT ON `trip_agencies` | ⚠️ Plan B (no adoptado) | Es atómico con la asignación y el trip ya está commiteado (sin settle-window para re-leer); pero fragmenta el hecho: **1 evento por agencia** (N rows por trip creado), rompe el contrato `agency_ids` del catálogo y ensucia métricas/auditoría. Documentado como fallback si la reescritura RPC se rechazara. |
| 3 | Triggers combinados (trips + trip_agencies) | ❌ Descartada | Doble emisión: `updateTrip` re-inserta/borra `trip_agencies` → re-dispararía eventos espurios; complejidad alta y detección de intención frágil. |
| 4 | Emisión desde service layer (insert outbox separado) | ❌ Descartada | No atómico: ventana de evento perdido (crash entre mutación y publish) o duplicado en retry; viola el requisito central. |
| 5 | RPC transaccional | ✅ **APROBADA** | Ver §4.1. |
| 6 | Otro mecanismo (ej. `publish_event()` auxiliar llamado por el service) | ❌ Colapsa en opción 4 | Sin transacción PostgREST no aporta atomicidad; solo es válido si el llamador ya está dentro de una función SQL (= opción 5). |

---

## 5. Contratos de eventos

Patrón común (copiar de `reservation-created.v1.ts`): constantes `*_V1_TYPE/_VERSION/_AGGREGATE`, interfaz del payload, `isPayloadValid`, `assertNoPiiInPayload` (blocklist), `parseEventV1(row)`.

**Regla general:** el worker **re-lee** por `aggregate_id` todo lo legible (route origin/destination, agency names/emails, passenger data). PII solo dentro del worker (service_role), nunca en el payload.

### trip.created.v1
- `aggregate_type: 'trip'`, `aggregate_id: trip_id`, `tenant_id: NULL`
- Payload: `{ trip_id, route_id, departure_time, vehicle_type, capacity, agency_ids: string[] }`
- Prohibido: names/emails de agencias, user data. Re-lee: route (origin/destination).

### trip.postponed.v1
- Payload: `{ trip_id, route_id, previous_departure_time, departure_time, agency_ids }`
- `previous_departure_time` = `ctx.trip.departure_time` (equivalente de `postponed_from`).

### trip.cancelled.v1
- Payload: `{ trip_id, route_id, departure_time, status: 'cancelled', agency_ids }`

### trip.completed.v1 (manual)
- Payload: `{ trip_id, route_id, departure_time, status: 'completed', agency_ids }`

### trip.auto_completed.v1 (sistema)
- Mismo shape que `trip.completed.v1` + `source: 'auto'`; tipo distinto en el catálogo (como WKR-003.2).

### trip.updated.v1 (edición no-pospuesta)
- Payload: `{ trip_id, route_id, departure_time, changed_fields: string[], agency_ids }`
- **Sin consumidor en WKR-007** (solo observabilidad/auditoría futura). Aprobado: se emite vía RPC.

### trip.archived.v1 (nuevo — resuelve gap de catálogo)
- Payload: `{ trip_id, route_id, departure_time, status: 'archived', agency_ids }`

### trip.deleted — **NO existe como evento (eliminado del dominio)**
- No hay operación de borrado en el dominio (la baja es `archived`). Aprobado eliminar el tipo muerto `trip_deleted` de `notification.service.ts`, de `notification-categories.ts` y del CHECK de la migración (nueva migración).

### reservation.cancelled.v1 / passenger.cancelled.v1 — **FUERA DE SCOPE**
- Decisión aprobada: **NO incluir** en WKR-007; quedan para ticket posterior. `reservation.service.ts:396,771` conservan su comportamiento actual durante WKR-007.

---

## 6. Diseño del dispatcher multi-evento

**Cambio mínimo:** `runner.ts:188` `eventType: 'reservation.created'` → `null` (reclamar todos). El claim RPC (050), `claim.ts` y el relay ya soportan `null`.

**Requisitos obligatorios (no es suficiente el cambio de `null`):**

1. **Registro completo de handlers** en `buildDefaultHandlers()` (`handlers/index.ts`) para cada tipo/versión publicado. Contrato: *ninguna entidad publica un `event_type` sin handler registrado en el mismo release*; si ocurre, el relay lo manda a `failed` (DLQ) — comportamiento actual, aceptado como red de seguridad.
2. **`composeHandlers(...)`** para multi-consumidor: `reservation.created` pasará a tener EmailHandler **+** NotificationHandler. Util que ejecuta sub-handlers secuencialmente y agrega outcome: `completed` solo si todos completed; `requeue` si alguno pide requeue; `failed permanent` si alguno falla permanente. Cada sub-handler debe ser idempotente (§10) para que el retry no duplique efectos.
3. **Extender `HandlerOutcome.reason`** (`outbox/types.ts:6`): añadir razones de skip/entrega nuevas (`skipped_no_agencies`, `skipped_effect_disabled`, `delivered`, `already_delivered`).
4. **No cambia**: claim.ts, retry.ts, stuck/recovery, observabilidad base, Sentry, DLQ runbook — ya son genéricos (correlación por `event_id`/`aggregate_id`/`tenant_id`; para trips `tenant_id=null` es esperado y se loguea).
5. **Orden de deploy obligatorio**: migraciones + RPCs/triggers y handlers en el mismo release; eventos emitidos mientras el worker viejo corre quedan `pending` (no se pierden — el worker viejo filtra `reservation.created`), y el worker nuevo los procesa al arrancar.

---

## 7. Diseño NotificationFanoutWorker

**Consume:** `reservation.created`, `trip.created`, `trip.postponed`, `trip.cancelled`, `trip.completed`, `trip.auto_completed`, `trip.archived`.

**Reemplaza los inserts síncronos:** `reservation.service.ts:190`, `superadmin.service.ts:510-530`, `1104-1131`, `1207-1226`, `1350-1383`, `trip.service.ts:44`.

**Diseño:** un factory genérico `createNotificationFanoutHandler(config)` registrado por evento; un solo módulo `notification-fanout.handler.ts`. Config por tipo:

| Evento | Notification type | Destinatarios | Actor (semántica actual) |
|---|---|---|---|
| reservation.created | `reservation_created` | superadmin | agency → createForAgency |
| trip.created | `trip_created` | agencias de `agency_ids` | superadmin → createForAgenciesAndAdmin |
| trip.postponed | `trip_postponed` | agencias (actuales ∪ nuevas) | superadmin |
| trip.cancelled | `trip_cancelled` | agencias | superadmin |
| trip.completed | `trip_completed` | agencias | superadmin |
| trip.auto_completed | `trip_auto_completed` | agencias + superadmin | system |
| trip.archived | `trip_archived` | agencias | superadmin |

**Flujo del handler:**
1. Parsear evento (valida versión, PII guard).
2. Cargar contexto: `trip` + `routes` (origin/destination) y, para `reservation.*`, `reservation` (booker_name, nº pasajeros). Esto reproduce el `label`/`body` y `metadata` actuales (trip_id, origin, destination, departure_time).
3. Resolver destinatarios y aplicar **delivery policy**: agencias → `notificationDeliveryPolicy.filterAgencyNotificationRows(rows)` (gate in_app); superadmin → sin filtrar (comportamiento actual). Para emails, el handler de email usa `shouldDeliver(agencyId, type, 'email')`.
4. Insertar rows de `notifications` con `source_event_id = event.id` (§10.2) y `ON CONFLICT DO NOTHING`; si no insertó fila nueva → `already_delivered` (idempotente).
5. Multi-tenant: `agency_id` escrito desde el payload/contexto del evento; nunca derivado del handler; `service_role` no filtra por RLS (BYPASSRLS en el worker, igual que hoy).

**Qué se elimina del request tras el flag:** las llamadas a `notificationService.*` listadas arriba.

**Integración de `reservation.created`:** NO se modifica `reservation-created.v1.ts` ni su handler. El EmailHandler existente se conserva tal cual; el NotificationFanout se registra como sub-handler adicional vía `composeHandlers([emailHandler, notificationFanout])` en `handlers/index.ts`.

---

## 8. Diseño EmailFanout

**Reemplaza los loops:** `superadmin.service.ts:477-507` (trip_created), `1066-1095` (trip_postponed), `1298-1325` (trip_cancelled).

**Diseño:** módulo `trip-email-fanout.handler.ts` por tipo de evento:
1. Recipients: `agency_ids` del evento → `SELECT id, name, email, status FROM agencies WHERE id IN (...)` → filtrar `status='active' AND email` (misma regla que `getAgenciesWithEmail`).
2. Gate: `notificationDeliveryPolicy.shouldDeliver(agencyId, type, 'email')`.
3. **Idempotencia por destinatario** con ledger (tabla nueva, §10.3): `INSERT INTO email_delivery_log ... ON CONFLICT DO NOTHING` → si conflicto, skip (`already_delivered`); si insertó, enviar (Resend) → marcar `sent`; si el envío falla → `DELETE` del ledger y retornar `requeue` (reintento real).
4. Formateo compartido: extraer `formatDateForEmail` y `getAgenciesWithEmail` de `SuperadminService` a un módulo común (`utils/email-fanout.ts`) reutilizado por worker y (durante transición) por el legacy.

**Transición sin doble envío:** nuevo flag `TRIP_EFFECTS_VIA_OUTBOX` (env, default `false`). Semántica de una sola vía:
- `false` → los loops legacy corren (comportamiento actual); los handlers del worker retornan `skipped_effect_disabled`.
- `true` → loops legacy deshabilitados; handlers del worker activos.
- **Nunca ambos activos.** (No reusar `EMAIL_VIA_OUTBOX`: aplica al ticket de reserva y no debe mezclarse.)

**Persistencia adicional:** tabla `email_delivery_log` (§10.3). Reutilizable por WKR-008 (reminders) y Fase 4 (digests).

---

## 9. Idempotencia

### 9.1 Publicación (H3) — prerrequisito dentro de WKR-007 (APROBADO)
Añadir a `outbox_events`:
- `dedup_key TEXT NULL`
- Índice único parcial: `UNIQUE (dedup_key) WHERE dedup_key IS NOT NULL` (`idx_outbox_events_dedup_key_unique`, migración 053)

Las RPC emisoras calculan un `dedup_key` determinístico por ocurrencia lógica e insertan con **`ON CONFLICT DO NOTHING` sin `conflict_target`** (ver §9.4):

| Evento | dedup_key |
|---|---|
| trip.created | `trip.created:{trip_id}` |
| trip.postponed | `trip.postponed:{trip_id}:{previous_iso}:{new_iso}` |
| trip.cancelled | `trip.cancelled:{trip_id}` |
| trip.completed / auto_completed | `trip.completed:{trip_id}` / `trip.auto_completed:{trip_id}:{occurred_at}` |
| trip.updated | `trip.updated:{trip_id}:{changed_fields_hash}` |
| trip.archived | `trip.archived:{trip_id}` |

- La fila de `reservation.created.v1` (trigger 049) queda con `dedup_key NULL` → el índice no la afecta.
- **Retrofit de `reservation.created.v1`: FUERA de WKR-007 → WKR-007.2** (decisión aprobada). La columna/índice quedan preparados; el trigger 049 no se toca en este ticket.

### 9.2 Notificaciones
- Columna nueva `notifications.source_event_id UUID NULL` (migración 054).
- Índice único parcial por **expresión** (no cambiar en Fase 0.1+ sin re-auditoría):

```sql
UNIQUE (
  source_event_id,
  (COALESCE(agency_id::text, '*')),
  (COALESCE(recipient_role, '*'))
)
WHERE source_event_id IS NOT NULL
```

- Insert idempotente: **`ON CONFLICT DO NOTHING` sin `conflict_target`** (ver §9.4). Fila no insertada → `already_delivered` (skip).
- Cubre el caso crash-después-insert-antes-de-complete (el único escenario de duplicado real bajo SKIP LOCKED).
- **Prohibido** en handlers/RPCs: `ON CONFLICT (source_event_id, agency_id, recipient_role)` — no coincide con el índice expresado y provoca `SQLSTATE 42P10`.

### 9.3 Email por destinatario
- Tabla nueva `email_delivery_log (event_id, recipient_id, email_type, status, attempts, sent_at, PK(event_id, recipient_id, email_type))` (migración 055).
- Semántica del ledger (trade-off explícito; **sin** recovery worker de `pending` en WKR-007):

| Paso | Acción |
|---|---|
| Antes de enviar | `INSERT` con `status = 'pending'` (`ON CONFLICT DO NOTHING` sobre la PK) |
| Envío OK | actualizar a `status = 'sent'`, set `sent_at`, incrementar `attempts` según política del handler |
| Envío falla | `DELETE` de la fila del ledger + outcome `requeue` (reintento real) |
| Crash tras envío OK y antes de marcar `sent` | la fila puede quedar en `pending`; **se acepta** para evitar un segundo envío en el retry (preferimos undelivered-ack sobre duplicado) |

- No diseñar recovery automático de filas `pending` huérfanas en este ticket.

### 9.4 Invariante `ON CONFLICT` (auditoría Fase 0 — HIGH-1)

Los índices de idempotencia de Fase 0 son **únicos parciales y/o por expresión**. Inferir un `conflict_target` de columnas crudas es incorrecto y puede fallar en runtime con:

```text
SQLSTATE 42P10 — there is no unique or exclusion constraint matching the ON CONFLICT specification
```

**Reglas obligatorias para Fase 2/3 (y posteriores):**

1. Para `notifications` (`source_event_id`): usar `INSERT ... ON CONFLICT DO NOTHING` **sin** `conflict_target`.
2. **No** usar `ON CONFLICT (source_event_id, agency_id, recipient_role)`.
3. Si en el futuro se usa un `conflict_target` explícito, debe reproducir **exactamente** las expresiones y el `WHERE` del índice `idx_notifications_source_event_idempotent`.
4. Para `outbox_events.dedup_key` en RPCs futuras: preferir `ON CONFLICT DO NOTHING` **sin** target (el índice `idx_outbox_events_dedup_key_unique` es parcial: `WHERE dedup_key IS NOT NULL`).
5. El índice de la migración **054 no se redefine** para “hacer pasar” un `ON CONFLICT` con columnas crudas; el SQL de aplicación se adapta al índice.

---

## 10. Multi-tenancy

- `trip.*` es un hecho **global** (multi-agencia): `tenant_id = NULL`, `agency_ids` en payload. `reservation.*` mantiene `tenant_id = agency_id`.
- Los consumidores escriben solo para los destinatarios derivados del evento (`agency_ids` / `agency_id` del payload), nunca para todos.
- El worker usa `supabaseAdmin` (service_role, BYPASSRLS) — igual que hoy; el aislamiento se preserva en el *escritor*, no en RLS: el handler debe construir rows de `notifications.agency_id` exactos.
- `correlationFromRow` ya refleja `tenant_id`; para trips será `null` (esperado); loguear `agency_count`.

---

## 11. Migración / rollout

**Fase 0 — Pre-paso (migraciones nuevas, sin cambio de comportamiento):**
1. `trips.created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` + backfill opcional desde `outbox_events.created_at`; trigger `BEFORE UPDATE` para `updated_at` (paridad con seats).
2. `outbox_events.dedup_key` + índice único parcial (§9.1).
3. `notifications.source_event_id` + índice único parcial (§9.2).
4. Tabla `email_delivery_log` (§9.3).
5. Extracción de `formatDateForEmail`/`getAgenciesWithEmail` a módulo común (sin cambio de comportamiento).

**Fase 1 — Dispatcher:** runner `eventType: null` + registry (solo `reservation.created`) + `composeHandlers`. Sin eventos nuevos → sin cambio de comportamiento. Deploy + verificación de no-regresión.

**Fase 2 — Eventos RPC:** migración con `create_trip`/`postpone_trip`/`set_trip_status`/`complete_trip`/`archive_trip`/`update_trip` + reescritura del service para llamarlos. Los efectos legacy (emails/notificaciones en request) **siguen activos** (`TRIP_EFFECTS_VIA_OUTBOX=false`), handlers de trip registrados pero `skipped_effect_disabled`. Los eventos se producen y quedan `completed` (skip) → auditable sin duplicar efectos.

**Fase 3 — Fanouts:** NotificationFanoutWorker + EmailFanout + `source_event_id`/ledger. En staging: verificar conteos de notificaciones y emails por evento. **Flip `TRIP_EFFECTS_VIA_OUTBOX=true`** → legacy deshabilitado, worker activo. Soak > 48h.
**Fase 4 — Cleanup:** eliminar loops legacy y llamadas `notificationService.*` del request; eliminar tipo muerto `trip_deleted` (código + migración CHECK); actualizar docs (WKR-003.2, AUD-021).

**Regresión `reservation.created`:** no tocar trigger 049, `reservation-created.v1.ts`, ni su handler; solo registrar el NotificationFanout como sub-handler del composite. `EMAIL_VIA_OUTBOX` intacto.

**Rollback:** `TRIP_EFFECTS_VIA_OUTBOX=false` restaura el comportamiento legacy (el código legacy existe hasta Fase 4). Las RPC son reversibles (revertir service a sentencias PostgREST). Los eventos `pending` nunca se pierden (outbox + recovery).

---

## 12. Tests requeridos

1. **Contratos de eventos:** parser roundtrip + guard PII + payload valido/invalido para cada evento nuevo.
2. **RPCs (SQL):** caso feliz (estado + outbox fila), rollback (validación falla → nada persistido), `ON CONFLICT DO NOTHING` (segunda llamada idéntica → una fila), `dedup_key` correcto, multi-agencia.
3. **superadmin.service.test.ts:** reescritura de `createTrip`/`updateTrip`/`updateTripStatus`/`archiveTrip` mockeando RPC; assert de que **no** se llama `emailService.sendTripPostponedEmail`/`sendNewTripAssignedEmail` ni `notificationService.createForAgenciesAndAdmin` cuando flag ON.
4. **notification-fanout.handler.test.ts:** recipients por tipo (agencias / agencias+superadmin / solo superadmin), filtro delivery policy, idempotencia vía `source_event_id` (reprocesar → `already_delivered`, cero rows nuevas), multi-tenant (agency_id correctos), body/metadata con route re-leída.
5. **trip-email-fanout.handler.test.ts:** filtro active+email, `shouldDeliver`, ledger (retry → no doble envío; fallo → reintenta), `skipped_effect_disabled`.
6. **composeHandlers.test.ts:** agregación de outcomes; sub-handler idempotente en retry.
7. **relay/runner:** claim con `eventType=null` multi-tipo; evento sin handler → `failed`; conteo de intentos.
8. **trip.service.test.ts:** `completeExpiredTrips` vía RPC → `trip.auto_completed`.
9. **Regresión:** `reservation.created` handler + `EMAIL_VIA_OUTBOX` sin cambios.
10. **E2E/soak manual (checklist):** crear trip → evento `pending` → worker `completed` → notificaciones/emails exactos; cancelar trip → seats liberados + emails/notifs una vez; flip de flag sin dobles.

---

## 13. Observabilidad

- Métricas/logs ya genéricos por handler (`handlerKey` = `type:version`); añadir métrica de skip por flag (`skipped_effect_disabled`) durante transición.
- Sentry: `fingerprintWorkerFailure(worker, area, handler)` ya cubre por handler; sin cambios.
- Logs de correlación: para `trip.*`, `tenant_id=null`; loguear `agency_count` y `agency_ids` (ids, no PII).
- Heartbeat, stuck reaper, healthz: sin cambios.
- Check `outbox_events.status` al final de cada fase (pending/processing/failed) como señal de salud.

---

## 14. Riesgos

| Riesgo | Mitigación |
|---|---|
| Duplicación de eventos (múltiples productores) | `dedup_key` + `ON CONFLICT DO NOTHING` (prerrequisito Fase 0) |
| Eventos fuera de transacción / pérdida | RPC atómica (estado⇔evento); nunca publish desde service vía PostgREST |
| Doble email/notificación en transición | Flag `TRIP_EFFECTS_VIA_OUTBOX` de una sola vía + ledger + `source_event_id` |
| Evento sin handler → DLQ (por `eventType:null`) | Contrato: tipo publicado ⇔ handler registrado en el mismo release; deploy ordenado |
| Regresión de `reservation.created` | Fases 1-3 sin tocar trigger/parser/handler; composite agrega sin modificar |
| `trip.postponed` detectado mal | Evitado por diseño: RPC con intención explícita (`postpone` flag) |
| `trips.created_at` / activity feed roto | Fase 0 añade la columna |
| Fuga de PII | Guard blocklist en cada contrato; worker re-lee con service_role |
| Fuga multi-tenant | Destinatarios siempre derivados del payload del evento |
| Migración RPC muy grande | Fases pequeñas; plan B documentado (Sección 4.3, no adoptado) |

---

## 15. Scope WKR-007 (definitivo APROBADO)

1. Pre-paso: migraciones de idempotencia/`created_at` + extracción de utils compartidos.
2. Multi-event dispatcher (`eventType:null` + registry + composite).
3. RPC transaccionales + eventos: `trip.created`, `trip.postponed`, `trip.cancelled`, `trip.completed`, `trip.auto_completed`, `trip.updated` (emitir, sin consumidor), `trip.archived` (resuelve gap de catálogo).
4. NotificationFanoutWorker (consume `reservation.created` + trips) con `source_event_id`.
5. EmailFanout (trip.created/postponed/cancelled) con `email_delivery_log`.
6. Flag `TRIP_EFFECTS_VIA_OUTBOX` + eliminación de loops/notificaciones en request.
7. Limpieza de `trip_deleted` (código muerto).

**Excluidos (decisiones aprobadas):**
- `reservation.cancelled.v1` y `passenger.cancelled.v1` → **ticket posterior** (no en WKR-007).
- Retrofit `dedup_key` del trigger 049 → **WKR-007.2** (columna/índice quedan preparados).

---

## 16. Fuera de scope

- `trip.reminder_due` → **WKR-008** (scheduler proactivo).
- Boarding events (`passenger.boarded`/`unboarded`) → ticket propio (requiere ADR-001, `boarding_logs` trigger, `operator_agency_id`).
- Purga/retention de `outbox_events` → **WKR-009**.
- Migración de timers (`LockCleanup`, `completeExpiredTrips`) a scheduler durable → **WKR-009** (el *evento* `auto_completed` sí es de WKR-007; el *timer* no).
- `agency.created`, `user.invited`, `user.activated` → Fase 4.
- `reservation.status_changed` (edición admin) → Audit Trail (Fase 5).
- `reservation.cancelled` / `passenger.cancelled` → ticket posterior (ver Sección 15).
- Retrofit `dedup_key` del trigger 049 → WKR-007.2.
- Frontend, Realtime Supabase, `trust proxy`, security hardening, ADR-001, `docs/incidents/*`.

---

## 17. Dependencias

**De la infra existente (ya lista):** outbox (049), claim multi-tipo (050), recovery (051), relay multi-tipo, observabilidad, DLQ, `/healthz`. Solo falta `runner.ts:188` → `null` y registry.

**Nuevas dependencias de WKR-007:** 4 migraciones (pre-paso) + migración de RPCs + limpieza CHECK `notifications.type`.

**Lo que WKR-007 prepara:**
- **WKR-008:** handlers/eventos de trip listos; `trip.reminder_due` se publicará cuando exista scheduler; `email_delivery_log` reutilizable para reminders.
- **WKR-009 / Fase 4:** NotificationFanout + EmailFanout consolidados; automatizaciones consumen los mismos eventos sin cambiar contrato (cambios aditivos, WKR-003.2 §9).
- **WKR-007.2:** columna `dedup_key` e índice ya presentes; solo resta el retrofit del trigger 049.

---

## 18. Orden recomendado de implementación

1. Fase 0 (migraciones idempotencia/created_at + utils compartidos).
2. Contratos de eventos + tests (§12.1).
3. RPC transaccionales + reescritura de service (llamadas RPC; legacy activo) + tests.
4. Dispatcher (`eventType:null`, registry, `composeHandlers`) + tests.
5. NotificationFanoutWorker + `source_event_id` + tests.
6. EmailFanout + `email_delivery_log` + tests.
7. Flag `TRIP_EFFECTS_VIA_OUTBOX` (default false) → soak → flip true → verificación E2E.
8. Cleanup legacy (loops, notificaciones en request, `trip_deleted`) + docs (WKR-003.2, AUD-021, ROADMAP/TASKS).

---

## 19. Consistencia entre secciones (verificación requerida por el usuario)

Se verificó la coherencia de las decisiones aprobadas entre las secciones 4, 6, 7, 8, 9, 11, 15 y 18:

- **§4.1 (RPC `create_trip`)** emite `trip.created` en la misma TX → consumido por §7 (NotificationFanout) y §8 (EmailFanout). Sin contradicción.
- **§4.1 (RPC `update_trip`)** emite `trip.updated` **sin consumidor** → §5 y §15 lo declaran explícitamente; §7 no lo lista como consumido. Coherente.
- **§4.2 / §15 / §16** coinciden: `reservation.cancelled` y `passenger.cancelled` fuera de scope; `reservation.created` integrado solo por composite, sin editar su módulo. Coherente.
- **§6.3** extiende `HandlerOutcome.reason`; §7.4 y §8.3 usan los nuevos valores (`already_delivered`, `skipped_effect_disabled`). Coherente.
- **§9.1** define `dedup_key` y declara el retrofit 049 → WKR-007.2; §15 y §17 lo reflejan. Coherente.
- **§9.2/§9.3** (source_event_id + email_delivery_log) son las piezas de idempotencia de consumidores usadas por §7.4 y §8.3. Coherente.
- **§11** usa el flag `TRIP_EFFECTS_VIA_OUTBOX` (Fases 2-3) y §8.5 lo define con la misma semántica de una sola vía. Coherente.
- **§18** ordena la implementación 0→4 y la §11 define el mismo rollout. Coherente.

**Sin contradicciones detectadas.** Ambigüedades residuales listadas en §20 (todas sin impacto en la arquitectura; se resuelven en la implementación).

---

## 20. Preguntas / decisiones (CERRADAS Y APROBADAS)

| # | Decisión | Estado |
|---|---|---|
| 1 | **Mecanismo de emisión** | ✅ **RPC transaccional** (`create_trip`, `postpone_trip`, `set_trip_status`, `complete_trip`, `archive_trip`, `update_trip`) |
| 2 | **Migraciones 052+ dentro de WKR-007** | ✅ Aprobadas (dedup_key, source_event_id, email_delivery_log, trips.created_at, RPCs, cleanup CHECK) |
| 3 | **Scope opcional** (`reservation.cancelled`/`passenger.cancelled`) | ✅ **Diferir** a ticket posterior |
| 4 | **`trip.updated`** | ✅ **Emitir sin consumidor** (vía RPC, con `changed_fields`) |
| 5 | **`trip_deleted`** | ✅ **Eliminar completamente** (código + CHECK de DB) |
| 6 | **Idempotencia del trigger 049** | ✅ **Después, WKR-007.2** (columna/índice preparados en WKR-007) |

**Ambigüedades residuales para la implementación (sin impacto arquitectónico):**
- Valor exacto de `changed_fields_hash` para `trip.updated` (hash del JSON ordenado de campos vs concatenación); se define en la migración RPC.
- Estrategia de backfill de `trips.created_at`: Fase 0 usó `NOW()` (sin correspondencia confiable trip↔outbox). Cerrada para históricos.
- Normalización del índice §9.2: **cerrada en 054** — `COALESCE(agency_id::text, '*')` y `COALESCE(recipient_role, '*')`; inserts usan `ON CONFLICT DO NOTHING` sin target (§9.4).

---

## Apéndice A — Archivos/migraciones probables (referencia de implementación)

- `backend/src/services/superadmin.service.ts` (createTrip/updateTrip/updateTripStatus/archiveTrip → RPC calls; remover loops tras flag)
- `backend/src/services/trip.service.ts` (completeExpiredTrips → RPC loop)
- `backend/src/services/notification.service.ts` (remover tipo `trip_deleted`)
- `backend/src/services/notification-delivery.policy.ts` (reutilizar)
- `backend/src/events/*` (nuevos: `trip-created.v1.ts`, `trip-postponed.v1.ts`, `trip-cancelled.v1.ts`, `trip-completed.v1.ts`, `trip-auto-completed.v1.ts`, `trip-updated.v1.ts`, `trip-archived.v1.ts` + exports)
- `backend/src/workers/runner.ts` (eventType null)
- `backend/src/workers/handlers/index.ts` (registry + composers)
- `backend/src/workers/handlers/notification-fanout.handler.ts` (nuevo)
- `backend/src/workers/handlers/trip-email-fanout.handler.ts` (nuevo)
- `backend/src/workers/handlers/compose.ts` (nuevo)
- `backend/src/workers/outbox/types.ts` (extensión HandlerOutcome.reason)
- `backend/src/workers/config.ts` + `backend/src/config/env.ts` (flag `TRIP_EFFECTS_VIA_OUTBOX`)
- `backend/src/utils/email-fanout.ts` (extraído de SuperadminService)
- `supabase/migrations/052+` (pre-paso, RPCs, cleanup)
- Tests: `superadmin.service.test.ts`, `trip.service.test.ts`, handlers, events, compose

**NO modificar:** migraciones 001–051; `reservation-created.v1.ts` y su handler (solo registro por composite); `app.ts`/`app.test.ts` (`trust proxy`); claim/stuck/retry RPCs; observability core; `EMAIL_VIA_OUTBOX`; frontend; ADR-001; `docs/incidents/*`.
