# F4-002 — Superadmin Daily Digest (email)

**Tipo:** Diseño / scope-lock (sin implementación en este documento)  
**Fecha:** 2026-08-12  
**Estado:** Scope-locked — **pendiente de implementación** (no completado)  
**Rama prevista:** `feat/f4-002-superadmin-daily-digest`  
**Referencias:** [ROADMAP.md](ROADMAP.md) Fase 4, [TASKS.md](../TASKS.md), [F4-001 design](F4-001-agency-daily-digest-design.md), [WKR-007](WKR-007-trip-notification-event-workers-design.md), [WKR-008](WKR-008-reminder-workers-audit.md), [WKR-009](WKR-009-outbox-retention-workers-design.md), `superadmin.service.ts#getDashboard`, `digest-scheduler.ts` (F4-001), `lib/timezone.ts` / `backend/src/utils/timezone.ts`

---

## 1. Purpose

Definir el contrato implementable del **digest diario por email para SUPERADMIN**: un resumen operativo **global** de la plataforma, proactivo, sin PII de pasajeros, sobre el worker Node existente (sin segundo proceso ni pg_cron).

---

## 2. Problem

El dashboard superadmin (`/admin`, `superadminService.getDashboard`) es **reactivo**. No existe canal email diario con KPIs globales. F4-001 cubre solo agencias; el superadmin queda fuera a propósito.

---

## 3. User / beneficiary

| Rol | ¿Incluido en F4-002? |
|---|---|
| **Superadmin** | **Sí** — único beneficiario |
| Agency | **No** (F4-001) |
| Pasajeros / bookers | **No** |

---

## 4. Current state (repo facts)

| Capacidad | Estado real |
|---|---|
| Worker Node + relay + schedulers | Sí (reminder, retention, agency digest) |
| Outbox + `dedup_key` | Sí |
| `email_delivery_log` PK `(event_id, recipient_id, email_type)` | Sí (055); `recipient_id` UUID genérico |
| Preferencias **agencia** (`agency_notification_preferences`, `ops_digest`) | Sí — **no** aplica a superadmin |
| Preferencias **superadmin** / por usuario | **No existen** |
| Evento / template / scheduler superadmin digest | **No existen** |
| `users.role` | `superadmin` \| `agency`; email UNIQUE; **N** superadmins posibles |
| Emails trip fanout | A **agencias**, no a superadmins |
| In-app superadmin | Sí (`recipient_role: 'superadmin'`) |
| Dashboard global | `getDashboard()` — KPIs + upcoming(5) + occupancy + **recent_activity con PII** |
| Timezone | `BUSINESS_TIMEZONE` = `America/Caracas` |
| F4-001 patrón | Option C, 07:00 Caracas, 48h/10, flag default false |
| `emit_agency_event` | Solo `aggregate_type='agency'` — **no** reutilizar para F4-002 |
| `outbox_events.aggregate_id` | **UUID NOT NULL** (049) |

---

## 5. Goals

1. Un email diario a **cada** superadmin elegible con agregados globales seguros.  
2. Reutilizar worker, outbox, ledger, timezone, observabilidad y patrón Option C de F4-001.  
3. Idempotencia diaria (un hecho de plataforma por `digest_date`) + ledger por destinatario.  
4. Flag default `false` + soak en producción.  
5. Cero PII de pasajeros/bookers; cero envío a roles `agency`.

---

## 6. Product decisions

| ID | Tema | Estado |
|---|---|---|
| **S1** | Destinatarios | **FIJADA** — todos los `users` con `role='superadmin'` y email válido |
| **S2** | Preferencia | **FIJADA** — tabla propia + categoría `superadmin_digest`, email default enabled (opt-out) |
| **S3** | Hora | **FIJADA** — 07:00 America/Caracas (igual F4-001) |
| **S4** | Ventana próximos | **FIJADA** — 48 horas |
| **S5** | Contenido | **FIJADA** — KPIs globales + próximos 48h (máx 10) + `occupancy_by_trip` (máx 10); lista §13 |
| **S6** | Cap upcoming | **FIJADA** — máximo 10 |
| **S7** | Digest vacío | **FIJADA** — skip envío si no hay operación relevante (§14) |
| **S8** | In-app | **FIJADA** — email only en v1 |

Ninguna decisión S1–S8 queda abierta para implementación, salvo ajustes menores de naming de RPC si el tip de migración lo exige.

