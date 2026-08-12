# WKR-007 — Plan de Implementación: Wiring a Producción (C1–C8)

**Tipo:** Plan de implementación (deliverable → convierte cada hallazgo del cierre en trabajo auditable)
**Fecha:** 2026-08-09
**Base:** [Auditoría de cierre WKR-007](WKR-007-trip-notification-event-workers-design.md) (NO-GO — Wiring Incomplete) y [AUD WKR-008](WKR-008-reminder-workers-audit.md)
**Branch objetivo:** rama de trabajo por ticket (p. ej. `features/wkr-007-wiring`), merge a `main` por PR
**Estado:** EJECUTADO C1–C7 — wiring a producción completo y cutover realizado (flag `TRIP_EFFECTS_VIA_OUTBOX=true` en entorno; C1–C5 merged vía PRs #87/#88; C6 tests consolidados PASS). C8 = cierre documental del presente plan.

---

## 0. Límites del plan (no tocar lo auditado)

### ❌ FUERA DE ALCANCE (NO MODIFICAR)
| Área | Razón |
|---|---|
| `backend/src/events/*` (7 contratos, `trip-common.ts`, `types.ts`, `index.ts`, tests) | Auditados y correctos (WKR-007.3) |
| `backend/src/workers/runner.ts`, `relay.ts`, `outbox/claim.ts`, `outbox/retry.ts`, `outbox/stuck.ts`, `outbox/types.ts` | Auditados; infra de claim/retry/stuck/dedup validada. Solo se **agregan** handlers nuevos, no se reescriben |
| `supabase/migrations/001–057` | Todas auditadas; la 057 está aplicada en Supabase. **No se crea ninguna migración** en C1–C8 |
| `supabase/tests/*` (harness SQL) | Auditados; no se modifican (se puede agregar harness nuevo solo si es estrictamente necesario) |
| `backend/src/services/notification.service.ts`, `email.service.ts`, `email-delivery-policy.ts`, `notification-delivery.policy.ts`, `notification-preference.service.ts` | Auditados; los handlers nuevos los **llaman**, no los reescriben |
| Flujos de reservas / boarding | Fuera del scope (WKR-007 = trips) |
| Frontend (`app/`, `components/`, `hooks/`) | Fuera del scope |
| `docs/*` excepto lo indicado en C8 | No se editan docs de diseño salvo C8 explícito |

### ✅ EN ALCANCE
- `backend/src/config/env.ts` — **agregar** flag `TRIP_EFFECTS_VIA_OUTBOX` (C1).
- `backend/.env-example` — documentar el flag (C1).
- `backend/src/services/superadmin.service.ts` — **adopción de RPCs** detrás del flag (C2).
- `backend/src/services/trip.service.ts` — `completeExpiredTrips` vía `complete_trip` (C3).
- `backend/src/workers/handlers/*` — **nuevos** handlers (NotificationFanout, EmailFanout) + registro (C4/C5).
- Tests: `superadmin.service.test.ts` (mock `.rpc` + rama flag), `trip.service.test.ts`, handlers nuevos.
- `TASKS.md` + `WKR-007 design` §16/§17/§18 — actualizar estado (C8).

### Reglas de oro
1. **Ningún cambio en migraciones.**
2. **Ningún cambio en `events/*` ni en `workers/outbox/*` ni `relay.ts`/`runner.ts`** (salvo lo indicado: registry/handlers son archivos aparte).
3. **Todo cambio en archivos auditados (service layer) se hace con rama `flag=false` intacta** como default y verificación de tests antes/después.
4. Cada ticket C se ejecuta como PR separado y auditable.

---

## 1. Estrategia de flag (premisa transversal)

Patrón a replicar de `EMAIL_VIA_OUTBOX` (`env.ts:35`, evaluada en `reservation.service.ts:223`):

```ts
// env.ts
TRIP_EFFECTS_VIA_OUTBOX: z
  .preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
  .default(false),
```

- **Default: `false`** → el sistema productivo mantiene el comportamiento legacy actual (INSERT/UPDATE directos + emails/notificaciones síncronos). **Cero riesgo de regresión.**
- `true` → el service llama a los RPCs transaccionales (emisión de outbox) y **se saltan los efectos legacy** (emails/notificaciones) porque serán responsabilidad de los handlers de fanout (C4/C5).
- **El flip a `true` SOLO ocurre en C7, después de que los handlers existan.** En C2–C5 el flag permanece `false` (o se prueba en rama en modo test con mocks).

---

## 2. C1 — Agregar flag `TRIP_EFFECTS_VIA_OUTBOX`

**Objetivo:** exponer el flag en entorno y documentación. Cero cambio de comportamiento.

### Archivos
| Archivo | Cambio |
|---|---|
| `backend/src/config/env.ts` | Agregar `TRIP_EFFECTS_VIA_OUTBOX` (preprocess boolean, default `false`) tras `EMAIL_VIA_OUTBOX` (~línea 36) |
| `backend/.env-example` | Agregar comentario + `TRIP_EFFECTS_VIA_OUTBOX=false` |

### Criterios de aceptación
- `env.TRIP_EFFECTS_VIA_OUTBOX` es `boolean`, default `false`.
- Test del parser: valores `true/1/yes` → `true`; ausencia/`false` → `false` (se puede cubrir en `init-from-env.test.ts` o un test nuevo mínimo de `env.ts`; si no hay test del parser hoy, agregar uno pequeño).
- Backend `tsc --noEmit` PASS. Backend tests PASS (280).

### Evidencia de anclaje
- `env.ts:35-36` (`EMAIL_VIA_OUTBOX`) — patrón exacto.
- `.env-example` — sección flags.

---

## 3. C2 — Adopción de RPCs en `superadmin.service.ts`

**Objetivo:** cuando `TRIP_EFFECTS_VIA_OUTBOX=true`, las operaciones lifecycle de trips llaman a los RPCs (emisión atómica de eventos). Cuando `false`, comportamiento legacy intacto.

### Operaciones y mapeo RPC

| Lifecycle | Método service | RPC (057) | Retorno RPC → contrato service |
|---|---|---|---|
| create | `createTrip` (`:375`) | `create_trip(route_id, departure_time, vehicle_type, agency_ids, created_by)` | `to_jsonb(trip)` → `trip` |
| update | `updateTrip` (`:1006`) | `update_trip(trip_id, route_id, departure_time, vehicle_type, agency_ids, p_postpone)` | `{trip_id, action:'postponed'|'updated', event_type, changed_fields}` → **re-select** `trips`+`routes`+`trip_agencies` y devolver `{trip, action}` |
| status | `updateTripStatus` (`:1370`) | `set_trip_status(trip_id, status)` | `{trip_id, status}` → `{id, status}` |
| archive | `archiveTrip` (`:1289`) | `archive_trip(trip_id)` | `{trip_id, status:'archived'}` → `{id, status}` |
| complete (manual) | `updateTripStatus(status:'completed')` | `set_trip_status(trip_id,'completed')` | igual que status |

### Flujo de rama (por método)
```
if (!env.TRIP_EFFECTS_VIA_OUTBOX) { ...legacy actual intacto...; return }
// outbox path:
// 1) validaciones del service SE CONSERVAN (scope guard 057:26-31):
//    assertNoDuplicateTrip, validateTripEditable, validateVehicleChange,
//    validateAgencyRemoval, validateNoActiveReservations, departure-in-future,
//    route.status check (createTrip :397-400)
// 2) supabaseAdmin.rpc('<rpc>', params)
// 3) mapear errores ERR_* a errores tipados (ver sección "Mapeo de errores")
// 4) re-fetch si el contrato del endpoint lo requiere (updateTrip)
// 5) NO ejecutar emails/notificaciones legacy (los hará el fanout, C4/C5)
```

### Mapeo de errores (nuevo helper privado en el service)
El RPC lanza `RAISE EXCEPTION 'ERR_*: mensaje'`. Supabase devuelve eso en `error.message`. Mapear:
- `ERR_TRIP_DUPLICATE` → `ValidationError` (o `ConflictError` según convención actual; verificar cuál usa `assertNoDuplicateTrip`)
- `ERR_TRIP_NOT_FOUND` → `NotFoundError`
- `ERR_TRIP_NOT_ACTIVE` → `ValidationError`
- `ERR_ROUTE_NOT_FOUND` → `NotFoundError`
- `ERR_NO_AGENCIES` → `ValidationError`
- `ERR_INVALID_VEHICLE_TYPE` → `ValidationError`
- `ERR_SEATS_IN_USE` → `ValidationError`
- `ERR_TRIP_NOT_DEPARTED` / `ERR_TRIP_DEPARTED` → `ForbiddenError`
- `ERR_TRIP_ARCHIVED` / `ERR_ALREADY_ARCHIVED` / `ERR_TRIP_STATUS_INVALID` / `ERR_TRIP_ACTIVE` → `ValidationError`
- Otros → `ValidationError(error.message)` (default conservador)

### Retorno `updateTrip` (outbox path)
El RPC no devuelve el trip completo. Replicar el re-select actual (`superadmin.service.ts:1273-1277`) y devolver `{ trip, action: isRealPostpone ? POSTPONED : UPDATED }` con `isRealPostpone` derivado del `action` del RPC (`'postponed'`).

### `createTrip` (outbox path)
- Validar `route.status` antes del RPC (check `:397-400`).
- El RPC inserta trips + seats + trip_agencies atómicamente y emite `trip.created`. El service **no** hace los inserts ni los rollbacks manuales (`:420-448` quedan muertos en este path).
- Mantener el retorno `trip` (re-select con `routes`/`trip_agencies` si el endpoint lo requiere; hoy `createTrip` devuelve el row insertado `:406-416`).

### Tests requeridos (C2)
- **Extender mock** `superadmin.service.test.ts`: el mock de DB (`:10-70`) hoy solo tiene `.from`; agregar `.rpc` al chainable para los 4 RPCs (mock `{data, error}`).
- **Tests rama outbox** (flag `true` en test):
  - `createTrip` → llama `create_trip` con params correctos; NO inserta seats/trip_agencies; NO llama `sendNewTripAssignedEmail`; NO llama `createForAgenciesAndAdmin`.
  - `updateTrip` postpone → llama `update_trip(postpone=true)`; re-select; retorna `POSTPONED`; NO emails legacy.
  - `updateTrip` edit → `update_trip(postpone=false)`; retorna `UPDATED`.
  - `updateTripStatus` cancel/completed → `set_trip_status`; NO notificación legacy; retorna `{id,status}`.
  - `archiveTrip` → `archive_trip`; NO notificación legacy.
  - Mapeo de errores: `ERR_TRIP_DUPLICATE`→ValidationError, `ERR_TRIP_NOT_FOUND`→NotFoundError, `ERR_TRIP_DEPARTED`→ForbiddenError.
- **Tests rama legacy** (flag `false`): los 280 existentes deben seguir pasando sin cambios de assertions (comportamiento actual).

### Criterios de aceptación C2
- Con flag `false`: **cero** cambio de comportamiento (tests legacy intactos).
- Con flag `true`: el service invoca los 5 RPCs, conserva validaciones de contexto, mapea errores, no duplica efectos.
- `tsc --noEmit` PASS; backend suite PASS; suites WKR-007 (47) PASS.
- Sin migraciones, sin cambios en `events/*` ni `workers/outbox/*`.

---

## 4. C3 — `completeExpiredTrips` vía `complete_trip` (emisión `trip.auto_completed`)

### Cambio en `backend/src/services/trip.service.ts:4-57`
- Legacy (`flag=false`): comportamiento actual (UPDATE directo + notificación legacy `createForAgenciesAndAdmin`).
- Outbox (`flag=true`): por cada trip expirado detectado (query de lectura `SELECT id FROM trips WHERE status='active' AND departure_time < NOW()-3d`), llamar `rpc('complete_trip', { p_trip_id, p_source: 'auto' })` → emite `trip.auto_completed` en la misma transacción. **No** notificación legacy (la hará el fanout de C4).
- El `complete_trip` RPC ya valida `status='active'` y `NOW() >= departure_time` (057:499-505); el cutoff 3 días garantiza la segunda condición.

### Riesgo de doble efecto (documentado, no es bug)
Hoy el path legacy hace UPDATE+notificación. Cuando el flag se active, ambos caminos conviven en código pero **solo uno se ejecuta según el flag**. El flip (C7) debe ser atómico: activar flag ⇔ quitar/mantener muerto el path legacy. **No** se puede llamar a `complete_trip` y además conservar el UPDATE legacy en el mismo flujo.

### Tests
- `trip.service.test.ts` (existe, 4 tests): agregar casos flag `true` → invoca `complete_trip(source='auto')`; flag `false` → comportamiento actual.
- Verificar que el mock soporte `.rpc`.

### Criterios de aceptación C3
- Flag `true` → cada trip expirado emite `trip.auto_completed` vía RPC, una sola vez (dedup con `occurred_at` del RPC 057:516-517).
- Flag `false` → sin cambios.
- Backend suite + WKR-007 suites PASS.

---

## 5. C4 — NotificationFanoutWorker (consume `reservation.created` + trip.*)

### Cambios
- **Nuevo** `backend/src/workers/handlers/notification-fanout.handler.ts`:
  - Consume `reservation.created`, `trip.created`, `trip.postponed`, `trip.cancelled`, `trip.completed`, `trip.auto_completed`, `trip.archived`.
  - Escribe notificaciones con `source_event_id` (columna 054 ya lista) usando `notificationService` + `notificationDeliveryPolicy` (fail-open existente).
  - **Idempotencia:** antes de insertar, consultar si ya existe notificación con `source_event_id` para (agency, role); si existe → `{kind:'completed', reason:'already_delivered'}`. Index único 054 (`idx_notifications_source_event_idempotent`) como respaldo de integridad.
  - Payload mínimo: usar el payload del evento + `source_event_id`; los títulos/cuerpos replican los strings legacy actuales (`superadmin.service.ts:486-504, 1242-1259, 1345-1363, 1489-1511`) para no cambiar la UX.
- **Registro** en `buildDefaultHandlers` (`workers/handlers/index.ts`): reemplazar el placeholder `reservationNotificationPlaceholder` (`:64-67`) por el handler real, y **agregar** entradas `trip.*:1`.
- **`completeExpiredTrips`:** la notificación legacy `trip_auto_completed` se mueve aquí (cuando flag activo).

### Límites
- No tocar `notification.service.ts` (se llama tal cual). No tocar `relay.ts`/`runner.ts`. Solo `handlers/*` y `handlers/index.ts`.

### Tests
- `notification-fanout.handler.test.ts`: por evento → inserta notificaciones por agencia+superadmin según actor; `already_delivered` idempotente; respeta `notificationDeliveryPolicy` (fail-open).

### Criterios de aceptación C4
- Cada evento trip.* + reservation.created produce fanout de notificaciones **una sola vez** (idempotente por `source_event_id`).
- Sin regresión: `handlers/index.ts` sigue exponiendo `reservation.created` con compose(email, notification).

---

## 6. C5 — EmailFanout (consume `trip.created/postponed/cancelled`)

### Cambios
- **Nuevo** `backend/src/workers/handlers/email-fanout.handler.ts`:
  - Consume `trip.created`, `trip.postponed`, `trip.cancelled`.
  - Resuelve agencias con email (`getAgenciesWithEmail`, ya en `utils/email-fanout.ts`).
  - Por destinatario: insertar fila en `email_delivery_log` (tabla 055, status `pending`, `email_type` = `trip_created` | `trip_postponed` | `trip_cancelled`) **antes** de enviar; marcar `sent` al completar; si `already sent` (PK `(event_id, recipient_id, email_type)`) → skip idempotente.
  - Enviar con templates existentes (`sendNewTripAssignedEmail`, `sendTripPostponedEmail`, `sendTripCancelledEmail` de `email.service.ts`) respetando `notificationDeliveryPolicy.shouldDeliver` (policy por agencia, fail-open).
- **Registro** en `buildDefaultHandlers`: agregar handlers de email para los 3 tipos (compose con el NotificationFanout).

### Límites
- No tocar `email.service.ts`, `email-delivery-policy.ts`, `notification-delivery.policy.ts`. Solo handlers nuevos + registro.

### Tests
- `email-fanout.handler.test.ts`: fanout por agencia; `email_delivery_log` pending→sent; skip si ya `sent` (PK); policy fail-open.

### Criterios de aceptación C5
- Un `trip.created/postponed/cancelled` produce exactamente un email por agencia con log idempotente.
- Sin migraciones; sin cambios en tablas.

---

## 7. C6 — Tests de wiring (service → RPC) y handlers

- Cobertura mínima agregada en C2–C5; este ticket es el **consolidado**:
  - Test de contrato: para cada RPC, verificar que el service pasa los params correctos (argumentos) y propaga errores `ERR_*`.
  - Test E2E-ish con mocks: `create → outbox row → handler email/notif` (se puede simular encadenando mocks; sin DB real).
  - Ampliar `superadmin.add-agencies.test.ts` si aplica (hay cambios de agencias en update).
- **No requiere infraestructura externa** (todo mockeado). Si en el futuro se quiere un harness SQL real para el wiring, documentar como deuda (los harnesses 057 ya validan los RPCs a nivel SQL; el wiring se valida con mocks TS).

---

## 8. C7 — Flip del flag y verificación E2E

> **ESTADO: EJECUTADO** — cutover realizado (`TRIP_EFFECTS_VIA_OUTBOX=true` en entorno tras soak en staging). El default del código permanece `false` como postura de rollback (diseño §8.5): revertir = fijar `false` en entorno.

- Cambiar default a `true` en producción **solo tras soak** en staging:
  - Activar `TRIP_EFFECTS_VIA_OUTBOX=true` en entorno.
  - Soak: crear/editar/cancelar/completar/archivar trips y verificar en `outbox_events` que los eventos trip.* aparecen `completed` (no `failed: No handler`), que no hay doble email/notificación (buscar duplicados por `source_event_id` y por `email_delivery_log`).
  - Verificar que `completeExpiredTrips` produce `trip.auto_completed` y no notificación legacy duplicada.
- Revertir a `false` si se detecta `failed: No handler`, doble emisión o perdida de emails.

---

## 9. C8 — Actualizar documentación

- `TASKS.md:12-18,52` → marcar hitos de WKR-007 completados según lo cerrado; mover WKR-007 a "completado" **solo cuando C7 verificado**.
- `docs/WKR-007-trip-notification-event-workers-design.md` §16/§17/§18 → reflejar estado real: fanout (C4/C5) y flag (C1/C2/C3) implementados; corregir la contradicción señalada (la §16 asumía "handlers listos").
- Anexar referencia al presente plan en `docs/WKR-007-wiring-implementation-plan.md`.
- **NO** se modifican otros docs de diseño (WKR-001/002/003.2) salvo que el cierre lo exija explícitamente.

---

## 10. Orden y dependencias

```
C1 (flag) ──► C2 (service→RPC, flag false default)
                  │
                  ├──► C3 (completeExpiredTrips→complete_trip)
                  │
                  └──► C4 (NotificationFanout) ──► C5 (EmailFanout)
                                                       │
                                                       ▼
                                                C6 (tests consolidados)
                                                       │
                                                       ▼
                                                C7 (flip + soak)
                                                       │
                                                       ▼
                                                C8 (docs)
```

- C1 precede a C2 (el flag se evalúa en C2).
- C2/C3 no dependen de C4/C5 para compilar (el flag permanece `false`); **pero** el flip C7 depende de C4/C5 (sin handlers, un trip.* en outbox terminaría `failed: No handler`).
- C4 y C5 son independientes entre sí y pueden ir en paralelo después de C2.

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Flag activado sin handlers → trip.* a `failed: No handler` | Flip solo en C7, después de C4/C5; monitoreo de `outbox_failed` durante soak |
| Doble email/notificación al activar flag | En C2/C3 el path legacy queda **muerto** bajo flag; el fanout es el único emisor |
| RPC rechaza operaciones que el service permitía (validaciones distintas) | Scope guard 057: validaciones de contexto quedan en el service; el RPC solo protege invariantes/races |
| Retorno de RPC distinto al contrato del endpoint | Re-select de `trips`+`routes`+`trip_agencies` en outbox path (updateTrip/createTrip) |
| Mapeo de errores incompleto | Helper central `mapTripRpcError` con cobertura de tests por código `ERR_*` |

## 12. Definición de "listo"

- Backend `tsc --noEmit` PASS.
- Backend suite completa PASS (280+ nuevos).
- Suites WKR-007 (47) PASS.
- `git diff --check` PASS.
- Verificación en staging con flag `true`: outbox trip.* en `completed`, sin `failed`, sin duplicados en `notifications.source_event_id` ni `email_delivery_log`.
- C8 actualizado.
