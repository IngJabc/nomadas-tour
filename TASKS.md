# TASKS

> Documento **operativo del sprint**. Una tarea activa a la vez; marcar `[x]` al completar.
> **Visión de producto (mediano/largo plazo):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
> **Historial de sprints completados:** [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)
> **Guía para mantener la documentación:** [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## Completado recientemente — Fase 4

- [x] **F4-004** — Occupancy Urgency Alerts (in-app) — **CLOSED**
  - Diseño / scope-lock (P1–P9)
  - Implementación: migración `064` (extiende RPC F4-003 con `p_urgency_enabled`), evento `trip.occupancy_urgency.due.v1`, NotificationFanout, widget agencia (badge «Sale mañana»), chip campana, tests, harness
  - Migración `064_occupancy_urgency_alerts.sql` aplicada
  - Harness `supabase/tests/f4_004_verification.sql` (BEGIN/ROLLBACK) — PASS (incl. same-tick, postponement, PII)
  - Soak `OCCUPANCY_URGENCY_VIA_WORKER=false` → cutover `true` en Render (worker)
  - Evidencia primer tick real: scanned=5, evaluated=5, emitted=0, skipped=5, cleaned_up=0, urgency_matches=1, urgency_emitted=1, already_escalated=0; 1× `trip.occupancy_urgency.due` completed/delivered; attempts=1; 0 retries; 0 failures
  - Copy re-fijada (P9): badge/pill/chip «Sale mañana»; títulos «Viaje casi lleno — sale mañana» / «Viaje con pocas reservas — sale mañana»; body `{destination} sale mañana · {pct}% ({reserved}/{total})`
  - Diseño: [`docs/F4-004-occupancy-urgency-alerts-design.md`](docs/F4-004-occupancy-urgency-alerts-design.md)

- [x] **F4-003** — Occupancy Alerts (in-app) — **CLOSED**
  - Diseño / scope-lock (P1–P5)
  - Implementación + ajustes post-audit (copy UI/notif: «Casi lleno» / «Pocas reservas»; solo destino; fila clickeable)
  - Migración `063_evaluate_occupancy_alerts.sql` aplicada
  - Harness `supabase/tests/f4_003_verification.sql` (BEGIN/ROLLBACK) — PASS
  - Soak `OCCUPANCY_ALERT_VIA_WORKER=false` → cutover `true` en Render (worker)
  - Evidencia primer tick real: scanned=5, evaluated=5, emitted=4, skipped=1, skipped_invalid_occupancy=0, cleaned_up=0; 4× `trip.occupancy_alert.due` completed/delivered; 0 retries; 0 failures
  - Diseño: [`docs/F4-003-occupancy-alerts-design.md`](docs/F4-003-occupancy-alerts-design.md)

- [x] **F4-002** — Superadmin Daily Digest (email) — **CLOSED**
  - Migración `062_schedule_superadmin_digest.sql` aplicada
  - Harness `supabase/tests/f4_002_verification.sql` (BEGIN/ROLLBACK) — PASS
  - Cutover `SUPERADMIN_DIGEST_VIA_WORKER=true` en Render (worker)
  - Primer email real recibido ~2026-08-13 07:31 America/Caracas
  - Diseño: [`docs/F4-002-superadmin-daily-digest-design.md`](docs/F4-002-superadmin-daily-digest-design.md)

- [x] **F4-001** — Agency Daily Digest (email) — 07:00 Caracas, migración 061, flag `AGENCY_DIGEST_VIA_WORKER` (cutover `true` en Render). Diseño: [`docs/F4-001-agency-daily-digest-design.md`](docs/F4-001-agency-daily-digest-design.md)

**Render (worker) — F4-003 (operativo):**

| Variable | Valor |
|---|---|
| `OCCUPANCY_ALERT_VIA_WORKER` | `true` |
| `OCCUPANCY_ALERT_POLL_MS` | `3600000` |
| `OCCUPANCY_ALERT_BATCH` | `50` |

**Render (worker) — F4-004 (operativo):**

| Variable | Valor |
|---|---|
| `OCCUPANCY_URGENCY_VIA_WORKER` | `true` |

**Fuera de F4-003 (follow-ups):** email de occupancy; thresholds configurables; seat quotas; analytics; timers; boarding retention; UI nueva superadmin de alertas.

**Fuera de F4-004 (follow-ups):** email de la escalación de urgencia; ventanas T-6h/T-2h; consolidar la constante de ventana (SQL + 2 defs TS).

---

## Completado — Fase 3 (Workers + observability)

- [x] WKR-001 … WKR-009 — outbox, email/trip/reminder workers, observabilidad, retention. Detalle: [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)

---

## Después (producto / follow-ups)

| Orden | Ticket / Fase | Tema | Estado |
|-------|---------------|------|--------|
| — | **F4-004** | Occupancy Urgency Alerts | Operativo / **CLOSED** |
| — | Futuro / Fase 6 | Métricas históricas y reporting | Futura |
| — | Infraestructura / Operaciones | Backup & Disaster Recovery — estrategia de backups automáticos, retención, almacenamiento externo, restauración verificada, RPO/RTO y alertas operativas | Futura capacidad de infraestructura |
| — | Follow-up | Migración timers `LockCleanup` / `completeExpiredTrips` | Futura |
| — | Follow-up | Retention `boarding_attempts` | Futura |
| — | Follow-up | Normalizar occupancy en `reservation.service.ts` | Futura |
| — | **SEC-009** | Continuous Security Validation — Futura (≠ Sentry). Selección de herramientas (Strix, CodeQL, Dependabot, secret scanning, SAST/DAST) se decide en el design del ticket. | Futura |

Detalle: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Bloqueadores

_Ninguno. F4-001, F4-002, F4-003 y F4-004 están CLOSED / operativos. Sin bloqueadores abiertos de Fase 4 sobre digests ni occupancy alerts._

---

## Ideas futuras

- **Background Worker nativo** — cuando el plan de hosting lo permita (sin HTTP)
- **UX continua** — responsive, accesibilidad, skeletons (ROADMAP Fase 7)
- **Escalabilidad** — caché, índices, costos; Prometheus (ROADMAP Fase 8)
- **Sentry frontend / Performance / Replay** — fuera de WKR-006.2
- **Email occupancy_alerts** — requiere Resend comercial
- **UI prefs `superadmin_digest`** — v1 es seed + gate de envío
- **Dashboard superadmin de alertas activas** — v1 usa in-app existente