---

## 7. S1 — Destinatarios

**Contrato:**

1. Elegibles = filas en `public.users` con `role = 'superadmin'` **y** `email` no nulo / no vacío (trim).  
2. **Nunca** usuarios `role = 'agency'`.  
3. **Nunca** `agencies.email`.  
4. **No** hardcodear un email único ni env allowlist en v1.  
5. Si hay 0 superadmins elegibles → completar handler sin envío (`skipped_no_email` / equivalente).

**Razón técnica:** el schema permite múltiples superadmins; las notificaciones in-app ya tratan el rol como conjunto. Un solo email hardcodeado contradiría el modelo.

---

## 8. S2 — Preferencia (superadmin, no agencia)

**No** usar `agency_notification_preferences` ni la categoría de agencia `ops_digest`.

| Pieza | Valor |
|---|---|
| Tabla nueva (migración) | `superadmin_notification_preferences` |
| PK / unicidad | `(user_id, category)` |
| `user_id` | FK → `users.id` (solo semántica superadmin en app/RPC) |
| Categoría | `superadmin_digest` |
| Default email | `email_enabled = TRUE` (opt-out) |
| Default in-app | `in_app_enabled = FALSE` (v1 email-only; sin fanout in-app) |
| Backfill | INSERT para cada `users.role = 'superadmin'` existente, `ON CONFLICT DO NOTHING` |
| Gate de envío | Handler consulta preferencia del **user_id** destinatario; si `email_enabled = false` → skip ese destinatario (sin claim sent) |

UI settings completa puede ser mínima en v1 (seed + gate); ampliar UI es follow-up si no entra en el mismo ticket.

---

## 9. S3 — Delivery time

Igual que F4-001:

- Ventana: hora local **07** en `America/Caracas`.  
- Poll default **1h** (`SUPERADMIN_DIGEST_POLL_MS=3600000`).  
- Fuera de hora → `skipped_outside_window`.  
- Constante documentada `SUPERADMIN_DIGEST_LOCAL_HOUR = 7` (espejo de `AGENCY_DIGEST_LOCAL_HOUR`).

---

## 10. S4 / S6 — Upcoming window & cap

- Incluir viajes `status = 'active'` con `now <= departure_time < now + 48h`.  
- Orden `departure_time ASC`.  
- **Máximo 10** filas.  
- Diferencia vs dashboard HTTP actual: dashboard usa **limit 5** y **sin** ventana 48h — el digest **no** copia ese límite; alinea a F4-001 (48h/10).

---

## 11–13. S5 — Minimum digest content

Fuentes conceptuales: agregados de `getDashboard()` **sin** `recent_activity` ni `reservations_by_date` (chart).

### Encabezado

- Título operativo (p. ej. “Resumen operativo diario — plataforma”)  
- `digest_date` (Caracas `YYYY-MM-DD`)  
- CTA a `/admin` (`FRONTEND_URL`)

### KPIs globales

| Campo | Fuente | Notas |
|---|---|---|
| `total_agencies` | `agencies` count | Reutilizar |
| `active_agencies` | `agencies` where `status=active` | Reutilizar |
| `active_trips` | `trips` where `status=active` | Reutilizar |
| `today_reservations` | `reservations` en **día Caracas** | **Adaptar** — no usar UTC slice del dashboard |
| `pending_boarding_passengers` | `reservation_passengers` active, `boarded=false` | Reutilizar (scope global OK) |

### Tabla próximos viajes (48h, max 10)

| Campo | Notas |
|---|---|
| route origin → destination | |
| `departure_time` formateada Caracas | |
| `reservation_count` | Global del viaje (todas las agencias) — correcto para SUPERADMIN |
| `available_seats` / `capacity` | Trip-level |
| `occupancy_pct` | Trip-level (misma semántica seats ≠ available) |

### Occupancy snapshot (`occupancy_by_trip`) — **obligatorio en v1**

`occupancy_by_trip` es **parte obligatoria** del digest v1 (no es opcional ni diferible a implementación).

