# AUD — WKR-008 Reminder Workers

**Tipo:** Auditoría técnica (read-only)
**Fecha:** 2026-08-09
**Estado:** Pendiente (sin código)
**Rama:** `main` (limpia)
**Referencia:** [ROADMAP.md](ROADMAP.md), [WKR-001](WKR-001-event-inventory-audit.md), [WKR-002](WKR-002-events-workers-architecture-adr.md), [WKR-003.2](WKR-003.2-domain-event-boundaries.md), [WKR-005.1](WKR-005.1-email-worker-readiness-audit.md), [WKR-007 design](WKR-007-trip-notification-event-workers-design.md)

---

## 1. Estado del contrato (docs)

- **Definición (ROADMAP.md:193):** WKR-008 = *Reminder workers*, ventanas **T-24h / T-2h**. Reminder = notificación **proactiva** de viaje próximo: "Tu viaje sale mañana a las 09:00" / "en 2 horas" (ROADMAP.md:37-38). Se diferencia de los flujos reactivos (confirmación, cancelación).
- **Evento clave:** `trip.reminder_due` (WKR-003.2:211-216) — un viaje **activo** entró en la ventana T-24h/T-2h. **No significa** que el reminder fue enviado; el envío es del consumer. **Productor:** `SchedulerWorker` (nuevo). **Consumidores futuros:** `ReminderWorker` (email a booker/agencia).
- **Re-agendar:** `trip.postponed` / `trip.cancelled` tienen como consumidor futuro a ReminderWorker (re-agendar / descartar reminders) (WKR-003.2:190-200).
- **Inventario (WKR-001:185,272):** `TripReminderWorker`, cron cada hora, "no existe; caso piloto de recordatorios".
- **ADR (WKR-002:227-230):** Reminder Worker consume *scheduler + trip.updated/postponed/cancelled*; ejecuta generación de `trip.reminder_due` a bookers/agencias en T-24h/T-2h.
- **Reutilización (WKR-007 design:232,415):** `email_delivery_log` es **reutilizable por WKR-008**; "handlers/eventos de trip listos; `trip.reminder_due` se publicará cuando exista scheduler".
- **Decisiones pendientes (WKR-003.2:450,453):** Scheduler = *cron durable en worker dedicado, liderazgo single-writer*; `trip.reminder_due` = frecuencia de evaluación (cada hora) y ventanas exactas **sin cerrar**.

## 2. Estado de la implementación (código)

**No existe absolutamente nada de reminders/scheduler.** Verificado con grep exhaustivo (backend + app + supabase, excluyendo docs):

| Componente | ¿Existe? | Notas |
|---|---|---|
| Evento `trip.reminder_due` | ❌ No | `backend/src/events/` solo tiene family trip.* creados en WKR-007.3 |
| Scheduler durable | ❌ No | Timers viven en `backend/src/index.ts:37-81` (setInterval LockCleanup 60s + completeExpiredTrips 1h) |
| Handler/worker de reminder | ❌ No | `handlers/index.ts` solo registra `reservation.created` + placeholder de notificación |
| Migración de reminders | ❌ No | Última migración: `057_trip_events_rpc.sql` |
| Env vars reminder | ❌ No | `config/env.ts` no las define |
| Template email reminder | ❌ No | `templates/`: solo invitation, registration, reset, new-trip, postponed, cancelled, confirmed, ticket |
| Tipo notificación reminder | ❌ No | `notifications.type` CHECK (029) y `NOTIFICATION_CATEGORIES` no lo incluyen |
| Tabla scheduler | ❌ No | `email_delivery_log` (055) sí existe, lista para reutilizar |

## 3. Hallazgos clave

> **Nota de actualización (2026-08-11):** los hallazgos **B**, **D** y **E** quedaron **resueltos** por el cierre de WKR-007 (adopción de RPCs en `superadmin.service.ts`/`trip.service.ts`, handlers `NotificationFanout`/`EmailFanout`, flag `TRIP_EFFECTS_VIA_OUTBOX` con cutover realizado, `trip.auto_completed` emitido vía `complete_trip`). Los hallazgos **A**, **C**, **F** y **G** permanecen vigentes.

