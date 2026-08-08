# WKR-007 — Reporte de re-auditoría independiente Fase 0 / Fase 0.1

**Tipo:** Auditoría de remediación (solo lectura; sin modificación de código).
**Fecha:** 2026-08-08
**Auditor:** Agente de análisis (re-auditoría independiente).
**Ticket:** WKR-007 — Trip / Notification Event Workers (Fase 0: infraestructura de idempotencia + trips.created_at; Fase 0.1: remediación de hallazgos de la auditoría).
**Artefacto de diseño de referencia:** `docs/WKR-007-trip-notification-event-workers-design.md`.

> **Nota de método:** este reporte verifica el estado **real del repositorio** en el momento de la auditoría. No asume la validez de ningún reporte previo; cada hallazgo se valida contra `archivo:línea` y contra los tests ejecutados. **Ningún resultado de base de datos real se inventa**: donde no se ejecutó un harness contra Supabase se declara explícitamente `NO VERIFICADO`.

---

## 1. Executive Verdict

### Calidad de implementación / documentación: **PASS**

- Sin hallazgos BLOCKER ni HIGH en código ni documentación.
- Todos los controles críticos verificables de forma estática (lectura directa + tests de contrato) están verificados.
- Diseño ↔ migraciones ↔ SQL de verificación ↔ tests son coherentes entre sí.

### Estado de DB real: **NO VERIFICADO (PENDING)**

- No existe evidencia en el repositorio de que las migraciones 052–055 hayan sido aplicadas a una instancia de Supabase.
- No existe evidencia de que `supabase/tests/wkr_007_phase0_verification.sql` haya sido ejecutado contra una DB real.
- **No se declara la DB real correcta.**

### Estado de Git: **NO COMMITEADO**

- Nada de WKR-007 (Fase 0/0.1) está versionado. Último commit relevante es ajeno a WKR-007.

### Veredicto general: **PASS WITH OBSERVATIONS**

Se cumple la regla de no ocultar el estado real: la implementación está auditada y coherente (PASS), pero **no se puede aprobar definitivamente Fase 1** mientras la verificación contra Supabase esté pendiente y el trabajo no esté commiteado. Detalle en §9.

---

## 2. Alcance y método

- **Tipo de auditoría:** solo lectura. No se modificó código, migraciones, frontend ni tests.
- **Acceso a DB real:** NO. No se ejecutó ningún SQL contra Supabase. La verificación de los archivos SQL es **estática** (lectura directa del SQL + tests de contrato estáticos que inspeccionan el contenido de los archivos).
- **Archivos inspeccionados:**
  - `supabase/migrations/052_trips_created_at_updated_at.sql`
  - `supabase/migrations/053_outbox_events_dedup_key.sql`
  - `supabase/migrations/054_notifications_source_event_id.sql`
  - `supabase/migrations/055_email_delivery_log.sql`
  - `supabase/tests/wkr_007_phase0_verification.sql`
  - `tests/boarding/wkr-007-phase0.test.ts`
  - `backend/src/utils/email-fanout.ts` y `backend/src/utils/email-fanout.test.ts`
  - `backend/src/services/superadmin.service.ts` (solo imports/uso de utils y ausencia de helpers duplicados)
  - `backend/src/events/types.ts` y `backend/src/types/index.ts` (diffs vs HEAD)
  - `docs/WKR-007-trip-notification-event-workers-design.md`
  - `git status` / `git diff` / `git log` (para 001–051 y estado de versionado)
- **Tests ejecutados:** ver §7.
- **Límite explícito:** una prueba estática **no equivale** a una verificación de DB real. Las conclusiones "RESOLVED" aplican al **contenido** de migraciones/SQL/diseño, no al comportamiento en una instancia de PostgreSQL.

---

## 3. Tabla de controles

