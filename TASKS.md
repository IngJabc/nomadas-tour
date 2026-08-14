# TASKS

> Documento **operativo del sprint**. Una tarea activa a la vez; marcar `[x]` al completar.
> **Visión de producto (mediano/largo plazo):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
> **Historial de sprints completados:** [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)
> **Guía para mantener la documentación:** [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## Sprint actual — F4-003 Occupancy Alerts (in-app)

**Fase 4 — Automatizaciones de producto.** Una tarea activa: **F4-003**.

Diseño: [`docs/F4-003-occupancy-alerts-design.md`](docs/F4-003-occupancy-alerts-design.md)

- [x] Design scope-lock (P1–P5)
- [x] Implementación (estado, RPC `evaluate_occupancy_alerts`, evento, scheduler, NotificationFanout, widget, tests)
- [ ] Aplicar migración `063_evaluate_occupancy_alerts.sql`
- [ ] Harness `supabase/tests/f4_003_verification.sql` (BEGIN/ROLLBACK)
- [ ] Soak en Render (worker): `OCCUPANCY_ALERT_VIA_WORKER=false`
- [ ] Habilitación controlada: `OCCUPANCY_ALERT_VIA_WORKER=true`

**No es cierre de fase.** Siguiente producto tras cutover: viajes sin acción / métricas nocturnas (o el ticket que se descomponga).

**Render (worker)** — agregar si aún no están:

| Variable | Soak | Encender |
|---|---|---|
| `OCCUPANCY_ALERT_VIA_WORKER` | `false` | `true` |
| `OCCUPANCY_ALERT_POLL_MS` | `3600000` | igual |
| `OCCUPANCY_ALERT_BATCH` | `50` | igual |

**Fuera de este sprint:** email de occupancy; thresholds configurables; seat quotas; analytics; timers; boarding retention; UI nueva superadmin de alertas.

---

## Ops pendiente — F4-002 (no CLOSED)

Implementación lista; falta cutover:

- [ ] Aplicar `062_schedule_superadmin_digest.sql`
- [ ] Harness `supabase/tests/f4_002_verification.sql` (BEGIN/ROLLBACK)
- [ ] Soak `SUPERADMIN_DIGEST_VIA_WORKER=false` → `true` (07:00 America/Caracas)

Diseño: [`docs/F4-002-superadmin-daily-digest-design.md`](docs/F4-002-superadmin-daily-digest-design.md)

| Variable | Soak | Encender |
|---|---|---|
| `SUPERADMIN_DIGEST_VIA_WORKER` | `false` | `true` |
| `SUPERADMIN_DIGEST_POLL_MS` | `3600000` | igual |
| `SUPERADMIN_DIGEST_BATCH` | `50` | igual |

---

## Completado recientemente — Fase 4 (inicio)

- [x] **F4-001** — Agency Daily Digest (email) — 07:00 Caracas, migración 061, flag `AGENCY_DIGEST_VIA_WORKER` (cutover `true` en Render). Diseño: [`docs/F4-001-agency-daily-digest-design.md`](docs/F4-001-agency-daily-digest-design.md)

---

## Completado — Fase 3 (Workers + observability)

- [x] WKR-001 … WKR-009 — outbox, email/trip/reminder workers, observabilidad, retention. Detalle: [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)

---

## Después (producto / follow-ups)

| Orden | Ticket / Fase | Tema | Estado |
|-------|---------------|------|--------|
| — | **F4-002** cutover | Migración 062 + soak/habilitación | Ops pendiente |
| — | Fase 4 resto | Viajes sin acción; métricas nocturnas | Futura |
| — | Follow-up | Migración timers `LockCleanup` / `completeExpiredTrips` | Futura |
| — | Follow-up | Retention `boarding_attempts` | Futura |
| — | Follow-up | Normalizar occupancy en `reservation.service.ts` | Futura |
| — | **SEC-009** | Continuous security validation (≠ Sentry) | Futura |

Detalle: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Bloqueadores

_Ninguno. F4-003 no se declara CLOSED hasta migración 063 + soak + habilitación. F4-002 tampoco hasta 062 + soak + habilitación._

---

## Ideas futuras

- **Background Worker nativo** — cuando el plan de hosting lo permita (sin HTTP)
- **UX continua** — responsive, accesibilidad, skeletons (ROADMAP Fase 7)
- **Escalabilidad** — caché, índices, costos; Prometheus (ROADMAP Fase 8)
- **Sentry frontend / Performance / Replay** — fuera de WKR-006.2
- **Email occupancy_alerts** — requiere Resend comercial
- **UI prefs `superadmin_digest`** — v1 es seed + gate de envío
- **Dashboard superadmin de alertas activas** — v1 usa in-app existente
