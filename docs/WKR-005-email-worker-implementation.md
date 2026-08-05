# WKR-005 — Outbox Relay + EmailWorker (implementation)

**Tipo:** Implementación  
**Fecha:** 2026-08-05  
**Estado:** Implemented  
**Referencias:** [WKR-005.1](WKR-005.1-email-worker-readiness-audit.md), [WKR-004](WKR-004-outbox-foundation-implementation.md), [WKR-002](WKR-002-events-workers-architecture-adr.md)

---

## Arquitectura implementada

```
nomadas-api (Express)
  └─ createAgencyReservation
       ├─ RPC → INSERT reservations → trigger → outbox pending
       ├─ UPDATE contact_email / send_ticket_email
       └─ if !EMAIL_VIA_OUTBOX → fire-and-forget email (legacy)

nomadas-worker (Node, mismo repo)
  └─ Outbox Relay loop
       ├─ claim_outbox_events (SKIP LOCKED)
       └─ ReservationCreatedHandler
            ├─ settle flags (strategy B)
            ├─ getTicketData + Resend
            └─ ticket_email_sent_at (condicional)
```

Sin Redis / BullMQ / Kafka. Mismo stack: Supabase service_role + Resend.

---

## Flujo completo `reservation.created.v1`

1. Trigger WKR-004 escribe outbox (`pending`).
2. Relay reclama → `processing`, `attempts++`.
3. Handler parsea contrato; carga flags por `reservation_id` (no confía en payload para PII).
4. **Strategy B:** si evento joven y flags aún vacíos → `pending` + `available_at` delay (no completa).
5. Si ya enviado / no pidió email → `completed`.
6. Si debe enviar → email → `ticket_email_sent_at` si null → `completed`.
7. Error temporal → `pending` + backoff; max attempts → `failed`.

---

## Estados del outbox

| Transición | Cuándo |
|------------|--------|
| `pending` → `processing` | `claim_outbox_events` |
| `processing` → `completed` | handler OK / skip / already_sent |
| `processing` → `pending` | retry / flags_not_settled |
| `processing` → `failed` | permanente o max attempts |

---

## Retry

- Base: `OUTBOX_RETRY_BASE_MS` (default 2000)
- Backoff exponencial cap 5 min (`retryDelayMs`)
- Settle retry: `min(retryBaseMs, settleMs)`
- Max: `OUTBOX_MAX_ATTEMPTS` (default 10)

---

## Idempotencia

- Claim atómico: `FOR UPDATE SKIP LOCKED` (migración `050`)
- Envío: `UPDATE … SET ticket_email_sent_at … WHERE ticket_email_sent_at IS NULL`
- Si ya hay `ticket_email_sent_at` → `already_sent` sin Resend

---

## Feature flag

| Variable | Default | Efecto |
|----------|---------|--------|
| `EMAIL_VIA_OUTBOX` | `false` | `true` → API no envía fire-and-forget; worker envía |

Otras:

- `OUTBOX_POLL_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_MAX_ATTEMPTS`
- `OUTBOX_SETTLE_MS` (default 5000) — ventana anti-race
- `OUTBOX_RETRY_BASE_MS`

---

## Cómo ejecutar localmente

```bash
# Terminal 1 — API
cd backend
npm run dev

# Terminal 2 — Worker
cd backend
# .env con mismas vars Supabase/Resend + :
EMAIL_VIA_OUTBOX=true
npm run worker
```

Producción (Render u otro): servicio separado `npm run worker:start` tras `npm run build`, misma `SERVICE_ROLE`.

Aplicar migraciones `049` + `050` antes.

---

## Archivos clave

| Path | Rol |
|------|-----|
| `supabase/migrations/050_claim_outbox_events.sql` | Claim SKIP LOCKED |
| `backend/src/workers/runner.ts` | Entry worker |
| `backend/src/workers/outbox/relay.ts` | Relay loop |
| `backend/src/workers/handlers/reservation-created.handler.ts` | Email handler |
| `backend/src/config/env.ts` | Flags |
| `reservation.service.ts` | Skip HTTP email si flag |

---

## Riesgos pendientes

1. Dual path si `EMAIL_VIA_OUTBOX=false` y worker también corre → posible doble envío (mitigado por `ticket_email_sent_at`).
2. Flags nunca llegan (bug UPDATE) → tras settle se marca `skipped_no_email`.
3. Sin RetentionWorker / DLQ table aún (`failed` queda en outbox).
4. Notificaciones in-app siguen en HTTP.

---

## Siguiente paso — WKR-006 / 006.1

Foundation de observabilidad (auditoría + diseño):  
[`WKR-006-worker-observability-foundation.md`](WKR-006-worker-observability-foundation.md) ✅

Implementación runtime → **WKR-006.1** (logs estructurados, métricas, heartbeat, reaper).  
Sentry → **WKR-006.2**. Retención/DLQ → **WKR-006.3**.

Handlers adicionales (`trip.created`, notifications) → **WKR-007+**.  
Seguridad continua automatizada → **SEC-009** (ticket separado; no mezclar con Sentry).

---

## Tests ejecutados

```text
npm test --prefix backend
# → 20 files, 186 passed

npm test -- tests/boarding
# → 37 passed | 4 skipped

git diff --check
# → clean
```
