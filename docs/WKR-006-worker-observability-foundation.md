# WKR-006 — Worker Observability Foundation

**Tipo:** Auditoría + diseño (sin implementación de runtime)  
**Fecha:** 2026-08-05  
**Estado:** Foundation documentada  
**Referencias:** [WKR-005](WKR-005-email-worker-implementation.md), [WKR-005.1](WKR-005.1-email-worker-readiness-audit.md), [WKR-004](WKR-004-outbox-foundation-implementation.md), [WKR-002](WKR-002-events-workers-architecture-adr.md), [ROADMAP](ROADMAP.md)

---

## Objetivo

Crear la base de observabilidad para procesos asíncronos **antes** de agregar más workers.

Este ticket **no**:

- Instala Sentry
- Cambia el proveedor de email (Resend)
- Agrega nuevos handlers / event types
- Implementa retención, DLQ table, ni métricas exportadas

Este ticket **sí**:

- Audita relay + workers actuales
- Define logs estructurados, métricas, health y correlación
- Documenta integración futura con Sentry
- Deja un plan de implementación concreto (WKR-006.1+)

---

## 1. Estado actual (auditoría)

### 1.1 Procesos

| Proceso | Entrada | Observabilidad hoy |
|---------|---------|-------------------|
| `nomadas-api` (Express) | HTTP | `GET /health` → `{ status, timestamp }`; sin correlation ID; errores vía `errorHandler` |
| `nomadas-worker` (`npm run worker` → `runner.ts`) | Loop outbox | Logs JSON ad hoc a stdout; sin health HTTP; sin métricas; sin Sentry |

El worker **no** comparte lifecycle con Express. No hay puerto de health en el proceso worker.

### 1.2 Flujo instrumentable

```text
API createAgencyReservation
  → RPC INSERT reservations
  → trigger → outbox_events (pending)     [event_id = outbox.id]
  → (opcional) UPDATE flags email

Worker runner
  → claim_outbox_events (SKIP LOCKED)     [status=processing, attempts++]
  → resolveHandler(type, version)
  → ReservationCreatedHandler
  → mark completed | requeue | failed
```

### 1.3 Qué ya existe (útil para observabilidad)

| Capacidad | Dónde | Notas |
|-----------|-------|-------|
| Identidad de evento | `outbox_events.id` | UUID; usable como `event_id` |
| Aggregate | `aggregate_type`, `aggregate_id` | Reservation: type=`reservation`, id=reservation UUID |
| Tenant | `tenant_id` (+ payload `agency_id`) | Ownership comercial (ADR-001) |
| Status machine | `pending` / `processing` / `completed` / `failed` | Fuente de verdad para contadores SQL |
| Attempts | `attempts` | Incrementa en claim; base para retries |
| Error text | `error_message` (max 2000) | Persiste en requeue/fail |
| Timestamps | `created_at`, `available_at`, `processed_at`, `updated_at` | Duración end-to-end aproximable |
| Logs JSON mínimos | `runner.ts` + `relay.ts` | `console.log(JSON.stringify({ event, ...meta }))` |
| Signal shutdown | SIGINT / SIGTERM → AbortController | Log `worker_shutdown` / `worker_stopped` |

### 1.4 Superficie de código auditada

| Archivo | Rol | Logs / métricas |
|---------|-----|-----------------|
| `backend/src/workers/runner.ts` | Boot + wire deps + loop | `worker_boot`, `worker_shutdown`, `worker_stopped`, `worker_fatal`; pasa `log` al relay |
| `backend/src/workers/outbox/relay.ts` | Claim batch + process | `outbox_relay_started`, `outbox_completed`, `outbox_failed_*`, `outbox_requeued*`, `outbox_no_handler`, `outbox_relay_loop_error` |
| `backend/src/workers/outbox/claim.ts` | RPC + UPDATE status | Sin logs; errores → throw |
| `backend/src/workers/handlers/reservation-created.handler.ts` | Email strategy B | **Sin logs propios**; outcomes vía relay |
| `backend/src/workers/handlers/index.ts` | DI handler + Resend | Sin logs |
| `backend/src/workers/config.ts` | Env runtime | Sin logs |
| `supabase/migrations/049_*` / `050_*` | Schema + claim | Sin heartbeat / retention |

