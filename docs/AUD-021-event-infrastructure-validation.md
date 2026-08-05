# AUD-021 — Event Infrastructure Validation Audit

**Tipo:** Auditoría + documentación (sin implementación)

**Fecha:** 2026-08-05

**Estado:** PASS WITH OBSERVATIONS

**Alcance:** Infraestructura de eventos y workers implementada entre WKR-001 y WKR-006.3

**Resultado general:** `PASS WITH OBSERVATIONS`

**Referencias:** [WKR-001](WKR-001-event-inventory-audit.md), [WKR-002](WKR-002-events-workers-architecture-adr.md), [WKR-003](WKR-003-transactional-outbox-foundation-design.md), [WKR-003.1](WKR-003.1-outbox-readiness-audit.md), [WKR-003.2](WKR-003.2-domain-event-boundaries.md), [WKR-004](WKR-004-outbox-foundation-implementation.md), [WKR-005](WKR-005-email-worker-implementation.md), [WKR-006](WKR-006-worker-observability-foundation.md), [WKR-006.1](WKR-006.1-worker-observability-implementation.md), [WKR-006.2](WKR-006.2-sentry-foundation-implementation.md), [WKR-006.3](WKR-006.3-outbox-retention-dlq-runbook.md), [ROADMAP](ROADMAP.md)

---

## 1. Resumen ejecutivo

### Objetivo

Determinar si la arquitectura actual **Outbox + Relay + Workers + Observabilidad** está preparada para comenzar la expansión hacia nuevos eventos de dominio (`trip.*`, `boarding.*`, `agency.*`, `user.*`).

### Alcance

Se auditaron las piezas implementadas entre WKR-001 y WKR-006.3:

- Tabla `outbox_events` y funciones RPC (migraciones 049-051).
- Módulo `backend/src/events/` (contrato `EventEnvelope`, evento `reservation.created.v1`).
- Módulo `backend/src/workers/` (runner, relay, claim, retry, stuck, handlers).
- Módulo `backend/src/observability/` (logger, metrics, heartbeat, Sentry).
- Documentos de diseño WKR-001 a WKR-006.3.

### Resultado general

**PASS WITH OBSERVATIONS**

La infraestructura auditada:

- **Outbox funciona** — publicación transaccional correcta, claim atómico con SKIP LOCKED.
- **Relay funciona** — ciclo de poll, procesamiento por batch, retry exponencial, shutdown graceful.
- **Email Worker funciona** — idempotencia vía `ticket_email_sent_at`, ventana de settle, estrategia de requeue.
- **Observabilidad existe** — logs con correlación, métricas, heartbeat, Sentry opcional con scrub de PII.
- **La base está lista para nuevos consumidores** — los hallazgos son de evolución, no de funcionalidad rota.

---

## 2. Arquitectura actual

### Flujo end-to-end

```
Domain action
     ↓
Database transaction
     ↓
outbox_events
     ↓
Outbox Relay
     ↓
Handler
     ↓
External effect
     ↓
Logs / Metrics / Sentry
```

### Decisiones fundamentales

- **PostgreSQL como backbone** — el outbox vive dentro de la misma base de datos que el dominio; no existe infraestructura adicional entre la publicación y el consumo.
- **Sin broker externo** — no hay Kafka, RabbitMQ ni BullMQ. El polling del relay sustituye el broker.
- **Sin Event Sourcing** — los eventos son proyecciones de hechos, no la fuente de verdad del estado.
- **DLQ lógica** — los eventos que agotan reintentos quedan en `status = failed` dentro de la misma tabla; no existe una tabla DLQ física.

### Composición de la cadena

| Capa | Implementación |
|------|----------------|
| Publicación | Trigger `AFTER INSERT` en `reservations` → `outbox_events` |
| Claim | `claim_outbox_events()` con `FOR UPDATE SKIP LOCKED` |
| Relay | `runOutboxRelayLoop` en `workers/outbox/relay.ts` |
| Dispatch | Mapa `(event_type:event_version) → handler` |
| Handler | `createReservationCreatedHandler` (envío de email vía Resend) |
| Recuperación | `recover_stuck_outbox_events()` + `recovery-scheduler.ts` |
| Observabilidad | `logger.ts`, `metrics.ts`, `heartbeat.ts`, `sentry.ts` |

---

## 3. Auditoría del Outbox

### Tabla outbox_events (migración 049)

**Estructura validada**

