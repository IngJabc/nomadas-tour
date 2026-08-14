# F4-004 — Occupancy Urgency Alerts (in-app)

**Tipo:** Diseño / scope-lock (contrato de implementación)
**Fecha:** 2026-08-14
**Estado:** **IMPLEMENTACIÓN EN CURSO** — scope-lock cerrado (P1–P9). Migración 064 creada; no aplicada / no soak aún.
**Rama:** `feat/f4-004-occupancy-urgency-alerts` (sugerida)
**Referencias:** [ROADMAP.md](ROADMAP.md) Fase 4, [TASKS.md](../TASKS.md), [F4-003 design](F4-003-occupancy-alerts-design.md) (CLOSED, operativo en producción), `supabase/migrations/063_evaluate_occupancy_alerts.sql`, `supabase/migrations/057_trip_events_rpc.sql` (`emit_trip_event`), `supabase/migrations/049_outbox_events.sql`, `backend/src/workers/occupancy-alert-scheduler.ts`, `backend/src/workers/runner.ts`, `backend/src/workers/handlers/index.ts`, `backend/src/workers/handlers/notification-fanout.handler.ts`, `backend/src/services/occupancy-alert.service.ts`, `backend/src/services/notification-delivery.policy.ts`, `backend/src/constants/notification-categories.ts`, `backend/src/services/notification.service.ts`, `backend/src/events/trip-occupancy-alert-due.v1.ts`, `backend/src/config/env.ts`, `backend/src/utils/timezone.ts` (`BUSINESS_TIMEZONE = 'America/Caracas'`), `components/dashboard/OccupancyAlertsWidget.tsx`, `components/notifications/notification-config.ts`, `components/notifications/NotificationItem.tsx`, `app/agency/page.tsx`, `supabase/tests/f4_003_verification.sql`, `tests/boarding/f4-003.test.ts`

---

## 1. Purpose

Definir el contrato implementable de la **escalación de urgencia** de F4-003: una alerta in-app adicional cuando un viaje **ya se encuentra en un estado de ocupación relevante de F4-003** (`near_full_alerted` / `underbooked_alerted`) y entra en una **ventana temporal crítica** respecto a su salida (T-24h).

F4-004 **no** es un segundo detector de ocupación: no reinterpreta umbrales, no crea una nueva máquina de estados y no reemplaza F4-003. Es estrictamente una **capa de urgencia temporal sobre el estado persistido de F4-003**.

---

## 2. Problem

F4-003 alerta cuando un viaje entra en un estado de ocupación relevante (`near_full >= 90` / `underbooked <= 20`), pero **no vuelve a alertar** cuando ese viaje continúa en ese estado y la salida se aproxima. Consecuencia operativa: un viaje "Pocas reservas" alertado hace 3 días puede salir sin que la agencia ni el superadmin reciban un aviso de que **la salida es inminente**, aunque el estado de ocupación no haya cambiado.

La infraestructura de F4-003 ya está operativa en producción (`OCCUPANCY_ALERT_VIA_WORKER=true`, migración 063 aplicada, primer tick real scanned=5/evaluated=5/emitted=4). F4-004 reutiliza esa infraestructura para una escalación temporal, sin email en v1 (mismo marco de F4-003).

---

## 3. Beneficiarios / destinatarios

| Rol | ¿Incluido en F4-004? | Regla |
|---|---|---|
| **Agency** | **Sí** | Recibe la escalación in-app **solo** para viajes en los que participa vía `trip_agencies` (asociaciones activas), respetando `agency_notification_preferences.in_app_enabled` para `occupancy_alerts`. |
| **Superadmin** | **Sí** | Recibe la escalación in-app global, **sin opt-out**; no usa `superadmin_notification_preferences`. |
| Pasajeros / bookers | **No** | |

Mismo modelo de destinatarios que F4-003 (§14 de F4-003). No hay destinatarios nuevos.

---

## 4. Current state (repo facts — auditados en esta fecha)

| Capacidad | Estado real verificado |
|---|---|
| RPC `evaluate_occupancy_alerts` (063) | Operativo: keyset `(departure_time, id)`, `FOR UPDATE OF t SKIP LOCKED`, `SECURITY DEFINER`, `SET search_path=public`, EXECUTE `service_role` only, contadores `scanned/evaluated/emitted/skipped/skipped_invalid_occupancy/cleaned_up/batch/has_more/next_cursor`, `has_more` exacto (§L) |
| Tabla `trip_occupancy_alert_state` (063) | Estrategia B: fila solo durante estado alertado; PK `trip_id`; CHECK `alert_type IN ('near_full','underbooked')`; CHECK `state IN ('near_full_alerted','underbooked_alerted')`; RLS on, service_role only |
| `emit_trip_event` (057) | `INSERT ... ON CONFLICT DO NOTHING` (sin conflict target), `dedup_key` unique parcial `053`; `aggregate_type='trip'`, `tenant_id=NULL` |
| `outbox_events.event_type` | TEXT libre — **sin CHECK** (049) → evento nuevo sin cambio de schema |
| Scheduler F4-003 | `startOccupancyAlertScheduler` en `runner.ts`, poll `OCCUPANCY_ALERT_POLL_MS=3600000`, batch `50`, flag `OCCUPANCY_ALERT_VIA_WORKER`, sin hour gate |
| Handler F4-003 | `createNotificationFanoutHandler('trip.occupancy_alert')` con `isEffectsEnabled: () => env.OCCUPANCY_ALERT_VIA_WORKER` (`handlers/index.ts:189-195`); `loadTripAgencyIds` filtra `agencies.status='active'`; `action_url` por rol (agencia → `/agency/trips/{id}/passengers`; superadmin → `/admin/trips/{id}`); idempotencia `source_event_id` + 23505 |
| Preferencias | `occupancy_alerts` solo en `agency_notification_preferences` (default `in_app_enabled=true`); superadmin sin categoría ni gate |
| `notifications.type` | Incluye `occupancy_alert` (063). F4-004 **reutiliza** este tipo; sin cambios |
| Widget de agencia | `OccupancyAlertsWidget.tsx` alimentado por `occupancy_alerts` de `getAgencyDashboard` → `listAgencyOccupancyAlerts` (fuente: `trip_occupancy_alert_state` live + trips + seats; **no** `notifications`); sin cap; orden departure ASC; CTA por rol |
| `BUSINESS_TIMEZONE` | `America/Caracas` (`backend/src/utils/timezone.ts:11`); usado solo para contenido/fechas |
| Notificación urgente en bell | No existe concepto de urgencia hoy (`metadata.urgency` no se usa; `occupancy_alert` sin icono en `NOTIFICATION_ICONS` → fallback `trip_created`, NON-BLOCKING conocido) |
| Test boarding F4-003 | `tests/boarding/f4-003.test.ts:31-42` asume 063 como **tip** → **debe actualizarse** cuando 064 sea el tip |