| Regla | Valor |
|---|---|
| Inclusión | **Siempre** en el email v1 junto a KPIs y próximos viajes |
| Máximo | **10** filas |
| Semántica | Viajes `active\|completed` recientes, misma lógica que `getDashboard()` (`occupancy_by_trip`) |
| Campos | `trip_id` / label ruta, `departure`, `total`, `reserved`, `occupancy_pct` |
| Distinción vs upcoming | **Upcoming** = horizonte **48h**, `status=active`, máx 10. **Occupancy snapshot** = snapshot de viajes `active\|completed` recientes (como dashboard), máx 10 — horizontes distintos; ambos se incluyen |

**Contrato v1 de contenido (inequívoco):**

1. KPIs globales  
2. Próximos viajes 48h, máximo 10  
3. Occupancy snapshot (`occupancy_by_trip`), máximo 10 filas  

### Excluido

- `recent_activity`  
- `booker_name`, nombres/documentos/teléfonos de pasajeros  
- Desglose por agencia con PII  
- Conteos de otras plataformas / secrets  

### Clasificación de queries

| Tipo | Ejemplos |
|---|---|
| Reutilización directa | Conteos agencies/trips; pending boarding; seats occupancy |
| Adaptación | `today_reservations` → bounds Caracas; upcoming → 48h + limit 10 |
| Query nueva | Resolución de destinatarios `users` + prefs; emisión outbox plataforma |
| No tocar | Refactor general de `getDashboard` HTTP |

---

## 14. S7 — Empty digest

**Definición de “sin operación relevante”** (todas verdaderas):

- `active_trips = 0`  
- `today_reservations = 0`  
- `pending_boarding_passengers = 0`  
- `upcoming_trips.length = 0`  

**Comportamiento:**

1. El scheduler **sí puede** emitir el evento del día (idempotencia de hecho diario).  
2. El handler, tras cargar agregados, si “vacío” → **no envía** emails; outcome `completed` con reason p.ej. `skipped_empty` (nombre final en impl).  
3. No escribir `email_delivery_log` como `sent` para skips vacíos.  
4. No reintentar el mismo día solo por vacío (evento completed).

Si hay **algún** indicador de operación relevante (`active_trips`, `today_reservations`, `pending_boarding_passengers` o `upcoming_trips.length > 0`) → enviar a todos los elegibles (sujeto a prefs). `occupancy_by_trip` es contenido obligatorio del email cuando el digest se envía, pero no determina por sí solo si existe operación relevante.

---

## 15. S8 — In-app

v1 = **email only**. No NotificationFanout para `superadmin.digest.due`. Preferencia `in_app_enabled` queda false por default.

---

## 16. IN scope

- Scheduler en worker existente.  
- Flag `SUPERADMIN_DIGEST_VIA_WORKER` (default false) + poll/batch.  
- Evento `superadmin.digest.due.v1` + outbox.  
- Writer/RPC de emisión plataforma (nuevo; no `emit_agency_event`).  
- Handler + template email.  
- Agregados globales seguros (§13).  
- Tabla + seed preferencias `superadmin_digest`.  
- `email_delivery_log` con `email_type = 'superadmin_digest'`.  
- Idempotencia diaria + por destinatario.  
- Tests unitarios + boarding/static.  
- Harness SQL BEGIN/ROLLBACK si hay RPC.  
- Soak flag false → true en producción.

---

## 17. OUT of scope

- F4-001 Agency Daily Digest (no modificar salvo wiring mínimo en `runner` para el nuevo scheduler).  
- F4-003 Occupancy Alerts.  
- Viajes “sin acción”.  
- Métricas nocturnas persistidas / Fase 6 analytics.  
- SMS / push.  
- Segundo worker / pg_cron.  
- Timers `LockCleanup` / `completeExpiredTrips`.  
- Retention `boarding_attempts`.  
- Audit trail (Fase 5).  
- `agency.created` / `user.invited` adoption.  
- `reservation.cancelled` → email.  
- Refactor general del dashboard HTTP.  
- `recent_activity` / PII.  
- In-app digest obligatorio.  
- Hardcoded single admin email.

---

## 18. Existing infrastructure reused

| Pieza | Uso |
|---|---|
| `runner.ts` + AbortController | Wire scheduler |
| Outbox relay / retries / `failed` | Entrega |
| `dedup_key` unique | Un evento por día |
| `email_delivery_log` | Un envío por (event, user, type) |
| Timezone helpers | Hora 07 + `digest_date` Caracas |
| Logger / heartbeat / healthz / Sentry | Observabilidad |
| Patrón F4-001 digest scheduler/handler | Copia estructural, flags/eventos distintos |
| Agregados tipo `getDashboard` | Contenido (sin activity) |

