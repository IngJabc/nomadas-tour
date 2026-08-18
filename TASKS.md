# TASKS

> Documento **operativo del sprint**. Una tarea activa a la vez; marcar `[x]` al completar.
> **Estado:** backlog disponible, **sin tarea activa**.
> **Visión de producto (mediano/largo plazo):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
> **Historial de sprints completados:** [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)
> **Guía para mantener la documentación:** [`docs/documentation-guide.md`](docs/documentation-guide.md)

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

Detalle: [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md) (sprints 21–27). Operación: [`docs/backup-disaster-recovery-operations.md`](docs/backup-disaster-recovery-operations.md). Emergencia: [`docs/backup-disaster-recovery-runbook.md`](docs/backup-disaster-recovery-runbook.md).

Migraciones `065` y `066` aplicadas en Supabase; harnesses PASS.

**GitHub (backup):** 9 secrets cargados; bucket R2 `nomadas-backups` privado; primer `workflow_dispatch` PASS; exclusiones `storage.buckets_vectors` / `storage.vector_indexes` en `data.sql`. Restore drill trimestral **pendiente** (no reutilizar backup `20260817T233641Z-32081141864`). Nombres de secrets: ver operations.

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
| — | Infraestructura / Operaciones | Restore drill trimestral (manual); copias offline extra de R2 | Futura |
| — | Follow-up | Migración timers `LockCleanup` / `completeExpiredTrips` | Futura |
| — | Follow-up | Retention `boarding_attempts` | Futura |
| — | Follow-up | Normalizar occupancy en `reservation.service.ts` | Futura |
| — | **SEC-009** | Continuous Security Validation — Futura (≠ Sentry). Selección de herramientas en el design del ticket. | Futura |
| — | **Futura capacidad** | Reserva asistida por enlace (después de seleccionar asientos) | Futura |
| — | **Futura capacidad** | Backup local de contingencia (cifrado, manual, fuera del scheduler) | Futura |

### Futura capacidad — Reserva asistida por enlace

Tras seleccionar viaje/asientos, opción: registrar datos ahora **o** enviar enlace seguro al reservante (completa datos; reserva sigue flujo normal). El wizard manual permanece. Diseño futuro debe cubrir: token no adivinable, expiración, seat locks, estado temporal, invalidación, campos permitidos al cliente, impedir cambiar viaje/asientos/precio, posible recuperación de progreso.

### Futura capacidad — Backup local de contingencia

Permitir ejecutar manualmente un backup cifrado de PostgreSQL + Storage y conservarlo localmente como última capa de contingencia independiente de GitHub Actions, Cloudflare R2 y Supabase.

Restricciones: manual; encrypted (`age`); no reemplaza el backup automático; no forma parte del scheduler; no requiere sincronización continua; no almacenar secretos en el repo; no asumir que la PC del operador es infraestructura de producción.

Detalle: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Bloqueadores

_Ninguno. F4-001…F4-004 CLOSED. F5-001…F5-003 implementados. Follow-ups post-sprint implementados. Backup MVP operativo en GitHub Actions (restore drill trimestral pendiente). Sin sprint activo._

---

## Ideas futuras

- **Background Worker nativo** — cuando el plan de hosting lo permita (sin HTTP)
- **UX continua** — responsive, accesibilidad, skeletons (ROADMAP Fase 7)
- **Escalabilidad** — caché, índices, costos; Prometheus (ROADMAP Fase 8)
- **Sentry frontend / Performance / Replay** — fuera de WKR-006.2
- **Email occupancy_alerts** — requiere Resend comercial
- **UI prefs `superadmin_digest`** — v1 es seed + gate de envío
- **Dashboard superadmin de alertas activas** — v1 usa in-app existente
- **Quitar gate UI del audit trail** — cuando la UI deje de ser demasiado técnica
- **Audit: invitaciones / correlation / retención** — fuera de F5-001…F5-003
