# Arquitectura General

## Tipo de sistema

Plataforma SaaS multi-tenant B2B para gestión de viajes, reservas, pasajeros y abordaje.
NO maneja pagos ni ventas.

---

## Arquitectura lógica

Frontend (Next.js) → Backend API (Node.js + Express) → Supabase (DB + Auth)

---

## Identidad y seguridad

- Supabase Auth valida la sesión y entrega la identidad autenticada.
- El backend resuelve rol y tenant desde `public.users`.
- `user_metadata` no se usa como fuente de autorización.
- La lógica de negocio y los permisos efectivos se validan en Express.
- PostgreSQL aplica defensa en profundidad mediante RLS.
- Las policies vigentes resuelven identidad con
  `private.auth_app_role()` y `private.auth_app_agency_id()`.
- El frontend nunca constituye una frontera de seguridad.
- Los pasajeros no tienen usuario ni acceso directo al sistema.

---

## Separación de dominios

### Superadmin domain

- Gestión global del sistema
- Rutas, viajes, agencias, asignación de cupos

### Agency domain

- Consulta los viajes donde está asignada mediante `trip_agencies`.
- Crea y administra comercialmente sus propias reservas y pasajeros.
- `agency_id` determina ownership y aislamiento comercial.
- No puede modificar reservas comerciales de otra agencia.

### Boarding domain

- Boarding es una operación compartida del viaje.
- `trip_agencies` determina qué agencias están autorizadas a operar el viaje.
- Una agencia asignada puede abordar o desabordar pasajeros del viaje aunque
  la reserva pertenezca comercialmente a otra agencia.
- El acceso cross-agency se limita al contexto operacional necesario.
- Cada acción registra actor y agencia operadora para mantener trazabilidad.

La decisión normativa y sus límites están documentados en
[ADR-001 — Boarding cross-agency](decisions/ADR-001-boarding-cross-agency.md).

---

## Puestos e inventario

- Cada viaje tiene puestos identificados mediante `seat_code`.
- La distribución visual usa layouts físicos estáticos según el tipo de
  vehículo.
- Los puestos se asignan a pasajeros y controlan inventario, locks y reservas.
- Los cupos de `trip_agencies` limitan cuántos puestos puede reservar cada
  agencia.
- Una reserva agrupa múltiples pasajeros y sus puestos bajo un mismo QR.

---

## Capacidades transversales

### Realtime

Supabase Realtime mantiene sincronizados los estados operacionales que requieren
actualización inmediata, como puestos, reservas, viajes, boarding y
notificaciones.

### Notificaciones

El backend genera notificaciones in-app y por email según eventos de negocio y
preferencias de la agencia. El frontend recibe las notificaciones in-app
autorizadas mediante API y Realtime.

### Outbox y workers

La plataforma usa **Transactional Outbox** (`outbox_events`) para hechos de
dominio. El primer evento es `reservation.created.v1`; un proceso worker
separado del HTTP (relay + EmailWorker) consume el outbox con retries e
idempotencia. Diseño: serie `docs/WKR-00x-*.md`.

**Observabilidad:**

```text
API / Worker
  → Structured Logs (JSON stdout)
  → Metrics (in-memory) + Heartbeat
  → Sentry (opcional — SENTRY_ENABLED)
  → Worker GET /healthz (WORKER_HEALTH_PORT — WKR-006.4)
```

Runtime (WKR-006.1–006.4): correlación en logs; recovery stuck; Sentry
opcional; health HTTP mínimo para hosting tipo Render Free Web Service
([`WKR-006.4-worker-health-endpoint.md`](WKR-006.4-worker-health-endpoint.md)).
Retención / DLQ lógica: [`WKR-006.3-outbox-retention-dlq-runbook.md`](WKR-006.3-outbox-retention-dlq-runbook.md).
No mezclar con SEC-009.

### Branding por agencia

`agency_settings` almacena logo y colores sin mezclar branding con la identidad
del tenant en `agencies`. `AgencyBrandingProvider` aplica las variables CSS
dentro del layout de agencia y permite actualización runtime sin recargar.

La migración `041_agency_settings.sql` define el schema y RLS. La migración
`042_agency_logo_bucket.sql` define el almacenamiento y las restricciones de
logos.

---

## Fuentes de verdad

- Reglas de negocio: [`business-rules.md`](business-rules.md).
- Permisos: [`permissions.md`](permissions.md).
- Decisiones arquitectónicas: [`decisions/`](decisions/).
- Schema y RLS: [`supabase/migrations/`](../supabase/migrations/).