---

## 5. Goals

1. Escalar in-app (máximo una vez por ciclo de urgencia) cuando un viaje **ya alertado por F4-003** entra en la ventana crítica de salida.
2. Reutilizar 100% la infraestructura de F4-003: mismo scheduler, mismo tick, mismo RPC (extendido), mismo outbox, mismo NotificationFanout, mismas prefs, misma observabilidad.
3. **Sin nueva tabla** y **sin nueva máquina de estados**: la urgencia se deriva de (estado F4-003 persistido + `departure_time` + `dedup_key` de outbox).
4. Anti-spam real: máximo una alerta de urgencia por `(trip_id, alert_type, urgency_window, departure_time)`.
5. Cero PII en evento y contenido; cero cross-tenant leakage.
6. Rollout con flag independiente `OCCUPANCY_URGENCY_VIA_WORKER` default `false` (soak sin alterar F4-003).
7. UI acotada: la urgencia es un **estado visual adicional** del widget existente; sin pantallas nuevas.

---

## 6. Relationship with F4-003

**F4-004 usa exclusivamente el estado persistido de F4-003 (`trip_occupancy_alert_state`) como requisito de entrada.** No recalcula thresholds ni crea un detector paralelo.

Regla de oro:

> **F4-004 NO genera alertas para un viaje que nunca haya entrado en un estado de F4-003.**

Cadena lógica (P4 — FIJADA):

```text
Viaje
  ↓
occupancy cruza umbral F4-003
  ↓
trip_occupancy_alert_state tiene fila (near_full_alerted / underbooked_alerted)
  ↓
departure_time - now() <= T-24h
  ↓
F4-004 → "Sale pronto / Requiere atención"  (una sola vez por ciclo)
```

Reglas de acoplamiento:

- **No** se cambian umbrales de F4-003 (90/85, 20/25).
- **No** se cambia la máquina de estados de F4-003 (Estrategia B, una transición por tick).
- **No** se recalcula ocupación para decidir urgencia: se usa el mismo `occupancy_pct` del tick (contenido) y la fila de estado (requisito).
- **No** se crea una segunda máquina de estados: el ciclo de urgencia es una **escalada one-shot derivada**, no un estado.

**Secuenciación FIJADA (para no doblar notificaciones en el mismo tick):** la escalación solo aplica cuando el viaje **ya estaba alertado al inicio del tick** (la fila `trip_occupancy_alert_state` existía antes de procesar el trip en ese tick). Si el viaje **entra** al estado alertado en ese mismo tick (transición `NORMAL → ALERTED`), F4-004 **no** emite ese tick: la alerta F4-003 aterriza primero y la urgencia se evalúa en un tick posterior mientras siga alertado y en ventana. Esto preserva el espíritu de "una transición por tick" de F4-003 y evita doble notificación simultánea en la campana.

---

## 7. Eligibility

Un viaje es elegible para escalación de urgencia en un tick si cumple **todas**:

1. `trips.status = 'active'` (filtro existente del RPC).
2. `departure_time > now()` (filtro existente del RPC).
3. Tiene fila en `trip_occupancy_alert_state` con `state IN ('near_full_alerted','underbooked_alerted')`.
4. La fila **existía al inicio del tick** (§6 — secuenciación; el `v_existing_type` leído al inicio del loop no es NULL).
5. `departure_time - now() <= INTERVAL '24 hours'` (ventana T-24h, §9).
6. La escalación no fue ya emitida para el ciclo `(trip_id, alert_type, window, departure_time)` (dedup outbox, §10).

**Comportamiento de casos determinados expresamente (P2 — FIJADO):**

| Caso | Comportamiento F4-004 |
|---|---|
| `total <= 0` | **Nunca** elegible: F4-003 omite el trip (no crea fila de estado) → no existe estado del que escalar. No se evalúa. |
| `reserved > total` | **Nunca** elegible: idem (F4-003 `skipped_invalid_occupancy`, sin fila de estado). |
| Viaje `cancelled` | No elegible: el cleanup de F4-003 elimina la fila de estado → desaparece la condición 3. |
| Viaje `completed` / `auto_completed` | No elegible: `status <> 'active'` + cleanup. |
| `departure_time` pasada | No elegible: condición 2 + cleanup de F4-003 elimina la fila. |
| Agencia desactivada | No elegible para esa agencia: `loadTripAgencyIds` filtra `agencies.status='active'` (entrega), sin cambio en RPC. |
| Ocupación en zona de hysteresis (21–25 / 85–89) | El trip permanece alertado (sin transición F4-003) → si entra en ventana, la escalación aplica normalmente (el estado sigue vigente). |
| Ocupación 0% (sin reservas) | `underbooked` (0 ≤ 20) → alertado → elegible para escalación en ventana. Sin lógica especial (P2: "0 reservas no se trata distinto"). |

---

## 8. Timing

