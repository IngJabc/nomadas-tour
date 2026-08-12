# F4-001 — Agency Daily Digest (email)

**Tipo:** Diseño / scope-lock (sin implementación en este documento)  
**Fecha:** 2026-08-12  
**Estado:** Implementado en código — **pendiente aplicar migración 061 en producción + soak del flag** (no CLOSED)  
**Rama:** `feat/f4-001-agency-daily-digest`  
**Referencias:** [ROADMAP.md](ROADMAP.md) Fase 4, [TASKS.md](../TASKS.md), [WKR-007 design](WKR-007-trip-notification-event-workers-design.md), [WKR-008 audit](WKR-008-reminder-workers-audit.md), [WKR-009 design](WKR-009-outbox-retention-workers-design.md), `lib/timezone.ts`, `reservation.service.ts#getAgencyDashboard`

---

## 1. Purpose

Definir el contrato implementable del **digest diario por email** para cada agencia activa: un resumen operativo proactivo, multi-tenant-safe, sobre la infraestructura de workers existente (sin segundo proceso ni pg_cron).

---

## 2. Problem

El dashboard de agencia (`/agency`, `getAgencyDashboard`) es **reactivo**: la agencia debe abrir la app para ver viajes próximos, ocupación y pendientes. No existe hoy un canal proactivo diario equivalente a los reminders de viaje (WKR-008) ni a la retención (WKR-009).

---

## 3. User / beneficiary

| Rol | ¿Incluido en F4-001? |
|---|---|
| **Agency** | **Sí** — único beneficiario |
| Superadmin | **No** → **F4-002** |
| Pasajeros / bookers | **No** |

---

## 4. Current state (repo facts)

| Capacidad | Estado real |
|---|---|
| Worker Node único + relay | Sí (`runner.ts`) |
| Schedulers existentes | Reminder (WKR-008), Retention (WKR-009) |
| Outbox + `dedup_key` unique parcial | Sí (053+) |
| NotificationFanout / EmailFanout | Sí (trip / reservation / reminder) |
| `email_delivery_log` PK `(event_id, recipient_id, email_type)` | Sí (055) |
| Preferencias por categoría | Sí; defaults `email_enabled: true` |
| Categoría digest | **No existe** |
| Template digest | **No existe** |
| Evento digest | **No existe** |
| Timezone de negocio | **`America/Caracas`** (`lib/timezone.ts` `BUSINESS_TIMEZONE`; emails `formatDateForEmail`) |
| Columna `agencies.timezone` | Comentario futuro en `lib/timezone.ts`; **no usada** hoy |
| Estados agencia | `active` \| `inactive` \| `pending` (022 / types) |
| Elegibilidad email trip fanout | `status = 'active' AND email` (`getAgenciesWithEmail`) |
| Dashboard agencia | Conteos + `upcoming_trips` + `occupancy_by_trip` + pending boarding (`getAgencyDashboard`) |
| Feature flags worker | Patrón boolean `true`/`"true"`/`"1"`, default false |

---

## 5. Goals

1. Enviar **un email diario** por agencia elegible con agregados operativos de **su** tenant.  
2. Reutilizar worker, outbox, ledger de email, prefs y observabilidad existentes.  
3. Idempotencia fuerte por `(agency_id, digest_date)`.  
4. Rollout con flag default `false` y soak en producción (único entorno Supabase del proyecto).  
5. Cero PII de pasajeros en payload y en el cuerpo del email.

---

## 6. IN scope

- Scheduler en el worker Node existente (patrón WKR-008/009).  
- Selección de agencias elegibles + consulta **scoped** por `agency_id`.  
- Emisión / entrega del digest diario (ver arquitectura §17).  
- Template React email nuevo (solo agregados).  
- Nueva categoría de preferencia + seed/backfill.  
- Respeto de `email_enabled` vía policy existente.  
- Idempotencia diaria.  
- Feature flag `AGENCY_DIGEST_VIA_WORKER`.  
- Logs estructurados del scheduler/handler.  
- Tests unitarios + boarding/static; harness SQL si hay RPC.  
- Soak flag off → on en producción.

---

## 7. OUT of scope

