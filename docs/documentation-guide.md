# Guía de documentación del proyecto

**Propósito:** Mantener la documentación de Nómadas Tour clara, sin duplicados y escalable conforme el producto crece hacia SaaS comercial.

**Cuándo usar este documento:** Al cerrar un sprint, al iniciar una fase del roadmap, al agregar documentación nueva o cuando un agente/humano no sepa dónde escribir algo.

**Última actualización:** 2026-08-02

---

## 1. Separación de roles (regla principal)

Cada tipo de documento responde **una sola pregunta**. No mezclar.

| Documento | Pregunta que responde | Qué va aquí | Qué NO va aquí |
|-----------|----------------------|-------------|----------------|
| [`ROADMAP.md`](ROADMAP.md) | ¿Hacia dónde evoluciona el producto? | Fases, objetivos, principios, valor de negocio | Tickets técnicos, PRs, checklist de sprint |
| [`TASKS.md`](../TASKS.md) | ¿Qué hacemos **ahora**? | Sprint actual, próximo sprint, bloqueadores, backlog inmediato | Historial largo de sprints completados |
| [`TASKS-HISTORY.md`](TASKS-HISTORY.md) | ¿Qué **ya** hicimos? | Detalle de sprints cerrados, con fecha si es posible | Tareas pendientes o visión futura |
| [`architecture.md`](architecture.md) | ¿Cómo está construido el sistema? | Capas, dominios, flujos técnicos estables | Backlog de producto |
| [`system-spec.md`](system-spec.md) | ¿Cuáles son las reglas funcionales base? | Spec original multi-tenant, roles, reglas de negocio | Estado del sprint |
| [`AGENTS.md`](../AGENTS.md) | ¿Cómo debe implementar el agente? | Design tokens, reglas de UI, protocolo de trabajo | Roadmap comercial |
| Docs de seguridad (`security-*.md`) | ¿Qué se remediò y cómo validarlo? | Auditoría, migraciones, tests SEC-007/008 | Nuevas features de producto |

**Regla práctica:** Si no sabes dónde poner algo, pregúntate: ¿es visión, ejecución, historial o referencia técnica?

---

## 2. Mapa rápido de `docs/`

```
docs/
├── ROADMAP.md              → Visión de producto (mediano/largo plazo)
├── documentation-guide.md  → Cómo mantener docs organizadas (este archivo)
├── TASKS-HISTORY.md        → Archivo de sprints completados
├── architecture.md         → Arquitectura técnica
├── system-spec.md          → Spec funcional base
├── business-rules.md       → Reglas de negocio
├── permissions.md          → Permisos por rol
├── database.md             → Modelo de datos
├── backend-deploy.md       → Build y deploy del backend
├── admin-patterns.md       → Patrones UI admin
├── ui-design.md            → Referencia de diseño
├── security-*.md           → Hardening (referencia cerrada)
```

Raíz del repo:

```
TASKS.md    → Sprint operativo (siempre corto)
AGENTS.md   → Reglas para agentes e implementación
```

---

## 3. Al cerrar un sprint

Seguir este flujo:

1. **Marcar `[x]`** las tareas completadas en `TASKS.md`.
2. **Mover el detalle** (bullets, archivos tocados, validaciones) a `TASKS-HISTORY.md`, agrupado bajo un encabezado con nombre de sprint y fecha.
3. **Dejar `TASKS.md` limpio:** solo sprint actual + próximo + “Después” + bloqueadores.
4. **No duplicar** el mismo contenido en ROADMAP y TASKS-HISTORY.
5. Si el sprint cerró una **fase del roadmap**, actualizar la tabla de “Estado actual” en `ROADMAP.md` (una línea por capacidad, no un dump técnico).

### Plantilla para entrada en TASKS-HISTORY

```markdown
## Sprint N — Nombre (YYYY-MM-DD)

[x] Tarea principal
- Detalle relevante
- Archivos o endpoints clave
- Validación: tsc ✓, build ✓, tests ✓
```

---

## 4. Al iniciar una fase del ROADMAP

