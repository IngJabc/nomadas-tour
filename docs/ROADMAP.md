# Nómadas Tour — Roadmap de producto

**Visión:** Convertir Nómadas Tour en un SaaS comercializable para agencias de viajes.  
**Alcance de este documento:** Dirección de mediano y largo plazo. No es un backlog técnico de sprint.  
**Ejecución operativa:** Ver [`TASKS.md`](../TASKS.md).

**Última actualización:** 2026-08-04

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

**Prioridad:** Segunda.

**Objetivo:** Incorporar procesamiento asíncrono y tareas programadas. Introducir una arquitectura moderna basada en **procesos en segundo plano**, desacoplada del ciclo HTTP.

**Nota:** No se elige aún implementación concreta (cola, cron distribuido, Supabase Edge Functions + scheduler, etc.). Esta fase documenta la **necesidad** y los casos iniciales.

**Casos iniciales:**

- Recordatorios de viajes para pasajeros
- Recordatorios de viajes para agencias
- Recordatorios al administrador para completar viajes
- Limpieza automática (locks expirados, datos temporales)
- Emails diferidos (no bloquear requests)
- Alertas operativas (ocupación, viajes próximos, anomalías)

**Valor:** Reduce carga manual, mejora puntualidad operativa y prepara el terreno para automatizaciones de producto.

---

### Fase 4 — Automatizaciones

**Prioridad:** Tercera (construida sobre Workers).

**Objetivo:** Reglas de negocio y comunicaciones que se ejecutan solas según configuración o umbrales.

**Ejemplos:**

- Recordatorios automáticos (T-24h, T-2h)
- Digest diario para agencias y superadmin
- Alertas de ocupación (viaje casi lleno / subocupado)
- Viajes próximos sin acción
- Limpieza programada
- Métricas nocturnas (agregados para dashboards)

**Valor:** El producto pasa de reactivo a **proactivo** — avisa antes de que algo falle en operación.

---

### Fase 5 — Audit Trail

**Prioridad:** Cuarta.

**Objetivo:** Registrar acciones administrativas y eventos relevantes para soporte, auditoría y trazabilidad.

**Eventos a registrar (ejemplos):**

- Crear / editar / cancelar viaje
- Crear / cancelar reserva
- Boarding (marcar / desmarcar pasajero)
- Cambios de usuarios e invitaciones
- Cambios de configuración de agencia

**Por evento:**

- **Actor** (usuario, rol, agencia)
- **Fecha** (timestamp con timezone)
- **Antes / después** (diff estructurado cuando aplique)
- **Metadata** (IP, origen, correlación)

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

**Prioridad:** Sexta (continua, no exclusiva).

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

**Prioridad:** Séptima (paralela a crecimiento de clientes).

**Objetivo:** Sostener más agencias, más viajes concurrentes y más tráfico Realtime sin degradación.

**Alcance:**

- Observabilidad (logs estructurados, trazas, métricas)
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
| [`security-hardening-implementation.md`](security-hardening-implementation.md) | Remediaciones de seguridad (cerradas) |
| [`system-spec.md`](system-spec.md) | Especificación funcional base |
| [`AGENTS.md`](../AGENTS.md) | Reglas de diseño e implementación |

---

## Historial — Fases técnicas originales (1–7)

Las fases iniciales del producto (backend, reservas, abordaje, dashboards, legacy cleanup) están **completadas**. Detalle por sprint: [`TASKS-HISTORY.md`](TASKS-HISTORY.md).

---

## Fuera de alcance (por ahora)

- Pagos y facturación
- Portal de pasajeros con login
- Marketplace entre agencias
- App móvil nativa

Estos ítems pueden evaluarse en roadmap futuro según demanda comercial.
