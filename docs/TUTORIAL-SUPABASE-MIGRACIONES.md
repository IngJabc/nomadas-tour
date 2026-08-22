# Tutorial — Migraciones de Supabase (Nómadas Tour)

**Propósito:** Procedimiento oficial para llevar cambios de base de datos desde desarrollo local hasta Producción.

**Audiencia:** Desarrolladores y agentes del proyecto.

**Fuente de verdad del schema:**

```text
supabase/migrations/
```

**Mecanismo oficial de despliegue:** Supabase CLI (`db push`).

**Última actualización**: 2026-08-20 (post F5-004 y adopción del flujo CLI Staging → Producción)

---

## Flujo oficial

```text
LOCAL (código + archivos en supabase/migrations/)
  ↓
STAGING (link CLI → project-ref Staging → dry-run → db push)
  ↓
validación completa (harness SQL, tests, build, smoke)
  ↓
commit + push  (humano; los agentes NO hacen commit)
  ↓
PRODUCCIÓN (backup → link → dry-run → db push)
  ↓
verificación post-deploy (migration list, harness, smoke)
```

---

## 1. Entornos

### Supabase Staging

Proyecto remoto de validación. Aquí se aplican primero las migrations nuevas y se ejecutan harnesses / smoke tests antes de Producción.

### Supabase Producción

Proyecto remoto que sirve a usuarios reales. Solo recibe migrations después de Staging validado, backup confirmado y dry-run limpio.

### Aplicación local → Staging vía `.env`

La app local (Next.js / backend) suele apuntar a Staging con variables en `.env` / `backend/.env` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.).

Eso **no** vincula la CLI al proyecto Staging.

### Supabase CLI → proyecto remoto vía `supabase link`

La CLI trabaja sobre el proyecto cuyo `project-ref` quedó vinculado con:

```powershell
npx.cmd supabase link --project-ref TU_PROJECT_REF
```

### Diferencia crítica

| Mecanismo | Qué controla |
|-----------|----------------|
| `.env` de la aplicación | A qué Supabase se conecta el código en runtime (API, Auth, Realtime) |
| `supabase link` | A qué proyecto remoto aplican `migration list`, `db push`, `migration repair` |

```text
App local con .env → Staging
        ≠
CLI con link → (el project-ref que hayas vinculado)

Antes de cualquier db push: verificar el link.
```

---

## 2. Instalación de Supabase CLI (Windows / PowerShell)

Este proyecto usa **Windows / PowerShell** e instalación **local** como `devDependency` (ver `package.json`), no Homebrew ni binario global.

```powershell
npm.cmd install --save-dev supabase
```

Verificar:

```powershell
npx.cmd supabase --version
```

En este entorno se usa:

```text
npm.cmd
npx.cmd
```

en lugar de `npm` / `npx` (evita problemas de resolución en PowerShell).

---

## 3. `supabase login`

Autentica la CLI con tu cuenta de Supabase:

```powershell
npx.cmd supabase login
```

Sin login válido no se puede `link` ni `db push` a proyectos remotos.

---

## 4. `supabase link`

Vincula el directorio del repo al proyecto remoto:

```powershell
npx.cmd supabase link --project-ref TU_PROJECT_REF
```

### Dónde obtener el project-ref

Dashboard de Supabase → Project Settings → General → **Reference ID**.

O en la URL del proyecto:

```text
https://supabase.com/dashboard/project/<PROJECT_REF>
```

> **ADVERTENCIA:** Antes de cualquier `db push`, verificar siempre que el project-ref corresponde al entorno correcto (Staging vs Producción). Un link incorrecto aplica SQL al proyecto equivocado.

---

## 5. `supabase migration list`

```powershell
npx.cmd supabase migration list
```

Muestra, por cada versión:

- **Local** — archivo presente en `supabase/migrations/`
- **Remote** — versión registrada en el migration history del proyecto vinculado

### Cómo detectar pendientes

| Local | Remote | Significado |
|-------|--------|-------------|
| Sí | Vacío / ausente | Migration pendiente de aplicar (o history desincronizado) |
| Sí | Sí | History alineado para esa versión |
| No | Sí | Remoto conoce una versión que no está en el repo (investigar) |

### Schema físico vs migration history

Pueden estar **desincronizados**:

```text
schema remoto     → ya tiene tablas/columnas/RPCs
migration history → no refleja esas versiones
```

Eso ocurre cuando alguien aplicó SQL a mano (SQL Editor) sin pasar por la CLI. En ese caso **no** asumir que `db push` es seguro: ver secciones 6 y 7.

### Pendiente en history ≠ cambio ausente en el schema