- **Scheduler:** el **mismo** `startOccupancyAlertScheduler` de F4-003 (frecuencia 1h, sin hora diaria). **No** se crea un segundo scheduler ni un segundo proceso.
- **Tick:** F4-004 se evalúa **dentro del mismo tick** de F4-003, **dentro del mismo RPC** `evaluate_occupancy_alerts` (extendido de forma acotada, §11).
- **No** hay ventana diaria: la urgencia es puramente temporal respecto a `departure_time`.
- **Granularidad de emisión:** la emisión ocurre en el primer tick en que `departure_time - now() <= 24h` con el viaje alertado; como el poll es horario, el disparo real es "dentro de la primera hora tras cruzar T-24h". Esto es aceptable y se documenta (no hay garantía de segundo exacto).

**Decisión de timing (FIJADA):** reutilizar exactamente el scheduler y el tick de F4-003. La ventana se evalúa en el RPC; el flag de entrega (`OCCUPANCY_URGENCY_VIA_WORKER`) se pasa como parámetro booleano del RPC (`p_urgency_enabled`) para permitir soak sin alterar el comportamiento de F4-003 (§11, §17).

---

## 9. Urgency window

**Ventana FIJADA: T-24h** (escalación cuando `departure_time - now() <= 24 horas`).

| Criterio | T-24h (elegida) | T-48h (descartada) |
|---|---|---|
| Valor operativo | "La salida es mañana/hoy": momento crítico real de venta/cancelación/reasignación | Anticipa demasiado; la agencia ya vio el estado al entrar |
| Relación WKR-008 | Alinea con el reminder **T-24h** ("Tu viaje sale mañana", dirigido a bookers); el último aviso operativo a la agencia coincide con el último aviso al pasajero | Duplicaría el arco temporal del reminder T-48h |
| Frecuencia / spam | Máximo 1 alerta por `(trip, type, window, departure)` → superficie acotada | ~el doble de superficie de escalación para valor marginal |
| Diferencia vs digest | El digest (F4-001/F4-002) es 07:00 diario y resume; T-24h es un aviso puntual de urgencia, no un resumen | T-48h se solaparía conceptualmente con el alcance del digest diario |
| Justificación fuerte para ambas ventanas en v1 | **No existe** → no se permite | — |

**Constante (versionada en código, NO env var):** ventana = `24h`. En SQL: `INTERVAL '24 hours'`. En frontend (widget): `24 * 60 * 60 * 1000` ms. En código TS (handler/constantes): `OCCUPANCY_URGENCY_WINDOW_MS = 86_400_000`. Valor de la constante en el payload: `urgency_window: 't24'`.

**Condición exacta (FIJADA):** en el RPC, un viaje alertado (condiciones §7) emite escalación cuando `(v_locked.departure_time - v_now) <= INTERVAL '24 hours'`. `departure_time > v_now` ya está garantizado por el filtro del loop. En el widget, `urgency = (departure_time - now) <= 24h`.

---

## 10. Anti-spam

**Regla (P3 — FIJADA):** máximo **una** alerta de urgencia por `(trip_id, alert_type, urgency_window, departure_time)`.

```text
trip X · underbooked · t24 · departure D
  → una alerta
  → nunca otra mientras el trip permanezca elegible para t24 con departure D
```

**Mecanismo:** el `dedup_key` del outbox (unique parcial `053`, `ON CONFLICT DO NOTHING`) es la autoridad de emisión; no hay cooldown periódico adicional en v1 (mismo modelo anti-spam que F4-003, pero la identidad es el ciclo de urgencia, no la transición).

**Identidad del ciclo (FIJADA — incluye `departure_time` para soportar postponement):**

```text
dedup_key = trip.occupancy_urgency:{trip_id}:{alert_type}:{urgency_window}:{departure_time_UTC_canonical}
```

