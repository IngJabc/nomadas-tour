# TASKS

> Documento **operativo del sprint**. Una tarea activa a la vez; marcar `[x]` al completar.
> **Visión de producto (mediano/largo plazo):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
> **Historial de sprints completados:** [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)
> **Guía para mantener la documentación:** [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## Sprint actual — siguiente

**Fase 3 — WKR-006.2 — Sentry wiring** *(Planned)*

Diseño (completado): [`docs/WKR-006.2-sentry-foundation-design.md`](docs/WKR-006.2-sentry-foundation-design.md)
Base runtime: [`docs/WKR-006.1-worker-observability-implementation.md`](docs/WKR-006.1-worker-observability-implementation.md)

- [ ] Instalar/init SDK solo cuando se ejecute WKR-006.2 (no en este sprint de docs)
- [ ] Worker + API con tags de correlación; `beforeSend` anti-PII
- [ ] Sin frontend / Performance / Session Replay en la primera integración
- [ ] **No** mezclar con SEC-009 (SAST / Strix)

---

## Completado recientemente — Fase 3 (Workers + observability)

- [x] WKR-001 — Event inventory audit
- [x] WKR-002 — Events/workers architecture ADR
- [x] WKR-003 — Outbox design (+ readiness / boundaries)
- [x] WKR-004 — Transactional outbox foundation
- [x] WKR-005 — Outbox relay + EmailWorker (`reservation.created.v1`)
- [x] WKR-006 — Worker Observability Foundation (docs)
- [x] WKR-006.1 — Structured logs + metrics + heartbeat + stuck reaper
- [x] WKR-006.2.1 — Sentry Foundation Design (docs only)

---

## Completado — Fase 2 Branding

- [x] Configuración de agencias — branding (logo, colores primario/secundario/acento)
- [x] Regla: nombre de agencia solo editable por superadmin (no por la agencia)
- [x] UI de settings en panel agencia + endpoints backend correspondientes

---

## Después (Fase 3 restante → producto)

| Orden | Ticket / Fase | Tema | Estado |
|-------|---------------|------|--------|
| 1 | **WKR-006.2** | Sentry wiring (API + worker) | **Planned** |
| 2 | WKR-006.3 | Retention + DLQ runbook | Pendiente |
| 3 | WKR-007 | Trip / notification event workers | Pendiente |
| 4 | WKR-008 | Reminder workers | Pendiente |
| 5 | WKR-009 | Retention / automation bridge | Pendiente |
| 6 | Fase 4 | Automatizaciones de producto | Pendiente |
| 7 | Fase 5 | Audit Trail | Pendiente |
| 8 | Fase 6 | Reportes | Pendiente |
| — | **SEC-009** | Continuous security validation (paralela; ≠ Sentry) | Futura |

Detalle: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Separación Observabilidad vs Seguridad continua

| | WKR-006.x (Sentry / logs / métricas) | SEC-009 (Strix / SAST / scanners) |
|--|--------------------------------------|-------------------------------------|
| Propósito | Errores, performance, trazas en producción | Vulnerabilidades, regresiones, multi-tenant/RLS |
| Momento | 006.1 ✅; 006.2.1 design ✅; 006.2 wiring Planned | Futura, paralela |
| No es | Pentest / SAST | APM / error tracking |

---

## Bloqueadores

_Ninguno al cierre de WKR-006.2.1 (2026-08-05)._

---

## Ideas futuras

Ítems útiles que no pertenecen al sprint inmediato:

- **UX continua** — responsive, accesibilidad, skeletons (ROADMAP Fase 7)
- **Escalabilidad** — caché, índices, costos; Prometheus (ROADMAP Fase 8)
- **Custom Access Token Hook** — defensa en profundidad opcional post-RLS
- **Tenant isolation test** — automatizar checklist multi-tenant (alimenta SEC-009)
- **Fix preexistente** — `lib/__tests__/utils.test.ts` (`formatDateTime`, timezone)
