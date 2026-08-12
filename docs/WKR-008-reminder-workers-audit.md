# AUD — WKR-008 Reminder Workers

**Tipo:** Auditoría técnica + implementación + cierre
**Fecha auditoría (arranque):** 2026-08-09
**Fecha implementación:** 2026-08-11
**Fecha cierre:** 2026-08-12
**Estado:** **PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED**
**Rama:** `feat/wkr-008-reminder-workers`
**Referencia:** [ROADMAP.md](ROADMAP.md), [WKR-001](WKR-001-event-inventory-audit.md), [WKR-002](WKR-002-events-workers-architecture-adr.md), [WKR-003.2](WKR-003.2-domain-event-boundaries.md), [WKR-007 design](WKR-007-trip-notification-event-workers-design.md)

---

## 1. Decisiones implementadas

| Decisión | Elección |
|---|---|
| Ventanas | **Solo T-48h y T-24h**. **No T-2h.** |
| Scheduler | Loop Node dentro del worker existente (`reminder-scheduler.ts` + `runner.ts`). **Sin pg_cron**, sin segundo proceso. |
| Productor | RPC `schedule_trip_reminders(p_batch)` (migración 059) → `emit_trip_event('trip.reminder_due', …)`. |
| Evento | `trip.reminder_due.v1` con `window: 't48' \| 't24'`. |
| Idempotencia | `dedup_key = trip.reminder_due:{trip_id}:{window}:{departure_time_utc}` en `outbox_events` (`ON CONFLICT DO NOTHING`). |
| Catch-up | Si el worker vuelve en la ventana T-24h, emite **solo t24** (nunca T-48h retrospectivo). |
| Postergación | Nueva `departure_time` → nuevas keys. Restaurar el horario exacto reutiliza la key histórica (no reenvía). |
| Fanout | `reminder-fanout.handler` (booker + agency email vía `email_delivery_log`) + `NotificationFanout('trip_reminder')` in-app. |
| Flag | `TRIP_REMINDER_VIA_OUTBOX` — default `false` en código (rollback); **activo `true` en Render** tras validación operativa (ver §10; evidencia de entorno, no verificable desde el repo). |
| Preferencias | Categoría `trip_reminders` + backfill en 059; defaults en `NOTIFICATION_CATEGORIES` / `seedDefaults`. |
| Poll | `REMINDER_SCHEDULE_POLL_MS=3600000` (1h); `REMINDER_SCHEDULE_BATCH=50`. |

---

## 2. Contrato `trip.reminder_due.v1`

Archivo: `backend/src/events/trip-reminder-due.v1.ts`

```ts
{
  trip_id, route_id, departure_time, window: 't48' | 't24', agency_ids
}
```

Reglas (igual que resto trip.*): `tenant_id` NULL, `payload.trip_id === aggregate_id`, sin PII.

---

## 3. Ventanas T-48 / T-24

Para un viaje `active` con `now < departure_time` y `now >= departure_time - 48h`:

- **t48:** `departure - 48h <= now < departure - 24h`
- **t24:** `departure - 24h <= now < departure`

Implementación SQL (equivalente): si `departure <= now + 24h` → `t24`, si no → `t48`.

---

## 4. Idempotencia y postergación

1. Viaje original → un evento t48 + un evento t24 (cuando cada ventana aplique).
2. Re-poll → `dedup_key` evita duplicados.
3. Admin pospone `departure_time` → nuevas keys → nuevas ventanas.
4. Restaura el horario exacto original → key histórica bloquea reemisión.
5. Nunca se borran / revierten reminders históricos.

---

## 5. Fanout

| Canal | Mecanismo |
|---|---|
| Booker email | Reservas `confirmed`/`partial` con `contact_email`; ledger `trip_reminder_t48` / `trip_reminder_t24`, `recipient_id = reservation.id` |
| Agency email | `getAgenciesWithEmail` + `shouldDeliver(agency, trip_reminder, email)`; mismo ledger, `recipient_id = agency.id` |
| In-app | `createNotificationFanoutHandler('trip_reminder')` con `source_event_id`; gated por `TRIP_REMINDER_VIA_OUTBOX` |

No hay camino síncrono legacy de reminders → no hay doble emisión in-app al activar el flag.

Textos:

- T-48h: "Tu viaje sale en dos días"
- T-24h: "Tu viaje sale mañana"
- Siempre muestran la fecha/hora real del evento (`departure_time`).