> **Una migration marcada como pendiente no significa necesariamente que el cambio no exista en el schema remoto.** Si el schema ya contiene ese cambio pero la tabla de migration history no lo registra, ejecutar la migration puede repetir SQL y provocar daños. Primero debe verificarse el estado real del schema; solo después se decide entre aplicar la migration o usar `migration repair --status applied`.

Ejemplo:

```text
Migration 068:
Remote history → pendiente
Schema → lock_expires_at YA existe

Resultado:
NO hacer db push a ciegas.
Verificar schema → repair history si corresponde.
```

---

## 6. CASO HISTÓRICO REAL DE NÓMADAS TOUR

Históricamente, Nómadas Tour aplicó migrations mediante **SQL Editor**, no mediante Supabase CLI.

Eso produjo:

```text
schema remoto
→ ya contenía los cambios

migration history
→ no los reflejaba correctamente
```

### Qué NO hacer en ese escenario

**NO** ejecutar directamente:

```powershell
npx.cmd supabase db push
```

si el dry-run muestra migrations históricas que **ya fueron aplicadas físicamente** en el schema.

**NO** usar a ciegas:

```powershell
npx.cmd supabase db push --include-all
```

`--include-all` puede forzar orden o inclusiones que re-ejecutan SQL destructivo o ya aplicado.

Primero: inspeccionar schema, dry-run, y si hace falta `migration repair` (sección 7).

---

## 7. `migration repair`

```powershell
npx.cmd supabase migration repair --linked --status applied VERSION...
```

Ejemplo (ilustrativo):

```powershell
npx.cmd supabase migration repair --linked --status applied 067 068 069
```

### Qué hace y qué no hace

> `migration repair --status applied` **modifica el migration history**; **no** vuelve a ejecutar el SQL de la migration.

Marca esas versiones como “ya aplicadas” en el remoto vinculado.

### Cuándo usarlo

- Solo cuando se verificó (SQL Editor / inspección) que el **schema remoto ya contiene** el cambio de esa migration.
- Nunca para ocultar una migration que **realmente no** fue aplicada.

### Cuándo no usarlo

- “Para que el dry-run quede limpio” sin haber verificado el schema.
- Como atajo en lugar de `db push` cuando el SQL aún no está en la BD.

---

## 8. ANOMALÍA HISTÓRICA DEL 010

> **EXCEPCIÓN HISTÓRICA DE NÓMADAS TOUR**  
> No presentar esto como práctica general para proyectos nuevos. Las **nuevas** migrations deben tener **versiones únicas**.

### Qué pasó

Existieron dos archivos con versión `010`:

```text
010_drop_all.sql
010_remove_price.sql
```

- `010_drop_all.sql` quedó registrada originalmente en Supabase.
- `010_remove_price.sql` fue una corrección histórica **también aplicada manualmente** en el pasado.
- **No** debe ejecutarse otra vez en Producción.
- La CLI puede detectarla como migration fuera de orden / conflicto de versión.

### Procedimiento usado (histórico)

Para poder desplegar migrations nuevas sin re-ejecutar esa corrección histórica:

```text
010_remove_price.sql
→ 010_remove_price.sql.ignore
```

Al renombrar fuera del patrón de migration (`NNNN_nombre.sql`), la CLI **ignora** el archivo.

Estado actual en el repo:

```text
supabase/migrations/010_drop_all.sql
supabase/migrations/010_remove_price.sql.ignore
```

`010_remove_price.sql` fue una migration histórica ejecutada **manualmente** en el pasado. Hoy se mantiene como `010_remove_price.sql.ignore` para que la CLI **no** la trate como migration activa. Eso evita volver a ejecutar SQL histórico sobre entornos existentes.

Esto es una **deuda histórica controlada**, no una solución general del proyecto:

- **No** debe utilizarse `.ignore` como estrategia para nuevas migrations.
- El historial completo de migrations antiguas todavía tiene una anomalía que podría requerir una futura **normalización / baseline**.
- Mientras esa normalización no exista, el `.ignore` es una excepción documentada para proteger Staging/Producción de re-ejecutar SQL ya aplicado.

> **Deuda histórica:** el tratamiento de `010_remove_price.sql` es una excepción heredada de la etapa en que las migrations se aplicaban manualmente mediante SQL Editor. No reutilizar este patrón para nuevas migrations. La normalización completa del historial legacy puede abordarse como una tarea separada.

El problema **no** está “completamente resuelto”: está **contenido** y documentado.

### Regla para el futuro

Toda nueva migration: versión **única** y secuencial. No duplicar números. No reutilizar el truco `.ignore` salvo otra excepción documentada y explícita.

---

## 9. `db push --dry-run`

```powershell
npx.cmd supabase db push --dry-run
```

- **No** modifica la BD.
- Muestra exactamente qué migrations ejecutaría.
- **Obligatorio** antes de aplicar a Producción (y recomendado siempre antes de Staging).

