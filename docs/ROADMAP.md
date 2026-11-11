# Nómadas Tour — Roadmap de producto

**Visión:** Convertir Nómadas Tour en un SaaS comercializable para agencias de viajes.  
**Alcance de este documento:** Dirección de mediano y largo plazo. No es un backlog técnico de sprint.  
**Ejecución operativa:** Ver [TASKS.md](../TASKS.md).

**Última actualización:** 2026-11-10

---

## Estado actual

Nómadas Tour superó la etapa de corrección arquitectónica. La plataforma opera como un **centro de operaciones multi-tenant** con capacidades de producción validadas:

| Capacidad                                                              | Estado                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Multi-tenant (aislamiento comercial + operación compartida controlada) | Operativo                                                                                              |
| Reservas por agencia (wizard, pasajeros, QR)                           | Operativo                                                                                              |
| Seat locks + concurrencia + idempotencia                               | Operativo                                                                                              |
| Scanner / Boarding por pasajero                                        | Operativo                                                                                              |
| Realtime (asientos, reservas, dashboards)                              | Operativo                                                                                              |
| Seguridad endurecida (RLS desde public.users, suite SEC-007/008/009) | Operativo                                                                                              |
| Notificaciones (in-app + email)                                        | Operativo                                                                                              |
| Deploy estabilizado (dist fuera de Git, build en Render)             | Operativo                                                                                              |
| Cancelación de viajes con reservas                                     | Operativo                                                                                              |
| Agencia desactivada con logout forzado                                 | Operativo                                                                                              |
| Edición de viajes con reservas existentes                              | Operativo                                                                                              |
| Estados inválidos protegidos                                           | Operativo                                                                                              |
| Branding configurable por agencia (logo + colores runtime)             | Operativo                                                                                              |
| Transactional Outbox + EmailWorker (eservation.created.v1)          | Operativo (WKR-004/005)                                                                                |
| Reminders T-48h / T-24h                                                | Operativo (WKR-008)                                                                                    |
| Digest diario agencias                                                 | Operativo (F4-001)                                                                                     |
| Digest diario superadmin                                               | Operativo (F4-002)                                                                                     |
| Alertas de ocupación (in-app)                                          | Operativo / Completado (F4-003)                                                                        |
| Escalación de urgencia de ocupación (T-24h, in-app)                    | Operativo / Completado (F4-004)                                                                        |
| Audit trail (append-only + lectura API/UI)                             | Operativo (F5-001...F5-003; gate UI temporal)                                                            |
| Integridad: no reservar tras departure_time                          | Operativo (RPC `066` + UX «Ya salió»)                                                               |
| Notificaciones in-app: actor = agencia; ruta = destino                 | Operativo (copy; dominio intacto)                                                                      |
| Boleto: solo destino                                                   | Operativo (origin conservado en modelo)                                                              |
| Reserva asistida por enlace (wizard + página pública)                  | Operativo (F5-004; tip `072`)                                                                        |
| Backup & DR automático (dump lógico diario cifrado en R2)              | Operativo / MVP (GitHub Actions 03:00 UTC; Auth core en data.sql; drill trimestral pendiente)        |
| Backup local de contingencia (copia manual offline)                    | Operativo (scripts local*.sh; tutorial [ackup-local-contingency.md](backup-local-contingency.md)) |
| Sentry (API + Worker)                                                  | Operativo (WKR-006.2)                                                                                  |
| Sentry Uptime                                                          | Configurado / Experimental                                                                             |
| Marketplace: catálogo público + wizard de reserva (repo hermano)       | Operativo (`nomadas-tour-marketplace`, Fases 0–1)                                                      |
| Marketplace: checkout con revisión de comprobante (MKT-007)            | Operativo (`checkout_attempts`; reserva/pago solo en aprobación atómica)                               |
| Marketplace: panel de revisión de pagos de agencia (MKT-006)           | Operativo (`/agency/payments`; verificación por `attempt_id`)                                          |
| Marketplace: historial de compras + boleto QR (RT-01…RT-03)           | Operativo (`/account/purchases`; QR reutiliza `reservations.qr_code`; sin cambios en tour)              |

**Fundación completada (referencia histórica):** alineación backend, dominio superadmin, flujo de reservas, abordaje QR, dashboards, design system, vehicle layouts, realtime global y hardening de seguridad. Detalle de sprints en [TASKS-HISTORY.md](TASKS-HISTORY.md).