---

## 6. Observabilidad

Reutiliza logs JSON del worker, métricas, heartbeat, Sentry, DLQ/retry/recovery. El scheduler loguea `reminder_scheduler_started|tick|error|stopped` con `scanned` / `emitted` / `duration_ms`. Errores del scheduler **no** tumban el relay.

---

## 7. Archivos clave

- `supabase/migrations/059_schedule_trip_reminders.sql`
- `backend/src/events/trip-reminder-due.v1.ts`
- `backend/src/workers/reminder-scheduler.ts`
- `backend/src/workers/handlers/reminder-fanout.handler.ts`
- `backend/src/templates/trip-reminder-email.tsx`
- `backend/src/config/env.ts` (`TRIP_REMINDER_VIA_OUTBOX`, poll/batch)
- `supabase/tests/wkr_008_verification.sql`

---

## 8. Hallazgos del audit de cierre — remediación (histórica)

Trazabilidad de findings del audit de cierre (estado final: **cerrados**; sin blockers técnicos).

| ID | Hallazgo | Severidad | Resolución / estado final |
|---|---|---|---|
| **F-01** | Literal `t22` en RPC 059 | P0 (reportado) | **Falso positivo / CLOSED.** Inspección directa de `059_schedule_trip_reminders.sql` y `pg_get_functiondef` (harness K): solo existen `'t48'` y `'t24'`. No había `t22` / `T22` / `trip_reminder_t22`. Sin cambio cosmético. |
| **F-02** | Pre-filtro muerto (`v_window` NULL en `NOT EXISTS`) | P2 (reportado) | **CLOSED.** Discrepancia con el código real: no existía ese `NOT EXISTS` con `v_window`. Remediación: pre-filtro `NOT EXISTS` con ventana **inline** vía `CASE` sobre `t.departure_time`. `emit_trip_event` sigue siendo la garantía final (`ON CONFLICT DO NOTHING`). |
| **F-03** | TOCTOU select→emit | P2 | **CLOSED.** `FOR UPDATE OF t SKIP LOCKED` + revalidación de `status` / `departure_time` bajo el lock antes de emitir. |
| **F-04** | Ausencia / ejecución del harness SQL comportamental | P2 → cerrado en cierre | **CLOSED.** Harness `supabase/tests/wkr_008_verification.sql` (casos A–K) creado, corregido (quoting + discovery por firma `pronargs`/`int4`) y **ejecutado exitosamente en staging** (`success. no rows returned`). |

Observations residuales (no blockers): únicamente P3 de documentación/trazabilidad — resueltas con este cierre documental.

---

## 9. Harness SQL

`supabase/tests/wkr_008_verification.sql` — BEGIN/ROLLBACK, casos A–J (+ K superficie):

- A t48 (~36h), B t24 (~12h), C fuera de ventana, D ya salido
- E catch-up solo t24, F dedup re-poll, G postponement, H restore
- I estados no elegibles, J `p_batch`, K solo t48/t24 + FOR UPDATE + NOT EXISTS

**Ejecución staging:** migración **059 aplicada**; harness A–K ejecutado completamente con resultado `success. no rows returned`.

---

## 10. Cierre definitivo (2026-08-12)

**Veredicto:** **PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED**

| Evidencia | Resultado |
|---|---|
| Migración 059 en staging | Aplicada |
| Harness SQL A–K | Ejecutado exitosamente (`success. no rows returned`) |
| WKR-008 unit tests | 20/20 PASS |
| WKR-008 boarding | 14/14 PASS |
| WKR-007 fase2 | 21/21 PASS |
| Backend tests | 352/352 PASS |
| Backend `tsc --noEmit` | PASS |
| Backend build | PASS |
| Root build | PASS |
| `TRIP_REMINDER_VIA_OUTBOX=true` en Render | Activo — **evidencia operativa** proporcionada/verificada durante el cierre; **no es una propiedad verificable desde el repositorio** (el default en código permanece `false` como postura de rollback) |
| Flujo real de reminders en producción | Probado y funcionó correctamente (evidencia operativa de cierre) |
| Blockers técnicos | **Ninguno** |

No quedan hallazgos P0/P2 abiertos. Observations: P3 de documentación/trazabilidad (este documento + TASKS/ROADMAP/HISTORY).