donde `{departure_time_UTC_canonical}` es el instante del viaje al momento de emisión, formateado como en F4-003: `to_char(departure_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.

**Comportamiento por caso (FIJADO):**

| Caso | Comportamiento |
|---|---|
| Viaje alertado y en ventana (estable) | Primera vez → emite. Ticks posteriores → `dedup` bloquea (`already_escalated++`). |
| Retry del outbox | `ON CONFLICT DO NOTHING` → sin duplicado; handler idempotente por `source_event_id`. |
| Sale de `underbooked` → `NORMAL` → vuelve a `underbooked` (misma departure, misma ventana) | `dedup_key` idéntico (trip, type, t24, misma departure) → **no** duplica. |
| **Postponement** (departure cambia) | Nueva departure → nuevo `dedup_key` → **nueva alerta de urgencia** cuando la nueva departure entre en ventana. Decisión: **sí genera nueva alerta** (la anterior describía la salida vieja; el cambio de horario ya notifica `trip.postponed`). |
| Cruza otra vez la ventana tras salir (viaje futuro distinto / re-entry con misma departure) | Con la misma departure, `dedup_key` estable → no duplica. |
| Worker restart / multi-instance | Estado en DB + `FOR UPDATE SKIP LOCKED` serializa; `dedup_key` en outbox idempotente. |
| Duplicate invocation | `ON CONFLICT DO NOTHING` + conteo `before/after` (patrón F4-003) → segunda invocación cuenta `already_escalated`. |

**Ciclo derivable y seguro:** la identidad es determinista (derivable de datos existentes) y nunca produce duplicados para el mismo ciclo; el postponement genera un ciclo nuevo (decisión explícita, no ambigua).

---

## 11. RPC / transaction

**Decisión (FIJADA):** **extender de forma cuidadosamente acotada** el RPC existente `evaluate_occupancy_alerts` (migración propia `064`), manteniendo atomicidad y reutilizando el estado F4-003. **No** se crea `evaluate_occupancy_urgency` ni una segunda evaluación en el ciclo.

### Cambios sobre el RPC (migración `064_evaluate_occupancy_urgency.sql`)

1. **Firma:** `evaluate_occupancy_alerts(p_batch INTEGER DEFAULT 50, p_after_departure TIMESTAMPTZ DEFAULT NULL, p_after_id UUID DEFAULT NULL, p_urgency_enabled BOOLEAN DEFAULT FALSE)`. PostgreSQL permite añadir el argumento final con default vía `CREATE OR REPLACE`; la llamada de 3 argumentos (harness F4-003 y scheduler actual) **sigue funcionando** con semántica `urgency off`.
2. **Postura inalterada:** `SECURITY DEFINER`, `SET search_path = public`, loop keyset `(departure_time, id)`, `FOR UPDATE OF t SKIP LOCKED`, una transición F4-003 por tick, cleanup, `has_more` exacto, contadores existentes — **sin cambios**.
3. **Bloque de urgencia** dentro del loop, **solo** en las ramas donde el viaje permanece alertado (es decir, donde `v_existing_type` no es NULL al inicio del tick y NO hubo reset):

   - Rama `v_existing_type = 'near_full'` y `v_occupancy >= 85` (permanece alertado):
     si `p_urgency_enabled` y `(v_locked.departure_time - v_now) <= INTERVAL '24 hours'` → emitir escalación.
   - Rama `v_existing_type = 'underbooked'` y `v_occupancy <= 25` (permanece alertado): idem.
   - Rama `v_existing_type IS NULL` (entra en estado este tick): **no** emite (secuenciación §6).
   - Rama reset (`ALERTED → NORMAL`): **no** emite (ya no hay estado alertado).
   - `p_urgency_enabled = FALSE`: ninguna emisión; **se cuentan candidatos** (`urgency_matches`) para visibilidad de soak sin efectos.

4. **Emisión** (misma transacción, patrón F4-003 §L): `v_dedup_key := 'trip.occupancy_urgency:' || trip_id || ':' || alert_type || ':t24:' || to_char(departure UTC)`; `v_payload := jsonb_build_object('trip_id', id, 'alert_type', ..., 'occupancy_pct', v_occupancy, 'departure_time', ..., 'route_id', ..., 'urgency_window', 't24')`; conteo `before` → `PERFORM emit_trip_event('trip.occupancy_urgency.due', id, payload, dedup_key)` → conteo `after`; `after > before` → `urgency_emitted++`, si no → `already_escalated++`. Con `p_urgency_enabled = FALSE` y candidato en ventana → `urgency_matches++` (sin emisión).
5. **Retorno JSONB** aditivo: se añaden `urgency_matches`, `urgency_emitted`, `already_escalated` (0 por defecto). Los consumidores existentes (`parseEvaluateResult`) ignoran claves nuevas → **retrocompatible**.
6. **Grants:** la firma cambia de 3 a 4 argumentos → re-aplicar `REVOKE ... FROM PUBLIC/anon/authenticated` y `GRANT EXECUTE ... TO service_role` sobre la nueva firma. El harness F4-003 (A/B) consulta por nombre y sigue pasando; la llamada 3-arg sigue válida por el default.

**Por qué extender en lugar de separar:** una sola transacción conserva el lock y el estado; evita una segunda pasada con su propio `SKIP LOCKED`; garantiza coherencia atómica entre la evaluación F4-003 y la escalación; cero riesgo de divergencia temporal entre dos RPCs. La puerta `p_urgency_enabled` mantiene el contrato de F4-003 intacto durante el soak.

---

## 12. Event architecture

### Contrato: `trip.occupancy_urgency.due.v1`

```text
event_type      = trip.occupancy_urgency.due
event_version   = 1
aggregate_type  = trip
aggregate_id    = trip_id
tenant_id       = NULL        (evento global; el fan-out decide destinatarios)
```

**Payload mínimo (sin PII):**

```text
{
  trip_id:        string   (uuid)
  alert_type:     'near_full' | 'underbooked'
  occupancy_pct:  number   (0-100, valor vivo del tick de emisión; contenido)
  departure_time: string   (ISO UTC; para contenido/CTA)
  route_id:       string   (uuid; para label origin→destination en handler)
  urgency_window: 't24'    (constante de la ventana; valor equivalente a t24)
}
```

**NO incluir:** `agency_ids`, emails, pasajeros, booker, documentos, teléfonos, conteos por agencia, token de idempotencia (`dedup_key` se computa en el emisor y no forma parte del contrato — patrón F4-003 §12).

**Nuevo módulo evento:** `backend/src/events/trip-occupancy-urgency-due.v1.ts` (espejo de `trip-occupancy-alert-due.v1.ts`): tipo/versión/aggregate, validador `isTripOccupancyUrgencyDuePayloadV1`, `urgencyDedupKey(tripId, alertType, window, departureUtc)`, parser. Exportar en `events/index.ts`.

**Emisor:** el RPC extendido (§11) vía `emit_trip_event` (057). **Sin** cambio en `outbox_events` (event_type TEXT libre, 049).

**Tenant behavior:** mismo que F4-003 — una sola fila outbox por escalación (global), fan-out a N destinatarios en el handler; sin evento por agencia.

---

## 13. NotificationFanout

F4-004 usa **NotificationFanout** (in-app). No EmailFanout, no `email_delivery_log`, no Resend, no `EMAIL_DELIVERY_MODE`.

- **Registro:** `createNotificationFanoutHandler('trip.occupancy_urgency', { ...createDefaultNotificationFanoutDeps(), isEffectsEnabled: () => env.OCCUPANCY_URGENCY_VIA_WORKER })` en `handlers/index.ts` (patrón F4-003 `handlers/index.ts:189-195`). El nuevo tipo se añade a la unión `NotificationFanoutEvent` y al `switch` de `buildRowsForEvent`.
- **Rows:** mismas que F4-003: fila por agencia asociada (`recipient_role:'agency'`, `agency_id`) + una fila superadmin (`recipient_role:'superadmin'`, `agency_id:null`). `filterAgencyNotificationRows` respeta `in_app_enabled` por agencia (mecanismo existente, sin cambios).
- **`action_url` por rol:** agencia → `/agency/trips/{trip_id}/passengers`; superadmin → `/admin/trips/{trip_id}`.
- **Tipo de notificación:** **`occupancy_alert`** (reutilizado; sin nuevo `NotificationType`, sin cambios al CHECK `notifications_type_check`).
- **Metadata (FIJADA):** `{ alert_type, occupancy_pct, trip_id, urgency: true, urgency_window: 't24' }`. La ausencia de `urgency` distingue la alerta normal; `urgency: true` la escalación.
- **Idempotencia:** `source_event_id = id del evento outbox` + 23505 (mecanismo existente); partial delivery completa solo filas faltantes.
- **Contenido (P9, §15):** copy de urgencia distinto al de F4-003.

---

## 14. Preferences

**Decisión (P7 — FIJADA): reutilizar la categoría `occupancy_alerts`.**

| Propiedad | Valor |
|---|---|
| Categoría | `occupancy_alerts` (existente) |
| Alcance | Solo agencia (`agency_notification_preferences`) |
| Default in-app (agencia) | `in_app_enabled = TRUE` (existente, sin cambios) |
| Opt-out agencia | Sí — `filterAgencyNotificationRows` la respeta (existente) |
| Opt-out superadmin | No — todos los superadmins reciben la escalación; sin `superadmin_notification_preferences` |
| Email | No en v1 (`email_enabled` no aplica a la entrega in-app) |
| Frontend | Distingue normal vs urgente **sin nueva categoría**: vía `metadata.urgency` (campana) y vía derivación temporal (widget). **No** se agrega categoría a `NOTIFICATION_CATEGORIES`, `NOTIFICATION_TYPE_TO_CATEGORY` ni `CATEGORY_METADATA`. |

**Justificación:** F4-004 es una escalación de la **misma señal** (ocupación), no una capacidad de notificación conceptualmente diferente; una categoría propia obligaría a duplicar prefs y la UI de settings para un opt-out que no aporta (la agencia que apaga `occupancy_alerts` quiere apagar ambas). La distinción visual (urgente) es **presentacional**, no de preferencia.

---

## 15. Targeting / multi-tenancy

**Decisiones (P5 — FIJADAS):**

- **Shared trips:** una única alerta de dominio (`tenant_id=NULL`, `aggregate_type=trip`, una fila outbox por escalación); fan-out a **todas** las agencias asociadas vía `trip_agencies` (solo asociaciones activas — `loadTripAgencyIds` filtra `agencies.status='active'`) + superadmin. **Nunca** un evento por agencia.
- **Agency isolation:** una agencia recibe la escalación **solo si participa en el viaje** (`trip_agencies.agency_id`). No cross-tenant leakage.
- **Superadmin:** global, incondicional, sin gate de preferencia.
- **RLS:** `notifications` ya aísla lectura por agencia (029); la fila superadmin tiene `agency_id=null` y `recipient_role='superadmin'`.

Ninguna lógica nueva de tenancy; se hereda el contrato de F4-003 (§14 F4-003).

---

## 16. UI — widget "Alertas de ocupación"

**Decisión (P8 — FIJADA): sin pantalla nueva.** Se extiende el widget existente `OccupancyAlertsWidget` para que la urgencia sea un **estado visual adicional** de la misma tarjeta (no una lista separada).

### Fuente de datos

- El widget sigue alimentándose de `occupancy_alerts` → `listAgencyOccupancyAlerts` (estado persistido `trip_occupancy_alert_state` live + trips + seats; **no** `notifications`).
- **Derivación de urgencia (FIJADA):** el servicio añade `urgency: boolean` a `AgencyOccupancyAlertRow`, donde `urgency = (departure_time - now) <= 24h`. Es derivación **en tiempo de lectura** desde datos existentes; **no requiere persistencia ni flag de entrega** (el widget muestra la verdad operativa incluso durante el soak del flag de notificación).
- **Ordenación (FIJADA):** urgentes primero (`urgency DESC`), luego el resto; dentro de cada grupo `departure_time ASC` (el servicio ya ordena por departure ASC; el sort por urgencia se añade en el servicio para una única fuente de verdad).
- **Max items (FIJADA):** sin cap en v1 (paridad con F4-003).

### Jerarquía visual por fila

```text
┌───────────────────────────────────────────────────────────┐
│ Alertas de ocupación                                      │
│                                                           │
│ [Casi lleno]  ·  [Sale pronto]   🔴 (acento danger)       │
│ Barquisimeto → Caracas                                    │
│ Sale hoy · 18:00                                          │
│ 94% · 29/31 reservados                                    │
│ [Ver viaje]                                               │
│                                                           │
│ [Pocas reservas] · [Sale pronto]  🔴 (acento danger)       │
│ Valencia → Caracas                                        │
│ Sale en 6h                                                │
│ 12% · 4/31 reservados                                     │
│ [Ver viaje]                                               │
│                                                           │
│ [Casi lleno]  (sin pill de urgencia)                      │
│ Maracaibo → Mérida                                        │
│ Sale mañana · 10:00                                       │
│ 92% · 28/31 reservados                                    │
│ [Ver viaje]                                               │
└───────────────────────────────────────────────────────────┘
```

- **Badge de urgencia:** pill `Sale pronto` con icono `Clock` (Lucide, stroke 1.75), fondo `#fef2f2`, texto `#ef4444` (danger — reglas de badges AGENTS.md). No se usa cyan para bordes/fondos decorativos (regla 17).
- **Icono:** el badge de urgencia lleva `Clock`; la alerta normal conserva `AlertTriangle` existente. La urgencia **no** cambia el icono de la fila completa.
- **Copy (P9):** badge `Sale pronto`. Los badges base de F4-003 se mantienen (`Casi lleno` / `Pocas reservas`).
- **Acento de tarjeta:** para la fila urgente, borde izquierdo o fondo sutil danger (`#fef2f2`) como indicador adicional no-color-dependiente (siempre acompañado del texto "Sale pronto" — accesible sin depender solo de color).
- **Empty state:** sin cambios (mantiene CTA "Ver viajes").
- **Responsive / accesibilidad:** se reutiliza el layout existente (card → flex row/col); la urgencia se comunica con texto + icono + color (no solo color).
- **CTA:** sin cambios — "Ver viaje" con deep-link por rol (`/agency/trips/{id}/passengers`).