El producto ya no es únicamente un proyecto de portafolio: entra en fase de **comercialización y valor para agencias**.

---

## Principios del producto

Estos principios guían decisiones de producto, arquitectura y priorización:

1. **Seguridad primero** — Autorización desde fuentes confiables (public.users, RLS, backend). Nunca delegar permisos a metadata del cliente ni al frontend.

2. **Integridad de reservas** — Una reserva es un contrato operativo: asientos, pasajeros y estados deben ser consistentes bajo concurrencia, cancelaciones y cambios de viaje.

3. **Multi-tenancy desde el diseño** — Los datos comerciales permanecen aislados por agencia. Las excepciones operacionales, como boarding en viajes compartidos, requieren autorización explícita y acotada según [ADR-001](decisions/ADR-001-boarding-cross-agency.md).

4. **Automatizar antes que aumentar carga operativa** — Si una tarea se repite diariamente (recordatorios, limpieza, alertas), debe tender a automatizarse, no a depender de memoria humana.

5. **Configuración antes que personalización mediante código** — Branding, datos comerciales y preferencias deben ser editables por la agencia sin despliegues ni forks por cliente.

6. **Escalabilidad y mantenibilidad** — Preferir procesos en segundo plano, observabilidad y límites claros sobre parches ad hoc en request/response.

---

## Roadmap visual — secuencia actual

`	ext
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
  SEC-001 ... SEC-008                        ✅ (hardening cerrado)
  SEC-009  Continuous security validation  → abierto (009.0 ✅; 009.1 ✅; 009.2 ✅; 009.3 Phase 3 DESCARTADA — Phase 1 DB/RLS y Phase 2 RPC son los controles validados)

FASE 4 — Automatizaciones (producto)
  F4-001  Agency Daily Digest            ✅
  F4-002  Superadmin Daily Digest        ✅
  F4-003  Occupancy Alerts               ✅
  F4-004  Occupancy Urgency Alerts       ✅
  (métricas nocturnas → futuro / Fase 6 / reporting)

FASE Infraestructura / Operaciones
  Backup & Disaster Recovery MVP         ✅
  Restore drill trimestral               → futura (manual)
  Backup local de contingencia           ✅

FASE 5 — Audit Trail
  F5-001  Audit trail foundation         ✅
  F5-002  Read API                       ✅
  F5-003  UI                             ✅
  F5-004  Reserva asistida por enlace    ✅
  F5 resto                               → futura

FASE A — Production & SaaS Readiness     → EN PROGRESO
FASE B — Professional UX                 → PLANIFICADA
FASE C — Reliability & Performance       → PLANIFICADA
FASE D — Scale                           → FUTURA (bajo evidencia)
FASE E — Advanced Observability          → FUTURA (bajo evidencia)
FASE 6 — Reportes                        → FUTURA
FASE 7 — UX (legacy, ver Fase B)         → INTEGRADA EN FASE B
FASE 8 — Escalabilidad (ver Fase D)      → INTEGRADA EN FASE D

PRÓXIMA INICIATIVA — Auto-servicio de rutas y viajes por agencia → DESCUBRIMIENTO COMPLETO + AS-TRIP-001/002/003 IMPLEMENTADOS (2026-11-10)
`

---

## Próxima iniciativa de producto (2026-11-10): auto-servicio de rutas y viajes por agencia

**Dirección de producto:** la siguiente iniciativa de Nómadas Tour es dar a
la agencia **autogestión de sus rutas y viajes sobre sus propios datos** —
hoy la alta y edición de rutas/viajes depende del superadmin, y la agencia
opera su día a día sin administrar su propia oferta.

**Hallazgos de descubrimiento validados (DISC-AS-01 a 05):**

1. **Routes son entidades globales** - No tienen `agency_id` en la tabla.
   La alta y modificación de rutas son superadmin-only por RLS
   `routes_superadmin_all`. Agencies **no pueden togglear** estado global
   de routes. Cualquier modelo de agency route management requiere una
   tabla `agency_routes` separada (diseño pendiente de definir).

