# TASKS

> Documento **operativo del sprint**. Una tarea activa a la vez; marcar `[x]` al completar.
> **Estado:** tarea activa — **SEC-009.0** (CI Security Foundation).
> **Visión de producto (mediano/largo plazo):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
> **Historial de sprints completados:** [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)
> **Guía para mantener la documentación:** [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## Activo — SEC-009 (Continuous Security Validation)

- [ ] **SEC-009.0** — CI Security Foundation — **en implementación**
  - Primer pipeline de PR: `.github/workflows/ci.yml` (`test:security`, `npm test`, backend tests, `tsc --noEmit`, builds).
  - Design: [`docs/SEC-009-continuous-security-validation-design.md`](docs/SEC-009-continuous-security-validation-design.md)
  - **No** declara SEC-009 MVP completo (gitleaks / audit / CodeQL / tenant suite / SQL harness → tickets posteriores).

---

## Completado recientemente — Fase 5 + post-sprint UX

- [x] **F5-001** — Audit Trail (foundation) — **Implementado**
  - Diseño: [`docs/F5-001-audit-trail-design.md`](docs/F5-001-audit-trail-design.md)
- [x] **F5-002** — Audit Trail Read API — **Implementado**
  - `GET /api/admin/audit` y `GET /api/agency/audit` (read-only, cursor, 90d, sanitización por rol)
- [x] **F5-003** — Audit Trail UI — **Implementado**
  - `/admin/audit`, `/agency/audit`; gate UI temporal (un SUPERADMIN; agencias ocultas)
- [x] **Post-sprint** — Bloquear reservas si `departure_time <= now()` — **Implementado** (`066`, UX «Ya salió»)
- [x] **Post-sprint** — Notificaciones: actor = nombre de agencia — **Implementado**
- [x] **Post-sprint** — Notificaciones in-app: solo destino — **Implementado**
- [x] **Post-sprint** — Boleto: solo destino — **Implementado** (`origin` conservado en modelo)
- [x] **Infra / Ops** — Backup & Disaster Recovery MVP — **Implementado** (GitHub Actions → age → R2)
- [x] **Infra / Ops** — Backup local de contingencia — **Implementado** (copia manual cifrada de artefactos R2; scripts `local*.sh`; no scheduler)
  - Tutorial operativo: [`docs/backup-local-contingency.md`](docs/backup-local-contingency.md)
- [x] **F5-004** — Reserva asistida por enlace — **CLOSED**
  - Diseño: [`docs/F5-004-reserva-asistida-por-enlace-design.md`](docs/F5-004-reserva-asistida-por-enlace-design.md)
  - Migrations tip `072`; wizard + página pública `/reservations/link`; Realtime agencia (`070`); tutorial CLI: [`docs/TUTORIAL-SUPABASE-MIGRACIONES.md`](docs/TUTORIAL-SUPABASE-MIGRACIONES.md)

Detalle: [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md) (sprints 21–30). Operación backup automático: [`docs/backup-disaster-recovery-operations.md`](docs/backup-disaster-recovery-operations.md). Emergencia: [`docs/backup-disaster-recovery-runbook.md`](docs/backup-disaster-recovery-runbook.md). Copia local: [`docs/backup-local-contingency.md`](docs/backup-local-contingency.md).

Migraciones `065`–`072` aplicadas / validadas en el flujo Staging→Prod documentado; harnesses F5-001 / F5-004 PASS donde corresponda.

**GitHub (backup):** 9 secrets cargados; bucket R2 `nomadas-backups` privado; cron diario + `workflow_dispatch` operativos; contrato Auth en dump (`auth_included=true`). Copia local manual: `scripts/backup/local*.sh` + tutorial [`docs/backup-local-contingency.md`](docs/backup-local-contingency.md). Restore drill trimestral **pendiente** (no reutilizar backup `20260817T233641Z-32081141864`). Referencia de backup validado reciente: `20260818T045852Z-32101100102`. Secrets: ver operations.

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
| — | **F5 resto** | Invitaciones/usuarios en audit; correlation ID; retención/purge; quitar gate UI temporal | Futura |
| — | Futuro / Fase 6 | Métricas históricas y reporting | Futura |
| — | Infraestructura / Operaciones | Restore drill trimestral (manual) | Futura |
| — | Follow-up | Migración timers `LockCleanup` / `completeExpiredTrips` | Futura |
| — | Follow-up | Retention `boarding_attempts` | Futura |
| — | Follow-up | Normalizar occupancy en `reservation.service.ts` | Futura |
| — | **SEC-009** | Continuous Security Validation (≠ Sentry, ≠ Fase 8). Design complete; **implementation in progress** (activo: SEC-009.0 CI foundation). Detalle: [`docs/ROADMAP.md`](docs/ROADMAP.md), [`docs/SEC-009-continuous-security-validation-design.md`](docs/SEC-009-continuous-security-validation-design.md) | En progreso |

---

## Bloqueadores

_Ninguno. Sprint activo: SEC-009.0 (CI Security Foundation). F4/F5 cerrados. Backup + tutoriales operativos. Restore drill trimestral pendiente._

---

## Ideas futuras

- **Background Worker nativo** — cuando el plan de hosting lo permita (sin HTTP)
- **UX continua** — responsive, accesibilidad, skeletons (ROADMAP Fase 7)
- **Escalabilidad** — load/stress/capacity, caché, índices, costos (ROADMAP Fase 8; ≠ SEC-009)
- **Hexagonal / Ports & Adapters** — evaluación oportunista en features nuevas complejas (ROADMAP; sin rewrite global)
- **Sentry frontend / Performance / Replay** — fuera de WKR-006.2
- **Email occupancy_alerts** — requiere Resend comercial
- **UI prefs `superadmin_digest`** — v1 es seed + gate de envío
- **Dashboard superadmin de alertas activas** — v1 usa in-app existente
- **Quitar gate UI del audit trail** — cuando la UI deje de ser demasiado técnica
- **Audit: invitaciones / correlation / retención** — fuera de F5-001…F5-003
