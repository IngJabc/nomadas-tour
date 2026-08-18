# Backup & Disaster Recovery — Operations

**Alcance:** instalación, configuración inicial, operación diaria, mantenimiento y rotación del MVP de backup.

**No es el procedimiento de emergencia.** Para desastre, restore, cutover y RTO/RPO usar:

- [`backup-disaster-recovery-runbook.md`](backup-disaster-recovery-runbook.md)
- [`RECOVERY-CHECKLIST.md`](RECOVERY-CHECKLIST.md)

**RPO:** 24 h. **RTO target:** 8 h. **RTO esperado actual:** ~90 min (estimación operativa, no SLA).

**Formulación correcta:** copia externa diaria cifrada + procedimiento de recuperación. Pérdida máxima **objetivo** de hasta 24 horas de datos. No es pérdida cero.

Este documento **no contiene secretos**. Donde hace falta un valor, usa placeholders:

```text
<PROJECT_REF>
<DB_PASSWORD>
<R2_ACCOUNT_ID>
<R2_ACCESS_KEY_ID>
<R2_SECRET_ACCESS_KEY>
<AGE_PUBLIC_KEY>
<AGE_PRIMARY_PRIVATE_KEY>
<AGE_VERIFY_PUBLIC_KEY>
<AGE_VERIFY_PRIVATE_KEY>
<SESSION_POOLER_URL>
<NEW_DB_URL>
<USER>
```

---

## Table of contents

