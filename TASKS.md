# TASKS

> Documento **operativo del sprint**. Una tarea activa a la vez; marcar `[x]` al completar.
> **Visión de producto (mediano/largo plazo):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
> **Historial de sprints completados:** [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)
> **Guía para mantener la documentación:** [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## Sprint actual — siguiente

**Fase 3 — WKR-007 — Trip / notification event workers**

Infra workers (outbox → email → observability → Sentry → retention runbook → healthz).

- [ ] Definir / emitir eventos de dominio siguientes (sin romper `reservation.created.v1`)
- [ ] Handlers de notificación desacoplados del request HTTP
- [ ] Reutilizar outbox + observabilidad + política DLQ de WKR-006.3

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

---

## Completado — Fase 2 Branding

- [x] Configuración de agencias — branding (logo, colores primario/secundario/acento)
- [x] Regla: nombre de agencia solo editable por superadmin (no por la agencia)
- [x] UI de settings en panel agencia + endpoints backend correspondientes

---

## Después (Fase 3 restante → producto)

| Orden | Ticket / Fase | Tema | Estado |
|-------|---------------|------|--------|
| 1 | **WKR-007** | Trip / notification event workers | **Siguiente** |
| 2 | WKR-008 | Reminder workers | Pendiente |
| 3 | WKR-009 | Retention worker (purga completed) / automation bridge | Pendiente |
| 4 | Fase 4 | Automatizaciones de producto | Pendiente |
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

_Ninguno al cierre de WKR-006.4. En Render Free: Web Service + `WORKER_HEALTH_PORT` = `PORT`._

---

## Ideas futuras

Ítems útiles que no pertenecen al sprint inmediato:

- **Background Worker nativo** — cuando el plan de hosting lo permita (sin HTTP)
- **UX continua** — responsive, accesibilidad, skeletons (ROADMAP Fase 7)
- **Escalabilidad** — caché, índices, costos; Prometheus (ROADMAP Fase 8)
- **Sentry frontend / Performance / Replay** — fuera de WKR-006.2
- **Custom Access Token Hook** — defensa en profundidad opcional post-RLS
- **Tenant isolation test** — automatizar checklist multi-tenant (alimenta SEC-009)