### Campana in-app (NotificationItem)

- La escalación es una fila `type='occupancy_alert'` con `metadata.urgency === true`.
- **Distinción visual (FIJADA):** `NotificationItem` renderiza un chip pequeño `Sale pronto` cuando `notification.metadata?.urgency === true`. Opcional (polish, no bloqueante): añadir la clave `occupancy_alert` a `NOTIFICATION_ICONS` para que la campana deje de usar el fallback `trip_created` (observación NON-BLOCKING de F4-003; se aprovecha para mejorar la legibilidad de la escalación). No es obligatorio para el contrato.

---

## 17. Environment variables

**FIJADO:** una sola variable nueva.

| Variable | Default | Servicio | Render manual | Soak | Activar | Redeploy |
|---|---|---|---|---|---|---|
| `OCCUPANCY_URGENCY_VIA_WORKER` | `false` | Worker (scheduler vía `p_urgency_enabled` + handler NotificationFanout) | **Sí** | `false` | `true` (tras soak/audit) | Sí |

**Por qué un flag independiente y no reutilizar `OCCUPANCY_ALERT_VIA_WORKER`:**

1. **Rollout aislado:** F4-003 ya está en producción (`true`). Apagar/reactivar F4-003 para controlar F4-004 rompería el servicio operativo; el flag independiente permite **soak de F4-004 sin tocar F4-003**.
2. **Postura de rollback:** ante un problema de la escalación, se apaga `OCCUPANCY_URGENCY_VIA_WORKER` sin afectar las alertas base.
3. **Doble puerta:** el RPC recibe `p_urgency_enabled = env.OCCUPANCY_URGENCY_VIA_WORKER` (no emite con flag off) y el handler tiene `isEffectsEnabled = env.OCCUPANCY_URGENCY_VIA_WORKER` (no entrega con flag off). Durante soak no se generan eventos de urgencia ni filas de notificación.