### 1.5 Forma actual de los logs del relay

Campos típicos hoy:

```json
{ "event": "outbox_completed", "id": "<outbox uuid>", "reason": "sent" }
{ "event": "outbox_requeued", "id": "...", "reason": "flags_not_settled", "availableAt": "..." }
{ "event": "outbox_failed_max_attempts", "id": "...", "attempts": 10 }
```

**Faltan** en casi todos los eventos: `aggregate_id`, `tenant_id` / `agency_id`, `handler`, `event_type`, `event_version`, `attempts`, duración, `worker_name`, correlation / request id.

El handler de email no emite eventos de log intermedios (`flags_loaded`, `email_send_start`, `email_send_ok`).

---

## 2. Gaps encontrados

| # | Gap | Impacto | Severidad |
|---|-----|---------|-----------|
| G1 | Logs sin campos de correlación estándar | Imposible trazar request → outbox → worker en prod | Alta |
| G2 | Sin medición de duración por evento | No hay p95/latencia de email async | Alta |
| G3 | Sin métricas agregadas (counters/gauges) | Solo se puede inferir con queries SQL ad hoc | Alta |
| G4 | Sin heartbeat del worker | No se distingue “idle sano” de “proceso muerto” | Alta |
| G5 | Worker sin health check | Orquestadores (Docker/Fly/systemd) no tienen probe nativo | Media |
| G6 | `processing` huérfano si el proceso muere mid-handler | Claim no recupera `processing` stuck; fila queda atrapada | Alta (ops) |
| G7 | Sin exportación de backlog (`pending` ready) | Cola creciendo silenciosa | Media |
| G8 | Handler sin logs de etapa | Difícil diagnosticar settle race vs Resend vs NotFound | Media |
| G9 | API sin correlation ID hacia outbox | El trigger no recibe request id; puente HTTP→evento no existe | Media |
| G10 | Sin Sentry (API / worker / frontend) | Excepciones no agrupadas ni alertadas | Media (planificada) |
| G11 | Sin retención de `completed` | Tabla crece sin bound | Baja (ops; ticket posterior) |
| G12 | DLQ = filas `failed` en la misma tabla | Diagnosticable por SQL, sin UX ni requeue controlado | Baja (aceptable corto plazo) |
| G13 | `log` tipado débil (`message` + meta libre) | Riesgo de esquemas inconsistentes entre handlers futuros | Media |

**Necesidad de cambio de código en este ticket:** ninguna. Los gaps se resuelven en **WKR-006.1+** según la propuesta abajo.  
**Excepción documentada (ops):** G6 (stuck `processing`) debe abordarse en hardening cercano; ver §5 decisiones y §6 siguiente paso — no se implementa aquí.

---

## 3. Propuesta técnica

### 3.1 Principios

1. **Stdout JSON estructurado** como transporte primario (compatible con hosts que scrapean logs).
2. **`outbox_events` como source of truth** para backlog y fallos persistidos; métricas in-process son derivadas / tiempo real.
3. **Correlación estable** desde el claim: siempre incluir `event_id` (= `outbox_events.id`).
4. **Sin PII en logs** (alineado con payload outbox): no email, documento, teléfono, QR, nombre de pasajero.
5. **Sentry es capa posterior** (excepciones + performance); no sustituye logs ni métricas de cola.
6. **SEC-009 (Strix/SAST) es otro ticket** — no mezclar.

### 3.2 Estrategia de correlación

#### Campos obligatorios en todo log de procesamiento de evento

| Campo | Fuente | Ejemplo |
|-------|--------|---------|
| `event_id` | `outbox_events.id` | UUID |
| `aggregate_type` | columna | `reservation` |
| `aggregate_id` | columna | UUID reserva |
| `agency_id` | `tenant_id` o payload | UUID agencia dueña |
| `handler` | clave registry | `reservation.created:1` |
| `event_type` | columna | `reservation.created` |
| `event_version` | columna | `1` |
| `worker_name` | const env | `nomadas-outbox-relay` |
| `attempts` | columna post-claim | `1…N` |
| `outcome` | resultado handler | `completed` / `requeue` / `failed` |
| `reason` | outcome.reason | `sent`, `flags_not_settled`, … |

