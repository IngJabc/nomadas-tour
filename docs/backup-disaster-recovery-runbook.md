# Backup & Disaster Recovery — Runbook

**Alcance:** capacidad MVP de backup lógico off-site. No es un SLA ni una garantía de pérdida cero.  
**RPO:** 24 h. **RTO target:** 8 h. **RTO esperado actual:** ~90 min (estimación operativa, no un compromiso).  
**Formulación correcta:** el sistema mantiene una copia externa diaria y un procedimiento para recuperar la plataforma, con una pérdida máxima **objetivo** de hasta 24 horas de datos.

Ejecución operativa de sprint: [`TASKS.md`](../TASKS.md). Checklist de reconstrucción: [`RECOVERY-CHECKLIST.md`](RECOVERY-CHECKLIST.md).

---

## Arquitectura

```text
GitHub Actions (03:00 UTC = 23:00 America/Caracas del día anterior)
      │
      ├── supabase db dump --role-only     → roles.sql
      ├── supabase db dump                 → schema.sql   (estructura; NO contiene filas)
      ├── supabase db dump --data-only --use-copy → data.sql  (filas reales)
      ├── Storage API                      → bytes de todos los buckets
      ├── tar.gz + age (dos recipients) + SHA-256
      └── upload a Cloudflare R2 (bucket privado nomadas-backups)
```

El backup **no depende** de API Render, worker ni frontend. Si la app está caída y Supabase + R2 responden, el job puede completar.

El workflow es **solo lectura** respecto a producción: no corre migraciones, no hace UPDATE/DELETE, no despliega Render, no cambia settings de Supabase.

---

## Qué incluye / qué no

| Pieza | ¿En el backup lógico MVP? |
|-------|---------------------------|
| Roles de Postgres (dump `--role-only`) | Sí |
| Schema `public` (y lo que el CLI no filtra) | Sí — **sin datos** en `schema.sql` |
| Filas reales (`data.sql` con `COPY`) | Sí — criterio de éxito |
| Bytes de Storage (todos los buckets descubiertos) | Sí — archivo aparte |
| `auth.users` / GoTrue / sesiones | **No.** El CLI excluye el schema `auth` del dump estándar |
| Schema `storage` (catálogo) | **No.** Los bytes van en el archive de Storage |
| PITR / clone administrado de Supabase | Distinto de este MVP; no se usa (plan Free) |

No afirmar que Auth quedó recuperado porque existan `roles.sql` / `schema.sql` / `data.sql`.

El mecanismo administrado de Supabase (restore/clone de proyecto) es **otra** herramienta, no este dump. El MVP no lo automatiza.

---

## Schedule

| Cron (GitHub Actions) | UTC | America/Caracas |
|----------------------|-----|-----------------|
| `0 3 * * *` | 03:00 | 23:00 del **día calendario anterior** |

GitHub no garantiza ejecución al minuto exacto. También existe `workflow_dispatch` para un backup manual.

---

## Cifrado (`age`)

Dos recipients:

1. **`BACKUP_AGE_RECIPIENT`** — clave pública **offline** (recuperación ante desastre). La privada `BACKUP_AGE_SECRET_KEY` **no** vive en GitHub, R2, logs ni el repo.
2. **`BACKUP_AGE_VERIFY_RECIPIENT` + `BACKUP_AGE_VERIFY_IDENTITY`** — par **solo para verificar** el objeto en CI (`download → decrypt → decompress`). No es la clave de desastre.

Generar el par offline (una vez, en una máquina de confianza):

```bash
age-keygen -o backup-master.agekey
# Public key → GitHub secret BACKUP_AGE_RECIPIENT
# Private key → almacenar offline (cofre / gestor). Nunca commit.
```

Par de verificación (puede vivir en GitHub Secrets):

```bash
age-keygen -o backup-verify.agekey
# public → BACKUP_AGE_VERIFY_RECIPIENT
# contenido del archivo (AGE-SECRET-KEY-1…) → BACKUP_AGE_VERIFY_IDENTITY
```