**No** se crean env vars para thresholds ni ventana: T-24h es constante versionada (código/SQL/frontend, §9), como los umbrales de F4-003.

**Implementación documentada (NO realizada aquí):** definir en `backend/src/config/env.ts` (`OCCUPANCY_URGENCY_VIA_WORKER`, preprocess booleano, default `false`), documentar en `backend/.env-example`, extender `getWorkerRuntimeConfig` y el log `worker_started`. **Definir default en código o `.env-example` NO configura Render**: `OCCUPANCY_URGENCY_VIA_WORKER` debe **agregarse manualmente en Render (servicio worker)** (ver §23 rollout).

---

## 18. Observability

**Decisión (FIJADA):** extender los logs del scheduler compartido (una sola familia `occupancy_alert_scheduler_*`); **no** se crea una familia `occupancy_urgency_scheduler_*` porque es el mismo tick y el mismo RPC.

- `occupancy_alert_scheduler_started` → añade `occupancy_urgency_via_worker`.
- `occupancy_alert_scheduler_tick` → añade:
  - `urgency_matches` — candidatos (viaje alertado + en ventana) en el tick;
  - `urgency_emitted` — escalaciones insertadas en el outbox;
  - `already_escalated` — intentos bloqueados por `dedup_key` (ciclo ya emitido).
- `occupancy_alert_scheduler_error` / `_stopped` — sin cambios.

Los tres contadores provienen del JSONB del RPC (§11) y se añaden a `OccupancyAlertEvaluateResult` + `parseEvaluateResult`.

Reglas:
- Sin PII (solo ids, conteos, `duration_ms`).
- Errores inesperados → manejo existente del scheduler (log) + Sentry según wiring global del worker; nunca para ticks normales/skips (paridad F4-003).

---

## 19. Security / tenancy

- Worker usa `service_role`; RPC `SECURITY DEFINER`, `SET search_path = public`, EXECUTE solo `service_role` (re-grant tras cambio de firma).
- Filtros explícitos: `trips.status='active'`, `departure_time > now`, estado F4-003 vigente, ventana `<= 24h`.
- Destinatarios: solo `trip_agencies.agency_id` del viaje (asociaciones activas) + superadmin. **No cross-agency leakage.**
- Sin PII en payload, metadata ni contenido; el evento es global (`tenant_id=NULL`) y el fan-out por agencia; RLS de `notifications` aísla lectura.
- No se exponen umbrales, ventana ni configuración a clientes.
- La urgencia no introduce nuevos estados ni expone `dedup_key`/`transition` en el payload (validador lo rechaza).

---

## 20. IN scope

- Extensión acotada del RPC `evaluate_occupancy_alerts` (migración `064`): `p_urgency_enabled` + bloque de emisión de urgencia en ramas "permanece alertado" + contadores.
- Evento `trip.occupancy_urgency.due.v1` + parser + `dedup_key` (sin cambios a `outbox_events`).
- `handlers/index.ts`: registro de `trip.occupancy_urgency.due` → NotificationFanout con gate `OCCUPANCY_URGENCY_VIA_WORKER`; caso nuevo en `notification-fanout.handler.ts` (copy de urgencia, metadata `urgency:true`, `action_url` por rol).
- Scheduler F4-003: pasar `p_urgency_enabled = env.OCCUPANCY_URGENCY_VIA_WORKER`; extender `OccupancyAlertEvaluateResult`/`parseEvaluateResult` y logs con `urgency_matches` / `urgency_emitted` / `already_escalated`.
- `config/env.ts` + `.env-example` + `workers/config.ts` + `worker_started`: `OCCUPANCY_URGENCY_VIA_WORKER`.
- Servicio `listAgencyOccupancyAlerts`: añadir `urgency: boolean` (derivación T-24h) y ordenación urgente-primero.
- Widget `OccupancyAlertsWidget.tsx`: pill `Sale pronto` (icono `Clock`, danger), ordenación, jerarquía visual; sin cap.
- `NotificationItem.tsx`: chip `Sale pronto` cuando `metadata.urgency === true`. (Polish opcional: clave `occupancy_alert` en `NOTIFICATION_ICONS`.)
- Harness SQL `supabase/tests/f4_004_verification.sql` + test boarding `tests/boarding/f4-004.test.ts` + **actualizar la aserción "tip" en `tests/boarding/f4-003.test.ts`** (063 → 064).
- Tests unitarios (evento, scheduler/parse, handler, servicio/widget) + regresión F4-001/002/003, WKR-007/008/009.
- Soak `false` → `true` + evidencia en producción; observabilidad; cierre documental.