2. **Status de trip validados** - Los statuses soportados por CHECK en la
   BD son `'active'`, `'cancelled'`, `'completed'` (migración 011) **y
   `'archived'` (migración 033)**. `'inactive'` **no es un status
   soportado** y **nunca debe introducirse**. Agencies tenían acceso de
   solo-lectura a sus trips asignados; desde **AS-TRIP-001/002** pueden
   **completar** viajes asignados en exclusiva que ya salieron, desde la
   UI "Completar viaje" de su panel (nunca cancelar viajes completos ni
   archivar), y desde **AS-TRIP-003** pueden **crear** un viaje nuevo
   asignado en exclusiva a su propia agencia eligiendo una ruta global
   activa (`POST /api/agency/trips`, `agency_ids` rechazado por schema
   strict).

3. **Autorización RPC + RLS** - El patrón de autorización por RPC con validación
   de `agency_id` es el modelo correcto y ya está implementado en todos los RPCs
   afecta-agencia (`cancel_agency_reservation`, `boarding_toggle`,
   `lockSeat`/`unlockSeat`, `cancelPassenger`). No se debe confiar en
   restricciones frontend-only. El acceso cruzado entre agencias está
   prohibido por políticas SQL en `reservations.agency_id` y
   `trip_agencies.agency_id`.

4. **Auditoría reutilizable** - `audit_append()` (migración 065) soporta
   grabación de todos los events agency necesarios sin requerir nuevas
   tablas o RPCs. Se usa categoría `'agency'` con constraints de acción
   predefinidas.

5. **Discrepancia `archived` — CERRADA** - `'archived'` **sí** está en la
   restricción CHECK de la BD desde la migración
   `033_add_trip_archived_status.sql`; el código aplicación y la BD son
   consistentes. Archivar es superadmin-only, limitado a viajes
   completed/cancelled, conserva todo el historial y no existe operación
   de des-archivar.

**Alcance propuesto (a validar — requisitos no inventados):**

- **Preservar routes globales** - Rutas existentes continúan sin cambios.
  Evaluar tabla `agency_routes` para gestión agency-specific de routes.
  Mantener compatibilidad con trips y routes globales existentes.
  **La creación/edición de rutas por la agencia NO está soportada** y
  requiere una **decisión de producto aparte**; AS-TRIP-003 solo permite
  **seleccionar** rutas globales existentes desde el catálogo
  (`GET /api/agency/routes`) y explica al usuario que una ruta faltante
  se solicita al superadmin (sin workaround de rutas de agencia).

- **Definir permisos agency** - Evaluar qué acciones pueden realizar agencies
  sobre sus routes/trips designados vs. qué requiere superadmin. El patrón
  actual RPC + RLS `agency_id` es la base.

- **Restricciones modificación trip** — **Resuelto en AS-TRIP-001/002**: las
  agencies **completan** viajes exclusivamente suyos que ya salieron, desde
  la **UI "Completar viaje"** del panel (`ConfirmModal` →
  `PATCH /api/agency/trips/:tripId/status`, solo `completed`);
  **cancelar un viaje entero y archivar son superadmin-only**; la
  cancelación **individual** de reservas sigue siendo una operación
  separada e independiente. Cancelar un viaje **con reservas existentes
  queda bloqueado hasta que exista el flujo de reembolsos** (no se
  implementan reembolsos en este incremento).

- **Alta de viaje por la agencia** — **Resuelto en AS-TRIP-003** y
  afinado en **AS-TRIP-003.1**: la agencia crea un viaje nuevo con
  `POST /api/agency/trips` desde un **modal abierto en `/agency/trips`**
  (mismo builder que el superadmin, sin paso de Agencias), eligiendo una
  **ruta global activa** del catálogo (`GET /api/agency/routes`, solo
  lectura; corregido en AS-TRIP-003.1 para no referenciar la columna
  `duration_minutes` que la migración 006 eliminó). La agencia sale
  **siempre** de `req.ctx`; el schema es **strict** (rechaza
  `agency_ids`, `agency_id`, `status`, etc.) y el viaje nace con
  **exactamente una** fila en `trip_agencies`. Se reutiliza
  `superadminService.createTrip` (RPC `create_trip` o rollback
  compensatorio) con todas las validaciones existentes: ruta
  existente/activa, salida futura, duplicado, capacidad y precio. **No se
  crean rutas desde la agencia**; si la ruta no existe, el UI explica que
  hay que solicitarla al superadmin. Éxito → cierra el modal + toast +
  refresca la lista; error → modal abierto para reintentar. La **edición**
  de viajes por la agencia sigue pendiente.