| Control | Resultado | Severidad | Evidencia |
| ------- | --------- | --------- | --------- |
| M1 — 052 `trips.created_at` / `updated_at` / trigger | ✅ PASS (estático) | Alta | `052:14-45`; test `wkr-007-phase0.test.ts:42-60` |
| M2 — 053 `dedup_key` + índice parcial + guard | ✅ PASS (estático) | Alta | `053:10-39`; test `:62-80` |
| M3 — 054 `source_event_id` + índice por expresión | ✅ PASS (estático) | Alta | `054:10-53`; test `:82-93` |
| M4 — 055 `email_delivery_log` + PK + RLS + grants | ✅ PASS (estático) | Alta | `055:10-54`; test `:95-109` |
| T1 — `created_at` NOT NULL DEFAULT NOW() + backfill | ✅ PASS (estático) | Media | `052:14-28`; `verification.sql:14-51`; test `:45-51` |
| T2 — `updated_at` probe cross-TX (MEDIUM-1) | ✅ PASS (estático) | Media | `verification.sql:53-133`; test `:181-189` |
| D1 — `dedup_key` / `ON CONFLICT DO NOTHING` sin target | ✅ PASS (estático) | Alta | diseño `:238-255`, `:297-301`; `verification.sql:135-215`; test `:62-80, 143-156` |
| N1 — `source_event_id` casos A–F | ✅ PASS (estático) | Media | `verification.sql:217-351`; test `:191-202` |
| N2 — Semántica de unicidad (COALESCE `'*'`) | ✅ PASS (estático) | Media | `054:45-53`; diseño `:257-272`; test `:85-92` |
| E1 — `email_delivery_log` posture (PK/checks/sent_at/pending→sent) | ✅ PASS (estático) | Media | `verification.sql:353-498`; test `:204-213` |
| E2 — RLS / grants `service_role` / sin `anon`+`authenticated` / sin realtime | ✅ PASS (estático) | Alta | `055:46-54`; `verification.sql:408-431`; test `:204-213` |
| U1 — Extracción de utils sin cambio de comportamiento | ✅ PASS | Media | `email-fanout.ts:7-33`; `superadmin.service.ts:24-26, 451-1333`; test `:111-127` |
| R1 — Regresión backend + contracts | ✅ PASS | Alta | Backend 217/217; Phase0 17/17; ver §7 |
| S1 — Verification harness (`wkr_007_phase0_verification.sql`) | ✅ AUDITADO / ⏸ **EJECUCIÓN PENDING** | Alta | archivo completo; no hay evidencia de corrida real |
| DB — Estado real de Supabase | ❌ **NO VERIFICADO** | Alta | sin evidencia de aplicación de 052–055 (§8) |

---

## 4. Findings remediados

### HIGH-1 — `ON CONFLICT` / `SQLSTATE 42P10`

**Evidencia:**
- Diseño §9.4 «Invariante `ON CONFLICT` (auditoría Fase 0 — HIGH-1)»: `WKR-007-trip-notification-event-workers-design.md:287-301`.
  - Documenta `SQLSTATE 42P10 — there is no unique or exclusion constraint matching the ON CONFLICT specification` (`:291-293`).
  - Regla 1: para `notifications` usar `INSERT ... ON CONFLICT DO NOTHING` **sin** `conflict_target` (`:297`).
  - Regla 2: **No** usar `ON CONFLICT (source_event_id, agency_id, recipient_role)` (`:298`).
  - Regla 3: si se usa `conflict_target` explícito, debe reproducir exactamente las expresiones y el `WHERE` del índice (`:299`).
  - Regla 4: para `outbox_events.dedup_key` preferir `ON CONFLICT DO NOTHING` **sin** target (índice parcial `WHERE dedup_key IS NOT NULL`) (`:300`).
  - Regla 5: el índice de 054 **no se redefine** para acomodar un `ON CONFLICT` con columnas crudas (`:301`).
- Diseño §9.2 prohíbe explícitamente el target de columnas crudas contra el índice por expresión de 054 (`:272`).
- SQL de verificación usa `ON CONFLICT DO NOTHING` **sin** `conflict_target` en todos los puntos donde aplica:
  - `dedup_key`: `wkr_007_phase0_verification.sql:195-204`.
  - `notifications`: `:291-302` (caso F) y `:327-336` (caso D).