- Superadmin daily digest (**F4-002**).  
- Occupancy alerts / umbrales (**F4-003**).  
- “Viajes próximos sin acción”.  
- Métricas nocturnas persistidas / dashboards nuevos.  
- SMS / push / in-app obligatorio (in-app digest diferido).  
- Segundo worker / pg_cron.  
- Migración `LockCleanup` / `completeExpiredTrips`.  
- Retention `boarding_attempts`.  
- Cambios a WKR-008 / WKR-009.  
- Adopción `agency.created` / `user.invited` / `reservation.cancelled` email.  
- PII: nombres, documentos, teléfonos, emails de bookers/pasajeros en el digest.  
- Timeline / recent_activity del dashboard (contiene `booker_name` / nombres de pasajeros).  
- Infraestructura paralela (colas, brokers, tablas DLQ).

---

## 8. Existing infrastructure reused

| Pieza | Uso en F4-001 |
|---|---|
| `runner.ts` + AbortController | Wire del digest scheduler |
| Outbox relay + retries / DLQ lógica `failed` | Entrega confiable del evento |
| `dedup_key` unique | Idempotencia de emisión |
| `email_delivery_log` | Idempotencia de envío por destinatario |
| `notification-delivery.policy` / prefs | Gate `email_enabled` |
| `getAgenciesWithEmail` pattern | Solo `active` + email |
| `formatDateForEmail` / `America/Caracas` | Formato de fechas en template |
| Logger / heartbeat / healthz / Sentry | Observabilidad |
| Datos equivalentes a `getAgencyDashboard` | Contenido (sin activity con PII) |

---

## 9. Product decisions (overview)

| ID | Tema | Estado |
|---|---|---|
| **D1** | Hora de envío (clock hour) | **REQUIERE DECISIÓN** — propuesta abajo |
| **D2** | Timezone | **DEFINIDA por el producto** → `America/Caracas` |
| **D3** | Ventana de próximos viajes | **REQUIERE DECISIÓN** — propuesta **48h** |
| **D4** | Contenido mínimo | **DEFINIDO** a partir de datos reales del dashboard (lista §14) |
| **D5** | Default de preferencia email | **PROPUESTA alineada al código** → default enabled (opt-out); confirmar |
| **D6** | Elegibilidad de agencias | **DEFINIDA** → solo `status = 'active'` con `email` no nulo |

---

## 10. D1 — Delivery time

**Hecho:** no hay hora de digest configurada en env, agencies ni prefs.

**Propuesta (pendiente de aprobación humana):**

- Enviar cuando la hora local en `America/Caracas` sea **`07:00`** (ventana del tick: minuto `[0, poll)`).  
- Env opcional futuro: `AGENCY_DIGEST_HOUR_LOCAL` default `7` (solo si se implementa; no es obligatorio en v1 si se fija 07:00 en código documentado).

**Mecanismo de scheduler (diseño):** poll periódico (default **1h**, alineado a reminders) — en cada tick, si flag on y `hour(America/Caracas) === D1`, intentar emitir digests del `digest_date` local de hoy para agencias aún no emitidas.

**Estado:** **D1 — REQUIERE DECISIÓN** (hora exacta; 07:00 es la recomendación).

---

## 11. D2 — Timezone

**Definida en código:**

```11:11:lib/timezone.ts
export const BUSINESS_TIMEZONE = 'America/Caracas';
```

Emails de dominio ya formatean con `timeZone: 'America/Caracas'` (`backend/src/utils/email-fanout.ts`).

**Regla F4-001:**

- `digest_date` = calendario `YYYY-MM-DD` en `America/Caracas` (no usar `toISOString().slice(0,10)` UTC — el dashboard HTTP hoy usa UTC para `today_reservations`; el digest **no** debe copiar ese bug).  
- Todas las etiquetas de fecha/hora del email en `America/Caracas` / `es-VE`.  
- Per-agency timezone: **fuera de F4-001** (comentario futuro en `lib/timezone.ts`).

**Estado:** **D2 — DEFINIDA** (`America/Caracas`).

---

## 12. D3 — Upcoming-trip window

**Hecho:** `getAgencyDashboard` lista próximos con `departure_time >= now`, `status = active`, `limit 10`, **sin** ventana fija 24h/48h/7d.

**Propuesta (pendiente de aprobación):**