---

## 19. Architecture options

### A — Scheduler → email directo + ledger

Rechazada: mismo argumento que F4-001 (ledger ligado a `event_id` de outbox; sin retries unificados).

### C — Scheduler → outbox → handler → email + ledger (**seleccionada**)

```text
superadmin-digest-scheduler
  → (flag on + hora 07 Caracas) schedule_superadmin_digest(digest_date)
  → outbox: superadmin.digest.due.v1 (1 fila / día)
  → relay → handler
  → resolve superadmins elegibles + prefs
  → si vacío → skip send
  → else claim/send/sent por user via email_delivery_log
```

---

## 20. Selected architecture — event contract

| Campo | Valor |
|---|---|
| `event_type` | `superadmin.digest.due` |
| `event_version` | `1` |
| `aggregate_type` | `platform` |
| `aggregate_id` | UUID **determinístico** por `digest_date`. **R1 (final):** RFC 4122 **UUIDv5 / SHA-1** via `node:crypto` en TypeScript (`backend/src/utils/deterministic-uuid.ts`), namespace constante `nomadas-platform`. **No MD5.** **No** extensión PostgreSQL (`uuid-ossp`). **No** calcular el UUID en SQL. Motivo: `aggregate_id` es UUID NOT NULL; no puede ser el string de fecha. |
| `tenant_id` | `NULL` (hecho de plataforma, no tenant agencia) |
| `payload` | `{ digest_date: string }` (`YYYY-MM-DD` Caracas) — **sin** emails ni nombres |
| PII en payload | Ninguna |
| `dedup_key` | `superadmin.digest.due:{digest_date}` |
| Emisión | INSERT … ON CONFLICT DO NOTHING (espíritu `emit_*`) |

**Un evento / múltiples destinatarios:**

- Emisión: **una** fila outbox por día calendario Caracas.  
- Handler: lista superadmins elegibles; para cada uno respeta prefs; claim ledger con `recipient_id = user.id`, `email_type = 'superadmin_digest'`.  
- Retry: destinatarios ya `sent` → `already_logged` skip; fallidos reintentan sin reenviar a los OK.  
- Fallo parcial → outcome `failed` retryable del evento (mismo patrón reminder/F4-001); **no** duplica a quien ya tiene `sent`.

**No** usar `emit_agency_event`. Crear p.ej. `emit_platform_event` / `schedule_superadmin_digest` con `SECURITY DEFINER`, `SET search_path = public`, EXECUTE solo `service_role`.

---

## 21. Tenancy / security

| Control | Regla |
|---|---|
| Naturaleza del digest | **Global** — correcto solo para SUPERADMIN |
| Destinatarios | Únicamente `users.role = 'superadmin'` |
| Prohibido | Enviar a `agency` o `agencies.email` |
| Worker | `service_role` (BYPASSRLS) — filtros explícitos de rol |
| RPC | DEFINER + search_path + REVOKE PUBLIC/anon/authenticated + GRANT service_role |
| Contenido | Sin PII; sin activity timeline |
| Separación F4-001 | Prefs/tablas/eventos/flags distintos; no acoplar a `ops_digest` de agencia |

Violación “email a agency” = defecto de implementación (tests de contrato).

---

## 22. Idempotency model

| Capa | Mecanismo |
|---|---|
| 1 Emisión | `dedup_key = superadmin.digest.due:{digest_date}` |
| 2 Envío | PK ledger `(event_id, recipient_id=user_id, email_type='superadmin_digest')` |
| 3 Scheduler | Errores logueados; no tumba relay; flag/ventana skip |
| Multi-instancia | dedup + SKIP LOCKED en RPC si aplica |
| Multi-destinatario | claim por usuario; retry no reenvía a `sent` |

---

## 23. Feature flag

| Variable | Default | Rol |
|---|---|---|
| `SUPERADMIN_DIGEST_VIA_WORKER` | **`false`** | Kill switch / soak |
| `SUPERADMIN_DIGEST_POLL_MS` | `3600000` | Cadencia |
| `SUPERADMIN_DIGEST_BATCH` | `50` | Límite técnico de procesamiento por lote, si el handler pagina destinatarios. |

**Tick:**

