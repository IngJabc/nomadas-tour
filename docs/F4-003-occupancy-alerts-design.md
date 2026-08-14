# F4-003 — Occupancy Alerts (in-app)

**Tipo:** Diseño / scope-lock (contrato de implementación)
**Fecha:** 2026-08-13 · **Cierre:** 2026-08-14
**Estado:** **CLOSED** — Operativo / Completado (migración 063 aplicada; harness PASS; cutover `OCCUPANCY_ALERT_VIA_WORKER=true`; evidencia de producción).
**Rama:** `feat/f4-003-occupancy-alerts` (historial en TASKS-HISTORY Sprint 19)
**Referencias:** [ROADMAP.md](ROADMAP.md) Fase 4, [TASKS.md](../TASKS.md), [F4-001 design](F4-001-agency-daily-digest-design.md), [F4-002 design](F4-002-superadmin-daily-digest-design.md), [WKR-007 design](WKR-007-trip-notification-event-workers-design.md), [WKR-008 audit](WKR-008-reminder-workers-audit.md), [WKR-009 design](WKR-009-outbox-retention-workers-design.md), `superadmin.service.ts#getDashboard`, `reservation.service.ts#getAgencyDashboard`, `notification-fanout.handler.ts`, `notification-delivery.policy.ts`, `notification-categories.ts`, `reminder-scheduler.ts`, `trip-reminder-due.v1.ts`, `backend/src/utils/timezone.ts`

---

## 1. Purpose

Definir el contrato implementable de las **alertas de ocupación** (`near_full` / `underbooked`) como notificaciones **in-app exclusivamente** (v1) sobre viajes `active`, usando la infraestructura de workers/outbox existente (sin segundo proceso, sin pg_cron, sin Resend).

El sistema debe avisar proactivamente cuando la ocupación de un viaje entra en un estado relevante para operación/comercialización. No es un dashboard de analytics ni un sistema de reportes.

---

## 2. Problem

Los dashboards (`/agency`, `/admin`) son **reactivos**: la agencia y el superadmin deben abrir la app para ver ocupación. No existe hoy un aviso proactivo cuando un viaje queda casi lleno (`>= 90%`) o subocupado (`<= 20%`). Sin alerta, la venta de un viaje casi lleno puede cerrarse sin refuerzo, y un viaje subocupado puede salir sin acciones de comercialización.

La infraestructura de notificaciones in-app ya es operativa (WKR-007 NotificationFanout + prefs); el envío de email externo está deliberadamente restringido (sin entorno comercial de Resend). Por eso **v1 es in-app only**.

---

## 3. Beneficiarios / destinatarios

| Rol | ¿Incluido en F4-003? | Regla |
|---|---|---|
| **Agency** | **Sí** | Recibe alertas in-app **solo** para viajes en los que participa mediante `trip_agencies`. |
| **Superadmin** | **Sí** | Recibe alertas in-app globales para viajes que cumplan el criterio. |
| Pasajeros / bookers | **No** | |

**Reglas de targeting (contrato):**

1. **Nunca** enviar una alerta de un viaje a una agencia que no esté asociada (`trip_agencies`).
2. **No inventar cupos por agencia.** `trip_agencies` es una relación de **participación**, no una asignación de seats: no existe `seats_assigned` ni `trip_agency_allocations` (legacy eliminado en `010_drop_all.sql:54`; `trip_agencies` junction pura en `011_create_all.sql:100-105`).
3. Un viaje **compartido** puede alertar a **múltiples** agencias asociadas + superadmin.
4. Occupancy es **trip-level** (global del viaje), no por agencia.

---

## 4. Current state (repo facts)

| Capacidad | Estado real |
|---|---|
| Worker Node único + relay | Sí (`runner.ts`) |
| Schedulers | Reminder (WKR-008), Retention (WKR-009), Digest agencia (F4-001), Digest superadmin (F4-002) |
| Outbox + `dedup_key` unique parcial | Sí (049/053/056) |
| `emit_trip_event` / `emit_platform_event` | Sí (057/062) |
| Claim/retry `SKIP LOCKED` | Sí (050/051) |
| `NotificationFanout` (in-app, idempotente por `source_event_id`) | Sí (054, `notification-fanout.handler.ts`) |
| Preferencias por categoría (agencia) | Sí (`agency_notification_preferences` 032/059/061; defaults `in_app_enabled: true`) |
| Preferencias superadmin | Solo categoría `superadmin_digest` (062) |
| Categoría `occupancy_alerts` | **No existe** |
| Evento `trip.occupancy_alert.due` | **No existe** |
| Estado de alerta por viaje (anti-spam) | **No existe** |
| Timezone de negocio | `BUSINESS_TIMEZONE = 'America/Caracas'` (`backend/src/utils/timezone.ts:11`) |
| Ocupación canónica | `reserved = seats.status != 'available'`; `occupancy_pct = round(reserved/total*100)` |
| Thresholds de ocupación | **No existen** (grep: 0 matches) |
| Dashboard superadmin | `getDashboard()` `occupancy_by_trip` (`superadmin.service.ts:1897-1943`) |
| Dashboard agencia | `getAgencyDashboard()` `occupancy_by_trip` (`reservation.service.ts:1011-1049`) |
| Widget "Ocupación de viajes" (agencia) | `components/dashboard/charts/OccupancyChart.tsx:65`, renderizado en `app/agency/page.tsx:388` → **será reemplazado** por "Alertas de ocupación" (§15). El componente `OccupancyChart` **se mantiene**: `/admin` también lo usa (`app/admin/page.tsx:246`); solo cambia su composición en la página de agencia. |

---

## 5. Goals

1. Alertar in-app (`near_full` / `underbooked`) sobre viajes `active` futuros, a agencias asociadas y superadmin.
2. Anti-spam real: **una alerta por transición de estado**, no por tick.
3. Reutilizar worker, outbox, `dedup_key`, NotificationFanout, prefs y observabilidad.
4. Rollout con flag default `false` y soak en producción.
5. Cero PII en evento y en contenido in-app.
6. Superficie UI acotada: reemplazar el widget "Ocupación de viajes" del dashboard de agencia por "Alertas de ocupación" con CTA "Ver viaje" con deep-link por rol (§15).

---

## 6. Canonical occupancy semantics

Semántica canónica de F4-003 = la existente en dashboards/digests:

```text
reserved = seats.status != 'available'
total    = filas de seats del viaje (fallback a trips.capacity si no hay filas)
occupancy_pct = round(reserved / total * 100)
```

**Guardas de cálculo (FIJADAS):**

- Si `total <= 0`, el viaje **no es elegible** para occupancy alerts en ese tick: no genera transición ni evento. Evita división por cero, `NaN`, `Infinity` y alertas falsas.
- Bajo datos válidos, `reserved` no debe ser mayor que `total`. Si una inconsistencia de datos produce `reserved > total`, el scheduler/RPC **no** genera una alerta inválida: registra el caso (métrica `skipped_invalid_occupancy`, §18) y continúa con el resto del batch. F4-003 **no corrige datos**.

**Significado de cada `seat.status` en la DB actual** (CHECK en `011_create_all.sql:83-84` y `017_fix_reservation_status_check.sql:14-17`):