---

## R2

- Bucket: `nomadas-backups` (privado, sin acceso público).
- Endpoint S3: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`
- Prefijos:

```text
production/database/daily|weekly|monthly/<backup_id>/
production/storage/daily|weekly|monthly/<backup_id>/
production/manifests/daily|weekly|monthly/<backup_id>/manifest.json
restore-drills/          # evidencia manual del drill trimestral
```

No usar GitHub Artifacts como almacenamiento permanente.

**Lifecycle recomendada (safety net):** expirar objetos bajo `production/` a los **95 días**. La política GFS (14 diarios / 4 semanales / 2 mensuales) la aplica `scripts/backup/retention.sh` porque “keep last N” no se expresa bien solo con TTL si un día falla el cron.

API token de R2: permisos mínimos sobre **ese** bucket (Object Read & Write). No usar un token de cuenta completa si se puede evitar.

---

## Secrets (nombres, sin valores)

Contexto: **GitHub Actions** (no Render, no runtime de la app).

| Nombre | Uso |
|--------|-----|
| `SUPABASE_DB_URL` | URI Postgres para `supabase db dump` (solo lectura de hecho; no usar un rol que aplique migraciones) |
| `SUPABASE_URL` | URL del proyecto, Storage REST |
| `SUPABASE_SERVICE_ROLE_KEY` | Listar/descargar objetos privados. No se usa Management API / `SUPABASE_ACCESS_TOKEN` |
| `BACKUP_AGE_RECIPIENT` | Public key offline |
| `BACKUP_AGE_VERIFY_RECIPIENT` | Public key de verificación CI |
| `BACKUP_AGE_VERIFY_IDENTITY` | Secret key de verificación CI |
| `R2_ACCOUNT_ID` | Endpoint R2 |
| `R2_ACCESS_KEY_ID` | API token R2 |
| `R2_SECRET_ACCESS_KEY` | API token R2 |

Restore manual (offline): `BACKUP_AGE_SECRET_KEY` (master), `RESTORE_TARGET_DB_URL`, credenciales R2.

---

## Verificación diaria

El job **falla** si dump, Storage, compresión, cifrado, checksum, upload o verify fallan. No hay éxito parcial.

Verify **no** se da por bueno con un `aws s3 cp` en código 0. Hace:

1. Download desde R2  
2. Comparar SHA-256  
3. Decrypt (identity de verificación)  
4. `gzip -t` + extraer  
5. Comprobar `roles.sql` / `schema.sql` / `data.sql` (este último **debe** contener `COPY` o `INSERT`)

---

## Restore (manual, target explícito)

```bash
CONFIRM_RESTORE=RESTORE \
RESTORE_ISOLATED=yes \
BACKUP_ID='<id>' \
RESTORE_TARGET_DB_URL='postgres://…-isolated…' \
BACKUP_AGE_SECRET_KEY='AGE-SECRET-KEY-1…' \
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… \
bash scripts/backup/restore.sh
```

Opcional Storage hacia el proyecto aislado: `RESTORE_STORAGE=1` + `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` del **target**.

El script rechaza producción implícita. No imprime credenciales.

Orden de referencia (CLI Supabase / restore-from-platform):

1. Download → decrypt → decompress  
2. `roles.sql` → `schema.sql` → `data.sql`  
3. Restore Storage (bytes)  
4. **Reconfigurar Auth** (usuarios, providers, URLs, JWT) — no viene en el dump  
5. Configurar proyecto (env, DNS, Render)  
6. Deploy app + worker  
7. Smoke tests  

No se automatiza la creación de un proyecto Supabase nuevo.

### Auth (limitación)

Tras un desastre hay que crear/vincular un proyecto Auth nuevo o reconstruir usuarios (invitaciones, passwords). El dump lógico **no** es un backup de `auth.users`. Documentar en el drill qué cuentas se re-crearon.

---

## Restore drill (MVP)

**Manual, trimestral.** No hay `restore-drill.sh`.

Demostrar en un **proyecto aislado**:

```text
backup real → DB con filas reales → Storage recuperado
→ Auth/reconfiguración → API → Worker → smoke tests → PASS
```

Guardar evidencia bajo `restore-drills/` en R2 (notas, timestamps, IDs). No borrar producción.

Smoke mínimo:

- DB: conexión, tablas/funciones/triggers/RLS, conteos críticos, versión de migración si aplica  
- App: `/health`, worker `/healthz`, login, listar trips/reservations, una reserva de prueba **solo en aislado**, audit trail  
- Storage: al menos un objeto real accesible  

---

## Troubleshooting

| Síntoma | Qué mirar |
|---------|-----------|
| `data.sql has no COPY/INSERT` | El dump salió sin filas o se usó el dump de schema por error |
| `claim` / Docker en `supabase db dump` | El runner necesita Docker (ubuntu-latest lo trae) |
| Verify decrypt fail | Identity de verificación no coincide con `BACKUP_AGE_VERIFY_RECIPIENT` |
| Storage 401 | `SUPABASE_SERVICE_ROLE_KEY` o URL incorrectos |
| Upload R2 403 | Token sin permiso en `nomadas-backups` |
| Cron no corrió | GitHub puede retrasar crons; usar `workflow_dispatch` y revisar Actions |

---

## Escenarios de pérdida

### Supabase desaparece

1. Crear proyecto nuevo (manual).  
2. Restore DB + Storage desde R2 (`restore.sh`).  
3. Reconfigurar Auth y URLs.  
4. Apuntar Render (`DATABASE_URL` / keys) al proyecto nuevo.  
5. Deploy + smoke.  
6. DNS si aplica.

### R2 desaparece

Los backups dejan de ser recuperables desde R2. El código y las migraciones siguen en Git. Mitigación: copiar periódicamente (fuera de este MVP) un ciphertext mensual offline. Recrear bucket `nomadas-backups` y secrets; el próximo job vuelve a generar copias **hacia adelante** (RPO: se perdió el historial en R2).

### GitHub Actions desaparece

Correr los scripts en un runner local con las mismas env vars. El código de backup está en el repo (clonar desde un mirror si GitHub no está). Scheduler: cron local temporal.

### Compromiso de credenciales

1. Rotar `SUPABASE_DB_URL` password / service role / R2 tokens.  
2. Si se filtró `BACKUP_AGE_VERIFY_IDENTITY`: rotar el par de verificación (los backups viejos siguen descifrables con el master offline).  
3. Si se filtró el **master** `BACKUP_AGE_SECRET_KEY`: tratar backups existentes como comprometidos; generar nuevo par; re-cifrar no es automático — el atacante puede leer copias antiguas.  
4. No commitear keys. Revisar logs de Actions (no deberían imprimir secretos).

### Render hay que reconstruirlo

Ver [`backend-deploy.md`](backend-deploy.md) y [`RECOVERY-CHECKLIST.md`](RECOVERY-CHECKLIST.md). El backup job **no** despliega Render.

---

## Scripts

| Script | Rol |
|--------|-----|
| `scripts/backup/database.sh` | Dump roles/schema/data, cifra, sube |
| `scripts/backup/storage.sh` | Descubre buckets, baja bytes, cifra, sube |
| `scripts/backup/verify.sh` | Download + decrypt + checks (antes del manifest de éxito) |
| `scripts/backup/finalize.sh` | Manifest de éxito + copias weekly/monthly (solo si verify PASS) |
| `scripts/backup/retention.sh` | GFS (`--dry-run` / `--apply`) |
| `scripts/backup/restore.sh` | Restore manual a target explícito |
| `scripts/backup/test-local.sh` | Tests sin red de producción |

Tests locales:

```bash
bash scripts/backup/test-local.sh
```