---

## 21. OUT of scope

F4-004 **no**:

- reemplaza F4-003 ni cambia sus umbrales ni su máquina de estados;
- crea un segundo detector de ocupación (no evalúa thresholds);
- crea analytics ni reportes históricos;
- crea entrega por email (no Resend, no EmailFanout, no `email_delivery_log`);
- crea thresholds configurables por agencia;
- crea seat quotas;
- crea un dashboard de alertas nuevo ni una pantalla nueva;
- crea un segundo worker ni scheduler propio;
- crea pg_cron;
- crea una nueva categoría de preferencia ni cambia `notifications.type`;
- introduce una tabla nueva ni una máquina de estados nueva;
- toca `getDashboard()` / `getAgencyTrips` / la semántica canónica de occupancy (follow-up F4-003 §25 permanece).

Es estrictamente **una capa de escalación de urgencia sobre F4-003**.

---

## 22. Decided (scope-lock v1)

| Decisión | Valor |
|---|---|
| Ventana | **T-24h** (`departure_time - now <= 24h`), constante versionada, sin env var |
| Modelo | Escalación one-shot derivada del estado F4-003 persistido + `departure_time` |
| Requisito de entrada | Fila `trip_occupancy_alert_state` vigente **existente al inicio del tick** |
| Secuenciación | Si el viaje entra al estado alertado este tick → la urgencia espera al siguiente tick |
| Anti-spam | Máx. 1 por `(trip_id, alert_type, urgency_window, departure_time)` vía `dedup_key` outbox; sin cooldown adicional |
| Postponement | Nueva departure → nuevo ciclo → nueva alerta (incluye `departure_time` en `dedup_key`) |
| Re-entry misma departure/ventana | No duplica (dedup estable) |
| Scheduler / tick | Reutiliza exactamente el scheduler y tick de F4-003; mismo RPC extendido |
| RPC | `evaluate_occupancy_alerts` (064) con `p_urgency_enabled BOOLEAN DEFAULT FALSE`; misma postura de seguridad; retorno aditivo |
| Evento | `trip.occupancy_urgency.due.v1`, `tenant_id=NULL`, payload mínimo sin PII + `urgency_window:'t24'` |
| Handler | NotificationFanout con gate `OCCUPANCY_URGENCY_VIA_WORKER`; `type='occupancy_alert'`; metadata `urgency:true`; `action_url` por rol |
| Preferencias | Categoría `occupancy_alerts` reutilizada (solo agencia); superadmin incondicional |
| UI | Widget existente; urgencia = estado visual adicional (pill `Sale pronto`, danger, `Clock`); urgentes primero; sin cap; CTA sin cambios |
| Env var | `OCCUPANCY_URGENCY_VIA_WORKER` default `false` (única nueva) |
| Persistencia | Sin tabla nueva (urgencia derivable de estado + departure + dedup outbox) |

---

## 23. Product decisions — CERRADAS (P1–P9)

| ID | Decisión cerrada |
|---|---|
| **P1 — Ventana** | **T-24h**. Alineada con WKR-008 T-24h, distinta del digest, menor spam, valor operativo máximo. No se permiten dos ventanas en v1. |
| **P2 — Elegibilidad** | Trip `active` + future + fila de estado F4-003 vigente + en ventana + fila pre-existente al inicio del tick. `total<=0`, `reserved>total`, cancelado/completado/salida pasada → nunca elegible (sin estado del que escalar). Agencia desactivada → filtro de entrega. 0 reservas → underbooked normal (sin caso especial). |
| **P3 — Anti-spam** | Máx. 1 alerta de urgencia por `(trip_id, alert_type, urgency_window, departure_time)`; sin cooldown periódico. Ciclo derivable y seguro ante re-entry; postponement = ciclo nuevo. |
| **P4 — Relación F4-003** | Estado persistido de F4-003 = requisito de entrada; datos vivos solo para contenido. Sin nueva máquina de estados. |
| **P5 — Destinatarios** | Agencias asociadas activas (`trip_agencies`) respetando `in_app_enabled`; superadmin global sin opt-out; sin `superadmin_notification_preferences`. |
| **P6 — Canal** | In-app only v1. Sin Resend/EmailFanout/`email_delivery_log`. |
| **P7 — Categoría** | Reutilizar `occupancy_alerts`. Frontend distingue normal/urgente por `metadata.urgency` (campana) y derivación temporal (widget), sin categoría nueva. |
| **P8 — UI** | Extender el widget existente: badge `Sale pronto` (danger + `Clock`), urgentes primero (departure ASC), sin cap, empty state y CTA sin cambios; sin pantallas nuevas. |
| **P9 — Copy** | Badge: **"Sale pronto"**. Normal (base F4-003 intacta): "Viaje casi lleno" / "Viaje con pocas reservas". Urgente título: **"Viaje casi lleno — sale pronto"** / **"Viaje con pocas reservas — sale pronto"**. Body: **`{destination} sale pronto · {pct}% ({reserved}/{total})`**. Sin términos técnicos (no "underbooked"/"urgency"/"occupancy state"). |