| status | Semántica | ¿Cuenta como reservado en F4-003? |
|---|---|---|
| `available` | Asiento libre | No |
| `reserved` | Asiento vendido (reserva confirmada/parcial) | Sí |
| `locked` | En lock de reserva en curso | **Sí** (incluido por `!= 'available'`) |
| `blocked` | Asiento bloqueado manualmente | **Sí** |
| `guide` | Asiento del guía | **Sí** (nunca se escribe hoy; solo existe en la constraint) |

> `boarded` **no es** un `seat.status` en la DB (no existe en el CHECK). El abordaje vive en `reservation_passengers.boarded` y no muta el asiento (`046_boarding_toggle_rpc.sql:182-207`).

**Existing semantic divergence — F4-003 canonical rule**

La auditoría detectó que `reservation.service.ts:1096` y `:1145` cuentan `reserved` como `status === 'reserved' || status === 'boarded'`, lo que en la práctica **excluye `locked`/`blocked`** y diverge de la semántica canónica `!= 'available'`.

- **Regla F4-003:** utilizar SIEMPRE la semántica canónica del dashboard/digest (`!= 'available'`). F4-003 **no** se implementa sobre `getAgencyTrips`/`getAgencyTripPassengers`.
- **Follow-up separado (NO en este sprint):** normalizar `reservation.service.ts:1096,1145` a la semántica canónica. Queda registrado en §25.

**Observación (no bloqueante):** F4-003 utiliza deliberadamente la semántica canónica existente (`seat.status != 'available'`) aunque `locked` y `blocked` puedan representar ocupación no vendida/comercial. La normalización de occupancy **comercial** queda fuera de F4-003 y pertenece al follow-up de normalización de `reservation.service.ts` (§25).

---

## 7. Thresholds (decisiones de producto v1)

Valores globales, versionados en código. **No configurables por agencia**, **no UI**, **no env vars** en v1.

| Alerta | Trigger | Reset (hysteresis) | Estado |
|---|---|---|---|
| `near_full` | `occupancy_pct >= 90` | `occupancy_pct < 85` | **DECIDIDA (v1)** |
| `underbooked` | `occupancy_pct <= 20` | `occupancy_pct > 25` | **DECIDIDA (v1)** |

Reglas:
- Solo estos dos umbrales. No incluir otros (p.ej. 80/95).
- Thresholds globales para todos los tenancies; versionados por código (constantes), no por configuración.
- **Hysteresis FIJADA:** el reset es distinto del trigger (`>= 90`/`< 85`; `<= 20`/`> 25`) para **evitar oscilación** alrededor del umbral: mientras el viaje permanezca entre 85–89 (near-full) no se re-alerta tras haber salido, y entre 21–25 (underbooked) idem.

---

## 8. Timing / detection model

### Seleccionado: **Scheduler-driven**

```text
Scheduler periódico (1h)
  → scan viajes active
  → calcular occupancy (semántica canónica)
  → evaluar umbral + máquina de estados
  → emitir evento (si transición) al outbox
  → relay → NotificationFanout (in-app)
```

Razones:
- Menor superficie de cambios (no se toca ninguna mutación de seats).
- Reutiliza patrón WKR-008 / F4-001 / F4-002 (scheduler → RPC → outbox → relay → handler).
- Mantiene el dominio HTTP/booking estable.
- Permite dedup e idempotencia centralizada (estado + outbox).

**No** se selecciona event-driven (evaluar en cada mutación de `seats.status`) porque exigiría inyectar lógica en cada RPC de reserva/cancelación/boarding y en el path HTTP, aumentando superficie y riesgo de regresión.

### Scheduler frequency

- **Poll:** cada **1 hora** (`OCCUPANCY_ALERT_POLL_MS = 3600000`).
- **Sin ventana horaria diaria.** A diferencia de F4-001/F4-002 (07:00 `America/Caracas`), F4-003 evalúa el **estado actual** de los viajes en cada tick. `BUSINESS_TIMEZONE` se usa solo para formatear fechas de contenido; no hay `local hour` gate.
- **Batch:** `OCCUPANCY_ALERT_BATCH = 50` viajes elegibles como máximo por invocación del RPC (contrato de fairness en el bloque siguiente).
- **Flag:** `OCCUPANCY_ALERT_VIA_WORKER` (default `false`).
- **Comportamiento fuera de ventana:** no aplica (no hay ventana). Con flag off → tick `skipped_effect_disabled` (patrón reminder).

### Batch / fairness contract (FIJADO)

`evaluate_occupancy_alerts` procesa **como máximo `p_batch` viajes elegibles por invocación** (`OCCUPANCY_ALERT_BATCH = 50`). Cuando existen más viajes elegibles que `p_batch`, el scheduler avanza en **invocaciones sucesivas sin volver a procesar indefinidamente los mismos primeros registros**.

Mecanismo — **sin cursor persistido nuevo ni tabla de scheduler nueva**:

1. **Orden determinista:** los viajes elegibles se evalúan en orden estable `(departure_time ASC, id ASC)`.
2. **Keyset pagination derivada de datos existentes:** cada invocación recibe `p_batch` y un par opcional `(p_after_departure, p_after_id)` = la última clave evaluada por la invocación previa; continúa con `WHERE (departure_time, id) > (p_after_departure, p_after_id) ORDER BY departure_time, id LIMIT p_batch`.
3. **Cursor en memoria del scheduler:** el scheduler guarda el par devuelto por el RPC (`next_cursor`) mientras recorre el ciclo y lo reinicia al empezar un ciclo nuevo; no se persiste paginación en DB.
4. **Avance del ciclo:** el scheduler repite invocaciones hasta que el RPC devuelva `has_more = false` (la última invocación procesó `< p_batch` viajes elegibles o no quedan más).

Garantía de progreso (fairness):

| Viajes elegibles | Invocaciones (`p_batch = 50`) |
|---|---|
| `<= 50` | **1** — sin offset. |
| `51` | **2** — 50 + 1 (la segunda arranca donde terminó la primera). |
| `100` | **2** — 50 + 50. |
| `300` | **6** — 50 × 6; cada invocación continúa donde terminó la anterior. |

La condición `>` sobre la clave ordenada impide re-procesar registros ya recorridos en el mismo ciclo; el diseño **no** depende de que el número real de viajes sea pequeño.

---

## 9. Active trips (alcance de evaluación)

Evaluar únicamente viajes que cumplan **todas**:

1. `trips.status = 'active'`
2. `departure_time > now` (no alertar salidas pasadas; una salida pasada sin completar ya no es comercializable)

No evaluar `completed`, `cancelled`, `archived` ni departures pasadas. Evita alertas históricas.

Además, un viaje con `total <= 0` en el tick se **omite**: no es elegible para occupancy alerts en ese tick y no genera transición ni evento (§6).

Comportamiento transicional:

| Evento | Comportamiento F4-003 |
|---|---|
| Viaje se cancela | Deja de evaluarse. No nuevas alertas. El estado de alerta queda obsoleto y se elimina por el cleanup del RPC (§16). |
| Viaje se completa | Deja de evaluarse. No nuevas alertas. |
| Departure pasa | Excluido por el filtro `departure_time > now`. |
| Viaje se re-programa (postponement) | Sigue `active`; el scheduler reevalúa con el nuevo `departure_time` en el próximo tick (sin lógica especial). |
| Cancellation libera seats (`057_trip_events_rpc.sql:436-442`) | El scheduler reevalúa; la ocupación cae y no genera alerta por sí misma (§8, §10). |