1. Leer la fase correspondiente en [`ROADMAP.md`](ROADMAP.md).
2. **Descomponer en `TASKS.md`** con criterios de “done” concretos (checklist accionable).
3. **No expandir el ROADMAP** con subtareas técnicas — eso vive en TASKS.
4. Si la fase introduce decisiones arquitectónicas nuevas (ej. Workers), documentar la decisión en `architecture.md` **después** de elegirla, no antes en el ROADMAP.

---

## 5. Evitar duplicados y archivos legacy

| Situación | Acción |
|-----------|--------|
| Existe conflicto de nombres `roadmap.md` vs `ROADMAP.md` en Windows | Usar **solo `ROADMAP.md`**. No crear `roadmap.md` separado (el filesystem no distingue mayúsculas). |
| Misma info en TASKS y ROADMAP | ROADMAP = *qué/por qué*; TASKS = *cómo/cuándo*. |
| Tarea completada hace meses en TASKS | Mover a TASKS-HISTORY; no borrar sin archivar. |
| Doc de seguridad con pendientes de producto | Mover pendientes a TASKS → *Ideas futuras* o ROADMAP. |

---

## 6. Documentos de seguridad (referencia cerrada)

Los archivos `security-hardening-implementation.md` y `security-audit-remediation.md` son **histórico + referencia de remediación**.

- **No agregar** nuevas features de producto ahí.
- **Sí actualizar** si hay un incidente de seguridad, nueva migración crítica o cambio en `tests/security/`.
- Pendientes opcionales de seguridad → `TASKS.md` → sección *Ideas futuras*.

---

## 7. Cuándo crear un documento nuevo

Crear un archivo nuevo solo si:

- El tema es **estable** y se consultará repetidamente (ej. `backend-deploy.md`).
- No cabe claramente en architecture, business-rules o ROADMAP.
- Tendrá un **dueño conceptual** claro (producto vs técnica vs operaciones).

Antes de crear, preferir **extender un doc existente** con una sección nueva.

### Nombres recomendados

- Minúsculas con guiones: `documentation-guide.md`, `backend-deploy.md`
- Excepción aceptada: `ROADMAP.md` (documento estratégico principal)

---

## 8. README raíz

El [`README.md`](../README.md) raíz sigue siendo boilerplate de Next.js.

**Cuando el producto esté listo para demo comercial**, reemplazarlo con:

- Qué es Nómadas Tour (1 párrafo)
- Enlaces a `ROADMAP.md`, `architecture.md`, `backend-deploy.md`
- Comandos mínimos para desarrollo (`npm run dev`, `npm test`, etc.)

No duplicar el ROADMAP completo en el README.

---

## 9. Anti-patrones (evitar)

- **TASKS.md de 400+ líneas** con sprints mezclados → archivar en TASKS-HISTORY.
- **ROADMAP como backlog Jira** con IDs de ticket y PRs.
- **Tres lugares** con la misma lista de “próximos pasos”.
- **Borrar historial** al limpiar TASKS — siempre mover, no eliminar.
- **Documentar en código** lo que debería estar en business-rules o permissions.
- **Actualizar AGENTS.md** con roadmap comercial — AGENTS es diseño e implementación.

---

## 10. Checklist rápido (fin de sprint)

- [ ] Tareas completadas marcadas `[x]`
- [ ] Detalle movido a `TASKS-HISTORY.md`
- [ ] `TASKS.md` refleja solo sprint actual + próximo
- [ ] Si aplica: `ROADMAP.md` → “Estado actual” actualizado
- [ ] Sin contradicciones entre TASKS, ROADMAP y docs técnicos
- [ ] Enlaces rotos revisados (paths relativos desde cada doc)

---

## Referencias cruzadas

| Desde | Enlazar a |
|-------|-----------|
| `TASKS.md` | ROADMAP, TASKS-HISTORY, esta guía (opcional) |
| `ROADMAP.md` | TASKS, TASKS-HISTORY, architecture |
| `AGENTS.md` | TASKS (checklist), ROADMAP (contexto) |
| Nuevo doc en `docs/` | Añadir fila al mapa de §2 si es permanente |