- flag false → `skipped_effect_disabled`  
- flag true, hora ≠ 7 → `skipped_outside_window`  
- flag true, hora = 7 → emitir/procesar  

Rollback: flag `false` en Render.

---

## 24. Observability

Eventos de log (patrón F4-001 / WKR):

- `superadmin_digest_scheduler_started`  
- `superadmin_digest_scheduler_tick` (`status`, `emitted`/`scanned` si aplica, `digest_date`, `duration_ms`)  
- `superadmin_digest_scheduler_error`  
- `superadmin_digest_scheduler_stopped`  

Handler: logs de skip (prefs / vacío / no email), sent, error — sin PII.  
Sentry: solo errores inesperados.  
Healthz / heartbeat: sin cambio de contrato.

---

## 25. Failure / retry

| Caso | Comportamiento |
|---|---|
| Flag off / fuera de ventana | Skip tick |
| 0 superadmins / todos prefs off | Completed skip |
| Digest vacío (S7) | Completed `skipped_empty` |
| Resend fail un user | Release claim de ese user; evento failed retryable; otros ya sent no se tocan |
| Max attempts | Outbox `failed` (DLQ lógica 006.3) |
| Error scheduler | Log; loop continúa |

---

## 26. Testing strategy

- Unit: scheduler flag/ventana; handler prefs / vacío / multi-user ledger; evento parse + no PII.  
- Env defaults parse.  
- Boarding: migración (prefs + RPC), event contract, runner wiring, flag default false, no pg_cron, no uso de `emit_agency_event` para este tipo.  
- Harness SQL: BEGIN/ROLLBACK — elegibilidad solo superadmin, dedup diario, grants DEFINER, prefs opt-out.  
- Regresión F4-001 / WKR-008 / WKR-009 boarding.  

---

## 27. Production rollout

1. Tests locales verdes.  
2. Aplicar migración(es) en prod (usuario).  
3. Deploy worker con flag **false**.  
4. Verificar ticks `skipped_effect_disabled`.  
5. Harness SQL si RPC.  
6. Flag **true** en ventana controlada.  
7. Verificar emisión + `email_delivery_log` sin PII.  
8. Cierre documental (TASKS/ROADMAP/HISTORY) — **fase posterior**, no este design.

**Nota:** F4-001 puede seguir en soak; F4-002 design no lo cierra. Preferible no cutover de ambos flags el mismo día sin soak estable de F4-001.

---

## 28. Definition of Done

- [ ] Este design vigente (scope-lock).  
- [ ] Migración: prefs superadmin + writer/RPC schedule (si aplica) + grants.  
- [ ] Scheduler en worker; flag default `false`.  
- [ ] Evento `superadmin.digest.due.v1` + handler email.  
- [ ] Template sin PII / sin activity.  
- [ ] Solo destinatarios `role=superadmin`.  
- [ ] Idempotencia `dedup_key` + ledger por user.  
- [ ] S7 vacío → skip send.  
- [ ] Unit + boarding (+ harness si RPC).  
- [ ] `tsc` + build verdes.  
- [ ] Soak false → true en producción; logs verificados.  
- [ ] Cierre documental posterior.  
- [ ] OUT respetado (F4-001/003 y lista §17).

---

## 29. Follow-ups

| Ticket | Tema |
|---|---|
| **F4-003** | Occupancy Alerts |
| Futuro | UI para gestionar preferencias `superadmin_digest` (v1 implementa únicamente seed + gate de envío). |
| Futuro | In-app digest superadmin |
| Fuera | Agency digest cambios; trips-without-action; nightly metrics; timers; boarding_attempts; audit trail |

---

## 30. Scope Guard

F4-002 **NO** incluye Agency Daily Digest, Occupancy Alerts, PII/activity, segundo worker, pg_cron, ni reutilizar `emit_agency_event` / `agency_notification_preferences` / `ops_digest` de agencia.

---

## Open items for implementation (no bloquean scope-lock)

1. Nombre exacto del tip de migración (`062_…`).  
2. **R1 resuelto:** `aggregate_id` = UUIDv5 / SHA-1 / `node:crypto` / namespace `nomadas-platform` / solo TypeScript. No MD5. No `uuid-ossp`. No duplicar en SQL.  
3. Naming final del reason `skipped_empty` en `HandlerOutcome` (extender unión si hace falta).  

Estos son detalles de implementación, no decisiones de producto abiertas.