---

## 10. Alert state machine / anti-spam

**Requisito:** no generar una alerta en cada tick mientras el viaje continúa sobre el umbral.

Máquina de estados (por `trip_id`) — estados relevantes **FIJADOS**:

```text
NORMAL
  ─(occupancy_pct >= 90)─> NEAR_FULL_ALERTED
  ─(occupancy_pct <= 20)─> UNDERBOOKED_ALERTED

NEAR_FULL_ALERTED
  ─(occupancy_pct < 85)─> NORMAL          (hysteresis)

UNDERBOOKED_ALERTED
  ─(occupancy_pct > 25)─> NORMAL          (hysteresis)
```

Conceptos **FIJADOS** (P1–P3):

| Concepto | Valor |
|---|---|
| **Trigger** | `near_full >= 90`; `underbooked <= 20` |
| **Reset (hysteresis)** | `near_full < 85`; `underbooked > 25`. Evita oscilación alrededor del threshold: el reset nunca coincide con el trigger. |
| **Frecuencia / anti-spam** | **Una alerta por transición de estado.** No hay cooldown periódico. La transición `NORMAL → NEAR_FULL_ALERTED` (o `→ UNDERBOOKED_ALERTED`) produce exactamente una alerta. Permanecer en `NEAR_FULL_ALERTED` / `UNDERBOOKED_ALERTED` NO genera alertas por cada tick. |
| **Re-entry (P2)** | Al volver a `NORMAL`, el estado queda **rearmado**: si posteriormente vuelve a cruzar cualquiera de los thresholds, se genera una nueva alerta. Mientras permanezca en el mismo estado de alerta, no hay nueva alerta. |
| **Dedup** | Emisión única por transición; el estado persistido es la autoridad de anti-spam (§11). El `dedup_key` se versiona por transición para permitir re-entry. |
| **Cooldown** | **No se implementa** cooldown temporal en v1 (P3). |

**Hysteresis explicada:** al no usarse el mismo valor para trigger y reset, un viaje que fluctúa levemente alrededor del umbral (p.ej. 88→92→89→91) no oscila entre alertado y normal: una vez en `NEAR_FULL_ALERTED`, solo sale al caer bajo 85, y solo re-entra al subir a 90 o más.

**Una transición por tick (R6 — FIJADO):** un tick de `evaluate_occupancy_alerts` ejecuta **como máximo una transición por `trip_id`**. El tick evalúa únicamente la **regla de salida del estado actual** y, si corresponde, realiza **una sola** transición; **nunca** encadena transiciones dentro del mismo tick.

Ejemplo: `NEAR_FULL_ALERTED` con `occupancy_pct = 15`:

- **este tick:** `NEAR_FULL_ALERTED → NORMAL` (regla de salida `occupancy_pct < 85`).
- **el siguiente tick,** si sigue `<= 20`: `NORMAL → UNDERBOOKED_ALERTED`.

Nunca `NEAR_FULL_ALERTED → NORMAL → UNDERBOOKED_ALERTED` en el mismo tick (impediría dos alertas en un solo tick). La transición de salida (`ALERTED → NORMAL`) **no emite** alerta; la transición de entrada (`NORMAL → ALERTED`) del tick siguiente sí.

---

## 11. Idempotency / anti-spam mechanics

Identidad lógica de una alerta activa:

```text
(trip_id, alert_type)
```

donde `alert_type ∈ { near_full, underbooked }`. El estado (`near_full_alerted` / `underbooked_alerted`) queda **implícito** en `alert_type`: una fila de estado existe **solo** mientras el viaje está en estado alertado (§10).

**Estrategia de persistencia (R5 — FIJADA): Estrategia B — filas solo durante estados alertados.**
`NORMAL` = **ausencia de fila**; no existe representación persistida de `NORMAL`. La fila se **crea** en la transición `NORMAL → ALERTED` y se **elimina** en `ALERTED → NORMAL`. Es consistente con: idempotencia (lock `FOR UPDATE SKIP LOCKED` + `INSERT ... ON CONFLICT DO NOTHING`), re-entry (borrar la fila deja el estado rearmado), dedup (token derivado de datos persistidos, Capa 2), RPC y scheduler.

Mecanismo propuesto: **combinación de tres capas** (se requiere la primera; las otras dos son idempotencia de transporte):

### Capa 1 — Estado persistido (autoridad anti-spam)
Tabla nueva `trip_occupancy_alert_state` (migración propia F4-003; **NO implementada en este documento**):

```text
trip_id        UUID PK (FK trips, ON DELETE CASCADE)
alert_type     TEXT  NOT NULL  CHECK ('near_full' | 'underbooked')
state          TEXT  NOT NULL  CHECK ('near_full_alerted' | 'underbooked_alerted')
occupancy_pct  INTEGER NOT NULL   -- valor que disparó la alerta (debug/contenido)
updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
```

Reglas del schema (R5):

- **PK / unique key:** `trip_id` (una fila por viaje). `NEAR_FULL_ALERTED` y `UNDERBOOKED_ALERTED` son **mutuamente excluyentes**: nunca coexisten dos filas para el mismo viaje.
- **`alert_type` NOT NULL:** siempre presente porque la fila solo existe durante un estado alertado. `CHECK` limita a `near_full` / `underbooked`.
- **`state` NOT NULL y SIN `'normal'`:** `NORMAL` nunca se persiste (Estrategia B); el `CHECK` solo admite los estados alertados. Se elimina la ambigüedad previa sobre `NORMAL`.
- **`updated_at` NOT NULL DEFAULT now():** token de transición para el `dedup_key` (Capa 2); cambia solo al crear la fila (cada transición `NORMAL→ALERTED` reinserta con un `updated_at` nuevo).

Ciclo de vida de la fila (R5 — FIJADO):

- `NORMAL → ALERTED`: el RPC **INSERTA** la fila y emite el evento **en la misma transacción** (patrón `schedule_trip_reminders` `059` con `FOR UPDATE SKIP LOCKED` + `INSERT ... ON CONFLICT DO NOTHING` como salvaguarda).
- `ALERTED → NORMAL` (reset por hysteresis): el RPC **ELIMINA** la fila; **no** se emite evento (la transición de salida no alerta).
- Permanencia en el mismo estado alertado: no se toca la fila; no hay evento.
- Viaje cancelado/completado o `departure_time <= now`: el scheduler no lo selecciona (filter §9) y la fila queda **inerte**; el RPC la **elimina en el cleanup** del ciclo (`trips.status != 'active'` o `departure_time <= now()`, §16). `ON DELETE CASCADE` de la FK queda como protección adicional si el trip se elimina físicamente; el cleanup **no** emite evento ni genera `near_full`/`underbooked`.
- Creación de un viaje: sin fila; la primera alerta se crea en el primer tick que detecte la transición.
- Worker restart: estado en DB → no re-emite.
- Múltiples instancias: `FOR UPDATE SKIP LOCKED` serializa.
- Mismo trip en múltiples ticks: solo transiciona cuando cruza; un tick con umbral estable no emite.
- **Una transición por tick** por `trip_id` (§10, R6).

