# Nómadas Tour — Roadmap de producto

**Visión:** Convertir Nómadas Tour en un SaaS comercializable para agencias de viajes.  
**Alcance de este documento:** Dirección de mediano y largo plazo. No es un backlog técnico de sprint.  
**Ejecución operativa:** Ver [`TASKS.md`](../TASKS.md).

**Última actualización:** 2026-08-17

---

## Estado actual

Nómadas Tour superó la etapa de corrección arquitectónica. La plataforma opera como un **centro de operaciones multi-tenant** con capacidades de producción validadas:

| Capacidad | Estado |
|-----------|--------|
| Multi-tenant (aislamiento comercial + operación compartida controlada) | Operativo |
| Reservas por agencia (wizard, pasajeros, QR) | Operativo |
| Seat locks + concurrencia + idempotencia | Operativo |
| Scanner / Boarding por pasajero | Operativo |
| Realtime (asientos, reservas, dashboards) | Operativo |
| Seguridad endurecida (RLS desde `public.users`, suite SEC-007/008) | Operativo |
| Notificaciones (in-app + email) | Operativo |
| Deploy estabilizado (`dist` fuera de Git, build en Render) | Operativo |
| Cancelación de viajes con reservas | Operativo |
| Agencia desactivada con logout forzado | Operativo |
| Edición de viajes con reservas existentes | Operativo |
| Estados inválidos protegidos | Operativo |
| Branding configurable por agencia (logo + colores runtime) | Operativo |
| Transactional Outbox + EmailWorker (`reservation.created.v1`) | Operativo (WKR-004/005) |
| Reminders T-48h / T-24h | Operativo (WKR-008) |
| Digest diario agencias | Operativo (F4-001) |
| Digest diario superadmin | Operativo (F4-002) |
| Alertas de ocupación (in-app) | Operativo / Completado (F4-003) |
| Escalación de urgencia de ocupación (T-24h, in-app) | Operativo / Completado (F4-004) |
| Audit trail (append-only + lectura API/UI) | Operativo (F5-001…F5-003; gate UI temporal) |
| Integridad: no reservar tras `departure_time` | Operativo (RPC `066` + UX «Ya salió») |
| Notificaciones in-app: actor = agencia; ruta = destino | Operativo (copy; dominio intacto) |
| Boleto: solo destino | Operativo (`origin` conservado en modelo) |
| Backup & DR (dump lógico diario cifrado en R2) | Operativo / MVP (GitHub Actions; drill trimestral pendiente) |

**Fundación completada (referencia histórica):** alineación backend, dominio superadmin, flujo de reservas, abordaje QR, dashboards, design system, vehicle layouts, realtime global y hardening de seguridad. Detalle de sprints en [`TASKS-HISTORY.md`](TASKS-HISTORY.md).

El producto ya no es únicamente un proyecto de portafolio: entra en fase de **comercialización y valor para agencias**.

---

## Principios del producto

Estos principios guían decisiones de producto, arquitectura y priorización:

1. **Seguridad primero** — Autorización desde fuentes confiables (`public.users`, RLS, backend). Nunca delegar permisos a metadata del cliente ni al frontend.

2. **Integridad de reservas** — Una reserva es un contrato operativo: asientos, pasajeros y estados deben ser consistentes bajo concurrencia, cancelaciones y cambios de viaje.

3. **Multi-tenancy desde el diseño** — Los datos comerciales permanecen aislados por agencia. Las excepciones operacionales, como boarding en viajes compartidos, requieren autorización explícita y acotada según [ADR-001](decisions/ADR-001-boarding-cross-agency.md).

4. **Automatizar antes que aumentar carga operativa** — Si una tarea se repite diariamente (recordatorios, limpieza, alertas), debe tender a automatizarse, no a depender de memoria humana.

5. **Configuración antes que personalización mediante código** — Branding, datos comerciales y preferencias deben ser editables por la agencia sin despliegues ni forks por cliente.

