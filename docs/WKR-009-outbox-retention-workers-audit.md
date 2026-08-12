# AUD — WKR-009 Outbox Retention Worker

**Tipo:** Auditoría técnica + implementación + cierre  
**Fecha scope-lock / diseño:** 2026-08-12  
**Fecha implementación:** 2026-08-12  
**Fecha cierre:** 2026-08-12  
**Estado:** **PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED**  
**Rama:** `feat/wkr-009-outbox-retention-worker`  
**Commit implementación:** `78e783b` — `feat(wkr-009): implement outbox retention worker`  
**Referencias:** [WKR-009 design](WKR-009-outbox-retention-workers-design.md), [WKR-006.3](WKR-006.3-outbox-retention-dlq-runbook.md), [ROADMAP.md](ROADMAP.md), [TASKS.md](../TASKS.md)

---

## 1. Executive summary

WKR-009 entrega la **purga automática** de filas `outbox_events` con `status = 'completed'` y antigüedad ≥ 30 días (`COALESCE(processed_at, updated_at)`), vía scheduler en el worker Node existente + RPC `SECURITY DEFINER` `purge_completed_outbox_events`, detrás del flag `OUTBOX_RETENTION_VIA_WORKER` (default `false` en código; **activo `true` en Render** tras soak).

Validación local, harness SQL, EXPLAIN y cutover en producción completados. Sin blockers. Scope OUT respetado (sin automation bridge, timers, boarding_attempts, pg_cron, segundo worker, ni auto-purga de non-completed).

---

## 2. Verdict

**PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED**

| Dimensión | Resultado |
|---|---|
| Contrato D1–D8 | Cumplido |
| Seguridad RPC | PASS |
| Tests repo | PASS (361/361; boarding 47/47; tsc/build) |
| Harness SQL prod | PASS (`Success. No rows returned`) |
| EXPLAIN / índice | PASS — sin índice (D6) |
| Render cutover | PASS (`false` → `true`) |
| Blockers | **Ninguno** |

---

## 3. Scope

### IN

- RPC `purge_completed_outbox_events` (migración 060)
- Scheduler `retention-scheduler.ts` + wire en `runner.ts`
- Flag / env retention
- Batch ≤1000, days ≥30, `SKIP LOCKED`, solo `completed`
- Tests + harness A–J
- Rollout operativo + docs de cierre

### OUT (confirmado no implementado)

Automation bridge / Fase 4; `LockCleanup` / `completeExpiredTrips` timer migration; `boarding_attempts` purge; pg_cron; segundo worker; nueva DLQ; purge `failed`/`pending`/`processing`; nuevos domain events / notification types / emails / templates / `composeHandlers`; índice obligatorio en 060.

---

## 4. Implementation summary

| Pieza | Ubicación |
|---|---|
| Migración | `supabase/migrations/060_purge_completed_outbox_events.sql` |
| Scheduler | `backend/src/workers/retention-scheduler.ts` |
| Runner | `backend/src/workers/runner.ts` (`Promise.all` reminder + retention) |
| Config | `backend/src/config/env.ts`, `backend/src/workers/config.ts`, `.env-example` |
| Unit tests | `retention-scheduler.test.ts`, `env.test.ts` |
| Boarding | `tests/boarding/wkr-009.test.ts` (+ tip 060 en wkr-007-fase2 / wkr-008) |
| Harness | `supabase/tests/wkr_009_verification.sql` |

Arquitectura: mismo proceso worker; flag off = skip; flag on = RPC; errores del scheduler no matan el relay.

---

## 5. Migration / RPC validation

**Función:** `public.purge_completed_outbox_events(p_batch INTEGER DEFAULT 1000, p_older_than_days INTEGER DEFAULT 30) RETURNS JSONB`

| Control | Estado |
|---|---|
| SECURITY DEFINER | Sí |
| `SET search_path = public` | Sí |
| REVOKE PUBLIC / anon / authenticated | Sí |
| GRANT EXECUTE service_role only | Sí |
| Sin GRANT DELETE en tabla | Sí |
| `status = 'completed'` hardcodeado | Sí |
| `COALESCE(processed_at, updated_at)` | Sí |
| Clamp days ≥30 / batch ≤1000 | Sí |
| `FOR UPDATE SKIP LOCKED` | Sí |
| JSON: `deleted`, `batch`, `older_than_days`, `cutoff` | Sí |

**Remediación F-01 (cuerpo SQL):** la primera versión usaba `RETURN (WITH … DELETE … SELECT …)` → PostgreSQL `0A000` (*WITH clause containing a data-modifying statement must be at the top level*). Corregido en producción con `CREATE OR REPLACE` a `SELECT … INTO v_result` + `RETURN v_result`. El archivo `060` del repo refleja la versión productiva.