- **Definir aislamiento cross-agency** - Confirmar que políticas RLS y validaciones
  RPC previenen acceso cruzado entre agencias en todas las operaciones.

- **Reusar mecanismo audit** - `audit_append()` ya soporta recording events
  agency. No se requieren nuevas migraciones para auditoría básica.

**Ítems de descubrimiento (brechas de scope — todavía no son tickets de fase):**

1. Diseño de tabla `agency_routes` (o alternativa) para route management
   agency — **proposal-only, no implementar en este ticket**.
2. ~~Decisión: incluir `'inactive'` y/o `'archived'` en enum trip status BD~~
   — **cerrado**: `'archived'` ya está en la CHECK (migración 033);
   `'inactive'` **no se introduce**.
3. Definir RPCs agency para operaciones trip management — **parcialmente
   cerrado**: completar viaje agency implementado en AS-TRIP-001
   (RPC `set_trip_status` con autorización) y alta de viaje en
   AS-TRIP-003 (reutiliza `create_trip` con la agencia de la sesión); el
   resto (alta/edición de rutas y **edición** de viajes por la agencia)
   sigue pendiente.
4. Panel UI: ubicación y componentes para route/trip management en panel
   agency — **parcial**: la acción **"Completar viaje"** ya está entregada
   en **AS-TRIP-002** (lista de viajes + confirmación + errores 403/404/409)
   y el alta **"Nuevo viaje"** está en **AS-TRIP-003 / AS-TRIP-003.1**
   (**modal desde `/agency/trips`**, sin página propia); alta/edición de
   **rutas** y **edición** de viajes por la agencia sigue **pendiente**.
5. ~~Validación: discrepancy `'archived'` status BD vs código aplicación~~
   — **cerrada** (migración 033).

**Trabajo restante explícito (post AS-TRIP-003):**

- **Sistema de reembolsos**: prerequisite para permitir cancelar un viaje
  con reservas. Mientras no exista, `set_trip_status` responde
  `ERR_TRIP_HAS_RESERVATIONS` (409) y no cambia nada. La cancelación
  **individual** de reservas sigue siendo una operación separada que sí
  funciona.
- **Edición de viajes por la agencia** (sigue pendiente de definición).
- **Alta/edición de rutas por la agencia**: **no soportado** — las rutas
  son globales sin `agency_id` y su CRUD es superadmin-only. Cualquier
  ruta específica de agencia requiere una **decisión de producto aparte**
  (tabla `agency_routes`, **proposal-only, no implementar**). El alta de
  viajes **no** crea rutas: si la ruta necesaria no existe, la agencia
  debe solicitarla al superadmin.

**Estado:** **DESCUBRIMIENTO COMPLETO + 3 INCREMENTOS IMPLEMENTADOS**
(DISC-AS-01…05 completados; **AS-TRIP-001** — autorización de transiciones
de estado de viaje — con migración `104_trip_status_authorization.sql`
**ya aplicada a Supabase**; **AS-TRIP-002** — UI "Completar viaje" en el
panel de agencia que consume ese endpoint; **AS-TRIP-003** — alta de viaje
por la agencia con asignación exclusiva y catálogo global de rutas, **sin
migración nueva**). Detalle de los tickets en
[TASKS.md](../TASKS.md).

**Relación con las fases existentes:** la **Fase A sigue en progreso** y
conserva su prioridad crítica; esta iniciativa se planifica en paralelo sin
cerrar ni reordenar las Fases B–E, F5 resto ni SEC-009 (009.0/.1/.2
COMPLETED; 009.3 cancelada). **No duplica tickets del marketplace:**
checkout, pagos y reservas B2C viven en `nomadas-tour-marketplace`.

---

## Roadmap por fases

Las fases están organizadas por prioridad de comercialización. Cada fase construye sobre la anterior.

---

### Fase A — Production & SaaS Readiness

**Prioridad:** Crítica. Bloquea lanzamiento comercial público.

**Objetivo:** Cerrar gaps de seguridad, SEO técnico, legal, analytics y observabilidad básica para que el producto pueda ser ofrecido comercialmente sin riesgos legales, de seguridad o de percepción de "prototipo".