1. [Quick Start — First-Time Setup](#quick-start--first-time-setup)
2. [Understanding the Backup Scripts](#understanding-the-backup-scripts)
3. [Creating the scripts from scratch](#creating-the-scripts-from-scratch)
4. [Architecture between scripts](#architecture-between-scripts)
5. [Script catalog](#script-catalog)
6. [Permissions and syntax validation](#permissions-and-syntax-validation)
7. [Windows line endings](#windows-line-endings-crlf-vs-lf)
8. [WSL / Git Bash](#wsl--git-bash)
9. [Local validation workflow](#local-validation-workflow)
10. [Cloudflare R2](#cloudflare-r2)
11. [age keys](#age-keys)
12. [GitHub Actions Secrets](#github-actions-secrets)
13. [`SUPABASE_DB_URL` and Database Password](#supabase_db_url-and-database-password)
14. [GitHub workflow](#github-workflow)
15. [R2 object layout and manifest](#r2-object-layout-and-manifest)
16. [Retention](#retention)
17. [Manual backup validation](#manual-backup-validation)
18. [Restore drill](#restore-drill--complete-procedure)
19. [Storage restore](#storage-restore)
20. [Auth recovery](#auth-recovery)
21. [Real disaster restore](#real-disaster-restore)
22. [Real incidents / lessons learned](#real-incidents--lessons-learned)
23. [Git / branch workflow](#git--branch-workflow)
24. [First production backups](#first-production-backups)
25. [Future local backup](#future-local-backup-not-implemented)
26. [Key rotation](#key-rotation)
27. [Do not do](#do-not-do)
28. [Quick reference](#quick-reference)

---

# Quick Start — First-Time Setup

Orden exacto la primera vez (o al reconstruir el sistema). Cada punto enlaza a la sección detallada.

1. [Create R2 bucket](#crear-el-bucket-r2)
2. [Create R2 API token](#crear-el-api-token-de-r2)
3. [Generate primary age identity](#clave-primaria-de-recuperación)
4. [Generate verification age identity](#clave-de-verificación-ci)
5. [Store primary private key securely](#custodia-windows--wsl--usb)
6. [Store verification private key securely](#custodia-windows--wsl--usb)
7. [Create the 9 GitHub Actions Secrets](#github-actions-secrets)
8. [Configure `SUPABASE_DB_URL`](#supabase_db_url-and-database-password)
9. [Verify R2 bucket is private](#verificar-que-el-bucket-sigue-privado)
10. [Verify workflow exists on `main`](#github-workflow)
11. [Run `workflow_dispatch`](#disparo-manual-workflow_dispatch)
12. [Verify workflow](#validar-que-el-workflow-pasó)
13. [Verify backup objects in R2](#r2-object-layout-and-manifest)
14. [Verify manifest](#manifest)
15. [Create isolated restore-drill project](#crear-proyecto-supabase-aislado)
16. [Perform restore drill](#restore-drill--complete-procedure)

Si el código ya está en `main`, **no** recrear los `.sh`. Empieza por R2, age y Secrets.

---

# Understanding the Backup Scripts

## What is a `.sh` file?

`.sh` significa **Shell Script**. Son archivos de texto que contienen comandos Bash, en el mismo orden en que un operador los escribiría en una terminal Linux.

No son:

- archivos de datos de Supabase;
- dumps SQL;
- documentos especiales de Cloudflare;
- binarios.

Son **automatización**. GitHub Actions (runner Ubuntu) ejecuta:

```bash
bash scripts/backup/database.sh
```

También se pueden ejecutar en local con WSL o Git Bash.

## Why Bash (not PowerShell)?

| Entorno | Qué es | Uso en este sistema |
|---------|--------|---------------------|
| **PowerShell** | Shell nativa de Windows | No ejecuta estos scripts tal cual (`source`, arrays Bash, `set -euo pipefail`) |
| **Git Bash** | Bash mínimo embebido con Git for Windows | Útil para `bash -n` y tests si `age`/`jq` están en PATH |
| **WSL** | Linux real sobre Windows (`/mnt/d/...`) | Entorno local recomendado para `test-local.sh` y restore drill |
| **GitHub Actions `ubuntu-latest`** | VM Linux del workflow | Ejecución real de backup diario |

El dump, `age`, `tar`, `gzip` y AWS CLI S3 (contra R2) son herramientas Unix. Bash es el lenguaje del runner. Escribir el mismo flujo en PowerShell duplicaría y rompería CI.

---

# Creating the scripts from scratch

Solo hace falta si se reconstruye el repo o se clona un árbol vacío. En operación normal estos archivos **ya existen** en Git.

## Prerequisites

- Repo `nomadas-tour` clonado.
- Permiso de escritura en el working tree.
- No se necesitan secretos para **crear** los archivos.

## Commands

```bash
mkdir -p scripts/backup
mkdir -p .github/workflows
```

Archivos del sistema (no inventar nombres distintos):

```text
.github/workflows/backup.yml
scripts/backup/lib.sh
scripts/backup/database.sh
scripts/backup/storage.sh
scripts/backup/verify.sh
scripts/backup/finalize.sh
scripts/backup/retention.sh
scripts/backup/restore.sh
scripts/backup/test-local.sh
```

También:

```text
.gitattributes          # LF obligatorio en scripts y workflow
docs/backup-disaster-recovery-runbook.md
docs/RECOVERY-CHECKLIST.md
docs/backup-disaster-recovery-operations.md   # este archivo
```

## What this does

Crea los directorios donde vive el pipeline. El contenido de cada script se versiona en Git; no se genera en runtime.

## Do not do

- No copiar dumps SQL al repo.
- No pegar claves `age` ni connection strings en los `.sh`.
- No crear un segundo workflow “por si acaso”.

## Next step

[Architecture between scripts](#architecture-between-scripts) y [Script catalog](#script-catalog).

---

# Architecture between scripts

```text
backup.yml                          # orquestador CI (cron + dispatch)
   │
   ├── database.sh                  # dump lógico Postgres
   │     └── lib.sh
   │
   ├── storage.sh                   # bytes de Storage API
   │     └── lib.sh
   │
   ├── verify.sh                    # download + checksum + decrypt + structure
   │     └── lib.sh
   │
   ├── finalize.sh                  # manifest status=success + copias GFS
   │     └── lib.sh
   │
   └── retention.sh --apply         # 14 daily / 4 weekly / 2 monthly
         └── lib.sh

restore.sh                          # MANUAL. No forma parte del backup diario.
      └── lib.sh

test-local.sh                       # LOCAL. No toca producción ni R2.
      └── lib.sh
```

Orden real en CI (verify **antes** de finalize):

```text
checkout
→ install tools (age, jq, aws)
→ setup Supabase CLI (latest)
→ temp workdir + BACKUP_ID
→ database.sh
→ storage.sh
→ verify.sh
→ finalize.sh
→ retention.sh --apply
→ cleanup
```

`restore.sh` nunca corre en el cron. `test-local.sh` nunca corre en CI.

Cada script operativo hace:

```bash
source "${SCRIPT_DIR}/lib.sh"
```

---

# Script catalog

## `scripts/backup/lib.sh`

**Tipo:** helpers compartidos. **No se ejecuta** como programa; se hace `source`.

| Tema | Funciones |
|------|-----------|
| Logging / errors | `log`, `die` |
| Env / commands | `require_cmd`, `require_env`, `redact` |
| SHA-256 | `sha256_file`, `write_sha256_sidecar` |
| age | `age_encrypt` (dos recipients), `age_decrypt` |
| R2 | `r2_endpoint`, `r2_env`, `r2_bucket`, `r2_cp_up`, `r2_cp_down`, `r2_cp_copy`, `r2_ls`, `r2_rm` |
| IDs | `utc_now`, `new_backup_id`, `latest_repo_migration` |
| SQL validation | `assert_nonempty_file`, `assert_data_sql_has_rows`, `assert_data_sql_excludes_internal_storage`, `assert_schema_sql`, `assert_roles_sql` |
| Archive | `tar_czf` |

**Exclusiones de data dump** (`BACKUP_DATA_EXCLUDE_TABLES`):

Storage internals:

```text
storage.buckets_vectors
storage.vector_indexes
```

Auth transitorio / administrado:

```text
auth.flow_state
auth.saml_relay_states
auth.oauth_client_states
auth.mfa_challenges
auth.webauthn_challenges
auth.instances
auth.schema_migrations
```

**Se mantienen en el dump:** `auth.users`, `auth.identities`, `auth.mfa_factors`, `auth.audit_log_entries`, y por defecto `auth.sessions`, `auth.refresh_tokens`, `auth.mfa_amr_claims`.

**Toca producción:** no. **Modifica R2:** solo si el caller usa `r2_*`. **Secrets:** nunca los imprime.

---

## `scripts/backup/database.sh`

**Tipo:** backup (solo lectura contra Postgres de producción).

### Responsabilidad

Crear, validar, empaquetar y cifrar:

```text
roles.sql
schema.sql
data.sql
```

Luego subir `database.tar.gz.age` + sidecar SHA-256 a R2 (si `BACKUP_UPLOAD=1`).

### Commands (equivalente conceptual)

Roles (roles de cluster, no filas de negocio):

```bash
supabase db dump --db-url "$SUPABASE_DB_URL" --role-only -f roles.sql
```

Schema (estructura; **sin filas**):

```bash
supabase db dump --db-url "$SUPABASE_DB_URL" -f schema.sql
```

Data (filas reales con `COPY`; exclusiones internas):

```bash
supabase db dump \
  --db-url "$SUPABASE_DB_URL" \
  --data-only \
  --use-copy \
  -x "storage.buckets_vectors" \
  -x "storage.vector_indexes" \
  -x "auth.flow_state" \
  -x "auth.saml_relay_states" \
  -x "auth.oauth_client_states" \
  -x "auth.mfa_challenges" \
  -x "auth.webauthn_challenges" \
  -x "auth.instances" \
  -x "auth.schema_migrations" \
  -f data.sql
```

### Por qué se excluyen tablas Storage internas

Son tablas **internas de Supabase Storage**. No son catálogo de negocio ni bytes de archivos. Incluirlas en `data.sql` rompe el restore en un proyecto aislado (`permission denied for table buckets_vectors`). Los bytes reales de objetos se respaldan con `storage.sh` → `storage.tar.gz.age`.

No se excluye `storage.*` entero a ciegas.

### Contrato Auth en `data.sql`

KEEP (obligatorio): `auth.users`, `auth.identities`, `auth.mfa_factors`, `auth.audit_log_entries`.  
KEEP (por defecto, no reutilizables tras restore): `auth.sessions`, `auth.refresh_tokens`, `auth.mfa_amr_claims`.  
EXCLUDE: tablas transitorias listadas arriba.

### Validación post-dump

```text
data.sql
→ debe contener COPY o INSERT (filas reales)
→ debe contener COPY "auth"."users" y COPY "auth"."identities"
→ no debe contener COPY storage.buckets_vectors ni COPY storage.vector_indexes
→ no debe contener COPY de tablas Auth transitorias
```

### Entradas

| Variable / flag | Uso |
|-----------------|-----|
| `SUPABASE_DB_URL` | Session Pooler URI (dump) |
| `BACKUP_AGE_RECIPIENT` | Public key primaria |
| `BACKUP_AGE_VERIFY_RECIPIENT` | Public key de verify (opcional pero requerida en CI) |
| `BACKUP_ID`, `BACKUP_WORK_DIR` | Puestas por el workflow |
| `BACKUP_SKIP_DUMP=1` | Fixtures locales (tests) |
| `BACKUP_UPLOAD=0` | No subir a R2 |

**Dependencias:** `supabase`, `docker` (CLI dump), `tar`, `gzip`, `age`, `jq`; `aws` si hay upload.

**Produce:** ciphertext + SHA-256 + `manifest/database.json`. Borra plaintext tras cifrar.

**Toca producción:** solo `SELECT`/dump. No migra, no `UPDATE`, no `DELETE`.

---

## `scripts/backup/storage.sh`

**Tipo:** backup (Storage REST, service role).

### Flujo

```text
List buckets
→ list objects (paginado)
→ download bytes
→ preserve bucket/path
→ tar + gzip
→ age
→ SHA-256
→ R2
```

Descubrimiento **genérico**: cualquier bucket futuro (p. ej. `vehicle-assets`) entra solo. No hay lista hardcodeada de buckets de producto.

### Estado observado en el primer backup de producción

| Bucket | Objeto de ejemplo |
|--------|-------------------|
| `agency-assets` | `logo.png` |

No documentar nombres de clientes ni PII. El recuento va en el manifest (`object_count`).

**Entradas:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, recipients `age`, `BACKUP_ID`.

**Flags de test:** `BACKUP_SKIP_STORAGE_API=1`, `BACKUP_UPLOAD=0`.

**Produce:** `storage.tar.gz.age` + sidecar + `manifest/storage.json`.

**Toca producción:** lectura de objetos. No borra Storage.

---

## `scripts/backup/verify.sh`

**Tipo:** verification. **No** se conecta a Postgres de producción.

```text
R2 download (o copia local si BACKUP_VERIFY_LOCAL=1)
→ checksum SHA-256 vs sidecar
→ age decrypt
→ gzip -t
→ tar extract
→ validación estructural SQL
→ success
```

`BACKUP_AGE_VERIFY_IDENTITY` permite que GitHub Actions descifre **sin** poseer la private key primaria de recuperación. La identity de verify **no** sustituye la master offline: sin la master no hay restore ante desastre.

Validación SQL:

- `roles.sql` menciona `ROLE`
- `schema.sql` contiene `CREATE TABLE`
- `data.sql` tiene `COPY`/`INSERT`
- `data.sql` **debe** contener `COPY "auth"."users"` y `COPY "auth"."identities"`
- `data.sql` **no** COPY de Storage internals ni Auth transitorio

Un `aws s3 cp` con exit 0 **no** cuenta como backup verificado.

---

## `scripts/backup/finalize.sh`

**Tipo:** backup metadata + copias GFS.

- Escribe `manifest.json` con `status=success` **solo** si existen `database.json` y `storage.json` (dump + storage ya corrieron) y **después** de que `verify.sh` haya pasado en el workflow.
- Sube el manifest a `production/manifests/daily/<backup_id>/`.
- Si el día UTC es domingo (`%u == 7`), copia a `weekly/`.
- Si el día UTC es 1 (`%d == 01`), copia a `monthly/`.
- Rechaza el upload si el JSON parece contener un secreto.

Por qué verify va **antes**: un job rojo no debe dejar en R2 un manifest `success` de un ciphertext corrupto o incompleto.

---

## `scripts/backup/retention.sh`

**Tipo:** mantenimiento R2.

```text
Keep 14 daily
Keep 4 weekly
Keep 2 monthly
Window ~90 days (lifecycle R2 de seguridad ~95 días; ver runbook)
```

- **GFS (grandfather-father-son):** diarios cortos + semanales + mensuales.
- **Idempotente:** se puede re-ejecutar; no borra si el conteo ≤ keep.
- Protege backups con menos de ~20 h (`too_new`).
- Default `--dry-run`. CI usa `--apply`.
- Lifecycle de R2 **no** expresa “keep last N” si un cron falla; este script es la política. Un TTL de 95 días es red de seguridad y **no** debe borrar objetos que GFS todavía necesita.

**Modifica R2:** sí, borra prefijos antiguos bajo `production/{database,storage,manifests}/{daily,weekly,monthly}/`.

---

## `scripts/backup/restore.sh`

**Tipo:** restore **manual**. Target explícito. No hay default a producción. No hace `DROP`. No llama Auth API ni crea usuarios a mano. Users/identities salen de `data.sql`.

### Guards

```text
CONFIRM_RESTORE=RESTORE
RESTORE_ISOLATED=yes
RESTORE_TARGET_DB_URL=<NEW_DB_URL>
BACKUP_ID=<backup_id>
BACKUP_AGE_SECRET_KEY=<AGE_PRIMARY_PRIVATE_KEY>
```

Opcional: `RESTORE_STORAGE=1` (usa `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` del **proyecto target**, no de producción).

Opcional: `SKIP_ROLES=1` si `roles.sql` no es aplicable en el proyecto nuevo (`supabase_admin`, ownership, etc.).

`RESTORE_ALLOW_PRODUCTION=I_UNDERSTAND` existe solo como escape documentado; **no** se usa en el drill trimestral.

### Do not do

- No apuntar `RESTORE_TARGET_DB_URL` a producción “para probar”.
- No usar este script de forma casual.
- El operador debe saber **exactamente** qué `<NEW_DB_URL>` está usando (`psql ... -c '\conninfo'`).

El script descarga desde R2, descifra con la identity disponible (master o verify), extrae y aplica `roles.sql` → `schema.sql` → `data.sql` con `psql --single-transaction --variable ON_ERROR_STOP=1`. Auth users/identities viajan en `data.sql`.

**`SET session_replication_role = replica`:** no se añade en `restore.sh`. `supabase db dump --data-only` ya emite ese `SET` **dentro** de `data.sql`. El `--command` extra del drill manual es redundante para esos dumps. Los 7 usuarios de Auth aparecieron por `COPY "auth"."users"` / `COPY "auth"."identities"`, no por ese `SET` adicional. Si `roles.sql` falla por roles administrados de Supabase, no editar el dump: usar `SKIP_ROLES=1` o omitir `--file roles.sql`.

---

## `scripts/backup/test-local.sh`

**Tipo:** test. **No** conecta a producción. **No** requiere R2. **No** usa secrets reales (genera pares `age` temporales).

Cubre:

- env ausente;
- `data.sql` vacío / sin `COPY`/`INSERT`;
- presencia obligatoria de `COPY "auth"."users"` y `COPY "auth"."identities"`;
- rechazo de tablas Auth transitorias (`flow_state`, `saml_relay_states`, `oauth_client_states`, `mfa_challenges`, `webauthn_challenges`, `instances`, `schema_migrations`);
- rechazo de `COPY storage.buckets_vectors` y `COPY storage.vector_indexes`;
- aceptación de dump de negocio + Auth requerido;
- encrypt/decrypt local;
- checksum inválido;
- ciphertext malformado;
- identity incorrecta;
- guards de `restore.sh`.

**Resultado actual (contrato Auth):** la suite local debe pasar completa (sin red de producción). El primer corte del MVP marcó 12/12; tras Storage internals 15/15; el contrato Auth añade asserts de COPY Auth y exclusiones transitorias.

---

# Permissions and syntax validation

## Prerequisites

Bash (WSL o Git Bash). No hace falta red.

## Commands

GitHub Actions invoca `bash scripts/backup/database.sh`, así que el bit `+x` **no es obligatorio en CI**. Sí es útil en local:

```bash
chmod +x scripts/backup/*.sh
```

Validar sintaxis (no ejecuta el backup):

```bash
bash -n scripts/backup/lib.sh
bash -n scripts/backup/database.sh
bash -n scripts/backup/storage.sh
bash -n scripts/backup/verify.sh
bash -n scripts/backup/finalize.sh
bash -n scripts/backup/retention.sh
bash -n scripts/backup/restore.sh
bash -n scripts/backup/test-local.sh
```

## Expected output

Sin salida. Exit code `0`.

Cualquier `syntax error` se corrige **antes** de merge.

## Next step

[Windows line endings](#windows-line-endings-crlf-vs-lf).

---

# Windows line endings (CRLF vs LF)

Bash y GitHub Actions esperan **LF**. Windows (editores, copiar/pegar) puede introducir **CRLF**. Un `.sh` con CRLF falla en el runner con errores crípticos (`$'\r': command not found`).

`.gitattributes` en la raíz fuerza LF:

```text
scripts/backup/*.sh text eol=lf
.github/workflows/*.yml text eol=lf
```

## Normalización reproducible (si Git o el editor reintroducen CRLF)

Desde la raíz del repo (Python 3; no usa rutas de un usuario concreto):

```powershell
python -c "from pathlib import Path; roots=[Path('scripts/backup'), Path('.github/workflows')];
files=[p for r in roots for p in r.glob('*') if p.suffix in {'.sh', '.yml'}];
[p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n')) for p in files];
print('normalized', len(files), 'files')"
```

## Validation

```bash
git diff --check
```

No debe listar `CRLF will be replaced by LF` de forma inesperada en esos paths una vez normalizados.

## Do not do

- No “arreglar” el problema convirtiendo a UTF-16.
- No desactivar `.gitattributes`.

---

# WSL / Git Bash

Los scripts se validaron en un entorno Linux-like **antes** de CI.

## Acceso al repo desde WSL

Windows `D:\nomadas-tour` se ve en WSL como `/mnt/d/nomadas-tour`.

Windows `C:\...` → `/mnt/c/...`.

## Commands

Instalar herramientas en WSL:

### age

```bash
sudo apt update
sudo apt install age
```

Si `apt` no ofrece el paquete, instalar el binario oficial en `~/.local/bin` y añadirlo al `PATH`.

### PostgreSQL **client** (restore drill)

```bash
sudo apt update
sudo apt install postgresql-client
```

`psql` viene de `postgresql-client`. `postgresql-client-common` **solo** no basta. **No** instalar PostgreSQL Server solo para restore.

### Checks

```bash
age --version
age-keygen --version
psql --version
jq --version
tar --version
gzip --version
```

### Suite local

Evitar heredar el `PATH` de Windows (paréntesis en `Program Files` rompen Bash). Ejemplo:

```bash
wsl -e bash -c "export PATH=/home/<USER>/.local/bin:/usr/bin:/bin && cd /mnt/d/nomadas-tour && bash scripts/backup/test-local.sh"
```

Si el repo está en `C:`:

```bash
cd /mnt/c/Users/<USER>/path/to/nomadas-tour
```

## Expected output

```text
15 passed, 0 failed
```

## Do not do

- No ejecutar `test-local.sh` contra producción (el script no lo hace; no “mejorarlo” para que sí).
- No copiar secretos de GitHub al entorno de test local.

---

# Local validation workflow

Secuencia usada al implementar (y la que debe repetirse ante un cambio de scripts):

```text
Create / edit scripts
→ bash -n
→ bash scripts/backup/test-local.sh
→ git diff --check
→ review diff
→ usuario: commit
→ usuario: push
→ merge a main
→ pull local de main
→ operational validation (workflow_dispatch)
```

Los agentes **no** hacen `git add` / `commit` / `push`. El operador humano sí. La validación operativa (R2, secrets, dump real) ocurre **después** del merge.

---

# Cloudflare R2

Almacenamiento **off-site** del ciphertext. Independiente de Supabase y de Render.

## Crear el bucket R2

### Prerequisites

Cuenta Cloudflare con R2 habilitado.

### UI path

```text
Cloudflare Dashboard
→ R2 Object Storage
→ Overview
→ Create bucket
```

### Valores

| Campo | Valor |
|-------|--------|
| Bucket name | `nomadas-backups` |
| Public access | **Disabled** |
| r2.dev / Public URL | **Disabled** |
| Custom Domains | **none** |

### What this does

Crea el único bucket de backups. Los scripts usan `R2_BUCKET` default `nomadas-backups`.

### Do not do

- No habilitar acceso público “para ver archivos”.
- No poner un custom domain delante del bucket.
- No usar un bucket de assets de producto.

### Validation

En el bucket:

- Public access = disabled
- No r2.dev subdomain
- Custom domains vacío

### Next step

[Crear el API token](#crear-el-api-token-de-r2).

---

## Crear el API token de R2

### UI path

```text
Cloudflare Dashboard
→ R2 Object Storage
→ Overview
→ Manage R2 API Tokens
→ Create API token
```

(La etiqueta exacta puede ser “Account API Tokens” / “R2 API Tokens” según el dashboard.)

### Valores elegidos

| Campo | Valor |
|-------|--------|
| Tipo | **Account API Token** |
| Permisos | **Object Read & Write** |
| Scope | **solo** el bucket `nomadas-backups` |
| TTL | Forever |
| Client IP filtering | None |

### Why

- GitHub Actions necesita leer y escribir objetos.
- Los runners de GitHub **no** tienen una IP fija útil para allowlist.
- Permisos Admin de cuenta son excesivos.

### Credentials (nombres; nunca valores)

Al crear el token Cloudflare muestra:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
<R2_SECRET_ACCESS_KEY>
```

El Account ID también está en:

```text
Cloudflare Dashboard
→ cualquier dominio o Overview
→ Account ID (barra lateral)
```

Copiar **una vez** a un gestor de contraseñas. El secret access key no se vuelve a mostrar.

### Do not do

- No pegar el secret en el repo, tickets, ni este documento.
- No reutilizar un token Admin global.

### Next step

[age keys](#age-keys), luego [GitHub Secrets](#github-actions-secrets).

---

## Verificar que el bucket sigue privado

### UI path

```text
Cloudflare Dashboard
→ R2 Object Storage
→ nomadas-backups
→ Settings
```

Confirmar de nuevo: public URL disabled, custom domains vacío, sin políticas de bucket públicas.

Un objeto `production/manifests/daily/<backup_id>/manifest.json` **no** debe abrirse en un navegador anónimo.

---

# age keys

Cifrado autenticado de los archives. Dos identities **distintas**.

| Identity | Public (GitHub Secret) | Private |
|----------|------------------------|---------|
| **Primary** (desastre) | `BACKUP_AGE_RECIPIENT` | **Offline only** — nunca GitHub |
| **Verify** (CI) | `BACKUP_AGE_VERIFY_RECIPIENT` | `BACKUP_AGE_VERIFY_IDENTITY` en GitHub **y** copia offline |

`age_encrypt` cifra para **ambos** recipients. CI descifra con verify. Restore de desastre usa la primary.

---

## Clave primaria de recuperación

### Prerequisites

`age-keygen` instalado (WSL). Máquina de confianza. Nadie más mirando la pantalla.

### Commands

```bash
mkdir -p ~/.nomadas-backup
chmod 700 ~/.nomadas-backup

age-keygen -o ~/.nomadas-backup/backup-age-key.txt
chmod 600 ~/.nomadas-backup/backup-age-key.txt
```

Public key (esto es `BACKUP_AGE_RECIPIENT`):

```bash
age-keygen -y ~/.nomadas-backup/backup-age-key.txt
```

### Expected output

Una línea `age1...` (pública) y un archivo con `AGE-SECRET-KEY-1...` (privada). **No** copiar la privada a GitHub.

### What this does

Sin este archivo no hay restore ante desastre. GitHub **no** puede recuperarlo.

### Do not do

- No commitear `backup-age-key.txt`.
- No ponerlo en Actions Secrets.
- No enviarlo por chat/email.

### Next step

Generar la identity de verify, luego [custodia](#custodia-windows--wsl--usb).

---

## Clave de verificación CI

### Commands

```bash
mkdir -p ~/.nomadas-backup/verify
chmod 700 ~/.nomadas-backup/verify

age-keygen -o ~/.nomadas-backup/verify/verify-age-key.txt
chmod 600 ~/.nomadas-backup/verify/verify-age-key.txt
```

Public (`BACKUP_AGE_VERIFY_RECIPIENT`):

```bash
age-keygen -y ~/.nomadas-backup/verify/verify-age-key.txt
```

El contenido del archivo (bloque `AGE-SECRET-KEY-1...`) es `BACKUP_AGE_VERIFY_IDENTITY`.

### Why two identities

CI debe demostrar que el ciphertext es descifrable **sin** exponer la llave de desastre. Si se filtra solo la identity de verify, se rotan verify keys; los backups viejos siguen siendo recuperables con la primary offline.

---

## Custodia Windows / WSL / USB

Rutas WSL:

```text
/home/<USER>/.nomadas-backup/backup-age-key.txt
/home/<USER>/.nomadas-backup/verify/verify-age-key.txt
```

Resolver rutas reales:

```bash
realpath ~/.nomadas-backup/backup-age-key.txt
realpath ~/.nomadas-backup/verify/verify-age-key.txt
```

Copia visible desde Windows (además del password manager):

```text
C:\Users\<USER>\Documents\Nomadas-Backup-Keys\
```

```bash
mkdir -p /mnt/c/Users/<USER>/Documents/Nomadas-Backup-Keys

cp /home/<USER>/.nomadas-backup/backup-age-key.txt \
  /mnt/c/Users/<USER>/Documents/Nomadas-Backup-Keys/backup-age-key.txt

cp /home/<USER>/.nomadas-backup/verify/verify-age-key.txt \
  /mnt/c/Users/<USER>/Documents/Nomadas-Backup-Keys/verify-age-key.txt
```

Luego: copia a USB **offline** (no dejar el USB conectado al PC de trabajo). Password manager = segunda copia. Opcional: tercera ubicación física.

`chmod 600` en WSL no se traduce a NTFS; el USB y la carpeta Documents deben estar fuera de sync a la nube pública y fuera de Git.

---

# GitHub Actions Secrets

### UI path

```text
GitHub
→ Repository (nomadas-tour)
→ Settings
→ Secrets and variables
→ Actions
→ Secrets
→ New repository secret
```

Crear **exactamente** estos 9 nombres (valores desde el gestor de contraseñas / dashboards; nunca aquí):

```text
SUPABASE_DB_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
BACKUP_AGE_RECIPIENT
BACKUP_AGE_VERIFY_RECIPIENT
BACKUP_AGE_VERIFY_IDENTITY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

El workflow `.github/workflows/backup.yml` los inyecta. No viven en Render ni en el runtime de la app.

### Tabla

| Secret | Source | Purpose | Public/private | Online/offline |
|--------|--------|---------|----------------|----------------|
| `SUPABASE_DB_URL` | Supabase → Database → Session pooler | `supabase db dump` | Private (password inside URI) | GitHub Secret |
| `SUPABASE_URL` | Supabase → Project Settings → API | Storage REST | Project URL is not the service role; treat as operational | GitHub Secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API | List/download private objects | **Private** | GitHub Secret |
| `BACKUP_AGE_RECIPIENT` | `age-keygen -y` primary | Encrypt to disaster key | **Public** key | GitHub Secret |
| `BACKUP_AGE_VERIFY_RECIPIENT` | `age-keygen -y` verify | Encrypt to CI key | **Public** key | GitHub Secret |
| `BACKUP_AGE_VERIFY_IDENTITY` | verify private file | Decrypt in CI verify | **Private** | GitHub Secret + offline copy |
| `R2_ACCOUNT_ID` | Cloudflare | Endpoint `https://<id>.r2.cloudflarestorage.com` | Account id | GitHub Secret |
| `R2_ACCESS_KEY_ID` | R2 API token | S3-compatible auth | Private | GitHub Secret |
| `R2_SECRET_ACCESS_KEY` | R2 API token | S3-compatible auth | **Private** | GitHub Secret |

**No** crear `BACKUP_AGE_SECRET_KEY` (primary private) en GitHub.

Restore manual usa la primary **offline** (`BACKUP_AGE_SECRET_KEY` o `-i` file).

### Validation

Settings → Secrets muestra los 9 nombres (valores ocultos). El primer `workflow_dispatch` es la prueba real.

---

# `SUPABASE_DB_URL` and Database Password

Para GitHub Actions se usa **Session Pooler**, no Direct connection. Direct suele estar en IPv6 y el runner no siempre llega.

### UI path

```text
Supabase Dashboard
→ Project (producción)
→ Project Settings
→ Database
→ Connection string
→ Session pooler
```

### Formato

```text
postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@<POOLER_HOST>:5432/postgres
```

Eso es `<SESSION_POOLER_URL>` una vez sustituidos los placeholders.

### Do not do

- No dejar el texto literal `[YOUR-PASSWORD]` ni los corchetes.
- No pegar la URI en el chat ni en el runbook.
- URL-encode caracteres especiales del password (`@`, `#`, `/`, etc.).

### Qué cambia un reset de Database Password

**Cambia:**

- password de Postgres;
- cualquier URI Direct o Pooler que lo contuviera (`SUPABASE_DB_URL`).

**No cambia:**

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY` / anon key;
- autenticación API estándar de Supabase.

La app en Render **no** usa una env de password de Postgres: usa `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (`backend/src/config/env.ts`). Resetear el DB password **no** exige cambiar esas dos env en Render. **Sí** exige actualizar `SUPABASE_DB_URL` en GitHub Actions o el dump diario falla.

### Next step

[GitHub workflow](#github-workflow).

---

# GitHub workflow

Archivo: `.github/workflows/backup.yml`

Nombre en Actions: `backup`

Permisos: `contents: read`

Concurrency: grupo `nomadas-backup`, `cancel-in-progress: false`

Runner: `ubuntu-latest`, timeout 45 min

CLI: `supabase/setup-cli@v1` con `version: latest`

### Schedule

| Cron | UTC | America/Caracas |
|------|-----|-----------------|
| `0 3 * * *` | 03:00 | 23:00 del **día calendario anterior** |

GitHub cron **no** garantiza el minuto exacto. Si el job no aparece, usar dispatch.

También: `workflow_dispatch` (manual).

Confirmar que el archivo está en **`main`**. Un workflow solo en una feature branch no corre el cron de producción.

---

## Disparo manual (`workflow_dispatch`)

### UI path

```text
GitHub
→ Repository
→ Actions
→ backup
→ Run workflow
→ Branch: main
→ Run workflow
```

### Expected output

Job verde. Steps: Checkout → Install tools → Setup Supabase CLI → Prepare workspace → Database dump → Storage → Verify → Manifest + GFS → Retention → Cleanup.

Logs **no** deben imprimir passwords, `AGE-SECRET-KEY`, service role ni URIs con userinfo.

### Validation

Ver [Validar que el workflow pasó](#validar-que-el-workflow-pasó).

---

## Orden del workflow (por qué)

1. **verify antes de finalize** — el manifest `success` solo se escribe/sube si el ciphertext se descargó, coincidió el SHA-256, se descifró y el SQL es estructuralmente válido.
2. **retention solo después de finalize** — no podar hasta que el snapshot de hoy esté catalogado.
3. **cleanup `if: always()`** — borra el workdir aunque el job falle (menos plaintext en el runner).

---

## Validar que el workflow pasó

```text
workflow green
+ objetos en R2 bajo production/database/daily/<backup_id>/ y production/storage/daily/<backup_id>/
+ production/manifests/daily/<backup_id>/manifest.json con "status": "success"
```

El `backup_id` tiene forma `YYYYMMDDTHHMMSSZ-<GITHUB_RUN_ID>`.

Hasta que un **restore drill** del backup **posterior al fix de `buckets_vectors`** no pase, **no** declarar DR cerrado. Un job verde no prueba que `psql` pueda aplicar `data.sql` en un proyecto nuevo.

---

# R2 object layout and manifest

```text
nomadas-backups/
└── production/
    ├── database/
    │   ├── daily/<backup_id>/database.tar.gz.age
    │   ├── daily/<backup_id>/database.tar.gz.age.sha256
    │   ├── weekly/...
    │   └── monthly/...
    ├── storage/
    │   ├── daily/<backup_id>/storage.tar.gz.age
    │   ├── daily/<backup_id>/storage.tar.gz.age.sha256
    │   ├── weekly/...
    │   └── monthly/...
    └── manifests/
        ├── daily/<backup_id>/manifest.json
        ├── weekly/...
        └── monthly/...
```

Prefijo adicional (evidencia humana, no lo escribe el cron):

```text
restore-drills/
```

Endpoint S3:

```text
https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
```

---

## Manifest

Campos (nombres reales en `finalize.sh`):

| Campo | Significado |
|-------|-------------|
| `backup_id` | ID del snapshot |
| `created_at` | UTC |
| `status` | `success` (solo ruta feliz) |
| `rpo` | `24h` |
| `rto_target` | `8h` |
| `rto_expected_estimate` | `90min (operational estimate, not an SLA)` |
| `schedule_note` | cron 03:00 UTC |
| `git_sha` | commit del runner |
| `workflow_run` | `GITHUB_RUN_ID` |
| `workflow_url` | link al run |
| `database` | object key, sha256, bytes, artifacts, `repo_latest_migration`, `auth` counts |
| `storage` | object key, sha256, bytes, `object_count` |
| `auth_included` | **`true`** |
| `auth` | `{ users, identities, mfa_factors }` — counts only, never emails/tokens |
| `limitations` | re-login, JWTs, OAuth/SSO/SMTP, WebAuthn, RPO |

En el fragmento de database:

```text
auth_included = true
storage_schema_included = false
```

`auth.users` / `auth.identities` viajan en `data.sql`. Eso **no** hace reutilizables JWTs, sessions ni refresh tokens del proyecto de origen.

---

# Retention

```text
14 daily
4 weekly
2 monthly
~90 days intended window
```

GFS: el diario cubre las últimas dos semanas; el semanal (domingo UTC) y el mensual (día 1 UTC) cubren más atrás con menos copias.

Lifecycle R2 recomendada (safety net, configurada en Cloudflare si se aplica): expirar `production/` a **95 días**, **después** de que `retention.sh` haya podido conservar weekly/monthly. No usar lifecycle como único motor de “keep last N”.

---

# Manual backup validation

Para inspeccionar un snapshot **sin** restore (máquina de confianza, primary o verify identity).

### Prerequisites

Ciphertexts descargados desde R2. Identity `age` correcta. No usar producción como destino.

### Commands

```bash
sha256sum -c database.tar.gz.age.sha256
sha256sum -c storage.tar.gz.age.sha256
```

Decrypt (primary):

```bash
age -d \
  -i /path/to/backup-age-key.txt \
  -o database.tar.gz \
  database.tar.gz.age
```

```bash
gzip -t database.tar.gz
mkdir database
tar -xzf database.tar.gz -C database
```

Filas reales:

```bash
grep -m 5 -E '^COPY |^INSERT ' database/data.sql
```

Tablas internas **ausentes** (esperado: **sin salida**):

```bash
grep -E '^COPY (storage\.buckets_vectors|storage\.vector_indexes)' database/data.sql
grep -E '^COPY ("auth"\.){0,1}"?(flow_state|saml_relay_states|oauth_client_states|mfa_challenges|webauthn_challenges|instances|schema_migrations)' database/data.sql
```

Auth **presente** (esperado: al menos una línea cada uno):

```bash
grep -E '^COPY ("auth"\."users"|auth\.users) ' database/data.sql
grep -E '^COPY ("auth"\."identities"|auth\.identities) ' database/data.sql
```

Repetir decrypt/`gzip -t`/`tar` para Storage.

### Do not do

- No asumir que “el archivo pesa > 0” = dump con filas.
- No usar un backup **anterior** al fix `6267576` para un restore drill nuevo.

---

# Restore drill — complete procedure

**Manual, trimestral, proyecto aislado.** No hay `restore-drill.sh`. **Nunca** producción.

El primer intento real (backup `20260817T233641Z-32081141864`) falló en `data.sql` por `buckets_vectors`. Ese ID **no** se reutiliza. El drill debe repetirse con un backup generado **después** del commit `6267576`.

Puedes usar `restore.sh` **o** `psql` a mano (el primer drill usó `psql` para ver el error exacto). Abajo: procedimiento **desde cero** con `psql`.

---

## Crear proyecto Supabase aislado

### UI path

```text
Supabase Dashboard
→ New project
```

Nombre de ejemplo:

```text
nomadas-restore-drill-YYYY-MM-DD
```

Región: la que use el operador. Password de DB: generar y guardar en el gestor (es `<DB_PASSWORD>` del **drill**, no el de producción).

### Do not do

- No usar el project ref de producción.
- No apuntar Render al proyecto de drill.

### Next step

Session Pooler del **proyecto nuevo** → `<NEW_DB_URL>`.

---

## Connection string del drill

### UI path

```text
Supabase (proyecto drill)
→ Project Settings
→ Database
→ Session pooler
```

```bash
export NEW_DB_URL='<NEW_DB_URL>'
```

### Install psql (WSL)

```bash
sudo apt update
sudo apt install postgresql-client
```

### Test

```bash
psql "$NEW_DB_URL" -c '\conninfo'
```

### Expected output

Host del pooler del **drill**, user `postgres.<PROJECT_REF>` del drill, database `postgres`. Si el host o el ref coinciden con producción: **parar**.

### Target vacío

```bash
psql "$NEW_DB_URL" -c "\dt"
```

En un proyecto nuevo, `public` debe estar vacío o solo con objetos default de Supabase, no las tablas de Nómadas.

### Privileges (reduce grants por defecto a `anon`/`authenticated`)

```bash
psql "$NEW_DB_URL" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;"
```

---

## Aplicar el dump

Tras [validación manual](#manual-backup-validation) (archivos en `./database/`).

```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file database/roles.sql \
  --file database/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file database/data.sql \
  --dbname "$NEW_DB_URL"
```

### Errores frecuentes (no editar el dump a ciegas)

| Síntoma | Qué hacer |
|---------|-----------|
| role `supabase_admin` / `cli_login_postgres` does not exist | Omitir `roles.sql` (`SKIP_ROLES=1` o quitar `--file database/roles.sql`). Los roles de plataforma los gestiona Supabase. |
| `must be owner` / cannot alter extension | No pelear con schemas administrados (`auth`, `storage`, `extensions`). Restaurar **nuestro** `public`. |
| `permission denied for table buckets_vectors` | Backup **viejo**. Generar uno nuevo; no parchear `data.sql` a mano como “solución permanente”. |
| `duplicate key` / objects already exist | El target no estaba vacío. Usar otro proyecto. **No** `DROP DATABASE` en producción. |

### Do not do

- No borrar líneas del SQL “hasta que pegue” y dar el drill por bueno.
- No mezclar `--file` de un backup con datos de otro.

---

## Restore validation (datos reales, no solo schema)

```bash
psql "$NEW_DB_URL" -c "\dt"
```

Conteos de negocio (ajustar si el modelo crece; deben ser **> 0** si producción tenía filas):

```sql
select count(*) from public.agencies;
select count(*) from public.trips;
select count(*) from public.reservations;
select count(*) from public.seats;
```

Funciones:

```sql
select count(*)
from information_schema.routines
where routine_schema = 'public';
```

RLS:

```sql
select count(*)
from pg_policies
where schemaname = 'public';
```

Un schema vacío con tablas sin filas **no** es un restore PASS.

Guardar evidencia (timestamps, `backup_id`, conteos) bajo `restore-drills/` en R2 **sin secretos**. No borrar el proyecto de drill hasta registrar esa evidencia.

---

# Storage restore

Los bytes **no** vienen de `data.sql`. Vienen de `storage.tar.gz.age`.

```bash
age -d \
  -i /path/to/backup-age-key.txt \
  -o storage.tar.gz \
  storage.tar.gz.age

gzip -t storage.tar.gz
mkdir storage
tar -xzf storage.tar.gz -C storage
```

El árbol conserva `bucket/key`. Ejemplo esperado:

```text
storage/agency-assets/logo.png
```

### UI path (crear bucket en el proyecto drill)

```text
Supabase (drill)
→ Storage
→ New bucket
→ agency-assets
```

(Público/privado: copiar la intención de producción; el archive **no** incluye la config del bucket.)

Subir objetos **preservando paths** (UI upload o `RESTORE_STORAGE=1` con las keys del **drill**).

La metadata/policies del bucket son **aparte** de los bytes. Recrear policies si el producto las necesita.

---

# Auth recovery

```text
auth.users + auth.identities
INCLUDED in data.sql (logical dump --data-only)
```

Contrato:

- **Restaurado:** usuarios, identities, MFA factors, audit_log_entries.
- **Presente pero no reutilizable:** sessions, refresh_tokens (el proyecto nuevo tiene signing keys distintas).
- **Excluido:** flow_state, saml_relay_states, oauth_client_states, mfa_challenges, webauthn_challenges, instances, schema_migrations.
- **Manual en dashboard:** SMTP, OAuth/SSO, Site URL, Redirect URLs.
- **Re-login obligatorio.** Old JWTs inválidos.
- **WebAuthn/Passkeys:** re-registro (RP ID cambia).

Drill `20260818T002023Z-32084093832`: login con contraseña original, JWT nuevo, RLS PASS.

---

# Real disaster restore

Orden (detalle de cutover: runbook + [`RECOVERY-CHECKLIST.md`](RECOVERY-CHECKLIST.md) + [`backend-deploy.md`](backend-deploy.md)):

```text
incident confirmed
→ new Supabase project
→ DB restore (backup_id verify PASS; Auth users/identities in data.sql)
→ Storage restore
→ Auth platform config (OAuth/SSO, SMTP, Site URL, Redirect URLs)
→ users re-login (old JWTs invalid)
→ Render env updates (SUPABASE_URL + SERVICE_ROLE + JWT del proyecto NUEVO)
→ Edge Function deployment if still required (supabase/functions/release-expired-locks)
→ API verification GET /health
→ Worker verification GET /healthz
→ smoke tests
→ cutover (DNS / clientes)
```

> Never casually point Render production to a restore drill project.

RPO 24 h / RTO target 8 h / RTO ~90 min **no cambian**.

---

# Real incidents / lessons learned

## Incident 1 — GitHub Actions billing lock

**Symptom:**

```text
The job was not started because your account is locked due to a billing issue.
```

**Cause:** la cuenta GitHub tenía un bloqueo de autorización de billing antiguo. El plan era GitHub Free / Copilot Free. El historial de pagos no tenía un cobro completado que desbloqueara Actions.

**Fix:** re-autorizar el método de pago (PayPal) en GitHub Billing. Sin eso el workflow no arranca, aunque el YAML sea correcto.

No documentar números de tarjeta ni cuentas de pago.

---

## Incident 2 — `[YOUR-PASSWORD]`

**Symptom:**

```text
FATAL: password authentication failed for user "postgres"
```

**Cause:** el placeholder de Supabase se dejó literal en `SUPABASE_DB_URL` (`[YOUR-PASSWORD]` o corchetes).

**Fix:** sustituir por el Database Password real, sin brackets, URL-encoded si aplica. Actualizar el Secret y re-lanzar el workflow.

---

## Incident 3 — `buckets_vectors`

**Symptom:**

```text
psql:database/data.sql:1364: ERROR: permission denied for table buckets_vectors
```

Ocurrió en el **proyecto aislado**, no en producción. El backup `20260817T233641Z-32081141864` había pasado dump, Storage, age, R2, verify, finalize y retention: verify estructural **no** bastaba.

**Cause:** `data.sql` incluía tablas internas `storage.buckets_vectors` y `storage.vector_indexes`.

**Fix:** exclusiones `-x` en `database.sh` + asserts. Commit `6267576`. **No** continuar el restore de ese backup. Generar uno nuevo y repetir el drill.

---

## Incident 4 — `psql` missing

**Symptom:**

```text
Command 'psql' not found
```

**Fix:**

```bash
sudo apt install postgresql-client
```

`postgresql-client-common` no instala el binario `psql`.

---

## Incident 5 — key identity confusion

| Identity | Sirve para | No sirve para |
|----------|------------|----------------|
| Primary (`BACKUP_AGE_RECIPIENT` / private offline) | Cifrar (public) + restore de desastre (private) | No vive en GitHub |
| Verify (`BACKUP_AGE_VERIFY_*`) | CI download→decrypt | No es la llave de desastre |

Usar la private de verify para un desastre **solo** funciona mientras esa identity siga siendo recipient de esos archivos. La política es: desastre = primary offline.

---

# Git / branch workflow

Modelo usado en la implementación:

```text
audit/analysis
→ implementation
→ local validation (bash -n, test-local.sh)
→ user commit
→ push
→ merge
→ local main pull
→ operational validation (secrets, R2, workflow_dispatch)
```

- El usuario hace commit y push.
- Los agentes no.
- La misma rama puede vivir todo un ciclo de implementación.
- **No** abrir una rama duplicada solo porque `main` ya recibió el merge.
- Rama nueva **solo** cuando hace falta otro cambio de código.

Commits de referencia (backup):

```text
f81f203  feat(infra): add backup and disaster recovery pipeline
6267576  fix(infra): exclude internal supabase storage tables from backup
```

---

# First production backups

Hitos **sin secretos**. DR **no** está cerrado hasta que el restore drill del backup post-fix pase.

### Backup 1 (pre-fix) — 2026-08-17

| Campo | Valor |
|-------|--------|
| `backup_id` | `20260817T233641Z-32081141864` |
| Pipeline commit | `f81f203` |
| Workflow | PASS (dump, Storage, age, R2, verify, finalize, retention) |
| Storage | bucket `agency-assets`, objeto `logo.png` (y recuento en manifest) |
| R2 | objetos presentes, manifest `status=success` |
| Restore drill | **FAIL** — `permission denied for table buckets_vectors` |

No reutilizar este ID para un drill nuevo. No modificar el ciphertext a mano.

### Backup 2 (post-fix)

Tras merge de `6267576`, se ejecutó un nuevo `workflow_dispatch`. El pipeline volvió a pasar (backup + Storage + encryption + R2 + verify + finalize + retention). Ese snapshot es el candidato del **siguiente** restore drill.

Confirmar en el `data.sql` extraído:

```text
grep COPY storage.buckets_vectors  → vacío
grep COPY storage.vector_indexes   → vacío
grep COPY/INSERT de tablas de negocio → presente
```

---

# Future local backup (not implemented)

Documentación únicamente. **No** está construido.

```text
PRIMARY
GitHub Actions → R2 (este MVP)

CONTINGENCY
manual encrypted local backup (misma forma: tar.gz.age + SHA-256)
```

Debe ser último recurso, **fuera del scheduler**, cifrado con `age`, sin secretos en el repo, sin tratar el PC del operador como infraestructura de producción. No reemplaza R2.

Detalle de producto: [`ROADMAP.md`](ROADMAP.md) / [`TASKS.md`](../TASKS.md).

---

# Key rotation

No rotar secretos de producción **en esta tarea**. Procedimientos futuros:

## Primary age key

1. Generar nuevo par offline.
2. Poner la **nueva** public en `BACKUP_AGE_RECIPIENT`.
3. `workflow_dispatch` de prueba: verify PASS con **verify identity** (sigue siendo el segundo recipient).
4. Conservar la **vieja** private mientras existan ciphertexts cifrados solo/también para ella (en la práctica ambos recipients van en cada archivo; igual: no borrar la vieja hasta que ningún backup que debas poder leer dependa de ella).
5. Retirar la vieja solo cuando el operador acepte que esos snapshots ya no hacen falta o están re-cifrados (re-cifrar **no** es automático hoy).

## Verify age key

1. Nuevo par.
2. Actualizar `BACKUP_AGE_VERIFY_RECIPIENT` y `BACKUP_AGE_VERIFY_IDENTITY`.
3. Dispatch de prueba. Backups **viejos** siguen descifrables con primary (y con la verify vieja si se conserva).
4. Si se filtró solo verify: rotar verify; primary intacta.

## R2 credentials

Nuevo API token Read & Write scoped a `nomadas-backups` → actualizar los 3 secrets R2 → dispatch. Revocar el token viejo. Los objetos no se reescriben.

## Database password

Reset en Supabase → actualizar **solo** `SUPABASE_DB_URL` en GitHub. Render no usa esa password. Dispatch de prueba.

## Service role key

Rotar en Supabase Dashboard → actualizar `SUPABASE_SERVICE_ROLE_KEY` en GitHub **y** en Render (API + worker). Es credencial de **app**, no solo de backup.

---

# Do not do

Never:

```text
- commit secrets;
- put primary age private key in GitHub;
- make R2 public;
- use R2 Admin permissions unnecessarily;
- use production DB URL for restore drill;
- restore production casually;
- run restore without explicit target;
- edit SQL merely to hide errors;
- assume upload success = backup success;
- declare manifest success before verification;
- delete the only copy of an age private key;
- delete the restore drill project before recording evidence;
- point Render production at a drill project;
- treat old JWTs, sessions, or refresh tokens as reusable after restore;
- skip OAuth/SSO/SMTP/Site URL reconfiguration because users were restored;
- exclude all of storage.* and call Storage “backed up” without storage.sh;
- continue a restore of backup 20260817T233641Z-32081141864.
```

---

# Quick reference

## Daily

Normalmente nada manual. Cron `0 3 * * *` (03:00 UTC).

## Manual backup

```text
GitHub
→ Actions
→ backup
→ Run workflow
```

## R2

```text
Cloudflare
→ R2 Object Storage
→ nomadas-backups
```

## Secrets (nombres)

```text
SUPABASE_DB_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
BACKUP_AGE_RECIPIENT
BACKUP_AGE_VERIFY_RECIPIENT
BACKUP_AGE_VERIFY_IDENTITY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

## Keys

- **Primary private:** offline (password manager + USB). Nunca GitHub.
- **Verify private:** GitHub Secret + copia offline.

## Validation

```text
workflow green
+
R2 objects present
+
manifest status=success
```

Restore real / drill: [`backup-disaster-recovery-runbook.md`](backup-disaster-recovery-runbook.md) y checklist [`RECOVERY-CHECKLIST.md`](RECOVERY-CHECKLIST.md).

## Tests locales

```bash
bash scripts/backup/test-local.sh
```

Esperado: todos PASS, 0 failed.
