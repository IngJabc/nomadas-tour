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
| — | **Post-sprint** | Notificaciones de reservas: agencia como actor visible (copy) | Futura |
| — | **Post-sprint** | Boleto: mostrar solo destino (conservar `origin` en modelo) | Futura |
| — | **Futura capacidad** | Reserva asistida por enlace (después de seleccionar asientos) | Futura |
| — | **Post-sprint** | Bloquear nuevas reservas si `departure_time <= now()` | Futura |

### Post F5-003 (no activos — no mezclar con el sprint)

Trabajo posterior documentado. **Ninguno es la tarea activa.** Detalle de producto: [`docs/ROADMAP.md`](docs/ROADMAP.md).

1. **Post-sprint — Notificaciones de reservas (copy)**
   Hoy el actor visible puede ser el reservante (`"José Bonilla realizó una reserva"`). Debe identificar a la **agencia** (`"Agencia Central realizó una reserva"`). Aplica a creación, cancelación y copies equivalentes. Cambio de presentación únicamente: no eliminar `booker_name` / `booker_document` ni otros datos de dominio; no cambiar backend ahora.

2. **Post-sprint — Boleto: solo destino**
   El boleto debe mostrar únicamente el destino. **No eliminar `origin`** del backend/modelo de rutas (soporte futuro multi-origen). Solo representación del boleto.

3. **Futura capacidad — Reserva asistida por enlace**
   Tras seleccionar viaje/asientos, opción: registrar datos ahora **o** enviar enlace seguro al reservante (completa datos; reserva sigue flujo normal). El wizard manual permanece. Diseño futuro debe cubrir: token no adivinable, expiración, seat locks, estado temporal, invalidación, campos permitidos al cliente, impedir cambiar viaje/asientos/precio, posible recuperación de progreso.

4. **Post-sprint — Reservas en viajes ya salidos**
   Bug/fix de integridad: no permitir crear reserva si `departure_time <= now()`, aunque `trips.status = 'active'`. Regla: `departure_time > now()` obligatorio. Enforcement futuro en backend/RPC (no solo frontend), test de regresión, todos los caminos de creación.

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