### Caso F5-004 (cadena esperada)

Tras alinear history y tip del repo, el dry-run hacia un remoto que ya tiene hasta `066` debe mostrar solo pendientes nuevas, por ejemplo:

```text
067_reservation_links.sql
068_seat_lock_expires_at.sql
069_reservation_link_rpcs.sql
070_reservation_links_agency_realtime.sql
071_invalidate_reservation_link.sql
072_reservation_link_agency_branding.sql
```

> Si el dry-run muestra una **migration histórica inesperada**, **detenerse**. No aplicar. Investigar (sección 6–8).

---

## 10. Aplicación en STAGING

Con CLI vinculada a Staging y dry-run correcto:

```powershell
npx.cmd supabase db push
```

Luego:

```powershell
npx.cmd supabase migration list
```

Confirmar que Local y Remote coinciden para las versiones recién aplicadas.

Staging es el entorno de **validación** antes de Producción. No saltar Staging.

---

## 11. Harness SQL

Directorio:

```text
supabase/tests/
```

Cada feature crítica debería tener un harness de verificación ejecutable en SQL Editor (o `psql`) **después** de aplicar las migrations.

### F5-004

```text
supabase/tests/f5_004_verification.sql
```

Características:

- **No destructivo:** transacción exterior con `ROLLBACK`.
- Valida, entre otras cosas:
  - schema (tablas / columnas);
  - RLS;
  - grants;
  - RPCs;
  - triggers;
  - constraints;
  - sanitize de `link_data`;
  - seguridad (p. ej. qué roles pueden SELECT).

Ejecutar el harness **después** de `db push` en Staging (y, si es apto, en Producción).

---

## 12. CASO REAL: REALTIME + `GRANT SELECT`

### Incidente F5-004 / migration `070`

`070_reservation_links_agency_realtime.sql` concede:

```sql
GRANT SELECT ON TABLE public.reservation_links TO authenticated;
```

Eso es **intencional**: la agencia usa **Postgres Changes / Realtime** sobre `reservation_links` en el wizard (cuando el pasajero guarda datos vía enlace).

### Arquitectura correcta

```text
authenticated
  ↓
SELECT permitido (GRANT)
  ↓
RLS habilitado
  ↓
policy reservation_links_agency_select
  ↓
solo filas de la agencia correspondiente
```

Separación explícita entre ambos controles:

| Control | Rol |
|---------|-----|
| `GRANT SELECT` | Permiso de **tabla**: permite al rol `authenticated` realizar/recibir la operación de lectura necesaria para Postgres Changes / Realtime |
| RLS + `reservation_links_agency_select` | Autorización de **filas**: restringe la lectura a la agencia correspondiente |

- El `GRANT` **no sustituye** RLS.
- RLS sigue siendo **obligatorio**.
- `authenticated SELECT` **no** significa acceso libre a todos los `reservation_links`.

> El `GRANT SELECT` es un permiso de tabla necesario para el mecanismo de Postgres Changes utilizado por la agencia. No implica acceso irrestricto a todas las filas. La autorización de filas continúa dependiendo de RLS y de la policy `reservation_links_agency_select`.

### Harness y falsa alarma

El harness trató inicialmente cualquier `authenticated SELECT` como fallo. Se **corrigió el harness**; **no** se modificó `070`.

### Migration `073` (incorrecta, eliminada)

Temporalmente se creó una migration `073` para **revocar** el grant. Fue **eliminada** porque era incorrecta (rompería Realtime de agencia).

### Cadena final (tip)

```text
066
067
068
069
070
071
072
```

con **`072`** como tip (`072_reservation_link_agency_branding.sql`).

---

## 13. Validación antes de Producción

Staging debe pasar, como mínimo:

```text
migration verification   (migration list + schema spot-check)
SQL harness              (p. ej. f5_004_verification.sql)
npm test
npx tsc --noEmit         (útil; no sustituye build)
npm run build            (raíz; y backend/ si hubo cambios ahí)
git diff --check
smoke tests
auditoría final
```

Solo después:

```text
READY TO COMMIT
```

(Los agentes reportan readiness; **no** hacen commit.)

---

## 14. Commit + Push

Una vez Staging validado:

```text
implementation
→ validation
→ audit
→ commit
→ push
```

**Los agentes NO deben ejecutar commits** en este proyecto. El humano hace commit y push.

Sin código en el remoto de Git, otro operador no puede aplicar la misma cadena en Producción de forma reproducible.

---

## 15. Producción

### Backup

Antes de aplicar migrations a Producción:

```text
backup
→ verify backup
```

Seguir los runbooks del repo (`docs/backup-disaster-recovery-*.md`, `docs/RECOVERY-CHECKLIST.md`) según el procedimiento vigente.

### Link a Producción