#### Campos opcionales / fase 2

| Campo | Cuándo | Notas |
|-------|--------|-------|
| `correlation_id` | Si la API lo propaga | Hoy el trigger no lo tiene; ver decisión D1 |
| `trip_id` | Desde payload (no PII) | Útil para soporte ops |
| `duration_ms` | Fin de `processClaimedEvent` | Wall clock handler+marks |
| `batch_size` / `claimed` | Loop | Throughput por tick |

#### Esquema de log propuesto

```ts
type WorkerLogEvent = {
  ts: string;                 // ISO
  level: 'info' | 'warn' | 'error';
  event: string;              // ej. outbox_completed
  worker_name: string;
  // correlation (cuando aplica a un row)
  event_id?: string;
  aggregate_type?: string;
  aggregate_id?: string;
  agency_id?: string | null;
  handler?: string;
  event_type?: string;
  event_version?: number;
  attempts?: number;
  outcome?: 'completed' | 'requeue' | 'failed';
  reason?: string;
  duration_ms?: number;
  // contexto proceso
  signal?: string;
  error?: string;             // mensaje corto, sin stack en info
};
```

#### Helper propuesto (implementación futura)

```text
backend/src/workers/observability/
  logger.ts      # logStructured(event, fields)
  metrics.ts     # counters/gauges in-memory + snapshot
  health.ts      # lastHeartbeatAt + getHealthSnapshot()
  context.ts     # correlationFieldsFromRow(row) → meta
```

No se crea en este ticket.

### 3.3 Puntos de log estructurado (dónde instrumentar)

| Momento | `event` sugerido | Nivel | Campos clave |
|---------|------------------|-------|--------------|
| Boot | `worker_boot` | info | config (poll, batch, maxAttempts, emailViaOutbox) — ya existe, enriquecer |
| Loop start | `outbox_relay_started` | info | ya existe |
| Claim vacío | `outbox_claim_empty` (opcional, sampled) | info | evitar spam; o solo métrica |
| Claim N>0 | `outbox_claimed` | info | `claimed`, `event_type` filter |
| Inicio proceso | `outbox_process_start` | info | correlación completa |
| Handler outcome | `outbox_completed` / `outbox_requeued` / `outbox_failed_*` | info/warn/error | + `duration_ms` + correlación |
| Loop error (claim/DB) | `outbox_relay_loop_error` | error | `error` |
| Heartbeat tick | `worker_heartbeat` | info | cada N segundos o cada poll con gauge |
| Shutdown | `worker_shutdown` / `worker_stopped` | info | ya existe |
| Fatal | `worker_fatal` | error | ya existe |
| Handler email (opcional) | `email_send_start` / `email_send_result` | info | `event_id`, `aggregate_id`, `result` — **sin** address |

### 3.4 Métricas necesarias

#### Gauges / snapshots (SQL o in-process + SQL)

| Métrica | Definición | Fuente preferida |
|---------|------------|------------------|
| `outbox_pending_ready` | `status=pending AND available_at <= now()` | SQL periódico |
| `outbox_pending_delayed` | `status=pending AND available_at > now()` | SQL |
| `outbox_processing` | `status=processing` | SQL (alerta si >0 por mucho tiempo → G6) |
| `outbox_failed_total` | `status=failed` (gauge stock) | SQL |
| `worker_last_heartbeat_age_seconds` | ahora − último heartbeat | In-process / archivo / tabla |

#### Counters (in-process desde boot; reset al restart — aceptable v1)

| Métrica | Cuándo incrementar |
|---------|-------------------|
| `outbox_events_processed_total` | outcome `completed` |
| `outbox_events_failed_total` | mark failed (permanent o max attempts) |
| `outbox_events_requeued_total` | mark requeue (incluye settle + error) |
| `outbox_retries_total` | cada requeue donde `attempts > 1` o reason ≠ settle* |
| `outbox_claim_batches_total` | cada `runOutboxRelayOnce` |
| `outbox_claim_empty_total` | claimed.length === 0 |

#### Histogramas / timers

| Métrica | Definición |
|---------|------------|
| `outbox_processing_duration_ms` | Desde entrada a `processClaimedEvent` hasta mark final |
| `outbox_e2e_latency_ms` (opcional) | `processed_at - created_at` en completed |

