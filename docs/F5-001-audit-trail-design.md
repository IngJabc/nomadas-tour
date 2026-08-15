# F5-001 — Audit Trail (foundation)

**Tipo:** Diseño / contrato de implementación (scope-lock)
**Fecha:** 2026-08-15
**Estado:** **Implementado** — migración `065_audit_log.sql` en tip; harness `supabase/tests/f5_001_verification.sql`; writers atómicos en mutaciones in-scope. Ops: aplicar `065` en Supabase (si aún no) y ejecutar harness (BEGIN/ROLLBACK).
**Rama:** `features/f5-001-audit-trail`
**Referencias:** [ROADMAP.md](ROADMAP.md) Fase 5, [TASKS.md](../TASKS.md), `supabase/migrations/065_audit_log.sql`, `supabase/tests/f5_001_verification.sql`, `backend/src/utils/audit-metadata.ts`, `tests/boarding/f5-001.test.ts`

---

## 1. Purpose

Registrar acciones administrativas y operativas relevantes en una tabla append-only multi-tenant (`public.audit_log`), escrita **en la misma transacción** que la mutación auditada, sin convertir el outbox en audit trail y sin UI/API de lectura en v1.

---

## 2. Scope lock

### In scope (F5-001)

| # | Capacidad |
|---|-----------|
| 1 | Tabla `audit_log` + CHECKs de `action` / `entity_type` / actor |
| 2 | Índices por entity / agency / actor / action (+ `occurred_at`) |
| 3 | RLS SELECT + grants/revokes (sin UPDATE/DELETE) |
| 4 | Append-only (`ERR_AUDIT_APPEND_ONLY`) |
| 5 | Writer `audit_append()` SECURITY DEFINER |
| 6 | Acciones: `trip.created` / `trip.updated` / `trip.cancelled` / `reservation.created` / `reservation.cancelled` / `boarding.board` / `boarding.unboard` / `agency_settings.updated` / `notification_preferences.updated` |
| 7 | Columna `trips.updated_by`; RPCs con `p_actor_user_id` |
| 8 | Propagación de actor desde `req.ctx` (nunca body/headers cliente) |
| 9 | Drop de policies cliente `bl_agency_insert` / `reservations_agency_insert` |
| 10 | Tests (seguridad, atomicidad, PII, tip 065) |

### Out of scope

- F5-002 / invitaciones (`agency_invitations`)
- Read API o UI de audit trail
- Correlation / request ID middleware
- Retención, archivado, particionado, worker de purge
- Analytics / Realtime sobre `audit_log`
- Migración o reemplazo de `boarding_logs`
- Convertir `outbox_events` en audit log
- Snapshots completos de filas / PII / tokens / credenciales
- `set_config` para transportar actor o metadata

---

## 3. Modelo de datos

```text
audit_log
  id, occurred_at
  actor_user_id (NULL solo si actor_role = system)
  actor_role ∈ { system, superadmin, agency }
  agency_id (NULL permitido; agencia no ve filas con agency_id NULL)
  action, entity_type, entity_id
  before JSONB, after JSONB   — diffs minimizados / whitelist
  metadata JSONB              — source / ip / user_agent / seat_code / …
```

**Entity types:** `trip` | `reservation` | `reservation_passenger` | `agency_settings` | `notification_preferences`

---

## 4. Seguridad

| Rol | SELECT | INSERT/UPDATE/DELETE |
|-----|--------|-------------------|
| `anon` / `authenticated` (directo) | Revocado (salvo SELECT grant + policies) | No |
| Superadmin | Todas las filas | No (solo DEFINER / service_role INSERT) |
| Agency | Solo `agency_id = private.auth_app_agency_id()` | No |
| `service_role` | Sí | INSERT vía `audit_append` |

- Actor HTTP: únicamente `req.ctx.userId` / role / agencyId.
- RPCs validan actor contra `public.users` (existencia + rol + tenant).
- Metadata API: `{ source, ip?, user_agent? }` — sin Authorization, cookies, JWT ni secrets.

---

## 5. Writers por dominio

| Acción | Mecanismo | Notas |
|--------|-----------|--------|
| `trip.*` | Trigger `trg_trips_audit` (+ `updated_by` en UPDATE/CANCEL) | `update_trip` / `set_trip_status` aceptan `p_actor_user_id`; postpone pliega `postponed_from` en un solo UPDATE → una sola fila `trip.updated` |
| `reservation.created` | CONSTRAINT TRIGGER deferred `trg_reservations_audit` | Actor = `reservations.created_by`; after: `trip_id`, `passenger_count`, `seat_codes` (labels only) |
| `reservation.cancelled` | RPC `cancel_agency_reservation` | Transaccional: cancel + unlock seats + audit; reemplaza flujo multi-step en `reservation.service.ts` |
| `boarding.*` | RPC `boarding_toggle` | Una fila audit; `boarding_logs` sigue siendo el detalle canónico de estado |
| `agency_settings.updated` | RPC `update_agency_branding` | Diff branding whitelist |
| `notification_preferences.updated` | RPC `update_agency_notification_preferences` | Diff prefs; canal `email` solo como boolean |

---

## 6. PII policy (v1)

**Prohibido** en `before` / `after` / `metadata`: nombres, documentos, teléfonos, emails de contacto, `qr_code`, `ticket_code`, tokens, credenciales, snapshots completos de filas.

**Permitido:** ids, statuses, seat labels, counts, flags booleanos de canal (`email: true/false` en prefs), `source` / `ip` / `user_agent`, `seat_code`, `freed_seat_count`.

---

## 7. Relación con otros sistemas

| Sistema | Relación |
|---------|----------|
| `outbox_events` | Independiente — hechos asíncronos / side-effects; **no** es audit trail |
| `boarding_logs` | Detalle operacional de boarding; audit solo resume board/unboard |
| Workers / digests / occupancy | Sin cambios de contrato en F5-001 |

---

## 8. Validación

| Artefacto | Rol |
|-----------|-----|
| `supabase/tests/f5_001_verification.sql` | Harness BEGIN/ROLLBACK (schema, RLS, append-only, writers, PII) |
| `tests/boarding/f5-001.test.ts` | Tip 065 + isolation vs 001–064 |
| `backend/src/services/audit-trail.pii.test.ts` | Whitelist PII |
| `backend/src/utils/audit-metadata.test.ts` | Metadata segura |
| `reservation.service.cancel.test.ts` | Cancel atómico vía RPC |

---

## 9. Follow-ups (fuera de F5-001)

- Lectura / UI de audit trail
- Invitaciones y cambios de usuarios (candidato F5-002+)
- Correlation IDs
- Retención / purge
- Visibilidad indirecta de viajes para agencia (`agency_id IS NULL`)