### Capa 2 — Outbox `dedup_key` (idempotencia de emisión)
`dedup_key = trip.occupancy_alert:{trip_id}:{alert_type}:{updated_at}` donde `{updated_at}` es el valor **persistido** de la fila de estado recién creada en `NORMAL → ALERTED`, leído vía `RETURNING updated_at` **dentro de la misma transacción**.

Naturaleza del token (FIJADO):

- `updated_at` **no es un contador** ni un identificador semántico de la transición por sí mismo; funciona **solamente** como un **token técnico de idempotencia** derivado de la fila nueva.
- Cada nueva inserción de la fila de estado (cada `NORMAL → ALERTED`) produce un `updated_at` nuevo, por lo que cada transición recibe un `dedup_key` distinto; re-entry genera un token nuevo.
- El sistema **no** depende de una garantía de unicidad temporal estilo `sequence`: los timestamps solo necesitan diferir entre transiciones del mismo `(trip_id, alert_type)`, y el índice único parcial `053` + `ON CONFLICT DO NOTHING` tolera colisiones teóricas sin emitir duplicados.
- La **autoridad anti-spam es la fila de estado** (Capa 1); `dedup_key` es una capa de **idempotencia del outbox (transporte)**, no de negocio. Retry del outbox no duplica (patrón `emit_trip_event` `057`).

### Capa 3 — `source_event_id` (idempotencia de fanout in-app)
NotificationFanout inserta con `source_event_id = id del evento outbox`; índice único parcial `054` + 23505 → `already_delivered`. Partial delivery a destinatarios: cada fila (agency/superadmin) tiene su `source_event_id`; reintentos solo completan los faltantes.

**Decisión explícita:** la autoridad anti-spam es la **Capa 1 (estado persistido)**; el outbox y `source_event_id` garantizan exactly-once del transporte. Esto cubre worker restart, multi-instancia, retry y partial delivery.

---

## 12. Event architecture

### Contrato: `trip.occupancy_alert.due.v1`

```text
event_type      = trip.occupancy_alert.due
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
  occupancy_pct:  number   (0-100, valor que disparó la transición)
  departure_time: string   (ISO UTC; para contenido/CTA, re-leído como en reminder)
  route_id:       string   (uuid; para label origin→destination en handler)
}
```

**No** se expone el token de idempotencia en el payload: `dedup_key` se computa en el emisor (RPC) y no forma parte del contrato del evento (§11 Capa 2).

**NO incluir:** nombres de pasajeros, emails, documentos, teléfonos, lista de pasajeros, booker data, ni conteos por agencia.

**Tenant behavior (decisión explícita):**

- Un viaje puede pertenecer operacionalmente a múltiples agencias (`trip_agencies`).
- El evento es **global** (`tenant_id = NULL`, `aggregate_type = trip`, `aggregate_id = trip_id`): **una sola fila de outbox por transición**, no una por agencia.
- El handler resuelve las agencias asociadas desde `trip_agencies` al entregar (fan-out a N destinatarios desde 1 evento). No se duplica el evento por agencia.
- El evento **no** incluye `agency_ids` en el payload (se re-leen en el handler, patrón reminder: "workers re-read route and reservation contact emails by id").

### Emisor
Scheduler/RPC del worker vía `emit_trip_event` (`057`) o un RPC `evaluate_occupancy_alerts` propio (migración F4-003, `SECURITY DEFINER`, `SET search_path = public`, EXECUTE solo `service_role` — mismo patrón `059`/`060`/`062`). Ver §18.

---

## 13. NotificationFanout

F4-003 v1 usa **NotificationFanout**. No EmailFanout, no `email_delivery_log`, no Resend, no `EMAIL_DELIVERY_MODE`.

- El handler registra `trip.occupancy_alert.due` → `notification-fanout.handler.ts` con `isEffectsEnabled: () => env.OCCUPANCY_ALERT_VIA_WORKER` (patrón `handlers/index.ts:156-170` para `trip.reminder_due`).
- Entregas: filas para **agencias asociadas** (`recipient_role: 'agency'`, `agency_id` = cada `trip_agencies.agency_id`) + **superadmin** (`recipient_role: 'superadmin'`, `agency_id: null`) con `actor: 'system'` (patrón `buildAgencyAndOptionalAdminRows`, `notification-fanout.handler.ts:112-161`).
- **`action_url` por rol (R2):** la fila de agencia usa `/agency/trips/{trip_id}/passengers` y la fila de superadmin usa `/admin/trips/{trip_id}`. **No** asumir un único `action_url` para ambos roles. La implementación puede extender `buildAgencyAndOptionalAdminRows` o construir las notification rows específicamente para occupancy, **manteniendo un único evento de dominio** (`trip.occupancy_alert.due.v1`, §12). `NotificationItem` ya prioriza `action_url` sobre el fallback (`components/notifications/NotificationItem.tsx:24-26`).
- Respeto de preferencias:
  - **Agency:** `filterAgencyNotificationRows` (bulk lookup `notificationDeliveryPolicy.filterAgencyNotificationRows`, `notification-delivery.policy.ts:58-95`) evalúa `in_app` por agencia — mecanismo **existente, sin cambios**. `occupancy_alerts` usa `agency_notification_preferences` con `in_app_enabled=true` por default; la agencia puede desactivar la categoría y NotificationFanout respeta esa preferencia.
  - **Superadmin:** **NO existe opt-out por categoría para F4-003.** **Todos** los usuarios con `users.role = 'superadmin'` reciben las notificaciones in-app de `occupancy_alert`. La entrega es **una única fila** `recipient_role='superadmin'`, `agency_id=null` (la tabla `notifications` no tiene `user_id`), visible por todos los superadmins. **NO** se usa `superadmin_notification_preferences` para decidir la entrega de F4-003: esa tabla existe por F4-002 (digest/email superadmin) y **no gobierna** las occupancy alerts.
- Idempotencia: `source_event_id` (§11 Capa 3).

### Categoría de preferencia: `occupancy_alerts` (P5 — FIJADA)

| Propiedad | Valor |
|---|---|
| Categoría | `occupancy_alerts` |
| Alcance | **Solo agencia** (`agency_notification_preferences`). **No** existe en `superadmin_notification_preferences` |
| Default in-app (agencia) | **`in_app_enabled = TRUE`** |
| Opt-out agencia | Sí: la agencia puede desactivar la categoría; NotificationFanout respeta la preferencia |
| Opt-out superadmin | **No en v1** — todos los superadmins reciben las occupancy alerts in-app |
| Email | **No existe en v1** (sin email path; `email_enabled` no aplica a la entrega) |
| Independencia | Independiente de `ops_digest` y `superadmin_digest` (no acoplada) |
| Backfill/seed | Solo para agencias existentes (`agency_notification_preferences`, `ON CONFLICT DO NOTHING`). **Sin backfill superadmin** |
| Respeto del handler | El handler **respeta `in_app_enabled = false`** para filas de agencia (no entrega la fila) |

**Comportamiento por tipo de preferencia (documentado por separado):**