| Columna | Tipo | Nota |
|---------|------|------|
| id | uuid | PK, default gen_random_uuid() |
| event_type | text | Ej: `reservation.created` |
| event_version | int | CHECK `>= 1` |
| aggregate_type | text | Ej: `reservation` |
| aggregate_id | text | UUID del agregado |
| tenant_id | uuid | `agency_id` de la reserva |
| payload | jsonb | CHECK `jsonb_typeof = 'object'` |
| status | text | CHECK ∈ (`pending`, `processing`, `completed`, `failed`) |
| attempts | int | CHECK `>= 0` |
| available_at | timestamptz | Ventana de disponibilidad para claim |
| processed_at | timestamptz | Nullable |
| error_message | text | Nullable |
| created_at / updated_at | timestamptz | Trazabilidad |

**Estados validados:** `pending → processing → completed | failed`, con `pending ⇄ processing` por requeue y recuperación.

**Índices validados:** índice en `(status, available_at, id)` para polling eficiente; índice en `(aggregate_type, aggregate_id)` para trazabilidad por agregado.

**Seguridad validada**

- RLS habilitada con política `service_role` únicamente.
- Sin acceso cliente (ni anónimo ni autenticado de pasajeros).
- **Sin Realtime** — la tabla no está expuesta en `supabase_realtime`.

### Payload

- **Mínimo necesario** — `reservation.created.v1` transporta solo `reservation_id`, `trip_id`, `agency_id`.
- **Sin PII** — sin documentos, teléfonos, emails, QR ni nombres; además el guard `assertNoPiiInReservationCreatedPayload` bloquea esas keys en tiempo de construcción.
- **Versionado** — `event_type` + `event_version`; el envelope incluye `type` y `version` explícitos.

---

## 4. Auditoría de eventos

### Evento implementado

**`reservation.created.v1`**

- `event_type = 'reservation.created'`, `event_version = 1`, `aggregate = 'reservation'`.
- Payload mínimo sin PII, con guard de bloqueo y test unitario (`reservation-created.v1.test.ts`).
- Publicado por trigger transaccional; consumido por el email worker.

### Eventos futuros definidos (WKR-003.2)

| Familia | Estado | Observación |
|---------|--------|-------------|
| `trip.*` | Definido | Espera WKR-007 (Trip Events) |
| `boarding.*` | Definido | Requerirá `operator_agency_id` (ADR-001) |
| `agency.*` | Definido | Backlog |
| `user.*` | Definido | Backlog |

### Validación de contrato

- **Naming** — consistente: `{dominio}.{accion}` en minúsculas, separado por puntos.
- **Versionado** — semántico por `event_version`; nuevos campos implican nueva versión, nunca mutación de versión existente.
- **Bounded context** — cada familia pertenece a un solo context; sin acoplamiento entre contexts.
- **Ownership** — el context propietario publica, los contextos consumidores reaccionan; los eventos no contienen lógica.

---

## 5. Auditoría del Relay

### Mecánica validada

- **Claim atómico** — `claim_outbox_events()` transiciona `pending → processing` y hace `attempts + 1` dentro de la misma transacción.
- **SKIP LOCKED** — `FOR UPDATE SKIP LOCKED` permite múltiples instancias del worker sin pisotear eventos.
- **Batch processing** — `OUTBOX_BATCH_SIZE=10`; procesamiento secuencial dentro del batch.
- **Retry** — exponencial con cap: `min(base * 2^(attempts-1), 5min)`; `OUTBOX_MAX_ATTEMPTS=10`.
- **Shutdown graceful** — AbortController + `sleep` con `AbortSignal`; drena el ciclo sin perder estado.
- **Guard de propiedad** — `markCompleted`/`markFailed`/`markRequeue` filtran `.eq('status','processing')`.

### Hallazgo

## H1 — Dispatcher limitado a reservation.created

**Severidad:** ALTO

**Ubicación:** `backend/src/workers/outbox/relay.ts` (claim de `runOutboxRelayOnce`)

**Aclaración obligatoria:** No es un fallo actual. El comportamiento es correcto porque solo existe un consumidor implementado. Es una limitación de evolución antes de introducir nuevos dominios: cualquier evento futuro (`trip.*`, `boarding.*`, etc.) no será reclamado por el relay actual.

**Ticket sugerido:** `WKR-007.1 — Multi-event dispatcher foundation`

---

## 6. Auditoría del Email Worker

