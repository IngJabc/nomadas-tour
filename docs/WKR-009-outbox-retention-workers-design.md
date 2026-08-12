# WKR-009 — Outbox Retention Worker

**Tipo:** Diseño / contrato de implementación + cierre  
**Fecha diseño / scope-lock:** 2026-08-12  
**Fecha cierre:** 2026-08-12  
**Estado:** **Implemented — CLOSED** (PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED)  
**Implementación:** commit `78e783b` — `feat(wkr-009): implement outbox retention worker`  
**Referencias:** [WKR-006.3](WKR-006.3-outbox-retention-dlq-runbook.md), [WKR-008](WKR-008-reminder-workers-audit.md), [ROADMAP.md](ROADMAP.md), [TASKS.md](../TASKS.md), [auditoría de cierre](WKR-009-outbox-retention-workers-audit.md)

---

## 1. Purpose

Definir el contrato implementable de WKR-009: **purga automática, acotada y segura** de filas `completed` antiguas en `public.outbox_events`, ejecutada dentro del worker Node existente.

Este documento cerró el alcance tras la auditoría inicial (veredicto **NEEDS DECISIONS**) y las decisiones **D1–D8**. La implementación y el cierre operativo están registrados en §17 y en el audit de cierre.

---

## 2. Problem statement

Tras WKR-004…WKR-008, el outbox acumula eventos `completed` sin bound. WKR-006.3 documentó la política de retención (30 días) y un runbook de purga **manual**; la purga **automática** quedó diferida a WKR-009.

Sin un job controlado:

- la tabla crece de forma indefinida;
- las queries de claim/ops pueden degradarse;
- la purga manual de emergencia (§5.5 de 006.3) no escala.

WKR-009 no introduce DLQ nueva: `failed` sigue siendo la DLQ lógica y **no** se auto-borra.

---

## 3. Scope (SCOPE IN)

WKR-009 incluye **únicamente**:

1. RPC PostgreSQL `SECURITY DEFINER` que elimina lotes de `outbox_events` elegibles.
2. Scheduler Node dentro del proceso worker existente (`runner.ts`), siguiendo el patrón de `reminder-scheduler.ts` (WKR-008).
3. Feature flag `OUTBOX_RETENTION_VIA_WORKER` (default `false` en código).
4. Batch limitado + protección de concurrencia (`FOR UPDATE SKIP LOCKED`).
5. Configuración/env (poll interval, batch, días de retención alineados a 30).
6. Observabilidad (logs estructurados; errores no tumben el relay).
7. Tests unitarios (scheduler/config) + harness SQL comportamental (BEGIN/ROLLBACK).
8. Rollout: dry-run/COUNT → soak con flag off/on controlado → documentación de cierre.

**Criterio de elegibilidad (única regla oficial):**

```sql
status = 'completed'
AND COALESCE(processed_at, updated_at) < now() - interval '30 days'
```

| Caso | Resultado |
|---|---|
| `completed` antiguo (≥ 30d) | Elegible → eliminable |
| `completed` reciente | Conservar |
| `completed` con `processed_at IS NULL` | Usar `updated_at` |
| `failed` | Conservar (nunca auto-purge) |
| `pending` | Conservar |
| `processing` | Conservar |

Índice `(status, processed_at)`: **no obligatorio por diseño** (D6). Evaluado con EXPLAIN en producción al cierre → no justificado (ver §17).

---

## 4. Out of scope (SCOPE OUT)

Explícitamente **fuera** de WKR-009:

| Tema | Motivo |
|---|---|
| “Automation bridge” / puente a Fase 4 | Naming/histórico; no hay requisitos funcionales (D1) |
| Producto Fase 4 (digest, alertas, etc.) | ROADMAP Fase 4, ticket distinto |
| Migración de `LockCleanup` desde `index.ts` | Follow-up / ticket separado (D2) |
| Migración de `completeExpiredTrips` timer al worker | Follow-up / ticket separado (D2) |
| Purga de `boarding_attempts` | Trabajo separado (D3) |
| `pg_cron` | Prohibido (D4) |
| Segundo proceso / worker | Prohibido (D4) |
| Infraestructura nueva (colas, brokers, tabla DLQ) | Reutilizar outbox + worker |
| Auto-purga de `failed` / `pending` / `processing` | Política 006.3 + D7 |
| Nuevos eventos de dominio, notification types, emails, templates, `composeHandlers` | No aplican a retention |

**Nota sobre referencias históricas:** documentos anteriores (p. ej. WKR-007 §16, WKR-006.3 secuencia, AUD-021) asociaron a WKR-009 la migración de timers API y/o un “automation bridge”. Esas asociaciones **no formaron parte del alcance**; quedan como follow-ups (§15).

---

## 5. Retention policy

Fuente normativa: WKR-006.3 §3, reforzada por D7.

- Conservar `completed` durante **30 días** desde `COALESCE(processed_at, updated_at)`.
- Purgar con `DELETE` en lotes (no archive externo en este ticket).
- `failed`: sin auto-delete; revisión ops según runbook 006.3.
- `processing` stale: sigue siendo responsabilidad de `recover_stuck_outbox_events` (WKR-006.1), **no** de WKR-009.
- FKs conceptuales (`notifications.source_event_id`, `email_delivery_log.event_id`) **sin FK física** — la purga no rompe integridad referencial (054/055).

No convertir retention en DLQ ni crear `outbox_dlq`.

---

## 6. Architecture

```text
Worker Node (existente — npm run worker)
  ├── outbox relay loop          (WKR-005+)
  ├── reminder scheduler         (WKR-008)
  └── retention scheduler        (WKR-009)
        │
        ▼ (si OUTBOX_RETENTION_VIA_WORKER=true)
    RPC SECURITY DEFINER
      purge_completed_outbox_events(p_batch [, p_older_than_days])
        │
        ▼
    DELETE eligible completed rows (batch)
        │
        ▼
    jsonb { deleted, batch, older_than_days, cutoff }
```

- Un solo proceso; mismo `AbortController` / shutdown limpio que el reminder scheduler.
- Errores del retention scheduler **no** matan el relay.
- Sin pg_cron, sin segundo servicio Render.

---

## 7. RPC / security model

| Control | Requisito |
|---|---|
| `SECURITY DEFINER` | Sí |
| `SET search_path = public` | Sí |
| `REVOKE` EXECUTE de `PUBLIC` / `anon` / `authenticated` | Sí |
| `GRANT EXECUTE` solo a `service_role` | Sí |
| DELETE vía PostgREST directo | No — RPC DEFINER es el camino |
| Predicado | Solo `completed` + edad; **imposible** borrar otros status por parámetros |
| Batch | `LEAST(GREATEST(COALESCE(p_batch, 1000), 1), 1000)` |
| Days | `GREATEST(COALESCE(p_older_than_days, 30), 30)` |
| Concurrencia | `FOR UPDATE SKIP LOCKED` |

Nombre: `public.purge_completed_outbox_events(INTEGER, INTEGER)`.

**Nota de implementación (histórica → cerrada):** la primera versión anidaba un CTE con `DELETE` dentro de `RETURN (...)`, lo que PostgreSQL rechaza (`0A000`). La versión final usa `SELECT … INTO v_result` + `RETURN v_result` (CTE modificador en nivel superior). Ver §17 / audit.

---

## 8. Scheduler / worker model

- `backend/src/workers/retention-scheduler.ts`
- Wire en `runner.ts` paralelo a reminder; `Promise.all([reminder.done, retention.done])` al shutdown.

Flag:

- `OUTBOX_RETENTION_VIA_WORKER=false` → tick `skipped_effect_disabled` / no RPC.
- `true` → llama RPC con batch y days configurados.

