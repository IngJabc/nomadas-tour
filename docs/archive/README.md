# Archivo documental histórico

Los documentos de esta carpeta se conservan como evidencia de etapas
anteriores de Nómadas Tour. No representan el estado actual del producto,
la arquitectura, el modelo de datos, los permisos ni el sistema de diseño.

No deben utilizarse como fuente para implementar funcionalidades o tomar
decisiones técnicas. Cuando exista una contradicción, prevalecen las fuentes
oficiales indicadas abajo.

## Documentos archivados

| Documento | Motivo de archivo |
|-----------|-------------------|
| `backend.AGENT.md` | Plan inicial del backend con roles, paths y modelo de datos obsoletos |
| `fronted-AGENT.md` | Plan inicial del frontend previo a la arquitectura actual |
| `database.md` | Resumen incompleto sustituido por las migraciones versionadas |
| `admin-patterns.md` | Reglas parciales absorbidas por la guía vigente del proyecto |
| `ui-design.md` | Referencia visual parcial sustituida por los tokens y reglas oficiales |

## Fuentes oficiales

| Tema | Fuente vigente |
|------|----------------|
| Reglas de implementación y diseño | [`AGENTS.md`](../../AGENTS.md) |
| Especificación funcional | [`system-spec.md`](../system-spec.md) |
| Reglas de negocio | [`business-rules.md`](../business-rules.md) |
| Permisos y límites de acceso | [`permissions.md`](../permissions.md) |
| Arquitectura técnica | [`architecture.md`](../architecture.md) |
| Modelo de datos y RLS | [`supabase/migrations/`](../../supabase/migrations/) |
| Decisiones arquitectónicas | [`decisions/`](../decisions/) |
| Visión de producto | [`ROADMAP.md`](../ROADMAP.md) |
| Ejecución del sprint | [`TASKS.md`](../../TASKS.md) |
| Build y despliegue backend | [`backend-deploy.md`](../backend-deploy.md) |

El historial se mantiene sin actualizar deliberadamente. Su propósito es
explicar la evolución del proyecto, no describir su operación vigente.