### Validación

- **Consumo** — el handler procesa `reservation.created.v1` (Estrategia B de WKR-005.1).
- **Proveedor** — Resend vía `emailService.sendReservationConfirmationEmail`.
- **Idempotencia** — flag `ticket_email_sent_at`; `markTicketEmailSent` actualiza solo cuando el flag es `null` (guard atómico).
- **Settle window** — `OUTBOX_SETTLE_MS=5000`: si el evento llega antes de que la transacción del servicio actualice los flags, el handler hace `requeue` (`flags_not_settled`, `contact_email_pending`).
- **Retries** — requeue con delay; agotados → `failed` con `error_message` (`max_attempts`).
- **Errores** — `NotFoundError` es fallo permanente; errores transitorios reintentan; excepciones inesperadas agotan reintentos antes de reportarse a Sentry (sin ruido en cada requeue).

### Documentación de transición

La doble ejecución durante la transición (path legacy fire-and-forget en `reservation.service.ts` + worker) está **mitigada por el guard de idempotencia** `ticket_email_sent_at`: aunque ambos caminos puedan intentar el envío, solo uno gana el UPDATE con `.is('ticket_email_sent_at', null)`. El riesgo residual (send no lockeado antes del UPDATE) se documenta como **H6**.

---

## 7. Auditoría de recuperación

### Mecánica validada

- **`recover_stuck_outbox_events()`** (migración 051) — reenvía `processing` abandonados a `pending`.
- **SKIP LOCKED** — misma garantía de concurrencia que el claim.
- **Recovery scheduler** — `OUTBOX_RECOVERY_INTERVAL_MS=60000`; corre antes del claim en cada ciclo; guard mínimo de 1000 ms entre ciclos.
- **Configuración** — `OUTBOX_STALE_PROCESSING_MS=300000` (5 min) define cuándo un `processing` se considera huérfano.

### Hallazgo

## H4 — Attempts mezcla procesamiento y recuperación

**Severidad:** MEDIO

**Ubicación:** migraciones 050 y 051 (`claim_outbox_events` + `recover_stuck_outbox_events`)

**Explicación:** ambos RPC incrementan `attempts` (`claim` al marcar processing, `recover` al reenviar). Una misma entrega consumida tras una recuperación cuenta 2 intentos. No rompe funcionalidad: el máximo de 10 sigue cumpliendo su rol de techo. La semántica puede evolucionar a columnas separadas (`delivery_attempts`, `recovery_count`) para observabilidad fina.

**Ticket sugerido:** WKR futuro de observabilidad avanzada.

---

## 8. Auditoría de observabilidad

### Logs

- Campos de correlación presentes: `event_id`, `event_type`, `event_version`, `tenant_id`, `handler`, `status`, `duration_ms`.
- Scrub de PII en el logger (patrón de keys sensibles + descarte de `data`/`body`).
- Eventos de log estables para scrapers: `outbox_claimed`, `outbox_processing_started`, `outbox_completed`, `outbox_requeued`, `outbox_failed`, `outbox_recovery_completed`, `outbox_relay_started`.

### Métricas

- Contadores: `events_processed_total`, `events_failed_total`, `events_retried_total`, `events_skipped_total`.
- Gauge: `current_processing_count`, `last_processing_duration_ms`, `last_success_at`, `last_error_at`.
- In-memory (ver **H7**).

### Heartbeat

- `OUTBOX_HEARTBEAT_MS=30000`; emite uptime y estado del worker; **H8** deja la persistencia a futuro.

### Sentry

- **Opcional** — `SENTRY_ENABLED` default `false`; init desde env (`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`).
- **Captura selectiva** — solo fallos inesperados (relay, handler agotado, recovery, lifecycle); fallos de dominio no generan ruido.
- **Sin PII** — scrub de keys sensibles + fingerprint por `worker`/`area`/`handler`; el payload de los eventos no contiene PII por diseño.

---

## 9. Auditoría operacional

### Validación de WKR-006.3

- **Failed events** — inspección con `status = 'failed'` y `error_message`; retry manual vía actualización de `status → pending` con `available_at = now()`.
- **Retención** — `completed` 30-90 días; pendiente de worker de purga (**H8**).
- **Inspección** — consultas documentadas sobre `status`, `attempts`, `available_at`, `created_at`.

### Confirmación

La **DLQ inicial** está implementada mediante `status = failed` dentro de `outbox_events`. **Sin tabla adicional.**

