# WKR-004 — Transactional Outbox Foundation (implementation)

**Tipo:** Implementación de infraestructura  
**Fecha:** 2026-08-05  
**Estado:** Implemented (sin workers)  
**Referencias:** [WKR-001](WKR-001-event-inventory-audit.md), [WKR-002](WKR-002-events-workers-architecture-adr.md), [WKR-003](WKR-003-transactional-outbox-foundation-design.md), [WKR-003.2](WKR-003.2-domain-event-boundaries.md), [ADR-001](decisions/ADR-001-boarding-cross-agency.md)

---

## Auditoría previa — dónde nace una reserva

| Pregunta | Hallazgo |
|----------|----------|
| Origen real | RPC `create_agency_reservation` (migración `047`) hace `INSERT INTO reservations` |
| Backend | `reservation.service.createAgencyReservation` llama al RPC vía `supabaseAdmin`; **no** inserta la fila directamente |
| Misma TX | Pasajeros + seats reserved + cabecera reserva en una sola transacción PL/pgSQL |
| Diferencia vs diseño | WKR-003.2 mencionaba payload amplio opcional; **esta iteración** usa payload mínimo `{ reservation_id, trip_id, agency_id }` (ticket WKR-004) |
| ADR-001 | Intacta: `agency_id` = ownership comercial; boarding operacional no cambia |

**Decisión de emisión:** trigger `AFTER INSERT` en `reservations` (no se modificó el RPC ni `reservation.service.ts`). El INSERT del RPC dispara el outbox en la misma transacción.

---

## Qué se implementó

1. **Migración** `supabase/migrations/049_outbox_events.sql`
   - Tabla `outbox_events` con CHECK de status/version/payload
   - Índices: `(status, available_at)`, `(aggregate_type, aggregate_id)`, `event_type`, `created_at`
   - RLS deny-by-default + REVOKE anon/authenticated + GRANT service_role
   - **No** publicada en `supabase_realtime`
   - Función + trigger `trg_reservations_outbox_created` → `reservation.created` v1

2. **Contrato TypeScript** `backend/src/events/`
   - `EventEnvelope<T>`, `OutboxEventRow`
   - `ReservationCreatedEventV1` / `ReservationCreatedDataV1`
   - `parseReservationCreatedEventV1` + guards anti-PII

3. **Tests**
   - Backend: `reservation-created.v1.test.ts`
   - Estático: `tests/boarding/outbox-foundation.test.ts`
   - SQL Editor: `supabase/tests/wkr_004_outbox_verification.sql`

4. **Documentación** (este archivo)

---

## Qué NO se implementó

- Workers / relay / polling
- Emails asíncronos (siguen fire-and-forget en el service)
- Scheduler
- Event sourcing
- Kafka / Redis / BullMQ
- Cambios a `create_agency_reservation` o `reservation.service.ts`
- Nuevos eventos además de `reservation.created.v1`

---

## Arquitectura actual

```
HTTP createAgencyReservation
  → RPC create_agency_reservation
      → INSERT reservations  ──(same TX)──► trigger
                                              → INSERT outbox_events
                                                  event_type=reservation.created
                                                  version=1
                                                  payload={reservation_id,trip_id,agency_id}
      → INSERT passengers / UPDATE seats
  → (side effects sync/fire-and-forget sin cambios)

Worker futuro (fuera de alcance):
  SELECT … FOR UPDATE SKIP LOCKED FROM outbox_events WHERE status='pending'
```

---

## Flujo reservation.created.v1

| Campo outbox | Valor |
|--------------|-------|
| `event_type` | `reservation.created` |
| `event_version` | `1` |
| `aggregate_type` | `reservation` |
| `aggregate_id` | `reservations.id` |
| `tenant_id` | `reservations.agency_id` |
| `payload` | `{ reservation_id, trip_id, agency_id }` |
| `status` | `pending` |

Envelope TS: `id`, `type`, `version`, `occurred_at` ← `created_at`, `tenant.agency_id`, `aggregate`, `data`.

---

## Decisión: trigger

| Criterio | Resultado |
|----------|-----------|
| Misma TX que el INSERT | Sí |
| Sin tocar RPC 047 | Sí |
| Sin driver `pg` en Express | Sí |
| Cubiertas inserciones futuras a `reservations` | Sí (cualquier INSERT) |

---

## Seguridad

- Sin `auth.jwt()` / `user_metadata`
- Sin grants a `anon` / `authenticated`
- Sin Realtime
- Payload sin documentos, teléfonos, emails, QR
- RLS habilitada sin policies cliente (deny default; service_role BYPASSRLS)

---

## Riesgos pendientes

1. Cualquier INSERT directo a `reservations` (fixtures, scripts) emite evento — esperado; workers deben ser idempotentes.
2. Side effects actuales (email/notif) siguen en el request hasta el Email Worker.
3. Crecimiento de `outbox_events` sin RetentionWorker.
4. Multi-instancia: sin relay aún; no hay contención.

---

## Próximo ticket recomendado

**WKR-005 — Outbox relay + EmailWorker (reservation.created)**  
Relay que marca `processing`/`completed`, envía email de ticket con idempotencia, y apaga gradualmente el fire-and-forget del service (feature flag).

---

## Validaciones

```text
npm test --prefix backend
# → 18 files, 176 passed

npm test -- tests/boarding
# → 7 files, 37 passed | 4 skipped

git diff --check
# → clean
```

SQL post-migrate: `supabase/tests/wkr_004_outbox_verification.sql`