6. **Escalabilidad y mantenibilidad** — Preferir procesos en segundo plano, observabilidad y límites claros sobre parches ad hoc en request/response.

---

## Roadmap visual — secuencia actual

```text
FASE 2 — Branding                          ✅ Completada

FASE 3 — Workers
  WKR-001  Event inventory audit           ✅
  WKR-002  Events/workers architecture ADR ✅
  WKR-003  Outbox design (+ 003.1 / 003.2) ✅
  WKR-004  Transactional outbox foundation ✅
  WKR-005  Outbox relay + EmailWorker      ✅
  WKR-006  Observability foundation (docs) ✅
  WKR-006.1 Worker observability (runtime) ✅
  WKR-006.2.1 Sentry foundation design (docs) ✅
  WKR-006.2 Sentry wiring (API + worker) ✅
  WKR-006.3 Retention + DLQ runbook ✅
  WKR-006.4 Worker health endpoint (/healthz) ✅
  WKR-007  Trip / notification event workers ✅
  WKR-008  Reminder workers ✅
  WKR-009  Outbox Retention Worker ✅

FASE Seguridad continua
  SEC-001 … SEC-008                        ✅ (hardening cerrado)
  SEC-009  Continuous security validation  → futura

FASE 4 — Automatizaciones (producto)
  F4-001  Agency Daily Digest            ✅
  F4-002  Superadmin Daily Digest        ✅
  F4-003  Occupancy Alerts               ✅
  F4-004  Occupancy Urgency Alerts       ✅
  (métricas nocturnas → futuro / Fase 6 / reporting)

FASE Infraestructura / Operaciones
  Backup & Disaster Recovery MVP         ✅
  Restore drill trimestral               → futura (manual)
  Backup local de contingencia           → futura capacidad

FASE 5 — Audit Trail
  F5-001  Audit trail foundation         ✅
  F5-002  Read API                       ✅
  F5-003  UI                             ✅
  F5 resto                               → futura

FASE 6 — Reportes
FASE 7 — UX
FASE 8 — Escalabilidad (amplía observabilidad)
```

---

## Roadmap por fases

Las fases están numeradas a partir de la fundación ya completada. Cada fase construye sobre la anterior.

---

### Fase 2 — Personalización de agencias

**Estado:** Completada.

**Objetivo:** Permitir que cada agencia personalice su espacio dentro de la plataforma, incrementando la percepción de **producto propio** para cada cliente B2B.

**Primera versión implementada:**

#### Branding

- Logo configurable por agencia mediante Storage.
- Color primario.
- Color secundario.
- Color de acento.
- Aplicación runtime y reactiva mediante `AgencyBrandingProvider`.
- Settings visuales con preview, validación y actualización sin refresh.

Los tokens de diseño del sistema (`AGENTS.md`) siguen siendo la base; la agencia configura variantes dentro de un marco seguro y consistente.

**Persistencia e infraestructura:**

- Migración `041_agency_settings.sql`: schema 1:1 de branding por agencia, RLS y defaults.
- Migración `042_agency_logo_bucket.sql`: bucket y restricciones para assets de logo.
- El branding visual vive en `agency_settings`; la identidad y el nombre del tenant permanecen en `agencies`.

#### Regla de negocio

**El nombre de la agencia no es editable por la agencia.** Solo el superadmin puede modificarlo. Esto evita suplantación de identidad y mantiene coherencia contractual con la plataforma.

**Valor:** Las agencias presentan la herramienta como suya ante pasajeros y operadores, sin perder el modelo SaaS centralizado.

---

### Fase 3 — Sistema de Workers

**Prioridad:** Completada hasta WKR-009. F4 y F5-001…F5-003 cerradas.

**Objetivo:** Procesamiento asíncrono y tareas programadas desacopladas del ciclo HTTP, mediante **Transactional Outbox + Workers** ([WKR-002](WKR-002-events-workers-architecture-adr.md)).

#### Progreso WKR