| Opción | Pros | Contras |
|---|---|---|
| 24h | Muy accionable | Poco contexto |
| **48h (recomendada)** | Alineada al horizonte WKR-008 (T-48) | — |
| 7 días | Más planificación | Email más largo; menos “hoy” |

**Regla propuesta:** incluir viajes `active` asignados a la agencia con  
`now <= departure_time < now + 48 hours`, ordenados por `departure_time`, cap **10** filas (mismo orden de magnitud que el dashboard).

**Estado:** **D3 — REQUIERE DECISIÓN** (recomendación: **48h**).

---

## 13. D4 — Minimum digest content

Solo campos **agregados** ya derivados hoy en `getAgencyDashboard` / seats / trip_agencies, **sin** `recent_activity` (PII).

### Encabezado

- `agency_name`  
- `digest_date` (Caracas)  
- Link CTA a `/agency` (FRONTEND_URL)

### KPIs del día (scoped `agency_id`)

| Campo | Fuente conceptual | Notas |
|---|---|---|
| `active_trips` | `trip_agencies` ⋈ `trips.status = active` | |
| `today_reservations` | `reservations` de la agencia con `created_at` en el **día Caracas** | Corregir semántica vs dashboard UTC |
| `pending_boarding_passengers` | `reservation_passengers` active no boarded vía reservas de la agencia | |

### Tabla “Próximos viajes” (ventana D3, max 10)

Por viaje asignado a la agencia:

| Campo | Scoped |
|---|---|
| `route` origin → destination | Sí (vía trip) |
| `departure_time` formateada Caracas | Sí |
| `reservation_count` de **esta** agencia | Sí (`reservations.agency_id`) |
| `available_seats` / `capacity` del viaje | Capacidad del **viaje** (compartida entre agencias asignadas) — OK como dato operativo del viaje; no es inventario “de otra agencia” |
| `occupancy_pct` del viaje | Derivado de seats del trip (misma semántica dashboard) |

### Explícitamente excluido del email

- `booker_name`, nombres de pasajeros, documentos, teléfonos, emails de contacto.  
- Lista de recent_activity / boarding labels con nombres.  
- Conteos globales de otras agencias / plataforma.

**Estado:** **D4 — DEFINIDO** (lista anterior); implementación no inventa columnas nuevas de producto.

---

## 14. D5 — Preference default

**Hecho:** `createDefaultPreferences()` / `seedDefaults` inicializan **todas** las categorías con `in_app_enabled: true`, `email_enabled: true` (opt-out).

**Propuesta F4-001:** nueva categoría p. ej. `ops_digest` (nombre final en implementación) con el **mismo default** (`email_enabled: true`), backfill idempotente para agencias existentes (patrón WKR-008 `trip_reminders`).

- In-app para digest: **no requerido en v1** (puede seed `in_app_enabled: false` o true sin UI de envío in-app).  
- El envío de email **debe** consultar `shouldDeliver(agencyId, type, 'email')`.

**Estado:** **D5 — PROPUESTA alineada al código; confirmar** (default enabled / opt-out).

---

## 15. D6 — Agency eligibility

**Definida por convención existente** (`getAgenciesWithEmail`):

Una agencia es elegible para digest sii:

1. `agencies.status = 'active'`  
2. `agencies.email` IS NOT NULL / no vacío  
3. Preferencia categoría digest con `email_enabled = true`  
4. Flag `AGENCY_DIGEST_VIA_WORKER = true`

`pending` e `inactive` **no** reciben digest.

**Estado:** **D6 — DEFINIDA**.

---

## 16. Architecture options

### Option A — Scheduler → email directo + ledger

```text
digest-scheduler → query agencies → build body → Resend
                 → email_delivery_log (¿event_id sintético?)
```

**Pros:** menos surface.  
**Contras:** `email_delivery_log.event_id` está pensado como id de outbox (055); retries/DLQ del outbox no aplican; inconsistente con WKR-007/008.

### Option C — Scheduler → outbox event → handler → email + ledger (**preferida**)

```text
digest-scheduler
  → (flag on + ventana D1) emit agency.digest.due.v1 por agencia
  → outbox (dedup_key)
  → relay → digest email handler
  → email_delivery_log + Resend
```

**Pros:** retries, `failed` DLQ lógica, `dedup_key`, mismo modelo que reminders; ledger con `event_id` real.  
**Contras:** un event type nuevo (necesario y acotado).