- **Agency notification preferences** (`agency_notification_preferences`, CHECK extendido en `061:12-20`): la categoría `occupancy_alerts` se agrega al CHECK con backfill `in_app_enabled=true` para agencias existentes. La entrega a cada agencia pasa por `filterAgencyNotificationRows` (`notification-delivery.policy.ts:58-95`), que evalúa `in_app` por agencia y descarta las filas con `in_app_enabled=false`.
- **Superadmin:** **no aplica.** `occupancy_alerts` **no** se agrega a `superadmin_notification_preferences` (`062:12-19`); esa tabla existe por F4-002 y gobierna únicamente el digest/email superadmin. La entrega superadmin de F4-003 es **incondicional** (todos los `users.role = 'superadmin'`), con una única fila `recipient_role='superadmin'` por evento (§12).

**Cambios necesarios (documentados, NO implementados aquí):**
- Extender `NOTIFICATION_CATEGORIES` + `NOTIFICATION_TYPE_TO_CATEGORY` + `CATEGORY_METADATA` (`notification-categories.ts:1-82`) con `occupancy_alerts` y nuevo `NotificationType` (p.ej. `occupancy_alert`).
- Migración SQL (R3):
  - Extender el CHECK de `agency_notification_preferences` (`061:12-20`) para incluir la categoría `occupancy_alerts` + backfill `in_app_enabled=true` (`ON CONFLICT DO NOTHING`).
  - **NO** modificar `superadmin_notification_preferences` (`062:12-19`): la categoría `occupancy_alerts` **no** se agrega ahí y **no** hay backfill superadmin para F4-003.
  - **Extender el CHECK de `notifications.type`** (`notifications_type_check`, `059_schedule_trip_reminders.sql:8-21`) para incluir **`occupancy_alert`**. El cambio **no** se limita a los CHECKs de preferencias. La migración F4-003 debe hacerlo de forma **segura y no destructiva**: patrón `DROP CONSTRAINT` + `ADD CONSTRAINT` en la misma migración con la lista **completa** de tipos (los existentes + `occupancy_alert`), sin perder datos (mismo patrón usado en `059`).
- El tipo `notification.service.ts` `NotificationType` se amplía.

---

## 14. Agency targeting / shared trips (P4 — FIJADO)

- `trip_agencies` es junction de **participación** (sin cupo): `UNIQUE(trip_id, agency_id)` (`011_create_all.sql:100-105`).
- **Superadmin targeting (P4):** **todos** los superadmins (`users.role = 'superadmin'`) reciben las alertas in-app globales. **Sin opt-out por categoría en v1**: no existe gate por preferencia superadmin (§13).
- **Agency targeting (P4):** destinatarios = agencias asociadas mediante `trip_agencies`; una agencia recibe la alerta **solo si participa en ese viaje**.
- **Nunca** enviar una alerta a un usuario `agency` que no esté asociado al viaje.
- Viaje compartido → alerta a todas las agencias asociadas (fan-out) + superadmin.
- F4-003 **NO implementa** seat quota por agencia.
- Occupancy específica por agencia (p.ej. "tu agencia ocupa X% del viaje") → **OUT / follow-up** (§25).

---

## 15. Alert content (in-app)

Contenido mínimo por notificación (sin PII):

| Campo | Fuente |
|---|---|
| Tipo de alerta | `near_full` / `underbooked` (badge/label) |
| Ruta | `origin → destination` (`routes` vía `route_id`) |
| Viaje | `trip_id` (referencia) |
| Departure | `departure_time` formateada `America/Caracas` (`BUSINESS_TIMEZONE`) |
| Occupancy | `occupancy_pct` |
| Capacidad | `trips.capacity` |
| Reserved seats | `reserved` (contador canónico) |
| Available seats | `total - reserved` (canónico) |
| CTA | **"Ver viaje"** — deep-link al viaje específico **por rol** (R1/R2): agencia → `/agency/trips/{trip_id}/passengers`; superadmin → `/admin/trips/{trip_id}`. **No** redirigir únicamente a `/agency`. La ruta de agencia **no** es `/agency/trips/{trip_id}` (esa página no existe): el detalle de viaje de agencia vive en `/agency/trips/{trip_id}/passengers`. |

- `metadata` del insert: `{ alert_type, occupancy_pct, trip_id }` (sin PII).
- No crear email template en v1.

### Widget del dashboard de agencia (FIJADO — reemplaza "Ocupación de viajes")

El dashboard de agencia (`app/agency/page.tsx:388`) renderiza hoy un widget **"Ocupación de viajes"** (`components/dashboard/charts/OccupancyChart.tsx:65`, fuente `occupancy_by_trip` de `getAgencyDashboard`).

- Ese **uso/composición en `app/agency/page.tsx`** queda reemplazado por un widget **"Alertas de ocupación"**.
- **`OccupancyChart` sigue existiendo:** el mismo componente lo usa el dashboard superadmin `/admin` (`app/admin/page.tsx:246`). F4-003 **solo** reemplaza su composición en la página de agencia; **no** se elimina ni refactoriza `OccupancyChart` globalmente.
- **NO** se crea una pantalla nueva ni una página exclusiva de alertas.
- El widget muestra las **alertas activas/relevantes para la agencia** (solo las que aplican a viajes en los que participa vía `trip_agencies`).

**Fuente de datos del widget (FIJADO): estado persistido `trip_occupancy_alert_state` (live).**
El widget lee el estado alertado como fuente de verdad y recalcula los valores vivos de ocupación con la semántica canónica (§6), uniendo `trip_occupancy_alert_state` + `trips` + `routes` + `trip_agencies` (+ `seats` para capacidad/reservados/disponibles actuales). Se expone vía el dashboard de agencia existente (`getAgencyDashboard`) o un endpoint dedicado (`GET /agency/occupancy-alerts`); es una query viva, **no** analytics ni snapshot.

- **No** usa la tabla `notifications` como fuente: las notificaciones nunca se borran (`029`), por lo que no desaparecerían al resetear a `NORMAL` y el widget quedaría obsoleto. La campana in-app (NotificationBell) sigue siendo la superficie de **entrega**; el widget es la superficie de **operación**.
- **Qué filas aparecen:** trips con fila en `trip_occupancy_alert_state` (viaje actualmente alertado) **y** `trips.status = 'active'` **y** `departure_time > now` **y** agencia participante vía `trip_agencies`. La fila solo existe mientras el estado es alertado (Estrategia B, §11).
- **Cuándo desaparecen:** al resetear a `NORMAL` (la fila de estado se elimina → desaparece del widget en el siguiente fetch/refetch); al cancelarse/completarse el viaje o pasar `departure_time` (filter de la query); al quitarse la agencia de `trip_agencies`.
- **Qué ocurre al resetear a `NORMAL`:** la transición `ALERTED → NORMAL` borra la fila (§11) → la alerta sale del widget automáticamente.
- **Qué ocurre tras una nueva transición:** `NORMAL → ALERTED` reinserta la fila con datos frescos (§11) → la alerta vuelve a aparecer en el siguiente fetch.
- **Deep-link del CTA:** por rol (R1/R2): agencia → `/agency/trips/{trip_id}/passengers`; superadmin → `/admin/trips/{trip_id}` (el widget de agencia usa la ruta de agencia).