---

## 10. Auditoría multi-tenant

### Validación

- **`tenant_id`** — presente en cada fila del outbox (igual a `agency_id` de la reserva).
- **`agency_id`** — el evento `reservation.created.v1` transporta `agency_id` en el payload.
- **Ownership** — separación comercial (`reservation.agency_id`) vs operacional (`trip_agencies`) según ADR-001; para `boarding.*` se distinguirá `operator_agency_id` (quien escanea) de `owning_agency_id` (propietaria).
- **Separación de agencias** — RLS `service_role` only + correlación `tenant_id` en logs garantiza trazabilidad por agencia sin mezclar datos.

### Confirmación

Los eventos **no entregan permisos**. Son hechos observables; la autorización siempre se evalúa en el consumidor contra el dominio (regla de oro de WKR-003.2 y ADR-001).

---

## 11. Riesgos encontrados

| ID | Severidad | Hallazgo | Ubicación | Ticket futuro |
|----|-----------|----------|-----------|---------------|
| H1 | ALTO | Relay solo procesa `reservation.created`; eventos futuros no serán reclamados | `backend/src/workers/outbox/relay.ts` | WKR-007.1 — Multi-event dispatcher foundation |
| H2 | MEDIO | Trigger de `reservations` genera evento para cualquier INSERT (sin filtro de `status`) | migración 049 | Evaluar en WKR-007.1 |
| H3 | MEDIO | Sin constraint único de idempotencia `(aggregate_type, aggregate_id, event_type, event_version)` → riesgo de eventos duplicados ante retry del cliente HTTP | migración 049 | WKR-007.2 — Outbox idempotency hardening |
| H4 | MEDIO | `attempts` mezcla procesamiento y recuperación (claim y recover incrementan) | migraciones 050/051 | WKR futuro de observabilidad avanzada |
| H5 | BAJO | `STALE_PROCESSING_MS` (5 min) puede recuperar handlers realmente lentos | `backend/src/config/env.ts` | WKR futuro de resiliencia |
| H6 | BAJO | Riesgo residual de doble envío durante transición legacy/worker (mitigado por `ticket_email_sent_at`) | `reservation.service.ts` + `markTicketEmailSent` | Migrar a `EMAIL_VIA_OUTBOX=true` |
| H7 | BAJO | Métricas in-memory (se pierden al reiniciar; sin endpoint Prometheus) | `metrics.ts` | Prometheus / métricas persistentes |
| H8 | OBSERVACIÓN | Retención y purga de `outbox_events` delegadas | WKR-006.3 | WKR-009 — Retention Worker |
| H9 | OBSERVACIÓN | Eventos futuros como `boarding.*` deberán incluir `operator_agency_id` (ADR-001) | diseño WKR-003.2 | Al implementar boarding events |
| H10 | OBSERVACIÓN | Timers del API (`LockCleanup`, `TripCleanup`) aún viven en `index.ts`; deben migrar a scheduler durable | `backend/src/index.ts` | Scheduler extraction |
| H11 | OBSERVACIÓN | Cambios locales pendientes de commit relacionados con Sentry (no es riesgo arquitectónico) | working tree | Commit previo a WKR-007 |

### Detalle de hallazgos

## H1 — Dispatcher limitado a reservation.created

**Severidad:** ALTO

**Ubicación:** `backend/src/workers/outbox/relay.ts`

**Aclaración:** comportamiento correcto hoy (solo existe un consumidor). Limita la evolución a nuevos dominios.

**Ticket:** WKR-007.1 — Multi-event dispatcher foundation

## H2 — Trigger genera evento para cualquier INSERT

**Severidad:** MEDIO

**Ubicación:** migración 049

**Aclaración:** diseño válido actualmente porque evita caminos sin evento; si el RPC llegara a insertar filas no confirmadas, el worker debería ignorarlas por flags.

## H3 — Sin constraint único de idempotencia

**Severidad:** MEDIO

**Ubicación:** migración 049

**Aclaración:** la idempotencia de consumo existe vía `ticket_email_sent_at`; falta el freno de publicación (`ON CONFLICT DO NOTHING`) para retries del cliente HTTP.

**Ticket:** WKR-007.2 — Outbox idempotency hardening

## H4 — Attempts mezcla procesamiento y recuperación

**Severidad:** MEDIO

**Ubicación:** migraciones 050/051