---

## 17. Selected architecture

**Option C** — alineada al outbox + fanout del repo.

Motivo decisivo: el ledger 055 y el relay ya resuelven idempotencia de envío y reintentos; inventar `event_id` sintéticos en A es más frágil y diverge del patrón WKR-008.

El evento es un **hecho operativo de scheduling** (“el digest del día D para la agencia A debe entregarse”), no un hecho de dominio de viaje. Payload mínimo; el handler **relee** agregados por `agency_id` (igual que reminder relee contactos).

---

## 18. Event contract (si Option C)

| Campo | Valor |
|---|---|
| `event_type` | `agency.digest.due` |
| `event_version` | `1` |
| `aggregate_type` | `agency` |
| `aggregate_id` | `agency_id` (UUID) |
| `tenant_id` | `agency_id` (tenant-specific; distinto de trip.* con `tenant_id` NULL) |
| `payload` | `{ agency_id: string, digest_date: string }` (`digest_date` = `YYYY-MM-DD` Caracas) |
| PII en payload | **Ninguna** |
| `dedup_key` | `agency.digest.due:{agency_id}:{digest_date}` |
| Emisión | `INSERT … ON CONFLICT (dedup_key) DO NOTHING` (mismo espíritu que `emit_trip_event`) |

**Handler:** dedicado (no reutilizar EmailFanout de trip.* sin adaptación): carga agregados scoped, respeta prefs, claim `email_delivery_log` con `email_type = 'agency_digest'`, `recipient_id = agency_id`, `event_id = outbox.id`.

**Retry / DLQ:** fallos de Resend → requeue/fail del outbox como handlers actuales; claim `pending` en ledger evita doble send en retry (patrón C5/reminder).

**In-app:** fuera de v1 (no registrar NotificationFanout para este tipo salvo decisión posterior).

---

## 19. Tenancy / security model

| Control | Regla |
|---|---|
| Worker DB access | `service_role` (BYPASSRLS) — **compensar** con filtros explícitos `agency_id` |
| Emisión | Una fila outbox por `(agency_id, digest_date)` |
| Query de contenido | Solo `trip_agencies.agency_id = X`, `reservations.agency_id = X` |
| Capacidad / seats | Nivel viaje (compartido); no exponer listas de otras agencias |
| RPC (si se usa para schedule batch) | `SECURITY DEFINER`, `SET search_path = public`, REVOKE PUBLIC/anon/authenticated, GRANT `service_role` only; **no** aceptar listados cross-tenant |
| Email | Solo a `agencies.email` de la agencia del evento |
| PII | Prohibida en payload y template |

Violación de filtro `agency_id` = defecto de implementación (tests de contrato / harness).

---

## 20. Idempotency model

**Capa 1 — Emisión (outbox):**  
`dedup_key = agency.digest.due:{agency_id}:{digest_date}`  
Re-poll del scheduler o segunda instancia → no crea segundo evento.

**Capa 2 — Envío (ledger):**  
PK `(event_id, recipient_id, email_type)` con `email_type = 'agency_digest'`.  
Retry del handler: claim `pending` → `sent`; si ya `sent` → skip.

**Capa 3 — Scheduler:**  
Errores logueados; no tumbar relay (patrón reminder/retention).  
`FOR UPDATE SKIP LOCKED` en RPC de schedule si se implementa claim de agencias en batch.

No hace falta tabla ledger aparte de `email_delivery_log` + `dedup_key`.

---

## 21. Feature flag

| Variable | Default | Rol |
|---|---|---|
| `AGENCY_DIGEST_VIA_WORKER` | **`false`** | Kill switch / soak |
| `AGENCY_DIGEST_POLL_MS` | `3600000` (1h) propuesto | Cadencia del scheduler |
| `AGENCY_DIGEST_BATCH` | p.ej. `50` propuesto | Max agencias por tick |

**Comportamiento:**

- `false` → tick `skipped_effect_disabled`; no emite.  
- `true` → evalúa ventana D1 + emite elegibles.  
- Rollback: poner flag `false` en Render (código default permanece `false`).  
- Soak: deploy → flag false → verificar logs → flag true en producción.

---

## 22. Observabilidad

Reutilizar logger JSON del worker. Eventos:

- `digest_scheduler_started`  
- `digest_scheduler_tick` (`status: ok | skipped_effect_disabled | skipped_outside_window`, `scanned`, `emitted`, `duration_ms`)  
- `digest_scheduler_error`  
- `digest_scheduler_stopped`  

Handler: logs de skip (prefs/no email), sent, error — sin PII.  
Sentry: solo fallos inesperados / fatales (no skips).  
Healthz / heartbeat: sin cambios de contrato.

---

## 23. Failure / retry behavior

| Fallo | Comportamiento |
|---|---|
| Flag off / fuera de hora D1 | Skip tick; sin error |
| Agencia sin email / prefs off | No emitir o handler skip |
| Insert dedup conflict | `emitted` no incrementa; OK |
| Resend transient | Outbox requeue + ledger pending |
| Resend permanent / max attempts | Outbox `failed` (DLQ lógica 006.3) |
| Error en scheduler loop | Log error; loop continúa; relay intacto |

---

## 24. Testing strategy

- Unit: scheduler flag off/on, fuera de ventana, emit con dedup; handler prefs/ledger.  
- Env defaults / boolean parse.  
- Boarding/static: migración (si hay), event contract, no PII keys, runner wiring, flag default false.  
- Harness SQL (si RPC): BEGIN/ROLLBACK; elegibilidad active-only; dedup; grants DEFINER.  
- No depender de datos productivos persistentes.

---

## 25. Production rollout strategy

Este proyecto aplica migraciones y validación operativa en **Supabase producción** (no hay staging separado).

1. Merge código + migración (preferencias/evento/RPC según impl).  
2. Aplicar migración en prod tras tests locales.  
3. Deploy worker con `AGENCY_DIGEST_VIA_WORKER=false`.  
4. Verificar `digest_scheduler_*` + `skipped_effect_disabled`.  
5. Harness SQL si aplica (BEGIN/ROLLBACK).  
6. Activar flag `true` en ventana controlada.  
7. Verificar un tick real (`emitted` / email_delivery_log) sin PII.  
8. Cierre documental (TASKS/ROADMAP/HISTORY) — **no** en esta fase de design.

---

## 26. Definition of Done

- [ ] Este design vigente + decisiones D1/D3/D5 aprobadas o fijadas en impl notes.  
- [ ] Scheduler en worker existente; flag default `false`.  
- [ ] Evento `agency.digest.due.v1` + handler email (Option C).  
- [ ] Categoría preferencia + backfill.  
- [ ] Template sin PII.  
- [ ] Queries scoped por `agency_id`; tests anti cross-tenant.  
- [ ] Idempotencia `dedup_key` + `email_delivery_log`.  
- [ ] Unit + boarding (+ harness si RPC).  
- [ ] Soak false → true en producción.  
- [ ] Docs de cierre al completar (posterior).  
- [ ] OUT respetado (F4-002/003 y follow-ups no mezclados).

---

## 27. Follow-ups

| Ticket | Tema |
|---|---|
| **F4-002** | Superadmin Daily Digest |
| **F4-003** | Occupancy Alerts (umbrales producto) |
| Futuro | Per-agency timezone (`agencies.timezone`) |
| Futuro | In-app digest |
| Fuera de F4 | LockCleanup / completeExpiredTrips migration; boarding_attempts retention; métricas persistidas; cancelación→email; agency.created / user.invited adoption |

---

## 28. Scope Guard

F4-001 **NO** incluye:

- WKR-008 reminders / WKR-009 retention  
- LockCleanup / completeExpiredTrips migration  
- boarding_attempts retention  
- automation bridge ambiguo  
- segundo worker / pg_cron  
- superadmin digest / occupancy alerts / trips-without-action / nightly metrics  
- PII de pasajeros o bookers  
- infraestructura paralela innecesaria  

---

## Open decisions (human approval before / at start of implementation)

1. **D1** — ¿Confirmar envío a las **07:00 America/Caracas**?  
2. **D3** — ¿Confirmar ventana de próximos viajes **48h** (cap 10)?  
3. **D5** — ¿Confirmar preferencia digest con **email default enabled** (opt-out), igual que el resto de categorías?

D2, D4 y D6 quedan fijados por el estado actual del repositorio según este documento.