No registra handlers de outbox nuevos: retention **no** es un domain event consumer.

---

## 9. Batch / concurrency / idempotency

| Tema | Diseño |
|---|---|
| Batch | Hard cap 1000 en RPC |
| Re-poll | Idempotente: filas ya borradas → `deleted = 0` |
| Multi-instancia | `SKIP LOCKED` |
| Crash mid-batch | Transacción RPC atómica |
| Idempotencia | No requiere `dedup_key`; el DELETE es la operación |

---

## 10. Configuration / feature flag

| Variable | Default | Rol |
|---|---|---|
| `OUTBOX_RETENTION_VIA_WORKER` | `false` (código) | Kill switch / soak (D5) |
| `OUTBOX_RETENTION_POLL_MS` | `86400000` (24h) | Cadencia |
| `OUTBOX_RETENTION_BATCH` | `1000` | Tamaño de lote |
| `OUTBOX_RETENTION_DAYS` | `30` | Edad (RPC clampa ≥30) |

Parse boolean: `true` / `"true"` / `"1"`.

---

## 11. Testing and SQL harness

### Unitarios / boarding

- Flag off → no purge; flag on → RPC; errores → loop continúa; env defaults.
- Contratos estáticos: `tests/boarding/wkr-009.test.ts` (+ tip 060 en wkr-007-fase2 / wkr-008).

### Harness SQL

`supabase/tests/wkr_009_verification.sql` — BEGIN/ROLLBACK; casos A–J (elegibilidad, batch, idempotencia, seguridad).

---

## 12. Staging / production rollout (diseño)

En este proyecto la validación operativa se realiza sobre **Supabase producción** (no hay proyecto staging separado), con flag off → on controlado — mismo patrón operativo que WKR-008.

Orden normativo: migrar RPC → dry-run COUNT → harness → deploy worker flag false → soak → flag true → cierre docs.

---

## 13. Definition of Done (D8)

WKR-009 **no** se marca completado hasta:

1. Diseño vigente.  
2. Migración con RPC `SECURITY DEFINER`.  
3. Autorización exclusiva `service_role`.  
4. Scheduler integrado al worker existente.  
5. Feature flag default `false` en código.  
6. Batch limitado.  
7. Concurrencia segura.  
8. Tests unitarios scheduler/config.  
9. Harness SQL comportamental.  
10. Validación de elegibilidad.  
11. Validación de seguridad de la RPC.  
12. Validación operativa en el entorno real.  
13. Dry-run/COUNT previo a activar purga.  
14. Soak.  
15. Activación controlada del flag.  
16. Documentación de cierre + auditoría.

**Estado al cierre:** todos los ítems cumplidos (ver §17 y audit).

---

## 14. Explicit decisions D1–D8

| ID | Decisión | Resolución |
|---|---|---|
| **D1** | Automation bridge | **Fuera de WKR-009.** Naming/histórico; no eventos/APIs/workers de bridge. Fase 4 es producto aparte. |
| **D2** | `LockCleanup` + `completeExpiredTrips` timers | **Fuera de WKR-009.** Ticket/follow-up separado. |
| **D3** | `boarding_attempts` retention | **Fuera de WKR-009.** |
| **D4** | Mecanismo | Scheduler Node en worker existente + RPC `SECURITY DEFINER`. **No** pg_cron, **no** segundo proceso. |
| **D5** | Feature flag | `OUTBOX_RETENTION_VIA_WORKER`, default **`false`** en código. |
| **D6** | Índice `(status, processed_at)` | **No obligatorio.** Evaluar con EXPLAIN/volumen; añadir solo con justificación. |
| **D7** | Edad | 30 días; predicado `COALESCE(processed_at, updated_at)`; solo `completed`. |
| **D8** | Definition of Done | Lista §13. |

*(Decisiones históricas del diseño — no reescritas en el cierre.)*

---