**Aclaración:** no rompe funcionalidad; puede evolucionar a `delivery_attempts` + `recovery_count`.

**Ticket:** WKR futuro de observabilidad avanzada

## H5 — STALE_PROCESSING_MS puede recuperar handlers realmente lentos

**Severidad:** BAJO

**Ubicación:** `backend/src/config/env.ts`

**Aclaración:** mitigado por la idempotencia de consumo; ajustar umbral o añadir heartbeat de processing.

## H6 — Riesgo residual de doble envío durante transición legacy/worker

**Severidad:** BAJO

**Aclaración:** mitigado por `ticket_email_sent_at`. Cierre definitivo al activar `EMAIL_VIA_OUTBOX=true` y deshabilitar el path legacy.

## H7 — Métricas in-memory

**Severidad:** BAJO

**Futuro:** Prometheus / métricas persistentes.

## H8 — Retención y purga delegadas a WKR-009

**Severidad:** OBSERVACIÓN

**Aclaración:** DLQ lógica vigente con `status = failed`; la purga de `completed` (30-90 días) queda en WKR-009.

## H9 — Eventos futuros con contexto adicional

**Severidad:** OBSERVACIÓN

**Aclaración:** `boarding.*` requerirá `operator_agency_id` y `owning_agency_id` según ADR-001.

## H10 — Timers del API

**Severidad:** OBSERVACIÓN

**Aclaración:** `LockCleanup` y `TripCleanup` deben migrar a scheduler durable futuro.

## H11 — Cambios locales pendientes de commit (Sentry)

**Severidad:** OBSERVACIÓN

**Aclaración:** no clasificar como riesgo arquitectónico; commitear antes de iniciar WKR-007.

---

## 12. Gaps futuros (fuera de alcance)

Documentados para backlog, no implementados en AUD-021:

- **WKR-007 — Trip Events** — publicación y consumo de la familia `trip.*`.
- **WKR-007.1 — Multi-event dispatcher foundation** — generalizar el claim del relay.
- **WKR-007.2 — Outbox idempotency hardening** — constraint único + `ON CONFLICT DO NOTHING`.
- **Notification Worker** — consumidores adicionales sobre eventos publicados.
- **Reminder Worker** — recordatorios programados sobre viajes.
- **Retention Worker (WKR-009)** — purga de `completed`/`failed` según política.
- **Scheduler extraction** — mover `LockCleanup`/`TripCleanup` a scheduler durable.
- **Métricas persistentes** — Prometheus u otro destino.
- **Tracing distribuido** — correlación end-to-end más allá de `event_id`.

---

## 13. Resultado final

| Área | Estado |
|------|--------|
| Outbox | PASS WITH OBSERVATIONS |
| Event Contracts | PASS |
| Relay | PASS WITH OBSERVATIONS |
| Email Worker | PASS |
| Retry/Recovery | PASS WITH OBSERVATIONS |
| Observabilidad | PASS |
| Seguridad | PASS |
| Documentación | PASS |

---

## 14. Validaciones finales

### Archivos revisados

- `backend/src/workers/` — runner, relay, claim, retry, stuck, handlers, observabilidad.
- `backend/src/events/` — contrato `EventEnvelope`, `reservation.created.v1`.
- `supabase/migrations/049_outbox_events.sql`, `050_claim_outbox_events.sql`, `051_recover_stuck_outbox_events.sql`.
- `backend/src/config/env.ts`, `backend/src/index.ts`, `backend/src/middlewares/error-handler.ts`, `backend/src/services/reservation.service.ts`.
- Docs WKR-001 a WKR-006.3 y `docs/decisions/ADR-001-boarding-cross-agency.md`.

### Comprobaciones

- **Solo documento creado** — AUD-021 no modifica código, SQL, migraciones, tests ni dependencias.
- **`git diff --check` limpio** — sin whitespace errors.
- **Sin cambios funcionales** — el único artefacto del ticket es `docs/AUD-021-event-infrastructure-validation.md`.

---

## Conclusión

La infraestructura de eventos está en condiciones de comenzar la expansión hacia nuevos dominios. El relé, el outbox, el email worker y la observabilidad funcionan de extremo a extremo. Los hallazgos H1-H11 no bloquean WKR-007; entran al backlog con tickets asociados, siendo **H1** el único requisito evolutivo de nivel ALTO (dispatcher multi-evento) que debe priorizarse junto con WKR-007.
