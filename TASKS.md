# TASKS

> Documento **operativo del sprint**. Una tarea activa a la vez; marcar `[x]` al completar.
> **Estado:** **Fase A (Production & SaaS Readiness)** en progreso — SEO, Legal, Analytics, SEC-010…014, OBS-001. **SEC-009** permanece abierto (009.0/.1/.2 COMPLETED; 009.3 CANCELADA). **Próxima iniciativa de producto:** auto-servicio de rutas y viajes por agencia — descubrimiento **DISC-AS-01…05 completado** e incrementos implementados: **AS-TRIP-001** (autorización de transiciones de estado de viaje), **AS-TRIP-002** (UI "Completar viaje" en el panel de agencia) y **AS-TRIP-003** (alta de viaje por la agencia sobre rutas globales).
> **Visión de producto (mediano/largo plazo):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
> **Historial de sprints completados:** [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)
> **Guía para mantener la documentación:** [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## Marketplace (schema + pagos) — COMPLETADO (ver detalle en `../nomadas-tour-marketplace/TASKS.md`)

> Estas migraciones y features son de `nomadas-tour-marketplace` pero viven
> **aquí** (migraciones) para mantener una sola historia sobre la BD compartida.
> Diseño y reglas: `../nomadas-tour-marketplace/docs/`.
> Repo marketplace: Fases 0–2 completadas (auth, catálogo, wizard, checkout
> MKT-007, panel de revisión de pagos de agencia) + **RT-01/RT-02
> (historial de compras) y RT-03 (boleto QR)**. Siguiente: MKT-008 (T-1) —
> **integrado y desplegado**, validación funcional local pendiente (ver
> `../nomadas-tour-marketplace/TASKS.md` → MKT-008 T-1).

- [x] **MKT-001** — Escritura de migraciones 074–079 — **2026-09-30**
  - `074_add_customer_role.sql` — `customer` en `users.role_check`, resuelto
    por catálogo porque `011_create_all.sql` no nombró el constraint.
    Sin esto, `POST /api/auth/register` del marketplace falla.
  - `075_reservations_marketplace.sql` — `reservations.customer_id`,
    `source` (backfill `internal`), `payment_status` (derivado),
    estados `locked`/`reserved` agregados sin quitar los de tour, y policy
    `reservations_customer_read`.
  - `076_payments.sql` — `trips.seat_price`, `reservation_passengers.unit_price`,
    `payments`, `payment_allocations`, helper `reservation_passenger_balance()`.
  - `077_platform_config_commissions_refunds.sql` — `platform_config`
    (fee 30), `commissions`, `reservation_refunds`,
    `agencies.first_marketplace_trip_completed_at`.
  - `078_trips_installments.sql` — `trips.installment_allowed`,
    `trips.installment_amount_cents`.
  - `079_cancel_reservation_passenger.sql` — RPC `cancel_reservation_passenger`
    (idempotente, libera solo su seat, crea refund `required`) y ampliación
    de `audit_log` para `actor_role='customer'` + acción
    `reservation.passenger_cancelled`. CHECKs ampliados, ningún valor quitado.
  - **APLICADAS a la BD** (074–080 verificadas en vivo 2026-10-06; 085–087
    aplicadas posteriormente). Validación inicial: UTF-8 sin BOM, sin bytes
    no-ASCII, paréntesis y bloques `$$` balanceados.
  - Hallazgo relevante: **el schema no tenía ninguna columna de precio**
    (001–073), por lo que la fórmula de saldo del marketplace no era
    calculable. Resuelto en 076 con precio de viaje + snapshot por pasajero.
  - UTF-8 sin BOM y solo ASCII en comentarios (los SQL 001–073 tienen mojibake
    al leerlos en consolas Windows; no se replicó ese defecto).

- [x] **MKT-005/006/007** — Pagos marketplace + checkout con revisión — **2026-10-13**
  - Migraciones 082–087 (locks/estados, RPCs de pago, `checkout_attempts` en 087).
  - **Repo tour**: panel de agencia `/agency/payments` (listado "Compras",
    detalle por intento, verificar/rechazar/ver comprobante);
    `checkout-attempt.service.ts` y `payment.service.ts`.
  - **Repo marketplace**: wizard de reserva + checkout (`checkout_attempts`),
    endpoints legacy → `410 Gone`.
  - Verificación/rechazo **por `attempt_id`** (nunca por `reservation_id`).
  - Detalle exhaustivo: `../nomadas-tour-marketplace/TASKS.md` → Fase 2.

- [x] **RT-01/02/03** — Historial de compras + boleto QR (repo marketplace) — **2026-10-20**
  - **Repo tour: cero cambios de código.** El escáner, las RPC de abordaje
    y la protección de duplicados quedan intactos.
  - El marketplace consume `reservations.qr_code`/`ticket_code` emitidos
    por la migración 087 **sin regenerar** el QR: un solo QR por reserva,
    valor idéntico al de `ReservationTicket` de tour (componente
    `react-qr-code`).
  - Nuevos endpoints del marketplace (solo lectura, cliente autenticado):
    `GET /api/public/checkout/attempts` (historial) y
    `GET /api/public/checkout/attempts/:attemptId/ticket` (boleto).
  - Detalle exhaustivo: `../nomadas-tour-marketplace/TASKS.md` →
    sección "RT-01…RT-03".

---

## Realtime de pagos de agencia — COMPLETADO

- [x] **RT-06** — Realtime en `/agency/payments` (listado + detalle) — **2026-10-22**
  - **Migración** `supabase/migrations/094_agency_payments_realtime.sql`
    (+ `supabase/rollbacks/094_agency_payments_realtime_rollback.sql`):
    policies `checkout_attempts_agency_read` y `payments_agency_read`
    (espejo de `authorize('agency')` del backend: role `agency` +
    `private.auth_app_agency_id()`), `GRANT SELECT` de `checkout_attempts`
    a `authenticated` y publicación de `checkout_attempts` + `payments`
    con la misma guarda de catálogo que 093 (PG17, reejecutable; no
    duplica miembros si 093 ya corrió). El rollback retira solo las dos
    policies: publicación y GRANT son compartidos con 093/RT-04A.
    **Migración APLICADA** (historial 074–101 aplicado, confirmado
    2026-11-10; al momento de esta tarea los archivos eran locales sin
    aplicar a la BD remota).
  - **Frontend** (`lib/realtime/subscriptions.ts`): helpers
    `subscribeToAgencyCheckoutAttempts`, `subscribeToAgencyPayments`,
    `subscribeToAgencyPaymentReservation`, `subscribeToAgencyPaymentPassengers`
    — solo-notificación (el backend es la autoridad; nunca se interpreta el
    payload) con estado de conexión por canal. El filtro `agency_id`/`id`
    es rendimiento: la autorización real es RLS.
  - **Hook** `hooks/useRealtimeRefresh.ts`: debounce 500 ms, min-gap
    700 ms (pliega el evento de la propia acción tras un refresco
    inmediato), `degraded` + `refreshNow`, limpieza de timer/canales al
    desmontar. Guard de secuencia (`fetchSeqRef`) en el `doFetch` de cada
    página para descartar respuestas viejas.
  - **Cableado** en las 3 vistas: listado (`checkout_attempts` +
    `payments` por agencia), detalle de pago (`payments` por id + la
    reserva y sus pasajeros cuando `reservation_id` es UUID, cubre T-1) y
    detalle de compra (`checkout_attempts` por id). Banner discreto ámbar
    "Sin actualizaciones en vivo…" con botón **Actualizar**; los timers de
    400 ms post-verificar/rechazar se reemplazan por refresco inmediato;
    **sin polling**. RPCs, TTLs (900/600), abordaje, locks y QR intactos.
  - **Pruebas** nuevas: `tests/payments/PaymentsRealtime.test.tsx`
    (8: suscripción, debounce, ráfaga única, cleanup, banner+Actualizar,
    seq guard, refresco de ambos detalles) y
    `tests/payments/realtime-agency-contract.test.ts` (18: 094, rollback,
    093 intacto, helpers, hook, páginas). Mocks de realtime añadidos a
    `PaymentsPages.test.tsx` y `PaymentReservationNavigation.test.tsx`.
  - **Verificación:** `npm test` → 652 passed / 4 skipped (70 archivos);
    `npx tsc --noEmit` OK; `npm run build` (next build) OK;
    `git diff --check` OK. **094 (+093) aplicadas en la BD** (confirmado
    2026-11-10). **Pendiente:** validar la entrega Realtime en vivo con
    sesión de agencia en staging — no cubierto por esta tarea (no se operó
    contra la BD remota); que la migración esté aplicada **no** implica
    validación funcional.

---

## Activo — SEC-009 (Continuous Security Validation)

- [x] **SEC-009.0** — CI Security Foundation — **COMPLETED**
  - Pipeline: `.github/workflows/ci.yml` (`security-tests`, `tests`, `backend-tests`, `typecheck`, `build`).
  - Triggers: `pull_request` + `push` → `main`. Validado, pusheado y mergeado.
  - Design padre: [`docs/SEC-009-continuous-security-validation-design.md`](docs/SEC-009-continuous-security-validation-design.md)
  - **No** declara SEC-009 MVP completo (SAST, tenant suite, SQL harness → tickets posteriores).
- [x] **SEC-009.1** — Secret Scanning MVP — **COMPLETED / IMPLEMENTED**
  - `.gitleaks.toml` + job `secret-scan` (`gitleaks/gitleaks-action@v3`, `checkout@v6`, `contents: read`, comments off).
  - Scan local: `gitleaks git --redact .` → `136 commits scanned` / `no leaks found`.
  - Required Status Check `secret-scan` en el Ruleset de `main`: **configurado** (bloquea merge si falla).
  - Setup local: [`docs/SEC-009.1-gitleaks-local-setup.md`](docs/SEC-009.1-gitleaks-local-setup.md)
  - Design: [`docs/SEC-009.1-secret-scanning-implementation-design.md`](docs/SEC-009.1-secret-scanning-implementation-design.md)
  - **No** incluye: baseline, `.gitleaksignore`, pre-commit, SAST, SCA.
- [x] **SEC-009.2** — Dependency Scanning MVP — **IMPLEMENTED / COMPLETED**
  - `audit:deps` en root `package.json`; job `dependency-scan` en `.github/workflows/ci.yml` (leaf, `contents: read`, `checkout@v4`, Node 22, `npm ci` root + backend, `npm run audit:deps`).
  - Remediación previa (commit aparte): `next` 16.2.9 → 16.3.2; root y backend **0 vulnerabilities** (`--audit-level=high`).
  - Validación: tests 399 / security 19 / backend 567; tsc y build root+backend PASS; `npm run audit:deps` PASS.
  - Design: [`docs/SEC-009.2-dependency-scanning-implementation-design.md`](docs/SEC-009.2-dependency-scanning-implementation-design.md)
  - Required Status Check `dependency-scan` en el Ruleset de `main`: **configurado / activo** (bloquea merge si falla).

---

## Activo — Fase A (Production & SaaS Readiness)

**Objetivo:** Cerrar gaps de seguridad, SEO técnico, legal y observabilidad básica para lanzamiento comercial. Detalle de cada ticket (temas, estado, archivos) en [`docs/ROADMAP.md`](docs/ROADMAP.md) → Fase A.

### A.1 — SEO Técnico & Landing Pública
- [ ] **SEO-001** — Landing page pública `/` (hoy redirige a `/login`) — value prop, CTA, branding, metadata, OG, responsive, contacto, legal links.
- [ ] **SEO-002** — Página 404 propia (`not-found.tsx`) — branded, CTA a `/login`, search params preservation.
- [ ] **SEO-003** — Meta tags por página (title, description, OG) — login, auth pages, public reservation link, dashboards. Hoy solo metadata global.
- [ ] **SEO-004** — `robots.ts` / `robots.txt` — disallow `/admin/`, `/agency/`, `/api/`, `/reservations/link/`; sitemap reference.
- [ ] **SEO-005** — `sitemap.ts` / `sitemap.xml` — URLs públicas.
- [ ] **SEO-006** — Favicon completo (ico multi-size, apple-touch-icon, manifest.json) — parcial.
- [ ] **SEO-007** — OG image dinámica para reservation links — planificado.
- [ ] **SEO-008** — Image optimization (`next/image` para assets estáticos) — planificado.

### A.2 — Legal & Trust
- [ ] **LEGAL-001** — Privacy Policy (`/privacy`).
- [ ] **LEGAL-002** — Terms & Conditions (`/terms`).
- [ ] **LEGAL-003** — Cookie Policy (`/cookies`) — solo cookies esenciales Supabase; sin banner si solo esenciales.
- [ ] **LEGAL-004** — Contact page (`/contact`) — form + honeypot + rate limit + email; footer global con links legales.
- [ ] **LEGAL-005** — Email sender identity (DMARC/SPF/DKIM) — verificar.

### A.3 — Analytics
- [ ] **ANALYTICS-001** — Decisión de producto: herramienta analytics (Vercel Analytics vs Plausible). **No implementar hasta decidir.**
- [ ] **ANALYTICS-002** — Implementación técnica — **bloqueada** por ANALYTICS-001.

### A.4 — Seguridad Crítica
- [ ] **SEC-010** — Rate limiting global + per-tenant en `/api/agency/*`, `/api/admin/*` (hoy solo auth y public links).
- [ ] **SEC-011** — CSP header configurado.
- [ ] **SEC-012** — Verificar `.env` no commiteado (`.gitignore` + secretos en Render/Vercel) — verificar.
- [ ] **SEC-013** — Verificar `trust proxy` contra Render — verificar.
- [ ] **SEC-014** — Password reset progressive lockout — evaluar.

### A.5 — Observabilidad Básica
- [ ] **OBS-001** — Readiness health check (`/readyz`) — DB connectivity; complementa `/healthz`.
- [x] **OBS-002** — Uptime monitoring — Sentry Uptime **configurado** (experimental).
- [x] **OBS-003** — Sentry API + Worker operativo — **COMPLETED** (WKR-006.2; graceful shutdown `flushSentry(2000)` en API y Worker).

---

## Completado recientemente — Fase 5 + post-sprint UX

- [x] **F5-001** — Audit Trail (foundation) — **Implementado**
  - Diseño: [`docs/F5-001-audit-trail-design.md`](docs/F5-001-audit-trail-design.md)
- [x] **F5-002** — Audit Trail Read API — **Implementado**
  - `GET /api/admin/audit` y `GET /api/agency/audit` (read-only, cursor, 90d, sanitización por rol)
- [x] **F5-003** — Audit Trail UI — **Implementado**
  - `/admin/audit`, `/agency/audit`; gate UI temporal (un SUPERADMIN; agencias ocultas)
- [x] **Post-sprint** — Bloquear reservas si `departure_time <= now()` — **Implementado** (`066`, UX «Ya salió»)
- [x] **Post-sprint** — Notificaciones: actor = nombre de agencia — **Implementado**
- [x] **Post-sprint** — Notificaciones in-app: solo destino — **Implementado**
- [x] **Post-sprint** — Boleto: solo destino — **Implementado** (`origin` conservado en modelo)
- [x] **Infra / Ops** — Backup & Disaster Recovery MVP — **Implementado** (GitHub Actions → age → R2)
- [x] **Infra / Ops** — Backup local de contingencia — **Implementado** (copia manual cifrada de artefactos R2; scripts `local*.sh`; no scheduler)
  - Tutorial operativo: [`docs/backup-local-contingency.md`](docs/backup-local-contingency.md)
- [x] **F5-004** — Reserva asistida por enlace — **CLOSED**
  - Diseño: [`docs/F5-004-reserva-asistida-por-enlace-design.md`](docs/F5-004-reserva-asistida-por-enlace-design.md)
  - Migrations tip `072`; wizard + página pública `/reservations/link`; Realtime agencia (`070`); tutorial CLI: [`docs/TUTORIAL-SUPABASE-MIGRACIONES.md`](docs/TUTORIAL-SUPABASE-MIGRACIONES.md)

Detalle: [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md) (sprints 21–30). Operación backup automático: [`docs/backup-disaster-recovery-operations.md`](docs/backup-disaster-recovery-operations.md). Emergencia: [`docs/backup-disaster-recovery-runbook.md`](docs/backup-disaster-recovery-runbook.md). Copia local: [`docs/backup-local-contingency.md`](docs/backup-local-contingency.md).

Migraciones `065`–`072` aplicadas / validadas en el flujo Staging→Prod documentado; harnesses F5-001 / F5-004 PASS donde corresponda.

**GitHub (backup):** 9 secrets cargados; bucket R2 `nomadas-backups` privado; cron diario + `workflow_dispatch` operativos; contrato Auth en dump (`auth_included=true`). Copia local manual: `scripts/backup/local*.sh` + tutorial [`docs/backup-local-contingency.md`](docs/backup-local-contingency.md). Restore drill trimestral **pendiente** (no reutilizar backup `20260817T233641Z-32081141864`). Referencia de backup validado reciente: `20260818T045852Z-32101100102`. Secrets: ver operations.

---

## Completado — Fase 4 (Automatizaciones)

- [x] **F4-004** — Occupancy Urgency Alerts (in-app) — **CLOSED**
  - Diseño: [`docs/F4-004-occupancy-urgency-alerts-design.md`](docs/F4-004-occupancy-urgency-alerts-design.md)

- [x] **F4-003** — Occupancy Alerts (in-app) — **CLOSED**
  - Diseño: [`docs/F4-003-occupancy-alerts-design.md`](docs/F4-003-occupancy-alerts-design.md)

- [x] **F4-002** — Superadmin Daily Digest (email) — **CLOSED**
  - Diseño: [`docs/F4-002-superadmin-daily-digest-design.md`](docs/F4-002-superadmin-daily-digest-design.md)

- [x] **F4-001** — Agency Daily Digest (email) — **CLOSED**
  - Diseño: [`docs/F4-001-agency-daily-digest-design.md`](docs/F4-001-agency-daily-digest-design.md)

Detalle y evidencia de cutover: [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md).

**Render (worker) — F4 occupancy (operativo):**

| Variable                       | Valor     |
| ------------------------------ | --------- |
| `OCCUPANCY_ALERT_VIA_WORKER`   | `true`    |
| `OCCUPANCY_ALERT_POLL_MS`      | `3600000` |
| `OCCUPANCY_ALERT_BATCH`        | `50`      |
| `OCCUPANCY_URGENCY_VIA_WORKER` | `true`    |

---

## Completado — Fase 3 (Workers + observability)

- [x] WKR-001 … WKR-009 — outbox, email/trip/reminder workers, observabilidad, retention. Detalle: [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)

---

## Próxima iniciativa — Auto-servicio de rutas y viajes por agencia (DESCUBRIMIENTO COMPLETO + AS-TRIP-001/002/003, 2026-11-10)

**Dirección:** la agencia pasa a **autogestionar sus rutas y viajes sobre
sus propios datos** (hoy la alta y edición de rutas depende del
superadmin; la alta de viajes ya la puede hacer la agencia). El
**descubrimiento cerró** (DISC-AS-01…05) y los primeros
incrementos de implementación (**AS-TRIP-001** autorización de estado,
**AS-TRIP-002** UI "Completar viaje", **AS-TRIP-003** alta de viaje por la
agencia) ya están entregados; el resto
sigue siendo **ítems de alcance** para convertirlos en tickets de fase. No
se inventan requisitos — cada ítem se resuelve con evidencia del dominio
existente.

**Reglas que no cambian:** RLS y aislamiento por `agency_id`, autorización
de backend desde `public.users`, rol superadmin intacto; **reusar el dominio
existente** (trips, rutas, vehículos, layouts, estados, triggers,
`audit_log`); sin tablas ni conceptos nuevos salvo que el descubrimiento lo
pruebe necesario. No duplica tickets del marketplace (checkout, pagos y
reservas B2C viven en `nomadas-tour-marketplace`).

- [x] **DISC-AS-01** — Alcance de rutas: CRUD de rutas de la agencia vs
  alta/edición por superadmin, y efecto sobre viajes ya publicados.
  - **Verificado:** Rutas son entidades globales sin `agency_id` en la tabla.
    Migración 001 crea `routes(id, origin, destination, duration_minutes, created_at)`;
    la **006 elimina `duration_minutes`** (`DROP COLUMN IF EXISTS`) y agrega
    `created_by`/`updated_at`; la 011 (create_all) define
    `routes(id, origin, destination)`; por lo tanto **`duration_minutes` NO
    existe en la BD actual** (ver AS-TRIP-003.1).
    Migración 021 agrega `status TEXT NOT NULL DEFAULT 'active'` con CHECK
    `status IN ('active', 'inactive')` e índice `idx_routes_status`.
    RLS `routes_superadmin_all` solo permite superadmin modificar rutas.
    **No hay endpoint ni mecanismo para que agencias toggleen estado global.**
  - **Decisión establecida:** Routes remain global; agencies cannot toggle
    global route status. Any agency route management requires a separate
    `agency_routes` relationship (not yet implemented).

- [x] **DISC-AS-02** — Edición de viajes con reservas existentes: reglas
  actuales (validaciones, ventanas cercanas a la salida, «Ya salió») y qué
  acciones quedan permitidas o restringidas para la agencia.
  - **Verificado:** Los statuses de trip en la BD CHECK son
    `'active'`, `'cancelled'`, `'completed'` (migración 011) **y
    `'archived'` (agregado por la migración 033)**. **No hay `'inactive'`**
    en ninguna restricción de la BD. Agencies pueden ver sus trips
    asignados vía `getAgencyTrips` (filtro por `agency_id` en
    `trip_agencies`).
    - Código en `reservation.service.ts` línea 1182:
      `if (trip.status === 'archived')` lanza error 'Trip not found',
      consistente con que `archived` **sí** está en la restricción CHECK.
  - **Acción permitida (en el momento del descubrimiento):** Agencies can
    view their assigned trips; no podían modificar status ni campos
    fundamentales de un trip.
  - **Decisión establecida:** `archived` es un estado **soportado** y de
    **solo-superadmin** (visibilidad administrativa, conserva todo el
    historial; no existe operación de des-archivar). `'inactive'` **nunca**
    debe introducirse. El alcance de escritura de la agencia sobre sus
    viajes se resolvió después en **AS-TRIP-001** (solo completar viajes
    exclusivos).

- [x] **DISC-AS-03** — Permisos y aislamiento: qué acciones quedan
  libremente de agencia y cuáles exigen superadmin (p. ej. publicación en
  el marketplace); verificación RLS sin acceso cruzado entre agencias.
  - **Verificado:** Autorización RPC + RLS en cada RPC afecta-agencia:
    `cancel_agency_reservation` valida `p_agency_id` coincide con
    `reservation.agency_id`; `boarding_toggle` valida vía
    `p_operator_agency_id`; `lockSeat`/`unlockSeat` valida
    `trip_agencies.agency_id`; `cancelPassenger` valida
    `reservation.agency_id`. Policies SQL: `reservations_agency_read`/
    `reservations_agency_insert` filtran por JWT `agency_id`. No hay acceso
    cruzado entre agencias posible sin parámetro `agency_id`.
  - **Discrepancia corregida:** Asumición anterior de que agencies pueden
    cambiar status de trip a `'inactive'` fue **incorrecta** — `'inactive'` no
    es status soportado en BD y el código valida `trip.status !== 'active'` para
    bloquear modificaciones.
  - **Decisión establecida:** El patrón RPC + RLS `agency_id` es el modelo
    correcto. Cualquier nueva operación de agency route/trip debe validar
    `agency_id` en el nivel RPC, nunca confiar en restricciones frontend-only.

- [x] **DISC-AS-04** — Validación de datos y reuso de UI: ocupación,
  layouts kia/bus, precios, horarios; qué formularios/componentes
  existentes se reutilizan (evitar duplicar pantallas).
  - **Verificado:** Panel agencia existente `/agency/settings/branding` con
    `AgencySettingsForm` (esquema Zod: logo_url URL, colores hex, cover_url URL,
    descripción máx. 2000, eslogan máx. 160). Navegación Admin sidebar.
    Dashboard `/admin/bookings` con tablas de trips/reservas/boarding.
    Componentes reutilizables: `ConfirmModal`, tablas, inputs DM Sans.
  - **Decisión establecida:** UI de route/trip management debe extender patrones
    existentes del panel agencia (validación de formularios, confirmaciones
    modales, listas de tablas) en lugar de crear nueva librería de componentes.
    Reutilizar tipografía DM Sans, paleta terracota/navy y patrón `ConfirmModal`.

- [x] **DISC-AS-05** — Auditoría y ubicación: eventos `audit_log` nuevos
  para cada acción de auto-servicio (reusar F5-001…F5-003) y dónde vive la
  gestión en el panel de agencia existente.
  - **Verificado:** `audit_append()` (migración 065) ya soporta grabación de
    eventos agency: actor_user_id, category ('agency'), agency_id, entity type,
    table name, entity_id, before/after JSONB, metadata. Ya usado para: cambios
    status trip, cambios reservation, eventos boarding, updates branding,
    preferences notification. UI auditoría en `/admin/audit` y `/agency/audit`
    (puerta F5-001…F5-003, gate superadmin solo).
  - **Decisión establecida:** Reutilizar existente `audit_append` para acciones
    de route/trip (cambios status, assignments, edits). No se requieren nuevas
    tablas o RPCs para auditoría básica de route/trip.

- [x] **AS-TRIP-001** — Autorización de transiciones de estado de viaje y
  salvaguardas de negocio (**IMPLEMENTADO, 2026-11-10**).
  - **Migración nueva:** `supabase/migrations/104_trip_status_authorization.sql`
    (**ya aplicada a Supabase**, según el contexto de AS-TRIP-002; este
    ticket no ejecuta aplicaciones de migración). Re-crea
    `set_trip_status(UUID, TEXT, UUID)` con:
    - actor obligatorio; rol y `agency_id` resueltos en `public.users`
      (el `service_role` del backend no puede evadir la autorización);
    - `agency` solo completa y solo si `trip_agencies` tiene **exactamente
      una** fila y es la suya (exclusividad leída en la misma transacción,
      no declarada por el cliente);
    - `agency` no cancela viajes completos ni archiva;
    - guarda `ERR_TRIP_HAS_RESERVATIONS` al cancelar (reservas vivas =
      `status <> 'cancelled'`), en la misma transacción que el `UPDATE`;
    - release de asientos + `lock_expires_at` y evento outbox con
      `dedup_key trip.<status>:<trip_id>` **sin cambios** (exactamente una
      vez);
    - `REVOKE/GRANT` re-emitidos: `EXECUTE` solo a `service_role`;
    - trigger `reservations_trip_status_guard` (`BEFORE INSERT`, `FOR SHARE`
      sobre el viaje) que cierra la carrera cancelar-reserva concurrente.
  - **Backend:**
    - `superadmin.service.updateTripStatus()` ya **no** hace `UPDATE`
      directo sobre `trips.status`: siempre invoca el RPC, con
      validación de ventanas de salida y autorización previas. Igual en
      ambas configuraciones de `TRIP_EFFECTS_VIA_OUTBOX` (los efectos
      legacy se emiten in-process solo cuando el flag está `false`).
    - `archiveTrip(id, actor)` superadmin-only en el servicio.
    - Controlador superadmin pasa `req.ctx` como actor (nunca body/query).
    - **Nuevo** `PATCH /api/agency/trips/:tripId/status` acepta únicamente
      `{ "status": "completed" }` (`controllers/agency-trip.controller.ts`).
  - **Tests:** matriz completa en `superadmin.trip-status.test.ts` (21) +
    `trip-status.controller.test.ts` (actor de sesión, body spoofed
    ignorado) + actualizados `superadmin.service.test.ts` y
    `reservation.service.cancel.test.ts` (cancel individual independiente).
    Suite backend **84 archivos / 781 tests ✅**; suite raíz **75 archivos /
    718 passed, 4 skipped ✅**; `tsc --noEmit`, `backend build` y
    `next build` **exit 0**.
  - **Pendiente (fuera de este ticket):** UI en panel de agencia para
    completar viaje → **hecho en AS-TRIP-002**; sistema de reembolsos
    (requisito previo para poder cancelar un viaje con reservas);
    `agency_routes` sigue **proposal-only**.

- [x] **AS-TRIP-002** — UI de agencia: completar un viaje exclusivo
  (**IMPLEMENTADO, 2026-11-10**). Consume el endpoint de AS-TRIP-001; no
  reimplementa autorización ni toca RPC/migración.
  - **Acción "Completar viaje"** en la tarjeta del viaje
    (`components/agency/AgencyTripCard.tsx`, footer junto a "Ver
    pasajeros"). Visible **solo** cuando el viaje está `active`, **ya
    salió** (ventana de salida del backend) y es **exclusivo** de la
    agencia (`agency_count === 1`). No aparece en viajes compartidos, no
    salidos, completados/cancelados ni sin datos de exclusividad. No se
    agregan acciones de cancelar/archivar.
  - **Visibilidad:** el listado `GET /api/agency/trips` ahora incluye
    `agency_count` (lectura de `trip_agencies`, dato informativo — la
    autorización sigue siendo del backend en el PATCH).
  - **Flujo** (`app/agency/trips/AgencyTripsContent.tsx`): tarjeta →
    `ConfirmModal` ("El viaje … se marcará como completado") →
    `agencyApi.completeTrip()` (`PATCH /api/agency/trips/:tripId/status`
    con `{ "status": "completed" }`) → toast de éxito + refresco de la
    lista. Envío bloqueado mientras está en curso (botón + modal en
    loading, guarda en el handler).
  - **Errores:** 403 / 404 / 409 y errores de red traducidos a mensajes
    accionables con `toast.error`; **nunca** toast de éxito si la
    petición falla; el modal queda abierto para reintentar.
  - **Tests:** `components/agency/__tests__/AgencyTripCard.complete.test.tsx`
    (8: visibilidad por exclusividad/salida/estado + click + sin anidado
    en `<Link>`), `tests/agency/AgencyTripsContent.complete.test.tsx`
    (9: confirmación, éxito con refresco, cancelación sin llamada,
    visibilidad en lista, 403/404/409 sin éxito, doble envío bloqueado,
    error genérico) y `reservation.service.test.ts` (+`agency_count`).
    Suite backend **84 archivos / 782 tests ✅**; suite raíz **77
    archivos / 735 passed, 4 skipped ✅**; `tsc --noEmit` (raíz y
    backend), `backend build` y `next build` **exit 0**.
  - **Pendiente (fuera de este ticket):** alta/edición de rutas por la
    agencia (UI de route management), flujo de reembolsos.

- [x] **AS-TRIP-003** — Alta de viaje por la agencia sobre rutas globales
  (**IMPLEMENTADO, 2026-11-10**). Reutiliza el dominio de AS-TRIP-001/002;
  **sin migración nueva** (se reutilizan `create_trip`, `trip_agencies` y
  las validaciones existentes).
  - **Endpoint nuevo:** `POST /api/agency/trips` (`auth + authorize('agency')
    + tenant`) → `AgencyTripController.createTrip` →
    `superadminService.createAgencyTrip(ctx, input)`.
    - Schema Zod **strict**: solo `route_id`, `departure_time`,
      `vehicle_type` (`bus|kia`) y `seat_price` opcional (centavos).
      `agency_ids`, `agency_id`, `status`, `postpone`, `created_by`,
      `actor_user_id` o cualquier campo extra → **400** (no se filtran en
      silencio): imposible crear viajes compartidos o asignar otra agencia
      desde el cliente.
    - La agencia se deriva **solo** de `req.ctx`; el service re-verifica
      rol `agency`, `agency_id` presente y que la agencia exista y esté
      `active` (defensa en profundidad además del middleware `tenant`).
    - Delega en `createTrip(..., [ctx.agencyId], ctx.userId, ...)`:
      **exactamente una** fila en `trip_agencies`, atomicidad vía RPC
      `create_trip` (outbox) o rollback compensatorio asientos+viaje
      (legacy), y **todas** las validaciones existentes: ruta existente y
      activa, salida en el futuro, duplicado ruta+salida, vehículo/
      capacidad (bus=31, kia=10) y precio entero en centavos.
  - **Catálogo de rutas:** `GET /api/agency/routes` →
    `listRoutesCatalog()` (solo lectura, solo rutas `active`, sin métricas
    ni escritura). **Las rutas siguen siendo globales y superadmin-only.**
    El select solo usa columnas reales: `id, origin, destination, status`
    (ver **AS-TRIP-003.1**).
  - **Frontend:** alta desde **modal** en `/agency/trips` vía
    `AgencyTripBuilderModal` → `BuilderLayout variant="agency"` reutilizando
    `StepIndicator`, `RouteStep`, `ScheduleStep`, `VehicleStep` y
    `ReviewStep` del builder del superadmin (**AS-TRIP-003.1**; el incremento
    original usaba la página `/agency/trips/new`, hoy eliminada), más el CTA
    **"Nuevo viaje"** en el header de `/agency/trips`.
    - Sin rutas activas → EmptyState dentro del modal: *"…Las rutas son
      globales: solicita al superadmin la creación de la ruta que
      necesitas…"* **No se crea ninguna ruta específica de agencia.**
    - Sin paso de Agencias ni `agency_ids`: la agencia sale **siempre** de
      `req.ctx`.
    - Validación en cliente idéntica al builder (salida futura, precio
      requerido/entero); el backend vuelve a validar todo.
    - Éxito → cierra el modal + toast + refresca la lista (sin
      navegación). Error → mensaje **inline** con el modal **abierto** para
      reintentar, nunca toast de éxito si falla.
  - **Tests:** `backend/src/controllers/agency-trip.create.controller.test.ts`
    + bloque `createAgencyTrip`/`listRoutesCatalog` en
    `superadmin.service.test.ts` + `tests/agency/AgencyTripCreate.test.tsx`.
    Cubren: creación exitosa, asignación exacta a la agencia autenticada,
    rechazo de `agency_ids`/`agency_id` spoofed, rechazo de viajes
    compartidos, ruta inexistente/inactiva, vehículo inválido, salida
    pasada, duplicado, precio inválido, atomicidad (sin viaje ni asignación
    parciales), agencia inexistente/inactiva, rol no-agencia, y que la
    creación superadmin sigue intacta (suite completa).
  - **Pendiente (fuera de este ticket):** edición de viajes por la agencia,
    alta/edición de rutas (`agency_routes` proposal-only), flujo de
    reembolsos (**prerequisito para cancelar un viaje con reservas**).
  - **Verificación:** suite backend **85 archivos / 822 tests ✅**; suite
    raíz **78 archivos / 746 passed, 4 skipped ✅**; `test:security`
    **12 archivos / 133 tests ✅**; `npx tsc --noEmit` (raíz y backend),
    `backend build` (tsc) y `next build` **exit 0**; `git diff --check`
    **exit 0**. **Sin cambios de entorno** (ninguna env var nueva).

- [x] **AS-TRIP-003.1** — Corrección del catálogo de rutas + alta de viaje
  de la agencia en **modal** (**IMPLEMENTADO, 2026-11-11**). Sin migración
  (el schema real no la requería) y sin cambios de entorno.
  - **Corrección del error en producción** — `GET /api/agency/routes`
    respondía `VALIDATION_ERROR: column routes.duration_minutes does not
    exist`:
    - **Causa:** `listRoutesCatalog()` seleccionaba `duration_minutes`.
      La migración 001 la creó, la **006 la eliminó**
      (`ALTER TABLE routes DROP COLUMN IF EXISTS duration_minutes`) y la
      011 (create_all) solo define `routes(id, origin, destination)`; la
      021 agrega `status`. La columna **no existe** en la BD actual.
    - **Corrección:** select a columnas reales
      `id, origin, destination, status`. **No se inventó columnas ni se
      creó migración**: la duración nunca la consumió el frontend ni
      `RouteStep` (solo `origin → destination`), así que no se necesita.
    - **Contrato:** la respuesta es exactamente
      `Pick<Route, 'id' | 'origin' | 'destination' | 'status'>[]`, que es
      lo que esperan `agencyApi.listRoutes` y `RouteStep`; se quitó el
      `duration_minutes` opcional del tipo en `lib/api.ts`.
    - **Superadmin intacto:** su catálogo usa `listRoutes()`
      (`select("*")` + métricas), otro service; sin cambios.
  - **Investigación de navegación:** el único origen real de la navegación
    a `/agency/trips/new` era el CTA `router.push('/agency/trips/new')`
    del header de `/agency/trips` (sin middleware, redirects ni
    navegación post-creación involucrados). Con la alta pasada a modal,
    esa navegación desaparece: el CTA **abre el modal en la misma lista**,
    el éxito cierra + toast + `doFetch()` y el error **no navega** (el
    modal queda abierto).
  - **UX modal (alineada a la del superadmin):** `AgencyTripBuilderModal`
    envuelve el **mismo** `BuilderLayout` con `variant="agency"` (prop
    opcional por defecto `'admin'` → el builder del superadmin no cambia):
    mismos pasos, validaciones y componentes (`StepIndicator`, `RouteStep`,
    `ScheduleStep`, `VehicleStep`, `ReviewStep`).
    - 4 pasos (Ruta → Programación → Vehículo → Revisión): **sin paso de
      Agencias, sin `agency_ids` ni configuración de viaje compartido**.
    - Rutas: solo el catálogo **global activo** vía `GET /api/agency/routes`;
      vacío → *"…solicita al superadmin…"*; fallo de carga → **Reintentar**
      dentro del modal.
    - Vehículos: los tipos soportados (`bus`=31 / `kia`=10); no existe
      inventario de vehículos por agencia en el esquema — la capacidad y la
      asignación del viaje a la agencia autenticada las valida el backend
      (`createAgencyTrip` → `createTrip`, agencia siempre de `req.ctx`).
    - Éxito → cierra el modal, toast `Viaje creado correctamente` y
      refresca la lista; error → mensaje inline, modal **abierto** para
      reintentar, nunca éxito falso ni navegación.
  - **Eliminado:** `app/agency/trips/new/page.tsx` y todas sus
    referencias (CTA, tipos y tests).
  - **Tests nuevos/actualizados:**
    `superadmin.service.test.ts` → select `id, origin, destination,
    status` + **contrato contra las migraciones** (deriva las columnas de
    `routes` desde `supabase/migrations/*.sql` y exige que el select solo
    use columnas existentes y que `duration_minutes` ya no esté) +
    chequeo de que ninguna fuente del backend la referencia en código;
    `tests/agency/AgencyTripCreate.test.tsx` reescrita para el modal (12
    tests): CTA sin navegar, catálogo por `/agency/routes` sin tocar
    endpoints de admin, payload sin agencia, cierre + toast + refresh,
    estado vacío, reintento de carga, revisión sin agencias, validaciones
    (salida pasada, precio requerido/entero), error 409/red con modal
    abierto y doble envío bloqueado.
  - **Verificación:** suite raíz **78 archivos / 747 passed, 4 skipped ✅**;
    suite backend **85 archivos / 824 tests ✅**; `test:security`
    **12 archivos / 133 tests ✅**; `npx tsc --noEmit` raíz y backend
    **exit 0**; `next build` **exit 0** (sin `/agency/trips/new`) y
    `backend build` (tsc) **exit 0**; `git diff --check` **exit 0**.
    **Sin migraciones, sin nuevas env vars, sin commit/push/deploy.**

**Relación con las fases:** la **Fase A sigue en progreso** y conserva su
prioridad crítica; esta iniciativa se planifica en paralelo **sin cerrar ni
reordenar** Fases B–E, F5 resto ni SEC-009 (009.3 sigue cancelada). Detalle
de la dirección en [`docs/ROADMAP.md`](docs/ROADMAP.md) → Próxima iniciativa
de producto.

- **Hallazgos de validación DISC-AS-01 a 05:** corregidas suposiciones
  previas (routes son globales sin agency_id; `'inactive'` no es status de
  viaje en la BD; `'archived'` **sí** está en la CHECK desde la migración
  033 — la "discrepancia abierta" quedó cerrada; agencies eran solo lectura
  en trips hasta AS-TRIP-001/002). Requerimientos pendientes:
  - diseño `agency_routes` table (**proposal-only, no implementar**),
  - panel UI para **alta/edición de rutas** por la agencia (la alta de
    **viajes** ya está entregada en **AS-TRIP-003** y la acción
    "Completar viaje" en **AS-TRIP-002**; la **edición** de viajes sigue
    pendiente),
  - flujo de reembolsos (bloquea cancelar viaje con reservas).

---

## Después (producto / follow-ups)

| Orden | Ticket / Fase                 | Tema                                                                                                                                                                                                                                                                                                                                                                              | Estado      |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| —     | **Próxima iniciativa**        | Auto-servicio de rutas y viajes por agencia (descubrimiento **DISC-AS-01…05** completado; **AS-TRIP-001** autorización de estado de viaje, **AS-TRIP-002** UI "Completar viaje" y **AS-TRIP-003** alta de viaje por la agencia IMPLEMENTADOS; resto: alta/edición de rutas y edición de viajes, `agency_routes` proposal-only, reembolsos)                                    | En curso (3 incrementos listos) |
| —     | **Fase A**                    | SEO (SEO-001…008), Legal (LEGAL-001…005), Analytics (ANALYTICS-001/002), SEC-010…014, OBS-001. Ver [`docs/ROADMAP.md`](docs/ROADMAP.md)                                                                                                                                                                                                                                            | En progreso |
| —     | **Fase B (Professional UX)**  | UX-001…011 (accesibilidad, mobile, estados de error, focus, contraste)                                                                                                                                                                                                                                                                                                            | Planificada |
| —     | **Fase C (Reliability & Perf)**| REL-001…006 (readiness, timeouts, paginación, métricas)                                                                                                                                                                                                                                                                                                                           | Planificada |
| —     | **Fase D (Scale)**            | SCALE-001…005 (worker separado, Redis, load test, querys, realtime) — futura bajo evidencia                                                                                                                                                                                                                                                                                       | Diferida   |
| —     | **Fase E (Adv Observability)**| OBS-004…007 (Sentry frontend, SLOs, correlation ID, dashboard ops) — futura                                                                                                                                                                                                                                                                                                       | Diferida   |
| —     | **F5 resto**                  | Invitaciones/usuarios en audit; correlation ID; retención/purge; quitar gate UI temporal                                                                                                                                                                                                                                                                                          | Futura      |
| —     | Futuro / Fase 6               | Métricas históricas y reporting (REP-001…004)                                                                                                                                                                                                                                                                                                                                      | Futura      |
| —     | Infraestructura / Operaciones | Restore drill trimestral (manual)                                                                                                                                                                                                                                                                                                                                                 | Futura      |
| —     | Follow-up                     | Migración timers `LockCleanup` / `completeExpiredTrips`                                                                                                                                                                                                                                                                                                                           | Futura      |
| —     | Follow-up                     | Retention `boarding_attempts`                                                                                                                                                                                                                                                                                                                                                     | Futura      |
| —     | Follow-up                     | Normalizar occupancy en `reservation.service.ts`                                                                                                                                                                                                                                                                                                                                  | Futura      |
| —     | **SEC-009**                   | Continuous Security Validation (≠ Sentry, ≠ Fase 8). **009.0** COMPLETED. **009.1** COMPLETED. **009.2** IMPLEMENTED / COMPLETED (`dependency-scan` Required Status Check activo). SEC-009 permanece **abierto**. Detalle: [`docs/ROADMAP.md`](docs/ROADMAP.md), [`docs/SEC-009-continuous-security-validation-design.md`](docs/SEC-009-continuous-security-validation-design.md) | En progreso |

---

## Bloqueadores

_Ninguno. Sprint: **Fase A** en progreso. SEC-009 abierto (009.0/.1/.2 COMPLETED). F4/F5 cerrados. Backup + tutoriales operativos. Restore drill trimestral pendiente._

---

## Ideas futuras

- **Background Worker nativo** — cuando el plan de hosting lo permita (sin HTTP)
- **UX continua** — responsive, accesibilidad, skeletons (ROADMAP Fase B)
- **Escalabilidad** — load/stress/capacity, caché, índices, costos (ROADMAP Fase D; ≠ SEC-009)
- **Hexagonal / Ports & Adapters** — evaluación oportunista en features nuevas complejas (ROADMAP; sin rewrite global)
- **Sentry frontend / Performance / Replay** — fuera de WKR-006.2 (ROADMAP OBS-004)
- **Email occupancy_alerts** — requiere Resend comercial
- **UI prefs `superadmin_digest`** — v1 es seed + gate de envío
- **Dashboard superadmin de alertas activas** — v1 usa in-app existente
- **Quitar gate UI del audit trail** — cuando la UI deje de ser demasiado técnica
- **Audit: invitaciones / correlation / retención** — fuera de F5-001…F5-003