**No quedan decisiones de producto abiertas antes de implementación.**

---

## 24. Testing / Definition of Done

### Pruebas mínimas

**Eligibility:**
- Alertado + fuera de ventana (`> 24h`) → no urgencia.
- Alertado + en ventana (`<= 24h`) → urgencia (una emisión).
- `NORMAL` (sin fila de estado) → no urgencia aunque esté en ventana.
- Entrada al estado alertado este tick → no urgencia este tick; tick posterior (aún alertado + ventana) → urgencia.

**Threshold relationship (sin detector duplicado):**
- `near_full` (>=90) y `underbooked` (<=20) generan urgencia **solo** cuando existe fila de estado; los casos 20/21/25/26/85/89/90/100 se resuelven por el estado F4-003 vigente, no por reevaluación.

**Dedup:**
- Mismo `(trip, type, window, departure)` → una sola alerta; segunda invocación → `already_escalated`, sin evento nuevo.
- Retry del outbox → sin duplicado (`ON CONFLICT DO NOTHING`); handler idempotente por `source_event_id`.
- Nuevo ciclo válido (nueva departure) → nueva alerta.

**Postponement:**
- Departure cambia → nueva departure en ventana → nueva alerta (dedup con departure nueva).
- Misma departure, re-entry a `underbooked` en la misma ventana → no duplica.

**Targeting:**
- Agencia asociada recibe; agencia no asociada **no** recibe; shared trip → fan-out a todas las asociadas; superadmin recibe.

**Preferences:**
- `in_app_enabled=true` → entrega; `false` → fila de agencia filtrada; superadmin sin gate.

**UI:**
- Badge `Sale pronto` presente solo con `urgency === true`; ordenación urgentes-primero + departure ASC; copy P9; CTA por rol intactos; empty state intacto.

**Contrato SQL (harness `f4_004_verification.sql`, BEGIN/ROLLBACK):**
- A) RPC extendido existe, `SECURITY DEFINER`, `search_path=public`, firma 4-arg con default; B) grants `service_role` only; C) `p_urgency_enabled=FALSE` no emite urgencia (F4-003 intacto); D) `p_urgency_enabled=TRUE` + alertado + ventana → 1 evento `trip.occupancy_urgency.due` con payload sin PII y `urgency_window='t24'`; E) segundo tick → sin duplicado (`already_escalated`); F) secuenciación (entrada este tick → sin urgencia); G) postponement (departure nueva en ventana → nueva emisión); H) fuera de ventana → sin urgencia; I) sin fila de estado → sin urgencia; J) limpieza heredada de F4-003 (sin lógica nueva de cleanup).

**Regression:**
- F4-001, F4-002, F4-003 (harness existente sigue PASANDO con la firma extendida), WKR-007, WKR-008, WKR-009.
- `tests/boarding/f4-003.test.ts`: actualizar aserción "tip es 063" → **064** (requisito explícito) y "sin modificaciones en 001–062" sigue aplicando a ≤062.

### Definition of Done

- [ ] Design vigente (scope-lock **cerrado**, P1–P9 fijadas).
- [ ] Migración `064_evaluate_occupancy_urgency.sql`: firma 4-arg con default, `SECURITY DEFINER`/`search_path=public`, bloque de urgencia en ramas "permanece alertado", contadores aditivos, re-grant `service_role` only.
- [ ] F4-003 intacto con `p_urgency_enabled=FALSE` (harness F4-003 pasa en producción).
- [ ] Evento `trip.occupancy_urgency.due.v1` + parser + `dedup_key` con `departure_time`.
- [ ] Handler NotificationFanout con gate `OCCUPANCY_URGENCY_VIA_WORKER`; `type='occupancy_alert'`; metadata `urgency:true`; `action_url` por rol.
- [ ] Scheduler: `p_urgency_enabled` desde env; contadores/logs extendidos.
- [ ] `listAgencyOccupancyAlerts` con `urgency` y orden urgente-primero; widget con pill `Sale pronto`; chip en `NotificationItem`.
- [ ] Sin email v1, sin tabla nueva, sin scheduler nuevo, sin categoría nueva.
- [ ] Harness SQL + boarding/unit + regresión verdes.
- [ ] `tsc --noEmit` + backend build + frontend build verdes.
- [ ] Soak `OCCUPANCY_URGENCY_VIA_WORKER=false` → `true` en producción; logs y evento real verificados.
- [ ] Cierre documental posterior (TASKS/ROADMAP/HISTORY).
- [ ] OUT respetado (§21).

---

## 25. Follow-ups

| Ticket | Tema |
|---|---|
| Futuro | Email como segundo canal de la escalación de urgencia (requiere entorno Resend comercial) — heredado de F4-003 §25. |
| Futuro | Ventanas adicionales (p.ej. T-6h / T-2h) — v1 es T-24h única. |
| Futuro | Umbrales/ventana configurables por agencia — v1 global/versionado. |
| Futuro | Normalización de occupancy comercial en `reservation.service.ts:1096,1145` (heredado, follow-up F4-003). |
| Futuro | Superficie UI en dashboard superadmin para listar alertas activas (heredado, follow-up F4-003). |
| Polish (no bloqueante) | Añadir clave `occupancy_alert` a `NOTIFICATION_ICONS` (hoy usa fallback `trip_created`). |

---

## 26. Scope Guard

F4-004 **NO** incluye email/Resend, thresholds ni ventanas configurables, analytics, seat quotas, una segunda detección de ocupación, una tabla nueva, una máquina de estados nueva, un scheduler/proceso nuevo, pg_cron, ni cambios a `getDashboard()`, `notifications.type`, `NOTIFICATION_CATEGORIES` o la semántica canónica de occupancy. El único mecanismo de entrega v1 es **NotificationFanout (in-app)** reutilizando `occupancy_alert`, y la única superficie UI es el widget existente con el estado visual adicional de urgencia. F4-004 es **una capa de escalación de urgencia sobre F4-003**, nada más.
