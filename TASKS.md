# TASKS

> Documento **operativo del sprint**. Una tarea activa a la vez; marcar `[x]` al completar.
> **Visión de producto (mediano/largo plazo):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
> **Historial de sprints completados:** [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)
> **Guía para mantener la documentación:** [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## Completado recientemente — Fase 5

- [x] **F5-001** — Audit Trail (foundation) — **Implementado**
  - Tabla append-only `public.audit_log` + `audit_append()` + RLS/grants
  - 9 acciones: trip create/update/cancel, reservation create/cancel, boarding board/unboard, branding, notification prefs
  - RPCs atómicos (`cancel_agency_reservation`, branding/prefs) + triggers trips/reservations; `trips.updated_by`
  - Drop policies cliente `bl_agency_insert` / `reservations_agency_insert`
  - Actor solo desde `req.ctx`; PII minimizado (whitelist)
  - Migración `065_audit_log.sql` (tip; sin tocar 001–064)
  - Harness `supabase/tests/f5_001_verification.sql` (BEGIN/ROLLBACK) — listo post-apply
  - Diseño: [`docs/F5-001-audit-trail-design.md`](docs/F5-001-audit-trail-design.md)

**Ops pendientes (F5-001):** aplicar migración `065` en Supabase (si aún no) → ejecutar harness → confirmar PASS.

**Fuera de F5-001 (follow-ups):** read API / UI; invitaciones/usuarios; correlation ID; retención/purge; analytics/realtime audit.

---

## Completado — Fase 4 (Automatizaciones)

- [x] **F4-004** — Occupancy Urgency Alerts (in-app) — **CLOSED**
  - Diseño: [`docs/F4-004-occupancy-urgency-alerts-design.md`](docs/F4-004-occupancy-urgency-alerts-design.md)

- [x] **F4-003** — Occupancy Alerts (in-app) — **CLOSED**
  - Diseño: [`docs/F4-003-occupancy-alerts-design.md`](docs/F4-003-occupancy-alerts-design.md)

- [x] **F4-002** — Superadmin Daily Digest (email) — **CLOSED**
  - Diseño: [`docs/F4-002-superadmin-daily-digest-design.md`](docs/F4-002-superadmin-daily-digest-design.md)

- [x] **F4-001** — Agency Daily Digest (email) — **CLOSED**
  - Diseño: [`docs/F4-001-agency-daily-digest-design.md`](docs/F4-001-agency-daily-digest-design.md)

Detalle y evidencia de cutover: [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md).

**Render (worker) — F4 occupancy (operativo):**

| Variable | Valor |
|---|---|
| `OCCUPANCY_ALERT_VIA_WORKER` | `true` |
| `OCCUPANCY_ALERT_POLL_MS` | `3600000` |
| `OCCUPANCY_ALERT_BATCH` | `50` |
| `OCCUPANCY_URGENCY_VIA_WORKER` | `true` |

---

## Completado — Fase 3 (Workers + observability)

- [x] WKR-001 … WKR-009 — outbox, email/trip/reminder workers, observabilidad, retention. Detalle: [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)

---

## Después (producto / follow-ups)

| Orden | Ticket / Fase | Tema | Estado |
|-------|---------------|------|--------|
| — | **F5-001** | Audit Trail foundation | Implementado — ops apply/harness |
| — | **F5-002+** / Fase 5 resto | Read API / UI audit; invitaciones/usuarios | Futura |
| — | Futuro / Fase 6 | Métricas históricas y reporting | Futura |
| — | Infraestructura / Operaciones | Backup & Disaster Recovery | Futura |
| — | Follow-up | Migración timers `LockCleanup` / `completeExpiredTrips` | Futura |
| — | Follow-up | Retention `boarding_attempts` | Futura |
| — | Follow-up | Normalizar occupancy en `reservation.service.ts` | Futura |
| — | **SEC-009** | Continuous Security Validation — Futura (≠ Sentry). Selección de herramientas en el design del ticket. | Futura |

Detalle: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Bloqueadores

_Ninguno. F4-001…F4-004 CLOSED. F5-001 implementado en tip; sin bloqueadores de código. Ops: aplicar `065` + harness si aún no están en el entorno objetivo._

---

## Ideas futuras

- **Background Worker nativo** — cuando el plan de hosting lo permita (sin HTTP)
- **UX continua** — responsive, accesibilidad, skeletons (ROADMAP Fase 7)
- **Escalabilidad** — caché, índices, costos; Prometheus (ROADMAP Fase 8)
- **Sentry frontend / Performance / Replay** — fuera de WKR-006.2
- **Email occupancy_alerts** — requiere Resend comercial
- **UI prefs `superadmin_digest`** — v1 es seed + gate de envío
- **Dashboard superadmin de alertas activas** — v1 usa in-app existente
- **UI / API de lectura del audit trail** — fuera de F5-001