| Ticket | Tema | Estado |
|--------|------|--------|
| [WKR-001](WKR-001-event-inventory-audit.md) | Inventario de eventos | ✅ |
| [WKR-002](WKR-002-events-workers-architecture-adr.md) | ADR arquitectura events/workers | ✅ |
| [WKR-003](WKR-003-transactional-outbox-foundation-design.md) | Diseño outbox (+ readiness / boundaries) | ✅ |
| [WKR-004](WKR-004-outbox-foundation-implementation.md) | Tabla `outbox_events` + `reservation.created.v1` | ✅ |
| [WKR-005](WKR-005-email-worker-implementation.md) | Relay + EmailWorker | ✅ |
| [WKR-006](WKR-006-worker-observability-foundation.md) | Observability foundation (auditoría + diseño) | ✅ |
| [WKR-006.1](WKR-006.1-worker-observability-implementation.md) | Worker observability (logs, metrics, heartbeat, stuck reaper) | ✅ |
| [WKR-006.2.1](WKR-006.2-sentry-foundation-design.md) | Sentry foundation design (docs only) | ✅ |
| [WKR-006.2](WKR-006.2-sentry-foundation-implementation.md) | Sentry wiring (API + worker; sin frontend) | ✅ |
| [WKR-006.3](WKR-006.3-outbox-retention-dlq-runbook.md) | Retention + DLQ runbook (docs) | ✅ |
| [WKR-006.4](WKR-006.4-worker-health-endpoint.md) | Worker `/healthz` (Render Free Web Service) | ✅ |
| [WKR-007](WKR-007-trip-notification-event-workers-design.md) | Trip / notification event workers (wiring + cutover) | ✅ |
| [WKR-008](WKR-008-reminder-workers-audit.md) | Reminder workers (T-48h/T-24h + cutover) | ✅ |
| [WKR-009](WKR-009-outbox-retention-workers-design.md) | Outbox Retention Worker (purga `completed` ≥30d) | ✅ |

#### Capacidades ya en el sistema (WKR-004/005)

- Tabla `outbox_events` y emisión transaccional de `reservation.created.v1`
- Proceso worker separado del HTTP (`npm run worker`)
- Retries básicos, claim `SKIP LOCKED`, idempotencia `ticket_email_sent_at`
- Feature flag `EMAIL_VIA_OUTBOX`
- Logs JSON estructurados + métricas + heartbeat + stuck recovery (WKR-006.1)
- Eventos de dominio trip.* (7 contratos v1), RPCs transaccionales 057, handlers NotificationFanout/EmailFanout y flag `TRIP_EFFECTS_VIA_OUTBOX` con cutover realizado (WKR-007)
- Reminder workers T-48h/T-24h: RPC `schedule_trip_reminders` (059), evento `trip.reminder_due.v1`, fanout email/in-app y flag `TRIP_REMINDER_VIA_OUTBOX` con cutover realizado (WKR-008)
- Retention worker: RPC `purge_completed_outbox_events` (060), scheduler en worker Node, flag `OUTBOX_RETENTION_VIA_WORKER` con cutover realizado (WKR-009)

#### WKR-006 / 006.1 — Worker Observability ✅

- Diseño: [`WKR-006-worker-observability-foundation.md`](WKR-006-worker-observability-foundation.md)
- Runtime: [`WKR-006.1-worker-observability-implementation.md`](WKR-006.1-worker-observability-implementation.md)

#### WKR-006.2.1 — Sentry Foundation Design ✅

**Documento:** [`WKR-006.2-sentry-foundation-design.md`](WKR-006.2-sentry-foundation-design.md)

Estrategia completa (tags, PII, entornos, Free plan, riesgos). **Docs only** — sin SDK.

#### WKR-006.2 ✅ / WKR-006.3 ✅ / WKR-006.4 ✅

1. **006.2** — Wiring Sentry API + worker (opcional vía `SENTRY_ENABLED`) ✅
   Doc: [`WKR-006.2-sentry-foundation-implementation.md`](WKR-006.2-sentry-foundation-implementation.md)