```powershell
npx.cmd supabase link --project-ref TU_PROJECT_REF_PRODUCCION
```

Confirmar project-ref (no Staging).

### Revisar history

```powershell
npx.cmd supabase migration list
```

### Dry-run

```powershell
npx.cmd supabase db push --dry-run
```

Solo debe listar las migrations **esperadas** (las mismas que ya corrieron en Staging y aún no en Producción).

### Aplicar

```powershell
npx.cmd supabase db push
```

### Verificar

```powershell
npx.cmd supabase migration list
```

### Harness

Ejecutar el harness verificado contra Producción **solo** después de confirmar que es no destructivo y apto para producción (p. ej. `BEGIN` … `ROLLBACK`).

### Smoke test

Después del schema deployment: smoke de producto en Producción (login, flujo tocado por la migration, errores de schema cache / Realtime si aplica).

Si PostgREST cachea columnas nuevas, puede hacer falta recargar schema (p. ej. `NOTIFY pgrst, 'reload schema';` en SQL Editor de diagnóstico) — eso es **diagnóstico**, no despliegue de migrations.

---

## 16. SQL Editor: cuándo usarlo

### NO usar SQL Editor para

- aplicar migrations normales;
- copiar/pegar manualmente `067`, `068`, `069`, etc.;
- mantener el schema de Producción “a mano”.

Ese fue el origen del desfase histórico schema vs migration history.

### SÍ usar SQL Editor para

- consultas de diagnóstico;
- inspección de tablas / policies / grants;
- verificación;
- harnesses no destructivos;
- debugging puntual (p. ej. `NOTIFY pgrst, 'reload schema';`).

### Regla

> **Git + `supabase/migrations/` + Supabase CLI = mecanismo oficial de despliegue de schema.**

---

## 17. Reglas permanentes

1. Nunca ejecutar una migration histórica contra Producción si el cambio **ya existe** en el schema.
2. Nunca usar `--include-all` para resolver una discrepancia sin entenderla.
3. Nunca aplicar migrations normales desde SQL Editor.
4. Toda nueva migration debe tener **versión única**.
5. Una migration ya aplicada en un entorno compartido **no se edita**; se crea otra migration.
   - **Excepción documentada:** una migration histórica puede modificarse SOLO cuando:
     1. el fresh replay es imposible sin el cambio;
     2. la remediación es técnicamente necesaria;
     3. el hash SHA-256 exacto del contenido aprobado queda registrado;
     4. el test de inmutabilidad verifica el hash aprobado;
     5. la excepción está documentada en el audit/diseño relevante.
   - Las remediaciones aprobadas se registran en `tests/boarding/migration-immutability.ts`.
   - Esta excepción NO se convierte en regla genérica.
6. `db push --dry-run` es **obligatorio** antes de Producción.
7. Staging y Producción deben recibir la **misma cadena** de migrations.
8. Grants y RLS deben verificarse **por separado**.
9. El migration history debe representar el estado **real** del schema.

---

## 18. Checklist rápida — Producción

```text
[ ] Código committeado y pusheado
[ ] Staging validado
[ ] Migration chain revisada
[ ] Backup Producción confirmado
[ ] CLI vinculada a Producción
[ ] migration list revisado
[ ] db push --dry-run revisado
[ ] Solo migrations esperadas
[ ] db push ejecutado
[ ] migration list actualizado
[ ] harness pasó
[ ] schema verificado
[ ] smoke test pasó
```

---

## 19. Comandos de referencia (PowerShell)

```powershell
npx.cmd supabase --version
npx.cmd supabase login
npx.cmd supabase link --project-ref TU_PROJECT_REF
npx.cmd supabase migration list
npx.cmd supabase migration repair --linked --status applied VERSION...
npx.cmd supabase db push --dry-run
npx.cmd supabase db push
```

Sustituir `TU_PROJECT_REF` / `VERSION...` según el entorno y las versiones reales.

---

## Resumen para el lector futuro

1. Instalar CLI local con `npm.cmd` / `npx.cmd`.
2. `login` → `link` a Staging (verificar ref).
3. `migration list` → detectar pendientes o history desfasado.
4. Si el schema ya tiene el cambio y el history no: `repair --status applied` (tras verificar), **no** re-ejecutar SQL histórico.
5. Excepción documentada del `010` (`.ignore`): no repetir el patrón.
6. Siempre `db push --dry-run` antes de aplicar.
7. `db push` en Staging → harness → tests → build → smoke.
8. Humano: commit + push.
9. Backup → link Producción → dry-run → `db push` → verificar → harness → smoke.
10. SQL Editor solo para diagnóstico / harness, nunca como canal de deploy de schema.

```text
Git + supabase/migrations/ + Supabase CLI
          ↓
     STAGING → PROD
```
