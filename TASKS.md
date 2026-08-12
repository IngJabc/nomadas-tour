# TASKS

> Documento **operativo del sprint**. Una tarea activa a la vez; marcar `[x]` al completar.
> **Visión de producto (mediano/largo plazo):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
> **Historial de sprints completados:** [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)
> **Guía para mantener la documentación:** [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## Sprint actual — siguiente

**Fase 4 — Automatizaciones de producto** (**Pendiente**)

Siguiente fase tras el cierre de WKR-009 (Outbox Retention Worker). Referencia: [`docs/ROADMAP.md`](docs/ROADMAP.md).

**Fuera del sprint inmediato (follow-ups técnicos, no WKR-009):** migración de timers `LockCleanup` / `completeExpiredTrips`; purga de `boarding_attempts`; automation bridge histórico ≠ Fase 4 producto.

Worker health (Render Free): [`docs/WKR-006.4-worker-health-endpoint.md`](docs/WKR-006.4-worker-health-endpoint.md)

---

## Completado recientemente — Fase 3 (Workers + observability)

- [x] WKR-001 — Event inventory audit
- [x] WKR-002 — Events/workers architecture ADR
- [x] WKR-003 — Outbox design (+ readiness / boundaries)
- [x] WKR-004 — Transactional outbox foundation
- [x] WKR-005 — Outbox relay + EmailWorker (`reservation.created.v1`)
- [x] WKR-006 — Worker Observability Foundation (docs)
- [x] WKR-006.1 — Structured logs + metrics + heartbeat + stuck reaper
- [x] WKR-006.2.1 — Sentry Foundation Design (docs)
- [x] WKR-006.2 — Sentry wiring (API + worker, opcional)
- [x] WKR-006.3 — Outbox Retention & DLQ Operational Runbook (docs)
- [x] WKR-006.4 — Worker health endpoint (`GET /healthz`, `WORKER_HEALTH_PORT`)
- [x] WKR-007 — Trip / notification event workers (eventos trip.*, RPCs 057, handlers fanout, wiring a producción + cutover realizado; cierre en [`docs/WKR-007-wiring-implementation-plan.md`](docs/WKR-007-wiring-implementation-plan.md))
- [x] WKR-008 — Reminder workers (**Completado** — T-48h/T-24h, migración 059, harness SQL A–K, cutover `TRIP_REMINDER_VIA_OUTBOX=true` en Render; cierre: [`docs/WKR-008-reminder-workers-audit.md`](docs/WKR-008-reminder-workers-audit.md) — PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED)
- [x] WKR-009 — Outbox Retention Worker (**Completado** — purga `completed` ≥30d, migración 060, scheduler + flag `OUTBOX_RETENTION_VIA_WORKER=true` en Render; harness A–J; EXPLAIN sin índice; cierre: [`docs/WKR-009-outbox-retention-workers-audit.md`](docs/WKR-009-outbox-retention-workers-audit.md) — PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED)

---

## Completado — Fase 2 Branding

- [x] Configuración de agencias — branding (logo, colores primario/secundario/acento)
- [x] Regla: nombre de agencia solo editable por superadmin (no por la agencia)
- [x] UI de settings en panel agencia + endpoints backend correspondientes

---

## Después (producto / follow-ups)

| Orden | Ticket / Fase | Tema | Estado |
|-------|---------------|------|--------|
| 1 | Fase 4 | Automatizaciones de producto | Pendiente |
| — | Follow-up | Migración timers `LockCleanup` / `completeExpiredTrips` (≠ WKR-009) | Futura |
| — | Follow-up | Retention `boarding_attempts` (≠ WKR-009) | Futura |
| — | **SEC-009** | Continuous security validation (≠ Sentry) | Futura |

Detalle: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Separación Observabilidad vs Seguridad continua

| | WKR-006.x (Sentry / logs / métricas / DLQ / healthz) | SEC-009 (Strix / SAST / scanners) |
|--|-----------------------------------------------------|-------------------------------------|
| Propósito | Operación y errores en producción | Vulnerabilidades / regresiones seguridad |
| Momento | 006.1–006.4 ✅ | Futura, paralela |
| No es | Pentest / SAST | APM / error tracking |

---

## Bloqueadores

_Ninguno al cierre de WKR-009. En Render Free: Web Service + `WORKER_HEALTH_PORT` = `PORT`._

---

## Ideas futuras

Ítems útiles que no pertenecen al sprint inmediato:

- **Background Worker nativo** — cuando el plan de hosting lo permita (sin HTTP)
- **UX continua** — responsive, accesibilidad, skeletons (ROADMAP Fase 7)
- **Escalabilidad** — caché, índices, costos; Prometheus (ROADMAP Fase 8)
- **Sentry frontend / Performance / Replay** — fuera de WKR-006.2
- **Custom Access Token Hook** — defensa en profundidad opcional post-RLS
- **Tenant isolation test** — automatizar checklist multi-tenant (alimenta SEC-009)