2. **006.3** — Retención + DLQ lógica (`failed`) + runbook ops ✅
   Doc: [`WKR-006.3-outbox-retention-dlq-runbook.md`](WKR-006.3-outbox-retention-dlq-runbook.md)
   Purga automática de `completed` → **WKR-009** ✅ (cerrado; ver [`WKR-009-outbox-retention-workers-audit.md`](WKR-009-outbox-retention-workers-audit.md)).
3. **006.4** — Health HTTP `GET /healthz` (`WORKER_HEALTH_PORT`) para Web Service free ✅
   Doc: [`WKR-006.4-worker-health-endpoint.md`](WKR-006.4-worker-health-endpoint.md)

**Separación conceptual (no mezclar en el mismo ticket):**

| Capacidad | Rol | Ticket |
|-----------|-----|--------|
| **Logs / métricas / health / Sentry** | Observabilidad y operación en producción | **WKR-006.x** |
| **SAST / Dependabot / secret scanning / DAST / Strix (candidatos)** | Seguridad ofensiva/preventiva, vulnerabilidades, validación continua | **SEC-009** |

#### WKR-007 ✅ — Trip / notification event workers

- **Estado:** Completado. Eventos de dominio trip.* v1, RPCs transaccionales (migración 057), handlers NotificationFanout/EmailFanout con idempotencia (`source_event_id` / `email_delivery_log`) y wiring a producción con cutover realizado (`TRIP_EFFECTS_VIA_OUTBOX=true` en entorno; default `false` en código como postura de rollback).
- Diseño: [`WKR-007-trip-notification-event-workers-design.md`](WKR-007-trip-notification-event-workers-design.md)
- Registro de implementación (C1–C8): [`WKR-007-wiring-implementation-plan.md`](WKR-007-wiring-implementation-plan.md)

#### WKR-008 ✅ — Reminder workers

- **Estado:** Completado. Ventanas **T-48h / T-24h** (sin T-2h). Scheduler en el worker Node + RPC `schedule_trip_reminders` (migración 059) + evento `trip.reminder_due.v1` + fanout email/in-app. Flag `TRIP_REMINDER_VIA_OUTBOX` con cutover realizado (`true` en Render; default `false` en código como postura de rollback). Harness SQL A–K ejecutado; validación operativa en producción. Veredicto de cierre: **PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED**.
- Auditoría / cierre: [`WKR-008-reminder-workers-audit.md`](WKR-008-reminder-workers-audit.md)

#### WKR-009 ✅ — Outbox Retention Worker

- **Estado:** Completado. Purga automática de `outbox_events` `completed` con `COALESCE(processed_at, updated_at) < now() - 30 days` vía scheduler en el worker Node + RPC `purge_completed_outbox_events` (migración 060). Flag `OUTBOX_RETENTION_VIA_WORKER` con cutover realizado (`true` en Render; default `false` en código como postura de rollback). Harness SQL A–J ejecutado en producción; EXPLAIN sin índice adicional (D6). Veredicto: **PASS WITH OBSERVATIONS / READY FOR CLOSURE / CLOSED**.
- **Qué no incluye:** automation bridge / Fase 4 producto; migración de timers `LockCleanup` / `completeExpiredTrips`; purga `boarding_attempts`; pg_cron; segundo worker; auto-purga de `failed`/`pending`/`processing`.
- Diseño: [`WKR-009-outbox-retention-workers-design.md`](WKR-009-outbox-retention-workers-design.md)
- Auditoría / cierre: [`WKR-009-outbox-retention-workers-audit.md`](WKR-009-outbox-retention-workers-audit.md)
- Política / runbook: [`WKR-006.3-outbox-retention-dlq-runbook.md`](WKR-006.3-outbox-retention-dlq-runbook.md)

**Valor de la fase:** reduce acoplamiento HTTP↔efectos secundarios, mejora confiabilidad de emails y prepara automatizaciones de producto (Fase 4).

---

### Fase Seguridad continua

**Prioridad:** Paralela a Workers / Escalabilidad (no bloquea WKR-006.x).