#### A.1 — SEO Técnico & Landing Pública

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| SEO-001 | Landing page pública / | 🔴 Pendiente | Value prop, CTA, branding, metadata, OG, responsive, contacto, legal links. / hoy redirige a /login. |
| SEO-002 | Página 404 propia (
ot-found.tsx) | 🔴 Pendiente | Branded, CTA a /login, search params preservation. |
| SEO-003 | Meta tags por página (title, description, OG) | 🔴 Pendiente | Login, auth pages, public reservation link, dashboards. Hoy solo metadata global. |
| SEO-004 | obots.ts / obots.txt | 🔴 Pendiente | Disallow: /admin/, /agency/, /api/, /reservations/link/; Sitemap: reference. |
| SEO-005 | sitemap.ts / sitemap.xml | 🔴 Pendiente | URLs públicas (/login, /forgot-password, /reset-password, /accept-invitation, landing). |
| SEO-006 | Favicon completo (ico multi-size, apple-touch-icon, manifest.json) | 🟡 Parcial | Existe avicon.ico y icon en metadata; faltan sizes y manifest. |
| SEO-007 | OG image dinámica para reservation links | 🟡 Planificado | Edge function o server component para /reservations/link?token=. |
| SEO-008 | Image optimization (
ext/image para assets estáticos) | 🟡 Planificado | us.jpg, 
omadas.jpg via 
ext/image + ormats: ['avif','webp']. |

#### A.2 — Legal & Trust

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| LEGAL-001 | Privacy Policy (/privacy) | 🔴 Pendiente | Datos recogidos, finalidad, base legal, derechos, proveedores (Supabase, Resend, Vercel, Render), contacto. |
| LEGAL-002 | Terms & Conditions (/terms) | 🔴 Pendiente | Alcance, obligaciones agencia, límites responsabilidad, IP, terminación, ley aplicable. |
| LEGAL-003 | Cookie Policy (/cookies) | 🔴 Pendiente | Documentar solo cookies esenciales de Supabase Auth (sb-*-auth-token). No banner si solo esenciales. |
| LEGAL-004 | Contact page (/contact) | 🔴 Pendiente | Form + honeypot + rate limit + email a soporte. Footer global con links legales y email soporte. |
| LEGAL-005 | Email sender identity (DMARC/SPF/DKIM) | 🟡 Verificar | EMAIL_FROM verificado en Resend; configuración DNS del dominio. |

#### A.3 — Analytics

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| ANALYTICS-001 | Decisión de producto: herramienta analytics | 🔵 Decisión pendiente | Opciones: Vercel Analytics (zero-config, privacy-friendly) vs Plausible (self-hosted). **No implementar hasta decidir.** |
| ANALYTICS-002 | Implementación técnica | ⏳ Bloqueado | Events: login, reservation_created, boarding, link_shared. Depende de ANALYTICS-001. |