**Contrato de acceso a datos del widget (tenancy — FIJADO):**
La fuente funcional del widget es `trip_occupancy_alert_state` + datos vivos del trip y seats, **siempre scoped por `agency_id` mediante `trip_agencies`**. La implementación puede **extender `getAgencyDashboard()`** o **crear un servicio/endpoint dedicado** (`GET /agency/occupancy-alerts`); en ambos casos debe cumplirse:

- la agencia solo ve alertas de trips asociados a esa agencia (`trip_agencies.agency_id`);
- no se devuelve estado de trips de otras agencias;
- no se usa la tabla `notifications` como fuente;
- el widget no cambia la semántica global de `getDashboard()`.

**Contenido mínimo del widget** (por alerta):

| Campo |
|---|
| Tipo: `near-full` / `underbooked` |
| Ruta (origin → destination) |
| Fecha/hora de salida |
| Occupancy percentage |
| Capacidad |
| Reservados |
| Disponibles |
| CTA **"Ver viaje"** → deep-link al viaje específico: `/agency/trips/{trip_id}/passengers` (rol agencia; la ruta sin `/passengers` no existe) |

**Naturaleza del widget:** NO es un segundo dashboard de ocupación. Su propósito es mostrar **alertas accionables activas/relevantes**. La información histórica completa de ocupación permanece fuera del alcance de F4-003.

**Superadmin:** no se crea pantalla nueva; el superadmin recibe las alertas por el mecanismo in-app existente. Si el dashboard superadmin necesitara una superficie adicional para listar alertas activas, se documenta como **follow-up** (§25), no en F4-003 v1.

---

## 16. Cancellation / completion behavior

| Situación | Comportamiento |
|---|---|
| Viaje `cancelled` | No nuevas alertas (fuera del filtro §9). El estado persistido queda obsoleto y **se elimina por el cleanup del RPC** (ver bloque de cleanup abajo). |
| Viaje `completed` | No nuevas alertas. |
| `departure_time` pasada | No alertas (filtro `departure_time > now`). |
| Agencia desactivada | No debe recibir nuevas alertas (la entrega in-app respeta el estado de la agencia; confirmar filtro de destinatarios en implementación). |
| Reserva cancelada / seat liberado | El scheduler **reevalúa** el estado actual en el próximo tick. Un cambio de reserva por sí mismo **no** genera alerta (es scheduler-driven, no event-driven). La liberación puede sacar al viaje de `near_full` y volverlo a `NORMAL` vía reset. |

**Cleanup del estado (FIJADO):** `evaluate_occupancy_alerts` elimina durante su ciclo de evaluación los registros de `trip_occupancy_alert_state` cuyo viaje ya no califica para F4-003: `trips.status != 'active'` o `departure_time <= now()`. Se mantiene `ON DELETE CASCADE` en la FK como protección adicional si el trip se elimina físicamente. **Ningún nuevo evento se emite por ese cleanup** y el cleanup no genera `underbooked` ni `near_full`. No existe lenguaje de "puede ignorarse" ni "decidir en implementación": el cleanup es parte del contrato del RPC (§11).

---

## 17. Environment variables

### Production Environment Variables

| Variable | Default (código) | Servicio | Render Worker | Soak | Activar | ¿Requiere redeploy? |
|---|---|---|---|---|---|---|
| `OCCUPANCY_ALERT_VIA_WORKER` | `false` | Worker (scheduler + handler) | **Agregar manualmente** | `false` | `true` (tras soak) | Sí (cambio de env en Render dispara redeploy; verificar logs) |
| `OCCUPANCY_ALERT_POLL_MS` | `3600000` | Worker (scheduler) | **Agregar manualmente** | `3600000` | igual | Sí |
| `OCCUPANCY_ALERT_BATCH` | `50` | Worker (scheduler) | **Agregar manualmente** | `50` | igual | Sí |

**IMPORTANTE:** definir `default` en `backend/src/config/env.ts` y documentarlas en `backend/.env-example` **NO** configura Render. Las tres variables deben **agregarse manualmente en Render (servicio worker)**. No se introducen thresholds como env vars en v1 (constantes en código, versionadas).

---

## 18. Observability

Eventos de log (patrón `reminder_scheduler_*`):

- `occupancy_alert_scheduler_started`
- `occupancy_alert_scheduler_tick`
- `occupancy_alert_scheduler_error`
- `occupancy_alert_scheduler_stopped`

Métricas del tick (`occupancy_alert_scheduler_tick`):

- `scanned` — viajes activos evaluados
- `evaluated` — viajes que cruzaron evaluación de umbral
- `emitted` — eventos emitidos al outbox
- `skipped` — viajes descartados (no active, pasados, sin transición, ya alertados)
- `skipped_invalid_occupancy` — viajes con `total <= 0` o `reserved > total` (skip, sin alerta; §6)
- `cleaned_up` — filas de estado eliminadas por cleanup (§16)
- `duration_ms`

Reglas:
- Sin PII (solo ids, conteos, `duration_ms`).
- Sentry solo para errores inesperados (no para ticks normales/skips).

---

## 19. Security / tenancy

- Worker usa `service_role` (RPCs `SECURITY DEFINER`, `SET search_path = public`, EXECUTE solo `service_role`).
- Filtros explícitos: `trips.status = 'active'`, `departure_time > now`.
- Destinatarios: solo `trip_agencies.agency_id` del viaje + superadmin. **No cross-agency leakage.**
- Sin PII, sin passenger data en payload, metadata, ni contenido (§12, §15).
- El evento es global (`tenant_id = NULL`) pero el fan-out es por agencia asociada; el RLS de `notifications` ya aísla lectura por agencia (`029_create_notifications.sql`).
- No se exponen umbrales ni configuración a clientes.

---

## 20. IN scope (candidato)

- Scheduler en el worker Node existente (patrón `reminder-scheduler.ts`).
- Feature flag `OCCUPANCY_ALERT_VIA_WORKER` + poll/batch (`OCCUPANCY_ALERT_POLL_MS`, `OCCUPANCY_ALERT_BATCH`).
- Evaluación de ocupación canónica (§6).
- Thresholds `near_full >= 90` / `underbooked <= 20` (§7).
- Máquina de estados + estado persistido (`trip_occupancy_alert_state`) (§10, §11).
- Evento `trip.occupancy_alert.due.v1` + outbox + `dedup_key` (§12).
- RPC `evaluate_occupancy_alerts` (migración propia F4-003) si se requiere emisión transaccional con estado (§11).
- Handler → NotificationFanout (in-app) con gate de flag (§13).
- Categoría de preferencia `occupancy_alerts` **solo agencia** (`agency_notification_preferences`) + backfill de agencias (§13).
- Extender el CHECK de `notifications.type` para incluir `occupancy_alert` (cambio seguro/no destructivo, patrón `059`) (§13, R3).
- Entrega superadmin incondicional: una única fila `recipient_role='superadmin'` por evento; todos los superadmins reciben la notificación; sin gate por preferencia (§13).
- Contenido in-app sin PII (§15).
- **Widget de agencia:** reemplazo de la composición de "Ocupación de viajes" por "Alertas de ocupación" en el dashboard de agencia (`app/agency/page.tsx`), con contenido §15, fuente de datos = estado persistido `trip_occupancy_alert_state` (live) y CTA "Ver viaje" con deep-link por rol (agencia → `/agency/trips/{trip_id}/passengers`; superadmin → `/admin/trips/{trip_id}`). `OccupancyChart` se mantiene para `/admin`; solo cambia su composición en la página de agencia (§15).
- Tests unitarios + boarding/static; SQL harness si RPC/migración.
- Soak flag `false` → `true` en producción.
- Observabilidad (§18).