El hardening **SEC-001 … SEC-008** está cerrado ([security-hardening-implementation.md](security-hardening-implementation.md)). La siguiente capa es **validación continua**, no un re-hardening ad hoc.

#### SEC-009 — Continuous Security Validation

**Estado:** Futura (no es sprint activo; sin herramienta seleccionada).

**Objetivo:** Automatizar parte de las auditorías de seguridad que hoy son manuales o semi-manuales.

**Alcance (futuro, sin elegir herramienta definitiva):**

- Análisis automatizado de vulnerabilidades
- SAST (static application security testing)
- Dependency scanning
- Regresiones de seguridad (ampliar suite tipo SEC-007)
- Validaciones multi-tenant / aislamiento
- Revisión continua de permisos y RLS

**Herramientas candidatas (evaluación abierta — ninguna seleccionada todavía):**

La selección se hará **cuando SEC-009 pase de roadmap a sprint** (design del ticket). Hasta entonces ninguna herramienta se considera definitiva ni debe configurarse en el repo.

| Candidato | Rol a evaluar |
|-----------|----------------|
| **Strix** | Evaluación de seguridad asistida por IA / testing ofensivo |
| **GitHub CodeQL** | SAST |
| **GitHub Dependabot** | Dependency scanning y alertas de dependencias vulnerables |
| **GitHub secret scanning** | Disponibilidad y condiciones según plan/repositorio |
| **SAST del ecosistema JavaScript/TypeScript** | Alternativas open source o gratuitas (además o en lugar de CodeQL) |
| **DAST / API security scanners** | Herramientas gratuitas/open source para probar endpoints y detectar vulnerabilidades desde el exterior |

**Criterios de evaluación (cuando se abra el ticket):**

- Priorizar **costo cero / open source / free tier**: el proyecto **no dispone hoy de presupuesto dedicado** a herramientas de seguridad.
- Cobertura real frente al stack **Next.js + TypeScript + Node/Supabase**.
- Facilidad de integración (local y/o CI).
- Tasa y manejabilidad de falsos positivos.
- Carga de mantenimiento operativo.
- Privacidad de datos (qué se envía a terceros).
- Posibilidad de ejecutarlo localmente o en CI sin dependencias de pago.
- **No asumir** que una herramienta gratuita hoy seguirá siendo gratuita al momento de ejecutar SEC-009: verificar precios y licencias en esa fecha.
- **Strix** queda como **candidato**, no como solución automática definitiva.

**No mezclar con WKR-006.x:** SEC-009 no es observabilidad de runtime. **Sentry no sustituye SEC-009** (ni SAST, ni dependency scanning, ni pentest/DAST asistido).

---

### Fase 4 — Automatizaciones

**Prioridad:** Completada (F4-001 … F4-004). Ejecución histórica: [`TASKS-HISTORY.md`](TASKS-HISTORY.md).

**Objetivo:** Reglas de negocio y comunicaciones que se ejecutan solas según configuración o umbrales.

**Progreso**

| Ticket | Tema | Estado |
|--------|------|--------|
| F4-001 | Digest diario agencias (email) | Operativo / Completado |
| F4-002 | Digest diario superadmin (email) | Operativo / Completado |
| F4-003 | Alertas de ocupación (in-app) | Operativo / Completado |
| F4-004 | Occupancy Urgency Alerts | Operativo / Completado |

**Fase 4 operativa:** F4-001 a F4-004 CLOSED. Recordatorios T-48h/T-24h viven en WKR-008; la escalación T-24h de ocupación vive en F4-004. Audit Trail F5-001…F5-003 cerrado.

**Retirado de la prioridad de Fase 4:** métricas nocturnas → **futuro / Fase 6 / reporting** (no existe aún un consumidor de negocio definido para materializar snapshots históricos).

**Valor:** El producto pasa de reactivo a **proactivo** — avisa antes de que algo falle en operación.

---

### Fase Infraestructura / Operaciones