#### Heartbeat

- Actualizar `lastHeartbeatAt` al **inicio de cada iteración del loop** (aunque claimed=0).
- Emitir log `worker_heartbeat` cada `max(pollMs, 30_000)` con snapshot de counters.
- Persistencia v1: **solo memoria + log** (suficiente si el host scrapea logs).
- Persistencia v1.1 (decisión D3): fila `worker_heartbeats` o UPDATE singleton — solo si el health debe vivir fuera del proceso.

### 3.5 Health check del worker

El API ya tiene `GET /health`. El worker es otro proceso: **no reutilizar el puerto HTTP de la API** sin diseño explícito.

#### Opción A — Health por señales (recomendada v1)

Sin abrir puerto:

1. Heartbeat log periódico + age gauge.
2. Script/orquestador: “proceso vivo” (PID) + “último `worker_heartbeat` en logs < 2× intervalo”.
3. Alerta SQL: `outbox_processing` antiguo o `pending_ready` creciendo.

#### Opción B — HTTP sidecar mínimo en el worker (v1.1)

```text
GET /healthz → 200 {
  status: "ok" | "degraded",
  worker_name,
  last_heartbeat_at,
  email_via_outbox,
  metrics_snapshot: { processed, failed, requeued, pending_ready? }
}
```

- Puerto separado (`WORKER_HEALTH_PORT`), default off.
- `degraded` si: último heartbeat stale, o errores de claim consecutivos, o `processing` stuck detectado.
- No autenticación en localhost; en red pública → no exponer o proteger.

#### Criterios de healthy / unhealthy

| Condición | Estado |
|-----------|--------|
| Loop corriendo + heartbeat reciente | `ok` |
| Abort/shutdown en curso | `stopping` (no unhealthy) |
| N errores consecutivos de claim/DB | `degraded` |
| Proceso caído (sin heartbeat) | unhealthy (detectado por orquestador) |

### 3.6 Integración futura con Sentry (no instalar ahora)

#### Alcance cuando se implemente

| Superficie | SDK | Contexto tags/extras |
|------------|-----|----------------------|
| Backend API | `@sentry/node` | `request_id`, user role, `agency_id` si auth |
| Worker | `@sentry/node` (mismo DSN o project `workers`) | `event_id`, `worker_name`, `aggregate_id`, `agency_id`, `handler` |
| Frontend Next.js | `@sentry/nextjs` | session, route; **sin** PII de pasajeros |

#### Reglas

- Capturar excepciones no manejadas + `worker_fatal` / fallos permanentes interesantes.
- **No** crear evento Sentry por cada `flags_not_settled` (ruido).
- Usar `beforeSend` para scrub PII.
- Performance: transaction opcional `outbox.process` con span email.
- Feature flag / env: `SENTRY_DSN` vacío = no-op.
- Ticket de implementación: **WKR-006.2** (después de logs+métricas locales).

#### Separación

| | WKR-006 series | SEC-009 |
|--|----------------|---------|
| Herramienta típica | Sentry, logs, métricas | Strix / CodeQL / Dependabot / SAST |
| Pregunta | ¿Qué falló en prod y con qué latencia? | ¿Qué vulnerabilidad o regresión de seguridad hay? |

### 3.7 Retención y DLQ (fuera de implementación inmediata)

Documentado para no perder el hilo del ROADMAP; **no** parte del código de WKR-006.1 mínimo:

| Tema | Propuesta | Ticket |
|------|-----------|--------|
| Retención `completed` | Job periódico DELETE/archive `processed_at < now() - N days` (N=14–30) | WKR-006.3 o hardening |
| `failed` como DLQ | Query + runbook requeue (`status=pending`, `available_at=now()`, reset attempts opcional) | WKR-006.3 |
| Stuck `processing` | Reaper: si `updated_at < now() - stale_ms` → `pending` + reason | **Prioritario en WKR-006.1** (G6) |

### 3.8 Diagrama objetivo (post WKR-006.1)