**A. Dependencia de scheduler durable inexistente.** No hay ningún mecanismo de cron durable. Los schedulers actuales (locks, auto-completado) siguen en la API (`index.ts:37-81`), un anti-patrón documentado (WKR-001 §5.2, AUD-021 H10). WKR-008 requiere el `SchedulerWorker` nuevo como productor de `trip.reminder_due`. El contrato "cron durable + single-writer" (WKR-003.2:450) está sin implementar y sin decisión de mecanismo (Postgres-as-queue vs cron).

**B. `trip.auto_completed` no se emite hoy.** `completeExpiredTrips` (`trip.service.ts:4-57`) hace UPDATE directo + notificación síncrona; no usa el RPC `complete_trip`. Si WKR-008 quiere descartar reminders de viajes no-activos, hoy el "hecho" de auto-completado no pasa por el outbox.

**C. Gap de contrato en el payload de `trip.reminder_due`.** El evento no define payload shape, y específicamente **no define `window` (T-24h vs T-2h)**. Dado que el type es el mismo para ambas ventanas, sin un campo `window` la idempotencia (dedup_key / `email_delivery_log`) no puede distinguir "enviado a las 24h" de "enviado a las 2h". Es un requisito derivar `dedup_key = trip.reminder_due:{trip}:{window}` (mismo patrón que `trip.postponed`, migración 057:348-350).

**D. El worker fallaría hoy ante trip.* events.** `runner.ts:188` usa `eventType: null` (claim todos los tipos), pero el registry solo tiene `reservation.created`. Si un trip.* se publicara hoy → relay lo marca `failed: "No handler"` (relay.ts:100-121). No es un problema activo (el service layer aún no llama a los RPC de trip), pero es la frontera que WKR-007 debe cerrar antes de que WKR-008 pueda encadenarse.

**E. WKR-007 no está completo (contradice WKR-007 design:415).** TASKS.md:52 marca WKR-007 como "**Siguiente**" (no cerrado). En código: migraciones Fase 0 (052-056), contratos trip.* v1 y RPCs 057 **sí**; pero **no** hay adopción en `superadmin.service` (sigue con updates directos, sin `.rpc('create_trip'|...)`), **no** hay handlers de trip (NotificationFanout/EmailFanout), **no** existe flag `TRIP_EFFECTS_VIA_OUTBOX`. El doc WKR-007:415 describe el estado *objetivo*, no el actual.

**F. Booker/pasajero sin email propio.** Los payloads trip.* son sin-PII por diseño. El ReminderWorker deberá resolver bookers en runtime (join `reservations.trip_id → contact_email`). Consistente con el patrón del worker actual (load-time lookup en `handlers/index.ts:13-30`).

**G. Canal:** el reminder a pasajero es **email** (el pasajero no autentica; WKR-003.2:216). Para agencias queda la opción email + in-app (requeriría nuevo `notifications.type` y categoría en `notification-categories.ts`). Decisión de producto abierta.

## 4. Verificación de regresión

- **Backend:** 36 files, **280/280 tests** ✅ (17.64s)
- **WKR-007 suites:** phase0 (17) + fase2 (21) + 007.2 (9) = **47/47** ✅
- **Typecheck:** `tsc --noEmit` exit 0 ✅
- **git:** limpio, sin cambios ✅

## 5. Decisiones que WKR-008 debe tomar (bloqueantes)

1. **Mecanismo de scheduler durable** (cron worker Node vs pg_cron vs polling) + single-writer.
2. **Ventanas exactas:** qué cuenta como "T-24h" y "T-2h" respecto de `departure_time`, frecuencia de evaluación (cada hora) y cómo evitar doble emisión.
3. **Payload/`window`:** definir `trip.reminder_due` payload con `window` y derivar dedup_key → idempotencia vía `email_delivery_log` (reutilizable, ya lista).
4. **Destinatarios:** booker (email) siempre; ¿agencias por email y/o in-app? (afecta `notifications.type` + categorías).

## 6. Orden recomendado

1. Cerrar WKR-007 (adopción RPC en service + handlers de trip + flag) — de él cuelga WKR-008.
2. Decidir scheduler durable (A) → SchedulerWorker productor.
3. Definir contrato `trip.reminder_due` v1 (window, payload, dedup) + tests de contrato.
4. ReminderWorker consumidor: resolver bookers, `email_delivery_log` como ledger, template email (2 variantes T-24h/T-2h), re-agendar en `trip.postponed` y descartar en `trip.cancelled`.
5. Feature flag (patrón `EMAIL_VIA_OUTBOX`) + soak.