**Prioridad:** MVP de backup implementado. Restore drill trimestral y backup local de contingencia siguen futuras.

**Objetivo:** Proteger los datos del SaaS ante pérdida de base de datos, corrupción, eliminación accidental, incidentes de infraestructura, fallo catastrófico del proveedor y necesidad de restauración operativa.

**MVP (en repo):** GitHub Actions diario (03:00 UTC = 23:00 America/Caracas del día anterior) → `roles.sql` + `schema.sql` + `data.sql` (incluye Auth core: `auth.users` / `auth.identities`; excluye Auth transitorio y Storage internals) + bytes de Storage → `age` → Cloudflare R2 (`nomadas-backups`). RPO 24 h; RTO target 8 h; RTO estimado ~90 min (no es SLA). Tras restore: re-login; JWTs viejos inválidos; OAuth/SSO/SMTP son config de plataforma. Operación: [`backup-disaster-recovery-operations.md`](backup-disaster-recovery-operations.md). Emergencia: [`backup-disaster-recovery-runbook.md`](backup-disaster-recovery-runbook.md).

**Aún fuera del MVP:** PITR; restore drill automático; creación automática de proyectos Supabase; garantía de pérdida cero; backup local de contingencia.

**Roles de almacenamiento:** R2 = backup automático principal. Backup local = contingencia manual (fuera del scheduler).

**No confundir con Workers:** no forma parte de WKR-006.x, no es un scheduler de producto y no corre en Render.

---

### Fase 5 — Audit Trail

**Prioridad:** F5-001…F5-003 cerrados. F5 resto (invitaciones/usuarios, correlation ID, retención/purge, quitar gate UI temporal) es futuro. Ejecución histórica: [`TASKS-HISTORY.md`](TASKS-HISTORY.md).

**Objetivo:** Registrar acciones administrativas y eventos relevantes para soporte, auditoría y trazabilidad.

**Progreso**

| Ticket | Tema | Estado |
|--------|------|--------|
| [F5-001](F5-001-audit-trail-design.md) | Foundation: `audit_log` append-only + writers atómicos (9 acciones) | ✅ |
| F5-002 | Read API (`GET /admin/audit`, `GET /agency/audit`) | ✅ |
| F5-003 | UI `/admin/audit` y `/agency/audit` (gate UI temporal) | ✅ |
| F5 resto | Invitaciones / usuarios; correlation ID; retención; quitar gate UI | Futura |

**F5-001 cubre:**

- Crear / editar / cancelar viaje
- Crear / cancelar reserva
- Boarding (board / unboard)
- Cambios de branding y preferencias de notificación de agencia

**F5-002 / F5-003 cubren:** consulta paginada, filtros, sanitización por rol, pantallas admin/agencia.

**Aún fuera de F5-001…F5-003:** cambios de usuarios e invitaciones; correlation ID; retención/purge; visibilidad del audit para todos los superadmins/agencias (hoy hay gate UI temporal).

**Por evento (modelo F5-001):**

- **Actor** (usuario, rol, agencia; `system` solo sin `actor_user_id`)
- **Fecha** (`occurred_at` timestamptz)
- **Antes / después** (diff JSONB minimizado / whitelist — sin PII)
- **Metadata** (`source`, `ip`, `user_agent`, correlación de dominio acotada)

**Valor:** Resuelve disputas operativas, cumplimiento interno y debugging sin depender de logs crudos.

---

### Fase 6 — Reportes

**Prioridad:** Quinta.

**Objetivo:** Visibilidad de negocio y operación para superadmin y agencias.

**Alcance:**

- KPIs (ocupación, reservas, abordaje, cancelaciones)
- Exportaciones (CSV / Excel según necesidad)
- Dashboard operativo enriquecido
- Métricas por agencia (superadmin) y comparativas agregadas

**Valor:** Decisiones basadas en datos; argumento de venta para agencias que miden su operación.

---

### Fase 7 — UX

**Prioridad:** Continua, no exclusiva.

**Objetivo:** Experiencia premium coherente con la filosofía de diseño (`AGENTS.md`).