**Smoke producción:**

```json
{"batch":1,"cutoff":"2026-07-13T15:43:24.573628+00:00","deleted":0,"older_than_days":30}
```

**Dry-run:** `eligible_completed = 0`.

---

## 6. Scheduler validation

Logs observados:

- Flag **false:** `retention_scheduler_started`, tick `skipped_effect_disabled`, relay/reminder/health vivos.
- Flag **true:** `outbox_retention_via_worker: true`, tick `status: ok`, `deleted: 0`, `batch: 1000`, `older_than_days: 30`, `duration_ms: 894`.
- Sin `retention_scheduler_error`, sin `worker_fatal`, relay/reminder/heartbeat/health OK.

Poll default 24h; batch 1000; days 30.

---

## 7. Tests

| Suite | Resultado |
|---|---|
| Backend Vitest | **361/361 PASS** |
| Boarding wkr-009 / wkr-008 / wkr-007-fase2 | **47/47 PASS** |
| `tsc --noEmit` | PASS |
| Backend build | PASS |
| `git diff --check` (pre-deploy) | limpio |

---

## 8. SQL harness

`supabase/tests/wkr_009_verification.sql` — ejecutado **completo** en producción.

**Resultado:** `Success. No rows returned`  
**Txn:** `BEGIN` … `ROLLBACK` (sin datos sintéticos persistidos).

| Caso | Cobertura |
|---|---|
| A | completed antiguo → delete |
| B | completed reciente → keep |
| C | `processed_at` NULL + `updated_at` fallback |
| D/E/F | failed / pending / processing antiguos → keep |
| G | batch limit |
| H | segundo call idempotente |
| I | batch=1 secuencial |
| J | DEFINER / grants / completed-only / SKIP LOCKED |

---

## 9. EXPLAIN / performance

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT e.id
FROM public.outbox_events AS e
WHERE e.status = 'completed'
  AND COALESCE(e.processed_at, e.updated_at) < NOW() - INTERVAL '30 days'
ORDER BY COALESCE(e.processed_at, e.updated_at) ASC
LIMIT 1000;
```

**Observado:** Seq Scan; ~30 filas inspeccionadas; 0 elegibles; buffers bajos; Execution Time ≈ **0.99 ms**.

**D6:** **sin índice en 060**; reevaluar si el volumen futuro lo exige.

---

## 10. Production / Render validation

| Paso | Resultado |
|---|---|
| Deploy branch `feat/wkr-009-outbox-retention-worker` | Automático |
| Soak `OUTBOX_RETENTION_VIA_WORKER=false` | PASS |
| Cutover `=true` | PASS |
| Primer tick con purga habilitada | `deleted: 0` (correcto; 0 elegibles) |
| Nota operativa | Este proyecto no usa Supabase staging separado; validación = producción con flag controlado (mismo patrón que WKR-008) |

Evidencia de entorno Render **no** es verificable desde el repo; default en código permanece `false` como postura de rollback.

---

## 11. Security

- DEFINER + `search_path=public`
- EXECUTE solo `service_role`
- Predicado completed-only; sin `p_status`
- Floor 30 días en RPC (autoridad de seguridad)
- Sin DELETE grant directo sobre `outbox_events`

---

## 12. Scope compliance

**PASS** — ningún ítem OUT implementado (ver §3).

---

## 13. Findings

| ID | Hallazgo | Severidad | Estado |
|---|---|---|---|
| **F-01** | Cuerpo RPC inicial `RETURN (WITH … DELETE …)` → `0A000` | P1 (bloqueaba harness) | **CLOSED** — `SELECT INTO` + `RETURN v_result`; repo sincronizado |
| **O-01** | Primer tick prod `deleted=0` | Observation | Esperado (0 elegibles) |
| **O-02** | Sin índice adicional | Observation | D6; reevaluar con volumen |
| **O-03** | Abort no cancela RPC in-flight | Observation | Consistente con WKR-008 |
| **O-04** | Harness batch/concurrencia secuencial (no multi-sesión) | Observation | Aceptable para DoD |

Sin blockers abiertos.

---

## 14. Definition of Done

Todos los ítems del diseño §13 / D8 cumplidos: diseño, migración DEFINER, grants, scheduler, flag default false en código, batch, SKIP LOCKED, tests, harness, elegibilidad, seguridad, validación operativa, COUNT, soak, cutover flag, docs de cierre.

---

## 15. Final closure

**WKR-009 — CLOSED / PASS WITH OBSERVATIONS**

Siguiente trabajo de producto: **Fase 4 — Automatizaciones** (fuera de este ticket). Follow-ups técnicos: timers API, `boarding_attempts` retention, política `failed`, índice si EXPLAIN futuro lo pide.