## 15. Follow-ups (fuera de este ticket)

1. **Migración de `LockCleanup`** (`backend/src/index.ts` → worker scheduler durable).  
2. **Migración del timer `completeExpiredTrips`** (el *evento* `trip.auto_completed` ya es WKR-007; el *timer* en API sigue siendo anti-patrón).  
3. **Retention/purga de `boarding_attempts`**.  
4. **Automation bridge / Fase 4** — automatizaciones de producto.  
5. Política futura de retención/archivado de `failed` (hoy: sin auto-delete).  
6. Reevaluar índice de purga si el volumen de `outbox_events` crece (D6).

---

## 16. Ready for implementation (histórico)

Tras D1–D8, WKR-009 quedó **scope-locked** y listo para implementación del retention worker descrito aquí.

> **Histórico:** en el momento del scope-lock este documento afirmaba “no hay código/migraciones creados”. Eso quedó superado por la implementación `78e783b` y el cierre §17.

---

## 17. Cierre / auditoría (2026-08-12)

**Veredicto:** **PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED**

### Implementación realizada

- Migración `060_purge_completed_outbox_events.sql` — RPC `purge_completed_outbox_events`.
- Scheduler `retention-scheduler.ts` cableado en `runner.ts` junto al reminder scheduler.
- Env: `OUTBOX_RETENTION_VIA_WORKER` (default `false` en código), poll 24h, batch 1000, days 30.
- Tests unitarios + boarding + harness SQL A–J.
- Commit de implementación: `78e783b`.

### Base de datos (producción)

- Migración **060 aplicada** en Supabase producción.
- Primer cuerpo con `RETURN (WITH … DELETE …)` → error PostgreSQL `0A000`.
- Corrección vía `CREATE OR REPLACE` (`SELECT … INTO v_result` + `RETURN v_result`); archivo `060` del repo sincronizado con la versión productiva.

### Validaciones

| Evidencia | Resultado |
|---|---|
| Smoke `purge_completed_outbox_events(1, 30)` | JSON OK; `deleted: 0`, `batch: 1`, `older_than_days: 30` |
| Dry-run `COUNT(*)` elegibles | `0` |
| Harness `wkr_009_verification.sql` | **Success. No rows returned** (BEGIN/ROLLBACK) |
| EXPLAIN (ANALYZE, BUFFERS) | Seq Scan; ~30 filas; 0 elegibles; ~0.99 ms → **sin índice** (D6) |
| Backend tests | **361/361** |
| Boarding wkr-009/008/007-fase2 | **47/47** |
| `tsc --noEmit` / build | PASS |

### Render / worker

1. Deploy desde `feat/wkr-009-outbox-retention-worker` con flag **`false`** → `skipped_effect_disabled`; relay/reminder/health OK.  
2. Activación **`OUTBOX_RETENTION_VIA_WORKER=true`** → tick `status: ok`, `deleted: 0`, `batch: 1000`, `duration_ms: 894`; sin `retention_scheduler_error` / `worker_fatal`.  
3. `deleted: 0` es correcto (0 elegibles al momento del cutover).

### Observaciones (no blockers)

- Remediation temprana del cuerpo SQL `0A000` antes del cierre.
- Primer tick productivo sin deletes reales (volumen elegible = 0).
- Índice diferido; reevaluar con crecimiento.
- Abort no cancela RPC in-flight (patrón WKR-008).
- Harness de batch/concurrencia es secuencial (no multi-sesión).

### Fuera de alcance (reafirmado)

Sin automation bridge, Fase 4, timers `LockCleanup`/`completeExpiredTrips`, `boarding_attempts`, pg_cron, segundo worker, DLQ nueva, purge failed/pending/processing, eventos/emails/templates nuevos, índice obligatorio.

**Detalle:** [`WKR-009-outbox-retention-workers-audit.md`](WKR-009-outbox-retention-workers-audit.md).