```text
                    ┌─────────────────────┐
  HTTP request ────►│ API (+ future cid)  │
                    └─────────┬───────────┘
                              │ same TX
                              ▼
                    ┌─────────────────────┐
                    │ outbox_events       │◄── SQL gauges (pending/failed)
                    └─────────┬───────────┘
                              │ claim
                              ▼
┌──────────────────────────────────────────────────────────┐
│ nomadas-worker                                           │
│  logger(JSON) ──► stdout                                 │
│  metrics ──► heartbeat log / (opt) /healthz              │
│  handler ──► outcome ──► mark + duration_ms              │
│  (later) Sentry.captureException + setContext(...)       │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Decisiones pendientes

| ID | Decisión | Opciones | Recomendación |
|----|----------|----------|---------------|
| D1 | ¿Propagar `correlation_id` desde API al outbox? | (a) Columna nueva / payload; requiere cambiar trigger/emisión (b) Diferir: correlacionar solo por `aggregate_id` + ventana temporal | **(b)** para WKR-006.1; (a) cuando haya más eventos |
| D2 | Health del worker | (A) solo logs/heartbeat (B) HTTP `/healthz` | **(A)** primero; (B) si el deploy lo exige |
| D3 | ¿Persistir heartbeat en DB? | Memoria+logs vs tabla | Memoria+logs en v1 |
| D4 | Backend de métricas | Counters in-memory vs Prometheus exporter vs solo SQL | In-memory + SQL gauges en v1; Prometheus en Fase 8 |
| D5 | Proyecto Sentry | Uno vs separado API/worker/frontend | Un org, projects separados o environments `api`/`worker`/`web` |
| D6 | Stuck `processing` reaper | Incluir en 006.1 vs ticket aparte | **Incluir en 006.1** (riesgo ops real) |
| D7 | Sampleo de `outbox_claim_empty` | Log cada vacío vs solo métrica | Solo métrica + heartbeat |

Ninguna de estas decisiones bloquea cerrar este documento de foundation.

---

## 5. Plan de implementación sugerido (tickets siguientes)

### WKR-006.1 — Structured logs + metrics + heartbeat (+ stuck reaper)

1. Módulo `workers/observability/*` (logger, metrics, context).
2. Enriquecer `processClaimedEvent` con correlación + `duration_ms`.
3. Heartbeat en el loop; log periódico con snapshot.
4. Queries/helpers documentados para gauges SQL (script o función read-only service_role).
5. Reaper de `processing` stale (migración o UPDATE en loop con cuidado SKIP LOCKED).
6. Tests unitarios del logger/metrics y del enriquecimiento de meta.
7. **Sin** Sentry SDK. **Sin** nuevos event types.

### WKR-006.2 — Sentry wiring

1. DSN por env; init en API + worker (+ frontend si aplica en el mismo sprint).
2. Tags: `event_id`, `worker_name`, `aggregate_id`, `agency_id`, `handler`.
3. Filtros de ruido (settle requeues).
4. Verificar scrub PII.

### WKR-006.3 — Retention + DLQ runbook

1. Política de borrado/archive `completed`.
2. Runbook SQL para inspeccionar/reencolar `failed`.
3. (Opcional) endpoint admin interno — solo si hay necesidad ops clara.

---

## 6. Siguiente paso recomendado

**WKR-006.1 implementado** — ver [`WKR-006.1-worker-observability-implementation.md`](WKR-006.1-worker-observability-implementation.md).

**Siguiente:** **WKR-006.2** (Sentry wiring) con los tags de correlación ya presentes en logs.

---

## 7. Restricciones cumplidas

| Restricción | Estado |
|-------------|--------|
| No instalar Sentry | ✅ |
| No cambiar email provider | ✅ |
| No agregar nuevos workers/handlers | ✅ |
| Solo docs en este ticket | ✅ (sin cambios de código) |
| Separar de SEC-009 | ✅ |

---

## 8. Checklist de cierre WKR-006 (foundation)

- [x] Auditoría runner / relay / handler / claim / schema
- [x] Gaps listados (G1–G13)
- [x] Métricas definidas (pending, processed, failed, retries, duration, heartbeat)
- [x] Health check diseñado (opción A/B)
- [x] Correlación definida (`event_id`, aggregate, agency, handler)
- [x] Sentry futuro documentado (sin instalar)
- [x] ROADMAP / TASKS / architecture actualizados
- [x] Siguiente paso: WKR-006.1