- Test de contrato: `tests/boarding/wkr-007-phase0.test.ts:143-156` valida que el diseño contenga §9.4, `SQLSTATE 42P10`, `ON CONFLICT DO NOTHING` y la prohibición.

**Análisis:** la coherencia diseño ↔ SQL es correcta. Los índices reales son únicos **parciales y/o por expresión** (`053:37-39`, `054:47-53`); el SQL de prueba y las reglas del diseño usan `ON CONFLICT DO NOTHING` sin target, que es lo que PostgreSQL acepta contra índices parciales/por expresión. No se encontró ningún `ON CONFLICT (col, col, col)` con target de columnas crudas en migraciones ni en el SQL de prueba.

**Estado:** **RESOLVED** (a nivel de código/diseño/SQL auditado estáticamente).
**Riesgo residual:** el SQL de prueba no se ha ejecutado contra una DB real; la corrección sintáctica y semántica en runtime queda pendiente de la verificación en Supabase (§8).

---

### MEDIUM-1 — Probe de `updated_at`

**Evidencia:** `wkr_007_phase0_verification.sql:53-133`.

- El probe ya **no** envuelve INSERT+UPDATE en una sola transacción.
- Separación real entre fases:
  1. **INSERT** en `public.trips` dentro de un `DO` top-level con `RETURNING created_at, COALESCE(updated_at, created_at)` y persistencia en temp table `ON COMMIT PRESERVE ROWS` (`:55-94`).
  2. **Espera:** `SELECT pg_sleep(0.25);` como sentencia top-level, fuera de la TX del INSERT (`:97`).
  3. **UPDATE** en un `DO` independiente (TX distinta) con `RETURNING updated_at` (`:99-127`).
  4. **Comparación:** `IF v_after IS NULL OR v_after <= v_before THEN RAISE EXCEPTION ...` (`:120-124`), de modo que `updated_at > updated_at_before` **puede ser verdadero** porque `NOW()` del trigger `update_updated_at()` corre en una TX posterior a la del INSERT (el comentario del header lo documenta en `:7-10`).
- Cleanup: `DELETE FROM public.trips WHERE id IN (...)` + `DROP TABLE` (`:130-133`) → no deja datos permanentes.
- Test de contrato: `wkr-007-phase0.test.ts:181-189` valida `wkr007_p0_trip_probe`, `ON COMMIT PRESERVE ROWS`, `pg_sleep`, `clock_timestamp()`, `across transactions` y el `DELETE` de limpieza.

**Análisis:** el diseño anterior dependía de `NOW()` (estable dentro de una misma TX) dentro de una única transacción, lo que hacía la comparación imposible. La reescritura en bloques top-level separados por `pg_sleep` elimina el falso positivo: `updated_at > updated_at_before` es alcanzable en una prueba real.

**Estado:** **RESOLVED** (estático). Ejecución contra DB real pendiente.

---

### MEDIUM — `source_event_id` casos A–F

**Evidencia:** `wkr_007_phase0_verification.sql:217-351`. Cada caso identificado:

| Caso | Qué cubre | Líneas |
|---|---|---|
| E | `source_event_id IS NULL` → múltiples filas permitidas (sin restricción) | `263-270` |
| A | mismo `source_event_id` + misma agency + mismo role → duplicado rechazado (`unique_violation`) | `272-289` |
| F | `ON CONFLICT DO NOTHING` sin target → skip del duplicado (`ROW_COUNT = 0`) | `291-302` |
| B | mismo `source_event_id` + agency diferente → permitido | `304-310` |
| C | mismo `source_event_id` + role diferente → permitido | `312-318` |
| D | superadmin con `agency_id IS NULL` → insert + dedupe vía `ON CONFLICT DO NOTHING` + conteo exacto = 1 | `320-348` |