---

## 21. OUT of scope

- Email en v1 / Resend / `email_delivery_log` / EmailFanout / templates de email.
- Dependencia de `EMAIL_DELIVERY_MODE` o Resend.
- UI para configurar thresholds.
- Thresholds personalizados por agencia.
- Seat quotas por agencia.
- Analytics / reportes.
- Nightly metrics.
- F4-001 / F4-002.
- Trips-without-action.
- Audit trail.
- Timers API (`LockCleanup` / `completeExpiredTrips`).
- Boarding retention (`boarding_attempts`).
- pg_cron.
- Segundo worker.
- Cambios generales a `getDashboard()`.
- Refactor general de `seat.status` / normalización `reservation.service.ts:1096,1145` (follow-up §25).
- In-app digest de agencia/superadmin.
- **Pantallas/páginas nuevas** de alertas (ni agencia ni superadmin): la única superficie UI de F4-003 v1 es el widget del dashboard de agencia (§15). Superadmin usa el mecanismo in-app existente.
- Segundo dashboard de ocupación / historial completo de ocupación en el widget (fuera del propósito §15).

---

## 22. Decided (scope-lock v1)

| Decisión | Valor |
|---|---|
| Canal | **In-app only** (NotificationFanout; NO email v1) |
| Modelo de detección | **Scheduler-driven** (1h) |
| Viajes evaluados | `trips.status = 'active'` y `departure_time > now` |
| Threshold near-full | trigger `>= 90`; reset `< 85` |
| Threshold underbooked | trigger `<= 20`; reset `> 25` |
| Frecuencia / anti-spam | **Una alerta por transición de estado**; sin cooldown |
| Re-entry | Tras volver a `NORMAL`, un nuevo cruce genera nueva alerta |
| Poll | `3600000 ms` (1h), sin ventana horaria diaria |
| Batch / fairness | `50` como máximo por invocación del RPC; keyset `(departure_time, id)` + cursor en memoria del scheduler; progreso garantizado sin re-procesar el mismo ciclo (§8) |
| Flag | `OCCUPANCY_ALERT_VIA_WORKER` default `false` |
| Thresholds configurables | No en v1 |
| Seat quotas por agencia | No |
| Superadmin targeting | **Todos** los superadmins (`users.role = 'superadmin'`) reciben las occupancy alerts in-app; **sin opt-out por categoría en v1**; no usa `superadmin_notification_preferences` |
| Agency targeting | Solo agencias asociadas vía `trip_agencies` |
| Evento | `trip.occupancy_alert.due.v1`, `aggregate_type=trip`, `tenant_id=NULL`, payload mínimo sin PII |
| Anti-spam | Estado persistido + outbox `dedup_key` + `source_event_id` |
| Categoría preferencia | `occupancy_alerts` (**solo agencia**): `in_app_enabled=true` por default, opt-out por agencia; independiente de digests |
| UI | Widget "Alertas de ocupación" reemplaza la composición de "Ocupación de viajes" en el dashboard de agencia (fuente: estado persistido `trip_occupancy_alert_state` live; `OccupancyChart` se mantiene para `/admin`); CTA "Ver viaje" deep-link por rol (agencia → `/agency/trips/{trip_id}/passengers`) |

---

## 23. Product decisions — CERRADAS (P1–P5)

Las cinco decisiones de producto pendientes quedan **fijadas** y pasan a formar parte del scope-lock:

| ID | Decisión cerrada |
|---|---|
| **P1 — Hysteresis** | `near_full`: trigger `>= 90`, reset `< 85`. `underbooked`: trigger `<= 20`, reset `> 25`. La hysteresis evita oscilación alrededor del threshold. |
| **P2 — Re-entry** | Cuando un viaje vuelve a `NORMAL`, el estado queda **rearmado**. Si posteriormente vuelve a cruzar cualquiera de los thresholds, se genera una nueva alerta. No hay alerta nueva mientras permanezca en el mismo estado de alerta. |
| **P3 — Frecuencia / anti-spam** | **Una alerta por transición de estado** (`NORMAL → NEAR_FULL_ALERTED` o `→ UNDERBOOKED_ALERTED`). No hay cooldown periódico. Permanecer en `NEAR_FULL_ALERTED`/`UNDERBOOKED_ALERTED` no genera alertas por tick. Al volver a `NORMAL`, el siguiente cruce vuelve a ser elegible. |
| **P4 — Superadmin targeting** | Todos los superadmins elegibles reciben las alertas in-app globales. Nunca se envía alerta a un usuario `agency` no asociado al viaje. Agencias: destinatarios = asociadas vía `trip_agencies`. No existe seat quota por agencia. |
| **P5 — Notification preference** | **Agency:** `occupancy_alerts` con `in_app_enabled=true` por default y opt-out por agencia mediante `agency_notification_preferences`. **Superadmin:** no hay preferencia individual para esta categoría en v1; todos los superadmins elegibles reciben las occupancy alerts in-app. **Email:** no existe en v1. |

El scope-lock está **cerrado**: no quedan decisiones de producto abiertas antes de implementación.

---

## 24. Testing / Definition of Done

### Pruebas mínimas

**Unit (scheduler/RPC/handler):**
- Threshold near-full (`>= 90`, reset `< 85`); underbooked (`<= 20`, reset `> 25`).
- Estado normal (sin alerta).
- Reset (hysteresis) y re-entry.
- Una alerta por transición (permanecer en `NEAR_FULL_ALERTED`/`UNDERBOOKED_ALERTED` no re-alerta).
- Una transición por tick (R6): `NEAR_FULL_ALERTED` con 15% → `NORMAL` en este tick (sin emitir); `NORMAL → UNDERBOOKED_ALERTED` solo en el tick siguiente si sigue `<= 20`. Nunca dos transiciones en el mismo tick.
- Sin viajes activos / viajes cancelados / completados / departure pasada.
- `total <= 0` → trip omitido (sin transición ni evento); `reserved > total` → skip registrado, sin alerta (§6).
- Cleanup del estado: filas de trips `cancelled`/`completed`/`departure_time <= now` eliminadas en el ciclo; sin evento por cleanup (§16).
- Batch/fairness: con `p_batch = 50`, 51 → 2 invocaciones, 100 → 2, 300 → 6; keyset `(departure_time, id)` sin re-procesar registros (§8).
- Dedup por transición; retry del outbox idempotente; estado persistido no re-emite en tick estable.

**Multi-tenant:**
- Agencia asociada recibe; agencia no asociada **no** recibe.
- Superadmin recibe.
- Viaje compartido → fan-out correcto a todas las agencias asociadas.
- Sin cross-tenant data.

