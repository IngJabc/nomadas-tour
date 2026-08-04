# TASKS

> Documento **operativo del sprint**. Una tarea activa a la vez; marcar `[x]` al completar.
> **Visión de producto (mediano/largo plazo):** [`docs/ROADMAP.md`](docs/ROADMAP.md)
> **Historial de sprints completados:** [`docs/TASKS-HISTORY.md`](docs/TASKS-HISTORY.md)
> **Guía para mantener la documentación:** [`docs/documentation-guide.md`](docs/documentation-guide.md)

---

## Sprint actual — completado

**Fase 2 — Personalización de agencias (branding)**

- [x] Configuración de agencias — branding (logo, colores primario/secundario/acento)
- [x] Regla: nombre de agencia solo editable por superadmin (no por la agencia)
- [x] UI de settings en panel agencia + endpoints backend correspondientes

---

## Próximo sprint

**Fase 3 — Infraestructura de Workers**

- [ ] Definir arquitectura de procesamiento asíncrono (evaluación, no implementación acelerada)
- [ ] Casos piloto: recordatorios, limpieza programada, emails diferidos

---

## Después

| Orden | Fase | Tema |
|-------|------|------|
| 3 | Fase 4 | Automatizaciones (sobre Workers) |
| 4 | Fase 5 | Audit Trail |
| 5 | Fase 6 | Reportes |

Detalle de alcance por fase: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Bloqueadores

_Ninguno al cierre del hardening (2026-08-02)._

---

## Ideas futuras

Ítems útiles que no pertenecen al sprint inmediato:

- **UX continua** — responsive, accesibilidad, skeletons (ROADMAP Fase 7)
- **Escalabilidad** — observabilidad, caché, monitoreo (ROADMAP Fase 8)
- **Custom Access Token Hook** — defensa en profundidad opcional post-RLS
- **Tenant isolation test** — automatizar checklist multi-tenant en `tests/security/`
- **Fix preexistente** — `lib/__tests__/utils.test.ts` (`formatDateTime`, timezone)