- El bloque completo corre dentro de `BEGIN ... ROLLBACK` (`:241, 351`) → no deja datos.
- El caso D valida la normalización por expresión del índice (`COALESCE(agency_id::text, '*')`, `COALESCE(recipient_role, '*')`, `WHERE source_event_id IS NOT NULL`, `054:47-53`).
- Test de contrato: `wkr-007-phase0.test.ts:191-202`.

**Análisis:** los seis casos están cubiertos explícitamente y sus líneas identificables. El uso de `ON CONFLICT DO NOTHING` sin target en los casos F y D es coherente con HIGH-1/§9.4.

**Estado:** **RESOLVED** (estático). Ejecución contra DB real pendiente.

---

### MEDIUM — `email_delivery_log`

**Evidencia del harness** (`wkr_007_phase0_verification.sql:353-498`):

- PK `(event_id, recipient_id, email_type)`: `:366-378` + rechazo de duplicado `:449-459`.
- `status` válido (`CHECK (status IN ('pending','sent'))`): `:380-388` + rechazo de `'bogus'` `:461-471`.
- `attempts >= 0`: `:390-397` + rechazo de `-1` `:473-483`.
- `sent_at` presente: `:399-406`.
- RLS habilitado: `:408-415` (`relrowsecurity`).
- Grants `service_role` SELECT/INSERT/UPDATE/DELETE: `:417-423`.
- Ausencia de acceso de `anon`/`authenticated` (SELECT/INSERT): `:425-431`.
- Transición `pending → sent` con `sent_at` y `attempts`: `:485-495`.
- Test de contrato: `wkr-007-phase0.test.ts:204-213`.

**Evidencia del diseño** (§9.3 «Email por destinatario», `WKR-007-...design.md:274-285`): documenta el trade-off exacto pedido:

```
INSERT con status = 'pending' (ON CONFLICT DO NOTHING sobre PK)
→ envío OK → status = 'sent' (+ sent_at, attempts)
→ fallo → DELETE de la fila + requeue (reintento real)
→ crash tras envío OK y antes de marcar sent → puede quedar 'pending' (aceptado; undelivered-ack > duplicado)
```

- Test de contrato: `wkr-007-phase0.test.ts:158-168` valida `pending`/`sent`, `DELETE.*requeue`, `puede quedar en`, `undelivered-ack`, `evitar un segundo envío`.

**Análisis:** el harness cubre todos los puntos requeridos y el diseño documenta explícitamente el trade-off `pending` tras crash y la decisión de **no** diseñar recovery automático de `pending` en WKR-007 (`:285`). No se inventó comportamiento: no hay recovery worker de `pending` en migraciones ni en el diseño dentro de este ticket.

**Estado:** **RESOLVED** (estático). Ejecución contra DB real pendiente.

---

### Baseline `trips.updated_at` (drift 006 → 010/011 → 052)

**Evidencia:**
- Diseño `WKR-007-...design.md:59`: ya **no** afirma que `updated_at` sobrevivió desde migration 006. Declara el baseline real:
  > `trips` **NO tenía `created_at`** en el baseline post-reset (`010_drop_all` + `011_create_all`). La migración `006` añadió `updated_at` + trigger `trips_updated_at`, pero ese estado **no sobrevivió** al recreate de `011` (trips se recreó sin `created_at` ni `updated_at`, y sin reponer el trigger). Fase 0 / migración `052` asegura ambas columnas con `ADD COLUMN IF NOT EXISTS` y recrea `trips_updated_at` (idempotente).
- Migración `052` es compatible con **ambos** escenarios:
  - DB donde `updated_at` ya existe → `ADD COLUMN IF NOT EXISTS` no-op; el `UPDATE ... WHERE updated_at IS NULL` no afecta filas (`052:32-37`).
  - DB donde no existe → crea la columna, backfill con `COALESCE(updated_at, created_at, NOW())`, y recrea el trigger (idempotente con `DROP TRIGGER IF EXISTS`) (`052:32-45`).
- Test de contrato: `wkr-007-phase0.test.ts:170-179` valida que el diseño refleje `010_drop_all|011_create_all` y `ADD COLUMN IF NOT EXISTS`, y que **no** contenga la afirmación incorrecta antigua.