#### A.4 — Seguridad Crítica

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| SEC-010 | Rate limiting global + per-tenant en /api/agency/*, /api/admin/* | 🔴 Pendiente | Actualmente solo auth y public links tienen rate limit. Usar express-rate-limit con key por eq.ctx?.agencyId o eq.ctx?.userId. |
| SEC-011 | CSP header configurado | 🔴 Pendiente | script-src 'self' 'unsafe-inline' (Framer Motion), style-src 'self' 'unsafe-inline' (Tailwind JIT), img-src data: blob: https:. |
| SEC-012 | Verificar .env no commiteado | 🟡 Verificar | Confirmar que .env está en .gitignore y secretos están en Render/Vercel env vars. |
| SEC-013 | Verificar 	rust proxy contra Render | 🟡 Verificar | pp.set('trust proxy', 1) en ackend/src/app.ts:17 — validar que Render usa 1 hop. |
| SEC-014 | Password reset progressive lockout | 🟡 Evaluar | ailed_attempts tracking existe; evaluar si agregar exponential backoff / lockout progresivo. |

#### A.5 — Observabilidad Básica

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| OBS-001 | Readiness health check (/readyz) | 🔴 Pendiente | DB connectivity check. Complementa /healthz (liveness). |
| OBS-002 | Uptime monitoring — Sentry Uptime | ✅ Configurado | Ya configurado experimentalmente. Documentar y validar. |
| OBS-003 | Verificar Sentry API + Worker operativo | ✅ Completado | WKR-006.2 completado. Graceful shutdown con lushSentry(2000) en API y Worker. |

---

### Fase B — Professional UX

**Prioridad:** Alta. Mejora percepción de calidad y usabilidad bajo presión (abordaje, ventanilla).

**Objetivo:** Accesibilidad, mobile UX, estados de error, navegación y polish coherente con AGENTS.md.

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| UX-001 | Skip links (<a href="#main">Saltar al contenido</a>) | 🔴 Pendiente | En pp/layout.tsx y DashboardLayout. |
| UX-002 | Input: ria-invalid, ria-describedby (error/helper), ria-live="polite" en error container | 🔴 Pendiente | components/ui/Input.tsx. |
| UX-003 | Button loading: ria-busy="true" + ria-live="assertive" | 🔴 Pendiente | components/ui/Button.tsx. |
| UX-004 | Focus visible en links (Sidebar, Navbar): ocus-visible:ring-2 focus-visible:ring-cyan | 🔴 Pendiente | components/layout/Sidebar.tsx, components/ui/Navbar.tsx. |
| UX-005 | Contraste cyan/white: ajustar cyan a #00B8E6 (4.5:1) o restringir cyan a fondos navy/dark | 🔴 Pendiente | pp/design-tokens.css, components/ui/Button.tsx. WCAG AA normal text. |
| UX-006 | Stepper labels visibles en mobile (no hidden sm:inline) | 🔴 Pendiente | pp/agency/reservations/new/page.tsx:949-986. |
| UX-007 | CTA sticky bottom en wizard reserva mobile (ixed bottom-0 safe-area-inset-bottom) | 🔴 Pendiente | Acción principal siempre accesible sin scroll. |
| UX-008 | Admin tables responsive: card layout en mobile <768px o horizontal scroll con sticky primera col | 🔴 Pendiente | pp/admin/agencies/page.tsx, pp/admin/trips/page.tsx, pp/admin/routes/page.tsx, pp/admin/bookings/page.tsx. |
| UX-009 | Empty states completados: notifications dropdown, audit trail, passenger lists | 🟡 Parcial | EmptyState component existe; aplicar donde falte. |
| UX-010 | Scanner QR (/agency/scan) audit + fixes mobile | 🔴 Pendiente | One-hand, safe areas, minimal clicks, feedback inmediato. |
| UX-011 | Alt text audit: decorativas → lt="" + ria-hidden; informativas → descriptivo | 🟡 Parcial | Revisar todas las Image y <img>. Remover assets no usados (us.jpg, 
omadas.jpg si no se usan). |

---

### Fase C — Reliability & Performance

**Prioridad:** Media. Basada en evidencia y medición, no en especulación.

**Objetivo:** Readiness, timeouts explícitos, paginación, medición y optimización basada en datos reales.

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| REL-001 | /readyz endpoint (DB ping) | 🔴 Pendiente | Complementa /healthz. Render readiness probe. |
| REL-002 | Timeouts explícitos: DB (30s), HTTP client (10s), RPC (configurable) | 🔴 Pendiente | Hoy sin timeouts explícitos; riesgo de hung requests. |
| REL-003 | Paginación en agency: /agency/trips, /agency/reservations, /agency/dashboard | 🔴 Pendiente | Cursor-based. Riesgo de respuestas gigantes con crecimiento. |
| REL-004 | Request/response size limits + compression (gzip/brotli) | 🟡 Verificar | Express default 100kb JSON; validar si suficiente. compression() middleware. |
| REL-005 | Métricas API básicas (request count, latency p50/p95/p99, error rate por endpoint) | 🟡 Planificado | Prometheus client o custom. Base para alertas SLO futuras. |
| REL-006 | Cache strategy evaluación (React Query / SWR + Next.js fetch cache) | 🟡 Evaluar | Solo si métricas muestran queries frecuentes costosas. NO asumir Redis necesario. |

---

### Fase D — Scale

**Prioridad:** Futura. Solo cuando métricas o necesidades reales lo justifiquen.

**Objetivo:** Separación Worker, cache distribuido, load testing, Realtime scaling.

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| SCALE-001 | Separar Worker en servicio Render independiente | ⏳ Diferido | Background Worker o segundo Web Service. Cuando memory/CPU contention sea medible. |
| SCALE-002 | Cache distribuido (Redis/Upstash) para dashboards/listados | ⏳ Diferido | Solo si cache strategy (REL-006) lo justifica con datos. |
| SCALE-003 | Load testing (k6/Artillery): login, reservation create, seat lock, boarding scan | ⏳ Diferido | Staging env. Cuando haya baseline de tráfico real. |
| SCALE-004 | Query optimization: getAgencyDashboard → materialized view o RPC agregado | ⏳ Diferido | Solo si N+1 medido es bottleneck real. |
| SCALE-005 | Realtime scale: connection pooling, broadcast vs presence, sharding por trip | ⏳ Diferido | Solo si conexiones concurrentes > límites Supabase. |

---

### Fase E — Advanced Observability

**Prioridad:** Futura. Cuando operación en producción lo requiera.

**Objetivo:** Full-stack observability, SLOs, correlation IDs, dashboards operacionales.

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| OBS-004 | Sentry Frontend (Next.js SDK) + Replay (10%) + Performance (web vitals) | 🟡 Planificado | Cuando errores de cliente sean opacos. |
| OBS-005 | API metrics + Alertas SLO (error rate >1%, p99 >2s, worker heartbeat missing >2min) | 🟡 Planificado | Requiere REL-005. |
| OBS-006 | Log correlation: equest_id header propagado API→Worker→DB | 🟡 Planificado | Middleware + worker context. |
| OBS-007 | Dashboard ops (Grafana/Sentry): worker health, outbox lag, queue depth | 🟡 Planificado | Cuando equipo de ops exista. |

---

### Fase 6 — Reportes (Legacy, renombrada)

**Prioridad:** Quinta. Visibilidad de negocio para superadmin y agencias.

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| REP-001 | KPIs (ocupación, reservas, abordaje, cancelaciones) | 🟡 Futura | |
| REP-002 | Exportaciones (CSV / Excel) | 🟡 Futura | |
| REP-003 | Dashboard operativo enriquecido | 🟡 Futura | |
| REP-004 | Métricas por agencia (superadmin) y comparativas agregadas | 🟡 Futura | |

---

### F5 Resto — Audit Trail Extendido

**Prioridad:** Futura. Extensiones del audit trail base (F5-001...F5-004 completados).

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| F5-005 | Invitaciones/usuarios en audit | 🟡 Futura | |
| F5-006 | Correlation ID en audit events | 🟡 Futura | |
| F5-007 | Retención/purge de audit_log | 🟡 Futura | |
| F5-008 | Quitar gate UI temporal (visibilidad para todos superadmins/agencias) | 🟡 Futura | |

---

### Infraestructura / Operaciones — Pendientes

| Ticket | Tema | Estado | Detalle |
|--------|------|--------|---------|
| INFRA-001 | Restore drill trimestral (manual) | 🟡 Pendiente | Tutorial: [ackup-disaster-recovery-runbook.md](backup-disaster-recovery-runbook.md). |
| INFRA-002 | Migración timers LockCleanup / completeExpiredTrips a worker | 🟡 Futura | Hoy corren en API process (ackend/src/index.ts:42-86). |
| INFRA-003 | Retention oarding_attempts | 🟡 Futura | Policy de retención + purge job. |
| INFRA-004 | Normalizar occupancy en eservation.service.ts | 🟡 Futura | Código duplicado entre dashboard y trips. |

---

### Política arquitectónica — Hexagonal / Ports & Adapters (Sin cambios)

**Decisión:** Nómadas Tour **no será reescrito globalmente** a arquitectura hexagonal.

La arquitectura actual está en producción y ya posee mecanismos de seguridad e integridad relevantes: autorización en backend, RLS, trusted identity, RPCs, constraints, workers, outbox, Realtime. No introducir una re-arquitectura masiva por razones puramente teóricas.

#### Principio para futuras features

Al diseñar una **nueva feature de complejidad significativa**, evaluar **explícitamente** si conviene aplicar:

`	ext
Hexagonal Architecture
Ports & Adapters
Use Cases + Domain + Ports + Adapters
`

No es obligatorio por defecto. La decisión se basa en complejidad y valor arquitectónico.

**Buenos candidatos** (evaluar hexagonal): reglas de negocio complejas; múltiples fuentes de infraestructura; integraciones externas; jobs/workers; alto riesgo de pruebas difíciles; varios canales de entrada; necesidad de desacoplar dominio de Supabase/HTTP; feature de vida útil larga y crecimiento previsto.

**Malos candidatos** (no forzar hexagonal): CRUDs muy simples; pantallas puramente presentacionales; cambios pequeños; refactors sin beneficio claro.

#### Estrategia recomendada

`	ext
Nómadas actual
    ↓
NO rewrite global
    ↓
Nueva feature compleja
    ↓
evaluar Hexagonal
    ↓
si aporta valor → implementar en ese bounded context
    ↓
evaluar experiencia
    ↓
reutilizar patrón en futuras features
`

#### Relación con seguridad y con SEC-009

> La arquitectura hexagonal **no es una herramienta de seguridad por sí misma**.

Puede mejorar fronteras y reducir accesos directos a infraestructura, pero **no sustituye** RLS, authorization, DB constraints, RPCs seguros, tenant isolation, SAST, DAST ni security regression tests.

SEC-009 debe **considerar** boundaries arquitectónicos en el análisis futuro, sin exigir migrar todo el sistema a Hexagonal. Reglas del estilo "use case no bypasea authorization boundary" solo se diseñarán cuando existan módulos que realmente usen Ports & Adapters.

`	ext
SEC-009          → seguridad continua / regresiones
Fase D           → escalabilidad / performance / costos
Hexagonal        → decisión incremental en features nuevas complejas
`

No mezclar estos tres temas en un único ticket. No crear ADR hexagonal todavía (salvo necesidad futura explícita).

---

## Relación con documentación técnica

| Documento                                                                                                                                                                             | Rol                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [TASKS.md](../TASKS.md)                                                                                                                                                             | Sprint actual y backlog inmediato                                                                                                            |
| [TASKS-HISTORY.md](TASKS-HISTORY.md)                                                                                                                                                | Historial de sprints completados                                                                                                             |
| [documentation-guide.md](documentation-guide.md)                                                                                                                                    | Cómo mantener docs organizadas                                                                                                               |
| [security-hardening-implementation.md](security-hardening-implementation.md)                                                                                                        | Remediaciones SEC-001...008 (cerradas); puntero a SEC-009 en ROADMAP                                                                           |
| [rchitecture.md](architecture.md)                                                                                                                                                  | Arquitectura técnica actual + política hexagonal (incremental)                                                                               |
| Serie WKR-00x-*.md                                                                                                                                                                  | Workers/outbox (incl. [WKR-006.1](WKR-006.1-worker-observability-implementation.md), [Sentry design](WKR-006.2-sentry-foundation-design.md)) |
| Serie F4-00x-*.md / [F5-001-audit-trail-design.md](F5-001-audit-trail-design.md) / [F5-004-reserva-asistida-por-enlace-design.md](F5-004-reserva-asistida-por-enlace-design.md) | Automatizaciones, audit trail y reserva asistida por enlace                                                                                  |
| [system-spec.md](system-spec.md)                                                                                                                                                    | Especificación funcional base                                                                                                                |
| [AGENTS.md](../AGENTS.md)                                                                                                                                                           | Reglas de diseño e implementación                                                                                                            |

---

## Historial — Fases técnicas originales (1–7)

Las fases iniciales del producto (backend, reservas, abordaje, dashboards, legacy cleanup) están **completadas**. Detalle por sprint: [TASKS-HISTORY.md](TASKS-HISTORY.md).

---

## Follow-ups de producto

**Cerrados:** actor de notificaciones = agencia; notificaciones in-app y boleto con solo destino (origin conservado en modelo); no reservar si departure_time <= now(); **reserva asistida por enlace (F5-004)**. Detalle: [TASKS-HISTORY.md](TASKS-HISTORY.md). Diseño: [F5-004-reserva-asistida-por-enlace-design.md](F5-004-reserva-asistida-por-enlace-design.md).

**Abiertos:** Ver Fase A, B, C, F5 Resto, Infraestructura.

---

## Fuera de alcance (por ahora)

- Pagos marketplace (comprobantes, comisiones) — implementados en el repo
  hermano `nomadas-tour-marketplace` (Fase 2). Falta facturación fiscal.
- Marketplace B2C — implementado en `nomadas-tour-marketplace` (catálogo,
  wizard, checkout con revisión). Ver su ROADMAP.
- Portal de pasajeros con login
- App móvil nativa

Estos ítems pueden evaluarse en roadmap futuro según demanda comercial.