**Alcance:**

- Responsive en todos los flujos críticos (scanner, reservas, dashboards)
- Accesibilidad (landmarks, teclado, contraste)
- Estados vacíos con CTA
- Skeletons en lugar de spinners aislados
- Feedback visual (toast, loading, success/error en acciones async)
- Consistencia del design system en pantallas legacy

**Valor:** Percepción de SaaS profesional; menor fricción en operación diaria bajo presión (abordaje, ventanilla).

---

### Fase 8 — Escalabilidad

**Prioridad:** Paralela a crecimiento de clientes.

**Objetivo:** Sostener más agencias, más viajes concurrentes y más tráfico Realtime sin degradación.

**Alcance:**

- Observabilidad avanzada (amplía WKR-006.x: trazas distribuidas, alertas SLO)
- Performance (queries, N+1, índices)
- Caché donde aporte (dashboards, listados)
- Rate limiting refinado por ruta y tenant
- Monitoreo y alertas de infraestructura
- Optimización de costos (Supabase, email, compute)

**Valor:** Confianza para escalar comercialmente sin sorpresas operativas.

---

## Relación con documentación técnica

| Documento | Rol |
|-----------|-----|
| [`TASKS.md`](../TASKS.md) | Sprint actual y backlog inmediato |
| [`TASKS-HISTORY.md`](TASKS-HISTORY.md) | Historial de sprints completados |
| [`documentation-guide.md`](documentation-guide.md) | Cómo mantener docs organizadas |
| [`architecture.md`](architecture.md) | Arquitectura técnica actual |
| [`security-hardening-implementation.md`](security-hardening-implementation.md) | Remediaciones SEC-001…008 (cerradas); SEC-009 futura |
| Serie `WKR-00x-*.md` | Workers/outbox (incl. [WKR-006.1](WKR-006.1-worker-observability-implementation.md), [Sentry design](WKR-006.2-sentry-foundation-design.md)) |
| Serie `F4-00x-*.md` / [`F5-001-audit-trail-design.md`](F5-001-audit-trail-design.md) | Automatizaciones y audit trail (contratos de implementación) |
| [`system-spec.md`](system-spec.md) | Especificación funcional base |
| [`AGENTS.md`](../AGENTS.md) | Reglas de diseño e implementación |

---

## Historial — Fases técnicas originales (1–7)

Las fases iniciales del producto (backend, reservas, abordaje, dashboards, legacy cleanup) están **completadas**. Detalle por sprint: [`TASKS-HISTORY.md`](TASKS-HISTORY.md).

---

## Follow-ups de producto

**Cerrados:** actor de notificaciones = agencia; notificaciones in-app y boleto con solo destino (`origin` conservado en modelo); no reservar si `departure_time <= now()`. Detalle: [`TASKS-HISTORY.md`](TASKS-HISTORY.md).

### Futura capacidad — Reserva asistida por enlace

Después de seleccionar asientos, permitir opcionalmente que la agencia genere un enlace seguro para que el reservante complete los datos (alternativa al wizard manual, que permanece). El diseño futuro deberá resolver token seguro y no adivinable, expiración, relación con seat locks, estado temporal, invalidación al confirmar/cancelar/expirar, campos permitidos al cliente, impedir cambiar viaje/asientos/precio y posible recuperación de progreso.

### Futura capacidad — Backup local de contingencia

Copia local **manual y cifrada** (`age`) del backup como último recurso, independiente de GitHub Actions, Cloudflare R2 y Supabase. Debe compartir el formato del MVP y permanecer **fuera del flujo automático**.

- **R2** = backup automático principal
- **Backup local** = contingencia manual

No es scheduler, no sustituye R2 y no trata la PC del operador como infraestructura de producción.

---

## Fuera de alcance (por ahora)

- Pagos y facturación
- Portal de pasajeros con login
- Marketplace entre agencias
- App móvil nativa

Estos ítems pueden evaluarse en roadmap futuro según demanda comercial.