**Análisis:** la corrección documental está aplicada y es coherente con la migración. `052` cubre DB pre-006 (con columnas), post-011 (sin columnas) y migración desde cero de forma idempotente.

**Estado:** **RESOLVED**.

---

## 5. Diferencias diseño ↔ implementación

Diferencias restantes, clasificadas. **Ninguna es BLOCKER ni HIGH.** Se reportan explícitamente para no ocultar detalles menores.

| # | Diferencia | Clasificación | Análisis |
|---|---|---|---|
| 1 | Diseño §20 (#2) lista RPCs y `cleanup CHECK` como parte de "migraciones 052+ aprobadas"; solo existen 052–055 (sin RPCs ni cleanup CHECK). | aceptable (esperado) | Son entregables de Fase 2 (§18/§11). Fase 0 es solo preparación de esquema; el diseño define el alcance total del ticket, no lo entregado en Fase 0. |
| 2 | Diseño §6.3 (`:180`) y §8 (`:208, 224`) describen `HandlerOutcome.reason` ampliado (`already_delivered`, `skipped_effect_disabled`, `skipped_no_agencies`, `delivered`); no implementado. | aceptable (esperado) | Consumidores de Fase 2/3. El test de contrato verifica que **no** se introdujo `TRIP_EFFECTS_VIA_OUTBOX` ni `composeHandlers` en Fase 0 (`wkr-007-phase0.test.ts:129-139`). |
| 3 | `runner.ts:188` sigue hardcodeando `eventType: 'reservation.created'`. | aceptable (esperado) | Diseño §6 (Fase 1) es quien cambia a `null`. Test lo verifica como contrato de Fase 0 (`:136`). |
| 4 | `TRIP_EFFECTS_VIA_OUTBOX` no existe en `env.ts` (solo `EMAIL_VIA_OUTBOX`, `env.ts:15`). | aceptable (esperado) | Diseño §8.5 lo define para Fase 2/3 (`:227-230`). |
| 5 | **Cross-references internas obsoletas:** diseño `:208` referencia «§10.2» para `source_event_id` y `:224` referencia «§10.3» para el ledger, pero la idempotencia vive en §9.2/§9.3 (la §10 es Multi-tenancy). | LOW (doc) | Referencias internas desactualizadas; no afectan el contenido normativo (§9.2/§9.3 son la fuente correcta y coherente). Corregible en una pasada de docs. |
| 6 | Tipo `Trip` ganó `created_at?`/`updated_at?` y `OutboxEventRow` ganó `dedup_key?` (opcionales). | aceptable | Coherente con 052/053; tipos opcionales porque no hay consumidores en Fase 0. |
| 7 | Flake de timezone `lib/__tests__/utils.test.ts` (frontend) | aceptable (fuera de scope) | Preexistente, declarado fuera de WKR-007 (`wkr-007-phase0.test.ts:215-223`). Ver §7. |

---

## 6. Riesgos residuales

1. **DB real no verificada (ALTO):** las migraciones 052–055 no tienen evidencia de aplicación y el harness no se ejecutó. El SQL auditado es correcto estáticamente, pero solo PostgreSQL real valida sintaxis, guards (DO $$ ... RAISE EXCEPTION), índices parciales/por expresión y el comportamiento de `update_updated_at()` entre transacciones.
2. **Migraciones no aplicadas (ALTO):** hasta que 052–055 estén aplicadas, `trips.created_at`/`updated_at` pueden no existir (depende del estado real de cada DB) y no existe `dedup_key` ni `source_event_id` ni `email_delivery_log`. Los consumidores de Fase 2/3 dependen de estas columnas.
3. **Ausencia de commit (ALTO):** todo WKR-007 (migraciones, diseño, SQL, tests, utils, cambios en 3 archivos trackeados) está sin versionar. La evidencia no es auditable vía git hasta un commit.
4. **Backfill `created_at` con `NOW()` (MEDIO):** los viajes históricos reciben `created_at` = momento del backfill, no su fecha real de creación. El activity feed del admin ordena por `trips.created_at` (diseño `:60`); para históricos el orden será por backfill. Aceptado en diseño (`052:8-12`; `design.md:464`), pero con impacto en el historial.
5. **Actividad histórica del activity feed (MEDIO):** pre-052 la subconsulta a `trips.created_at` fallaba (PostgREST 400 → `recentTrips` null → viajes invisibles). 052 corrige la columna, pero no repara el dato de creación histórico (relacionado con #4).
6. **Fase 2/3 (MEDIO):** disciplina de `ON CONFLICT DO NOTHING` sin target en las RPCs reales (no solo en el harness); registro de handlers para todo tipo publicado (un tipo sin handler → DLQ); retrofit del trigger 049 (`dedup_key`) diferido a **WKR-007.2** (diseño §20 #6, `:460`).
7. **Flake de timezone frontend (BAJO, preexistente):** `lib/__tests__/utils.test.ts` falla en esta máquina por timezone; explícitamente fuera de WKR-007. No se tocó.

---

## 7. Evidencia de tests

Resultados **reales** de esta auditoría (no reclamados):

```text
Phase0 static (tests/boarding/wkr-007-phase0.test.ts): 17/17 PASS
Backend suite   (backend, vitest run):                    31 files / 217 tests PASS
  ├─ email-fanout.test.ts:                                 3/3 PASS
  ├─ superadmin.service.test.ts:                          35/35 PASS
  └─ resto del backend:                                   PASS
TypeScript      (npx tsc --noEmit -p backend/tsconfig.json): PASS (exit 0)
git diff --check:                                          PASS (exit 0)
git diff --cached:                                         vacío (nada staged)

No relacionado con WKR-007 (preexistente, NO tocado):
  lib/__tests__/utils.test.ts > formatDateTime > formats ISO date string correctly:
  1 FAIL por timezone (esperado '14:30', recibido '10:30 AM') — flake preexistente declarado
  fuera de scope en wkr-007-phase0.test.ts:215-223. Resto del archivo: 8 PASS.
```

**Clasificación del fallo:** el único test en rojo es el flake de timezone del frontend (`formatDateTime`), preexistente y ajeno a WKR-007. No fue modificado. Ningún test de WKR-007 (estáticos) ni del backend falla.

---

## 8. Estado de la DB

```text
Código SQL:        AUDITADO   (052–055, lectura directa)
SQL harness:       AUDITADO   (wkr_007_phase0_verification.sql, lectura directa + contracts)
DB Supabase real:  NO VERIFICADA
Migraciones 052-055 aplicadas: NO CONFIRMADO
```

- No se encontró en el repositorio evidencia de aplicación de 052–055 (sin historial de migraciones, sin log de ejecución, sin schema diff).
- El harness `wkr_007_phase0_verification.sql` **no tiene evidencia de ejecución** contra una instancia real → **PENDING**.
- El repositorio **no** representa automáticamente el estado de Supabase. No se declara la DB correcta.

---

## 9. Recomendación

1. **¿La implementación de Fase 0/0.1 está suficientemente sólida?** Sí, a nivel de código, migraciones y documentación: coherente, sin BLOCKER/HIGH, con tests estáticos y backend verdes. **No** es suficiente para declarar Fase 1 lista por sí sola (ver puntos siguientes).
2. **¿Qué falta antes de aprobar definitivamente?**
   a. Aplicar 052–055 en una instancia de Supabase (recomendado: entorno de staging/test).
   b. Ejecutar `supabase/tests/wkr_007_phase0_verification.sql` en esa instancia y confirmar todos los `PASS` (secciones 1–6) + `ROLLBACK` limpio.
   c. Commitear el trabajo de Fase 0/0.1 para dejar evidencia auditable.
   d. (Bajo costo) corregir las cross-references §10.2/§10.3 → §9.2/§9.3 del diseño (LOW, §5 #5).
3. **¿Se puede empezar Fase 1?** **No todavía.** Fase 1 (dispatcher multi-evento) es técnicamente independiente, pero aprobar Fase 1 sobre una base de esquema sin verificar en DB compromete la cadena de evidencia. Condición de entrada: aplicar + verificar 052–055 en Supabase (al menos staging) y commitear.
4. **¿Se debe aplicar primero 052–055?** Sí. En staging/test primero, con el harness; no en producción sin la verificación previa.
5. **¿Se debe ejecutar el SQL de verificación en Supabase?** Sí, es requisito para aprobar. Requiere una DB con 052–055 aplicadas y dependencias del script (≥ 2 agencias y ≥ 1 ruta; ver §10).
6. **¿Se necesita un commit antes de continuar?** Sí. Actualmente **nada** de WKR-007 está versionado (6 archivos nuevos + diseño + `docs/incidents/` sin trackear; 3 archivos modificados: `backend/src/events/types.ts`, `backend/src/services/superadmin.service.ts`, `backend/src/types/index.ts`). Sin commit no hay línea base reproducible para la re-auditoría de Fase 1+.

---

## 10. Reproducción

### Tests estáticos y typecheck (repo)

```bash
# Contratos estáticos de Fase 0/0.1
npx vitest run tests/boarding/wkr-007-phase0.test.ts

# Utils extraídos (usa la config de backend)
cd backend
npx vitest run src/utils/email-fanout.test.ts

# Suite completa del backend
npx vitest run
cd ..

# Typecheck del backend
npx tsc --noEmit -p backend/tsconfig.json

# Whitespace/conflict check sobre cambios trackeados
git diff --check
```

> En PowerShell la ejecución de `npx.ps1` puede estar bloqueada por Execution Policy; usar `npx.cmd`.

### Verificación SQL en Supabase (requiere DB con 052–055 aplicadas)

1. Aplicar `supabase/migrations/052_trips_created_at_updated_at.sql` → `055_email_delivery_log.sql` en orden.
2. Abrir Supabase → SQL Editor → pegar completo `supabase/tests/wkr_007_phase0_verification.sql` → Run.
3. Prerrequisitos del script:
   - ≥ 2 agencias en `public.agencies` (sección 4, casos A–D).
   - ≥ 1 ruta en `public.routes` (sección 2, probe de trips).
4. El script es **no destructivo**:
   - Sección 2 crea/borra un trip de prueba con `DELETE` de limpieza.
   - Secciones 3–5 corren dentro de `BEGIN ... ROLLBACK`.
   - Sección 1, 5 (check estáticos) y 6 solo leen catálogo/estructura.
5. Resultado esperado: todos los `RAISE NOTICE 'PASS: ...'`; cualquier `RAISE EXCEPTION 'FAIL: ...'` indica un control no cumplido en esa instancia.

---

## Apéndice — Estado de Git al momento de la auditoría

- **Último commit relevante:** `29525a7` — Merge PR #81 `fix/express-trust-proxy` (ajeno a WKR-007).
- **Archivos nuevos sin trackear (`??`):**
  - `backend/src/utils/email-fanout.ts`
  - `backend/src/utils/email-fanout.test.ts`
  - `docs/WKR-007-trip-notification-event-workers-design.md`
  - `docs/incidents/` (incidente de X-Forwarded-For; ajeno a WKR-007)
  - `supabase/migrations/052_…`, `053_…`, `054_…`, `055_…`
  - `supabase/tests/wkr_007_phase0_verification.sql`
  - `tests/boarding/wkr-007-phase0.test.ts`
- **Archivos trackeados modificados sin commit (` M`):**
  - `backend/src/events/types.ts` (añade `OutboxEventRow.dedup_key`)
  - `backend/src/services/superadmin.service.ts` (importa utils de `email-fanout.ts`; elimina helpers privados: +13/−37)
  - `backend/src/types/index.ts` (añade `Trip.created_at?`/`updated_at?`)
- **Migraciones 001–051:** sin modificaciones (`git status --porcelain -- supabase/migrations` vacío para esa ruta).
- **Staged:** nada (`git diff --cached` vacío).
- **WKR-007 commiteado:** NO.