**Notification:**
- Preferencia `occupancy_alerts` (agencia) enabled → entrega; disabled (`in_app_enabled=false`) → fila de agencia filtrada.
- Superadmin (sin gate): una única fila `recipient_role='superadmin'` por evento; todos los superadmins reciben la notificación. **No** se consulta `superadmin_notification_preferences`.
- CHECK `notifications.type` extendido con `occupancy_alert` (migración no destructiva; tipos existentes preservados).
- `action_url` por rol (R2): agencia → `/agency/trips/{trip_id}/passengers`; superadmin → `/admin/trips/{trip_id}`.
- NotificationFanout `source_event_id` idempotente.
- Sin email path (assert: no EmailFanout, no `email_delivery_log`, no `EMAIL_DELIVERY_MODE`).

**Widget de agencia:**
- "Ocupación de viajes" reemplazado por "Alertas de ocupación" en `app/agency/page.tsx`; `OccupancyChart` sigue usado por `/admin` (`app/admin/page.tsx:246`) y **no** se elimina/refactoriza.
- Fuente de datos: `trip_occupancy_alert_state` (live) — el widget **no** se alimenta de la tabla `notifications`.
- Campos mínimos visibles (tipo, ruta, salida, occupancy, capacidad, reservados, disponibles).
- CTA "Ver viaje" deep-link a `/agency/trips/{trip_id}/passengers` (no a `/agency`; la ruta sin `/passengers` no existe).
- Solo alertas de viajes en los que la agencia participa.
- Contrato de tenancy: la agencia **solo** ve alertas de trips asociados a esa agencia (`trip_agencies.agency_id`); no se devuelve estado de trips de otras agencias; no se usa `notifications` como fuente; no cambia la semántica global de `getDashboard()`.
- La alerta desaparece al resetear a `NORMAL` (fila de estado eliminada) y al cancelarse/completarse el viaje o pasar `departure_time`; reaparece tras una nueva transición.

**Event:**
- `event_type`/`event_version`; `aggregate_type=trip`; payload sin PII.

**Worker:**
- Flag `false` → `skipped_effect_disabled`; flag `true` → evalúa.
- Polling, batch, scheduler error (log sin crash).

**Regression:**
- F4-001, F4-002, WKR-007, WKR-008, WKR-009.

### Definition of Done

- [ ] Design vigente (scope-lock **cerrado**, P1–P5 fijadas).
- [ ] Migración: estado `trip_occupancy_alert_state` (Estrategia B, §11) + RPC `evaluate_occupancy_alerts` + categoría `occupancy_alerts` **solo agencia** + CHECK `notifications.type` con `occupancy_alert` (cambio no destructivo) + backfill de agencias (grants/RLS/SKIP LOCKED).
- [ ] Cleanup del estado en cada ciclo (`trips.status != 'active'` o `departure_time <= now()`); sin evento por cleanup (§16).
- [ ] `total <= 0` / `reserved > total` → skip con registro (`skipped_invalid_occupancy`), sin alerta (§6).
- [ ] Batch/fairness: keyset `(departure_time, id)` + cursor en memoria; progreso garantizado en 51/100/300 (§8).
- [ ] Scheduler en worker; flag default `false`.
- [ ] Evento `trip.occupancy_alert.due.v1` + handler NotificationFanout.
- [ ] Contenido in-app sin PII.
- [ ] Anti-spam por estado + `dedup_key` + `source_event_id`.
- [ ] Preferencias `occupancy_alerts` **solo agencia** (`in_app_enabled=true` default; opt-out por agencia; independientes de digests).
- [ ] Superadmin: una única fila `recipient_role='superadmin'` por evento; todos los superadmins la reciben; **sin** uso de `superadmin_notification_preferences`.
- [ ] **Widget de agencia "Ocupación de viajes" reemplazado por "Alertas de ocupación" (composición en `app/agency/page.tsx`; `OccupancyChart` se mantiene para `/admin`).**
- [ ] **Alertas in-app visibles en el dashboard.**
- [ ] **Deep-link directo al trip por rol (agencia → `/agency/trips/{trip_id}/passengers`; superadmin → `/admin/trips/{trip_id}`).**
- [ ] **Una alerta por transición; una transición por tick por viaje (R6).**
- [ ] **Hysteresis 90/85 y 20/25.**
- [ ] **Re-entry tras volver a NORMAL.**
- [ ] **No email v1.**
- [ ] Unit + boarding/static (+ harness SQL si RPC).
- [ ] `tsc --noEmit` + backend build + frontend build verdes.
- [ ] Soak `false` → `true` en producción; logs verificados.
- [ ] Cierre documental posterior (TASKS/ROADMAP/HISTORY).
- [ ] OUT respetado (§21).

---

## 25. Follow-ups

| Ticket | Tema |
|---|---|
| Seguimiento | Cierre operativo F4-002 (primer ciclo 07:00 con flag ON) — **no bloquea** este design. |
| Normalización | Unificar semántica de `reserved` en `reservation.service.ts:1096,1145` a `!= 'available'` (divergencia detectada en auditoría). |
| Futuro | Normalización de occupancy **comercial** (si `locked`/`blocked` deben contar de forma distinta): F4-003 usa deliberadamente la semántica canónica `!= 'available'` y queda fuera de su alcance (§6). |
| Futuro | Email como segundo canal de `occupancy_alerts` (requiere entorno Resend comercial). |
| Futuro | Thresholds configurables por agencia (v1 = global/versionado). |
| Futuro | Seat quotas por agencia / occupancy específica por agencia. |
| Futuro | Preferencias superadmin ampliadas (más allá de `superadmin_digest`). |
| Futuro | Superficie UI en dashboard superadmin para listar alertas activas (si se requiere; v1 usa el mecanismo in-app existente). |
| Fuera | Analytics/reportes, nightly metrics, trips-without-action, audit trail, timers, boarding retention. |

---

## 26. Scope Guard

F4-003 **NO** incluye email/Resend/ledger en v1, thresholds configurables, seat quotas, analytics, cambios generales a `getDashboard()`, refactor general de seat status, ni reutilización de `ops_digest`/`superadmin_digest` como categoría. El único mecanismo de entrega v1 es **NotificationFanout (in-app)**.

La UI acotada de F4-003 **no** convierte el ticket en: un dashboard de analytics, reportes, configuración de thresholds, seat quotas, nightly metrics, F4-001, F4-002 ni audit trail. La única superficie UI de v1 es el widget del dashboard de agencia ("Alertas de ocupación", reemplazando la composición de "Ocupación de viajes" en `app/agency/page.tsx`; **`OccupancyChart` se mantiene porque `/admin` lo usa** — no se elimina ni refactoriza globalmente). El widget se alimenta de `trip_occupancy_alert_state` (estado persistido live) y **no** de la tabla `notifications`; no es analytics ni un segundo dashboard de ocupación. El superadmin usa el mecanismo in-app existente, sin pantalla nueva; **todos** los superadmins reciben las occupancy alerts in-app, sin opt-out por categoría y **sin** usar `superadmin_notification_preferences` (tabla que gobierna solo F4-002). El opt-out por categoría aplica **únicamente** a las agencias vía `agency_notification_preferences`.
