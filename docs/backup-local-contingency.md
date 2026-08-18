# Backup local de contingencia — Tutorial operativo

**Alcance:** copia manual, verificación offline, retención local y restore desde disco de un backup **ya existente en R2**.

**Este tutorial contiene todo lo necesario** para crear, verificar, conservar y restaurar una copia local de contingencia. Los documentos siguientes son **referencia complementaria** sobre el sistema BDR completo — no hace falta consultarlos para ejecutar el flujo local:

- [`backup-disaster-recovery-operations.md`](backup-disaster-recovery-operations.md) — instalación del backup automático, secrets iniciales, workflow
- [`backup-disaster-recovery-runbook.md`](backup-disaster-recovery-runbook.md) — cutover, RTO/RPO y decisiones de desastre
- [`RECOVERY-CHECKLIST.md`](RECOVERY-CHECKLIST.md) — checklist de reconstrucción de servicios

**Principio:** **copy, don't regenerate.** Los scripts copian ciphertexts ya producidos por el pipeline automático. No ejecutan `pg_dump`, no vuelven a cifrar y no modifican el workflow.

**Entorno del operador:** Windows + WSL + repositorio Nómadas Tour clonado (p. ej. `/mnt/d/nomadas-tour`).

**Backup de referencia (validación histórica):** `20260818T045852Z-32101100102` — usar solo como ejemplo de formato; elegir siempre el `BACKUP_ID` real que corresponda.

---

## Procedimiento rápido

Flujo principal sin leer las secciones detalladas. Cada paso indica el resultado que confirma el éxito.

| Paso | Acción | Resultado esperado |
|------|--------|-------------------|
| 1 | Entrar al repo en WSL: `cd /mnt/d/nomadas-tour` | Shell en la raíz del clone |
| 2 | Comprobar prerrequisitos: `aws`, `age`, `jq`, `bash` (§3) | Comandos responden con `--version` |
| 3 | Configurar R2 + identity age (§4–§5) | Variables exportadas sin imprimir secretos |
| 4 | Elegir `BACKUP_ID` (§6) | ID con forma `YYYYMMDDTHHMMSSZ-<run_id>` |
| 5 | Definir `LOCAL_BACKUP_DIR` y crear el directorio (§5) | Ruta elegida por el operador |
| 6 | `bash scripts/backup/local.sh "$BACKUP_ID" "$LOCAL_BACKUP_DIR"` | Log: **`local copy PASS`** |
| 7 | `unset R2_*` y `bash scripts/backup/local-verify.sh …` (§10) | Log: **`local verify PASS`** |
| 8 | Comprobar que no hay plaintext (§11) | Solo 5 artefactos cifrados/metadata |
| 9 | Si solo se quiere **preservar** la copia → **proceso terminado** | Criterios §9 cumplidos |
| 10 | Si se requiere **recuperación** → preparar target aislado (§17) | Checks de configuración OK |
| 11 | Restore dry-run, luego restore real (§16) | Logs de restore + validación §18–§19 |

> Para entender cada paso, criterios de validez y troubleshooting, continuar con las secciones detalladas.

---

## Ruta operativa recomendada

### Contingencia normal (preservar copia)

```text
1. Seleccionar backup          → §6
2. Ejecutar local.sh             → §7  → local copy PASS
3. Ejecutar local-verify.sh      → §10 → local verify PASS
4. Comprobar manifest            → §12
5. Conservar copia             → §9 (criterios de validez)
```

Opcional: `local-list.sh` (§14), retención local dry-run (§15).

### Prueba (restore drill)

```text
1. Crear staging limpio          → §17
2. local-verify                  → §10
3. local-restore dry-run         → §16.A
4. local-restore real            → §16.A
5. Validar Auth / RLS / Storage  → §18–§19
```

Usar proyecto **nuevo o completamente vacío** para evitar falsos positivos.

### Disaster recovery real

```text
1. Conservar / verificar backup local  → §9–§10
2. Confirmar target de recuperación    → §17
3. Ejecutar restore                    → §16.B
4. Reconfigurar plataforma Auth        → §16.B (OAuth/SMTP/URLs)
5. Validar Auth                        → §18
6. Validar API / worker                → runbook (cutover)
7. Smoke tests                         → §19
8. Cutover según runbook               → referencia complementaria
```

---

## Table of contents

- [Procedimiento rápido](#procedimiento-rápido)
- [Ruta operativa recomendada](#ruta-operativa-recomendada)
1. [Qué es](#1-qué-es-el-backup-local-de-contingencia)
2. [Cuándo utilizarlo](#2-cuándo-utilizarlo)
3. [Prerrequisitos](#3-prerrequisitos)
4. [Identities age](#4-identities-age)
5. [Variables de entorno](#5-variables-de-entorno)
6. [Elegir el backup](#6-elegir-el-backup)
7. [Crear la copia local](#7-crear-la-copia-local)
8. [Ejemplo de salida](#8-ejemplo-de-salida)
9. [¿Cuándo es válida una copia local?](#9-cuándo-es-válida-una-copia-local)
10. [Verificar sin R2](#10-verificar-la-copia-sin-r2)
11. [Comprobar que no hay plaintext](#11-comprobar-que-no-hay-plaintext)
12. [Verificar el manifest](#12-verificar-el-manifest)
13. [Byte-identical con R2 (opcional)](#13-byte-identical-con-r2-opcional)
14. [Listar backups locales](#14-listar-backups-locales)
15. [Retención local](#15-retención-local)
16. [Restore desde copia local](#16-restore-desde-copia-local)
17. [Preparar staging / target aislado](#17-preparar-staging--target-aislado)
18. [Validación funcional post-restore](#18-validación-funcional-después-del-restore)
19. [¿Cuándo está validado un restore?](#19-cuándo-está-validado-un-restore)
20. [Seguridad](#20-seguridad)
21. [Troubleshooting](#21-troubleshooting)
22. [Documentación complementaria](#22-documentación-complementaria)

---

## 1. Qué es el backup local de contingencia

```text
R2                    = backup automático principal (GitHub Actions → age → R2)
Backup local          = copia manual de contingencia (operador → disco)
```

| Característica | Backup local |
|----------------|--------------|
| Manual | Sí — el operador ejecuta `local.sh` |
| Cifrado | Sí — conserva los `.tar.gz.age` existentes |
| Scheduler / cron | No |
| GitHub Actions | No |
| Sustituye R2 | No |
| Genera backup nuevo | No |
| Offline tras descarga | Sí — `local-verify.sh` y `local-restore.sh` no necesitan R2 |
| Infraestructura de producción | No — la PC del operador solo guarda ciphertext |

Flujo:

```text
R2
  ↓  local.sh
copia local cifrada (<LOCAL_DIR>/daily/<BACKUP_ID>/)
  ↓  local-verify.sh
verify offline
  ↓  local-restore.sh (opcional, proyecto aislado)
restore en staging / disaster recovery
```

Scripts:

```text
scripts/backup/local.sh
scripts/backup/local-list.sh
scripts/backup/local-verify.sh
scripts/backup/local-restore.sh
scripts/backup/local-retention.sh
```

---

## 2. Cuándo utilizarlo

Usar la copia local cuando:

- R2 está temporalmente inaccesible o hay outage de Cloudflare/R2
- Las credenciales de R2 fallan y se necesita un backup ya descargado
- Se quiere una copia offline adicional de un `backup_id` concreto
- Se va a restaurar desde disco sin volver a descargar de R2
- Se quiere preservar un snapshot verificado fuera de R2

**Importante:** la copia local **no mejora el RPO** del sistema automático (sigue siendo 24 h). Es una capa extra de resiliencia operativa, no un segundo pipeline de backup.

---

## 3. Prerrequisitos

Trabajar desde **WSL** en el directorio del repo:

```bash
cd /mnt/d/nomadas-tour    # o la ruta real del clone
export PATH="$HOME/.local/bin:/usr/bin:/bin"
```

### Comandos requeridos

| Comando | Uso |
|---------|-----|
| `bash` | Ejecutar scripts |
| `aws` | Descargar de R2 en `local.sh` |
| `age` / `age-keygen` | Descifrar para verify/restore |
| `jq` | Validar manifest |
| `tar`, `gzip` | Integridad de archives |
| `psql` | Solo restore real (no dry-run) |
| `curl`, `python3` | Solo si `RESTORE_STORAGE=1` en restore real |

Comprobar:

```bash
bash --version
aws --version
age --version
jq --version
tar --version
gzip --version
```

### Instalar AWS CLI en WSL

Los scripts usan `aws s3 cp` con credenciales R2 vía variables de entorno. **No hace falta** `aws configure`.

```bash
sudo apt update
sudo apt install -y awscli
aws --version
```

### Instalar age en WSL

```bash
sudo apt update
sudo apt install -y age
age --version
```

Si `apt` no ofrece el paquete, instalar el binario oficial en `~/.local/bin` y añadirlo al `PATH`.

### Instalar jq (si falta)

```bash
sudo apt install -y jq
```

---

## 4. Identities age

El proyecto usa **dos pares age**. Cada backup de producción se cifra con **dos recipients** (primary + verify); cualquiera de las dos private keys puede descifrar.

### Primary / master identity — `backup-age-key.txt`

| | |
|---|---|
| **Archivo típico** | `backup-age-key.txt` |
| **Uso** | Disaster recovery real |
| **Custodia** | Offline — password manager + copia física segura. **Nunca** en GitHub ni junto a los backups |

### Verify identity — `verify-age-key.txt`

| | |
|---|---|
| **Archivo típico** | `verify-age-key.txt` |
| **Uso** | Verificación de backups; pruebas locales; `local.sh` / `local-verify.sh`; restore drill cuando baste con descifrar (ambos recipients presentes) |
| **Custodia** | GitHub Secret + copia offline |

**Nunca** imprimir ni pegar el contenido de las private keys en tickets, chat o este repo.

### Localizar los archivos

```bash
find /mnt/c/Users/<usuario>/Documents \
  -type f \
  \( -name "backup-age-key.txt" -o -name "verify-age-key.txt" \) \
  2>/dev/null
```

También pueden estar bajo `~/.nomadas-backup/` en WSL.

### Método recomendado — archivo en disco

Para copia y verify (operación normal):

```bash
export BACKUP_AGE_IDENTITY_FILE="/ruta/real/verify-age-key.txt"
chmod 600 "$BACKUP_AGE_IDENTITY_FILE"
```

Para disaster recovery real (restore contra proyecto de recuperación):

```bash
export BACKUP_AGE_IDENTITY_FILE="/ruta/real/backup-age-key.txt"
chmod 600 "$BACKUP_AGE_IDENTITY_FILE"
```

`lib.sh` resuelve la identity en este orden: argumento explícito → `BACKUP_AGE_IDENTITY_FILE` → `BACKUP_AGE_VERIFY_IDENTITY` (inline) → `BACKUP_AGE_SECRET_KEY` (inline).

### Método avanzado — identity inline

**No recomendado para operación normal.** Las variables inline dejan el secreto en el entorno del proceso y pueden quedar en el historial de shell.

```bash
export BACKUP_AGE_VERIFY_IDENTITY='AGE-SECRET-KEY-1...'   # verify
export BACKUP_AGE_SECRET_KEY='AGE-SECRET-KEY-1...'        # master
```

Usar solo si no hay acceso al archivo y el operador acepta el riesgo operativo.

**No** guardar la private key dentro de `<LOCAL_BACKUP_DIR>` ni junto a los ciphertexts.

---

## 5. Variables de entorno

Configurar en la shell de WSL (o gestor de secretos). **Nunca** commitear valores reales.

### Convención del tutorial

`LOCAL_BACKUP_DIR` es una variable de comodidad. Los scripts reciben ese path como **segundo argumento** `<LOCAL_DIR>`.

```bash
export LOCAL_BACKUP_DIR="/mnt/c/Users/<usuario>/nomadas-backups"
mkdir -p "$LOCAL_BACKUP_DIR"
```

### R2 (solo para `local.sh`)

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `R2_ACCOUNT_ID` | Sí | Account ID de Cloudflare |
| `R2_ACCESS_KEY_ID` | Sí | Access key del token R2 |
| `R2_SECRET_ACCESS_KEY` | Sí | Secret del token R2 |
| `R2_BUCKET` | No | Default: `nomadas-backups` |

Los scripts mapean internamente a `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. **No** usar `aws configure`.

### Age

| Variable | Uso recomendado |
|----------|-----------------|
| `BACKUP_AGE_IDENTITY_FILE` | **Método principal** — ruta a `verify-age-key.txt` o `backup-age-key.txt` |

### Backup

| Variable / argumento | Descripción |
|----------------------|-------------|
| `BACKUP_ID` | Argumento 1 de los scripts locales |
| `LOCAL_BACKUP_DIR` | Argumento 2 (`<LOCAL_DIR>`) |

### Restore (`local-restore.sh`)

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `RESTORE_TARGET_DB_URL` | Sí | Connection string del Session Pooler (copiada del Dashboard) |
| `CONFIRM_RESTORE` | Sí | Exactamente `RESTORE` |
| `RESTORE_ISOLATED` | Sí | Exactamente `yes` |
| `RESTORE_STORAGE` | No | `1` → sube bytes de Storage al target |
| `SUPABASE_URL` | Si `RESTORE_STORAGE=1` | URL del proyecto target |
| `SUPABASE_SERVICE_ROLE_KEY` | Si `RESTORE_STORAGE=1` | Service role del target |
| `RESTORE_DRY_RUN` | No | `1` → descifra y valida SQL; **no** `psql` ni PUT |
| `SKIP_ROLES` | No | `1` → omite `roles.sql` |

---

## 6. Elegir el backup

Formato:

```text
YYYYMMDDTHHMMSSZ-<run_id>
```

Ejemplo histórico:

```text
20260818T045852Z-32101100102
```

### Dónde encontrarlo

1. **GitHub Actions** — job `backup` → logs → `backup_id=`
2. **Manifest en R2** — `production/manifests/daily/<BACKUP_ID>/manifest.json` con `"status": "success"`
3. **Cloudflare R2** — bucket `nomadas-backups` → `production/database/daily/` o `production/manifests/daily/`

Elegir el último backup verificado **anterior** al incidente (o el snapshot que se quiera preservar).

```bash
export BACKUP_ID='20260818T045852Z-32101100102'   # sustituir por el ID real
```

---

## 7. Crear la copia local

```bash
bash scripts/backup/local.sh \
  "$BACKUP_ID" \
  "$LOCAL_BACKUP_DIR"
```

### Qué hace `local.sh` (comportamiento real)

```text
staging (/tmp/nomadas-local-copy.*)
  ↓ descarga 5 objetos R2
  ↓ SHA-256 sidecars
  ↓ manifest + backup_id
  ↓ header age + decrypt temporal + gzip -t
  ↓ borra plaintext temporal
mv staging → <LOCAL_BACKUP_DIR>/daily/<BACKUP_ID>/
```

1. Descarga cinco objetos bajo `production/.../daily/<BACKUP_ID>/`.
2. Valida en **staging** antes de publicar la copia final.
3. Mueve al destino **solo** si todo pasa.
4. Si el destino `<LOCAL_BACKUP_DIR>/daily/<BACKUP_ID>/` **ya existe**, aborta (no sobrescribe).

### Los cinco artefactos

```text
database.tar.gz.age
database.tar.gz.age.sha256
storage.tar.gz.age
storage.tar.gz.age.sha256
manifest.json
```

### Estructura resultante

```text
<LOCAL_BACKUP_DIR>/
└── daily/
    └── <BACKUP_ID>/
        ├── database.tar.gz.age
        ├── database.tar.gz.age.sha256
        ├── storage.tar.gz.age
        ├── storage.tar.gz.age.sha256
        └── manifest.json
```

### Si `local.sh` falla — copias parciales

> **No utilizar ninguna carpeta como backup válido si `local.sh` no terminó con `local copy PASS`.**

El script escribe en staging temporal y solo hace `mv` al destino final tras las validaciones. Si falla **antes** del `mv`, normalmente **no** queda un directorio final en `<LOCAL_BACKUP_DIR>/daily/<BACKUP_ID>/`. Si el destino ya existía de un intento anterior, el script rechaza sobrescribir.

Procedimiento:

```text
1. Leer el mensaje de error en stderr.
2. Confirmar si existe <LOCAL_BACKUP_DIR>/daily/<BACKUP_ID>/.
3. Si existe pero local-verify.sh no pasa → tratar como inválida.
4. Eliminar esa carpeta: rm -rf "<LOCAL_BACKUP_DIR>/daily/<BACKUP_ID>"
5. Corregir la causa (R2, age, red, permisos).
6. Repetir local.sh hasta obtener local copy PASS.
7. Ejecutar local-verify.sh.
```

---

## 8. Ejemplo de salida

Salida esperada (bytes dependen del backup):

```text
[backup-local] downloading R2 artifacts for 20260818T045852Z-32101100102
[backup-local] cryptographic check (temporary plaintext, then wipe)
[backup-local] local copy PASS
[backup-local] backup_id=20260818T045852Z-32101100102
[backup-local] artifact_count=5
[backup-local] database_ciphertext_bytes=<n>
[backup-local] storage_ciphertext_bytes=<n>
[backup-local] verification=PASS
[backup-local] destination=/mnt/c/Users/<usuario>/nomadas-backups/daily/20260818T045852Z-32101100102
```

Los logs no incluyen passwords, connection strings, hashes de filas ni contenido de keys.

---

## 9. ¿Cuándo es válida una copia local?

Checklist — marcar todo antes de considerar la copia una contingencia utilizable:

```text
[ ] local.sh terminó con local copy PASS
[ ] existen los 5 artefactos bajo daily/<BACKUP_ID>/
[ ] SHA-256 sidecars coinciden (validado por local.sh y local-verify.sh)
[ ] manifest.json es JSON válido
[ ] manifest backup_id coincide con BACKUP_ID
[ ] ciphertexts age válidos (header age-encryption.org/v1)
[ ] local-verify.sh devuelve local verify PASS
[ ] no hay plaintext persistente en la carpeta del backup
```

> Si `local-verify.sh` devuelve **`local verify PASS`**, la copia está verificada estructuralmente (checksums, manifest, age, gzip, contrato SQL Auth, árbol Storage) y puede considerarse **copia de contingencia válida**.

### `local-list.sh` no sustituye a `local-verify.sh`

`verified-checksums` en `local-list.sh` solo confirma que los cinco archivos existen y que los sidecars SHA-256 coinciden. **No** ejecuta decrypt ni validación estructural del dump. Siempre ejecutar `local-verify.sh` antes de confiar en la copia.

---

## 10. Verificar la copia sin R2

Paso crítico: demostrar independencia de R2.

```bash
unset R2_ACCOUNT_ID
unset R2_ACCESS_KEY_ID
unset R2_SECRET_ACCESS_KEY

bash scripts/backup/local-verify.sh \
  "$BACKUP_ID" \
  "$LOCAL_BACKUP_DIR"
```

Mantener `BACKUP_AGE_IDENTITY_FILE` (u otra identity válida).

### Qué valida `local-verify.sh`

- Cinco artefactos presentes
- SHA-256 sidecars
- `manifest.json` + `backup_id`
- Header `age`
- Decrypt temporal → `gzip -t`
- `roles.sql`, `schema.sql`, `data.sql` + contrato Auth (`assert_data_sql_backup_contract`)
- Árbol Storage extraído

Salida esperada:

```text
[backup-local-verify] local verify PASS
```

Plaintext solo en `/tmp/nomadas-local-verify.*` — se borra al salir.

---

## 11. Comprobar que no hay plaintext

```bash
find "$LOCAL_BACKUP_DIR/daily/$BACKUP_ID" \
  -maxdepth 1 \
  -type f \
  -printf '%f\n' | sort
```

Esperado (exactamente cinco archivos):

```text
database.tar.gz.age
database.tar.gz.age.sha256
manifest.json
storage.tar.gz.age
storage.tar.gz.age.sha256
```

**No** deben existir:

```text
database.tar.gz
roles.sql
schema.sql
data.sql
storage/
```

---

## 12. Verificar el manifest

```bash
jq '{
  backup_id,
  status,
  auth_included,
  auth
}' \
  "$LOCAL_BACKUP_DIR/daily/$BACKUP_ID/manifest.json"
```

Contrato actual esperado:

```text
auth_included = true
auth.users       → entero
auth.identities  → entero
auth.mfa_factors → entero
```

Comparar conteos Auth con los obtenidos tras un restore (§18).

---

## 13. Byte-identical con R2 (opcional)

> Esta comprobación es **opcional**. Normalmente solo se realiza durante validación inicial, auditoría o troubleshooting.

> `local.sh` **ya valida SHA-256** durante la copia. **No** es necesario volver a descargar desde R2 en cada operación normal para considerar válida una copia local.

Para confirmar byte-identidad adicional contra R2:

```bash
export R2_ACCOUNT_ID='<placeholder>'
export R2_ACCESS_KEY_ID='<placeholder>'
export R2_SECRET_ACCESS_KEY='<placeholder>'
export R2_BUCKET='nomadas-backups'

TMP_R2="$(mktemp -d)"
KEY="production/database/daily/${BACKUP_ID}/database.tar.gz.age"

aws s3 cp "s3://${R2_BUCKET}/${KEY}" "${TMP_R2}/database.tar.gz.age" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --only-show-errors

cmp "${TMP_R2}/database.tar.gz.age" \
  "$LOCAL_BACKUP_DIR/daily/$BACKUP_ID/database.tar.gz.age"

rm -rf "$TMP_R2"
```

`cmp` **sin salida** = idénticos byte a byte. Repetir opcionalmente para `storage.tar.gz.age`. Eliminar siempre `$TMP_R2` al terminar.

---

## 14. Listar backups locales

```bash
bash scripts/backup/local-list.sh \
  "$LOCAL_BACKUP_DIR"
```

Ejemplo:

```text
Available local backups:

DAILY
  20260818T045852Z-32101100102  [verified-checksums]

Total: 1
```

| Estado | Significado |
|--------|-------------|
| `incomplete` | Faltan archivos o SHA-256 no coincide |
| `verified-checksums` | Cinco artefactos + sidecars OK — **no** sustituye `local-verify.sh` |

Lista también `weekly/` y `monthly/` si existen.

---

## 15. Retención local

Manual. Default: **dry-run** (no borra).

```bash
bash scripts/backup/local-retention.sh \
  "$LOCAL_BACKUP_DIR" \
  --dry-run
```

Defaults reales del script:

```text
--keep-daily 7
--keep-weekly 2
--keep-monthly 1
```

Aplicar borrado solo con confirmación explícita:

```bash
bash scripts/backup/local-retention.sh \
  "$LOCAL_BACKUP_DIR" \
  --apply
```

- Sin cron. Sin GitHub Actions. **No** modifica R2.

---

## 16. Restore desde copia local

Operación de **recuperación**. Siempre requiere:

```text
CONFIRM_RESTORE=RESTORE
RESTORE_ISOLATED=yes
RESTORE_TARGET_DB_URL=<copiada del Dashboard>
```

`RESTORE_TARGET_DB_URL` es obligatoria **incluso** con `RESTORE_DRY_RUN=1` (`restore_require_guards` en `lib.sh`).

---

### A. Restore drill / prueba

**Objetivo:** demostrar que la copia local permite reconstruir un proyecto aislado.

**Target:** staging / restore-validation — proyecto **nuevo o completamente limpio** (§17). Evita falsos positivos por datos preexistentes.

**Orden recomendado:**

1. Preparar staging vacío (§17)
2. `local-verify.sh` (§10)
3. Dry-run:

```bash
export RESTORE_TARGET_DB_URL='...'   # copiar del Dashboard → Session Pooler
export BACKUP_AGE_IDENTITY_FILE='/ruta/real/verify-age-key.txt'

RESTORE_DRY_RUN=1 \
CONFIRM_RESTORE=RESTORE \
RESTORE_ISOLATED=yes \
bash scripts/backup/local-restore.sh \
  "$BACKUP_ID" \
  "$LOCAL_BACKUP_DIR"
```

Resultado esperado:

```text
[backup-local-restore] RESTORE_DRY_RUN=1 — skipping psql apply
[backup-local-restore] restore finished. ...
```

4. Restore real con Storage:

```bash
export SUPABASE_URL='...'                    # Project URL del target
export SUPABASE_SERVICE_ROLE_KEY='...'       # service_role del target
export BACKUP_AGE_IDENTITY_FILE='/ruta/real/backup-age-key.txt'

CONFIRM_RESTORE=RESTORE \
RESTORE_ISOLATED=yes \
RESTORE_STORAGE=1 \
bash scripts/backup/local-restore.sh \
  "$BACKUP_ID" \
  "$LOCAL_BACKUP_DIR"
```

5. Validar (§18–§19)

> **Nunca ejecutar un restore contra producción como parte de una prueba.**

Si `roles.sql` falla en Supabase gestionado:

```bash
SKIP_ROLES=1 CONFIRM_RESTORE=RESTORE RESTORE_ISOLATED=yes RESTORE_STORAGE=1 \
  bash scripts/backup/local-restore.sh "$BACKUP_ID" "$LOCAL_BACKUP_DIR"
```

---

### B. Disaster recovery real

**Objetivo:** recuperar el servicio tras un incidente real.

- Usar un **proyecto de recuperación aislado** (nuevo Supabase), nunca asumir que un URL es seguro sin verificarlo.
- Confirmar explícitamente el target con el operador antes de ejecutar.
- Confirmar `RESTORE_ISOLATED=yes` y que se conoce el impacto (sobrescribe datos del target).
- Ejecutar el mismo `local-restore.sh` que en el drill (§16.A), con identity **master** recomendada.
- Tras restore: reconfigurar OAuth/SSO, SMTP, Site URL, Redirect URLs; usuarios deben re-login.

> Para cutover DNS, Render, RTO/RPO y decisiones de negocio, consultar [`backup-disaster-recovery-runbook.md`](backup-disaster-recovery-runbook.md). **La ejecución técnica del restore local permanece en este documento.**

Flujo interno del script:

```text
database.tar.gz.age  → decrypt → tar → roles.sql / schema.sql / data.sql → psql
storage.tar.gz.age   → decrypt → tar → PUT Storage (si RESTORE_STORAGE=1)
```

Plaintext solo en `/tmp/nomadas-local-restore.*`.

---

## 17. Preparar staging / target aislado

Procedimiento **completo** para un restore drill o proyecto de recuperación. No es necesario recrear staging para una simple copia local (§7).

### Crear proyecto aislado

```text
Supabase Dashboard
  → organización (la del equipo)
  → New project
  → project name        (elegir nombre descriptivo, p. ej. restore-drill-YYYYMMDD)
  → database password   (generar y guardar en gestor de secretos)
  → region              (elegir región)
  → Create project
```

Esperar a que el proyecto termine de aprovisionarse.

### Confirmar que está vacío

SQL Editor del proyecto nuevo:

```sql
select count(*) from auth.users;
select count(*) from auth.identities;
```

Esperar:

```text
0
0
```

Verificar que `public.users` aún no existe:

```sql
select to_regclass('public.users');
```

`NULL` es **normal** — el schema de negocio llegará con `schema.sql` durante el restore.

### Obtener DB target (Session Pooler)

> Copiar **exactamente** la connection string mostrada en Supabase. **No construir manualmente** el hostname del pooler.

```text
Supabase Dashboard
  → proyecto aislado
  → Connect
  → Session pooler
  → copiar URI (modo Session)
  → sustituir [YOUR-PASSWORD] por la contraseña del proyecto
```

```bash
export RESTORE_TARGET_DB_URL='...'
```

Comprobar conexión (opcional, no imprimir la URL):

```bash
psql "$RESTORE_TARGET_DB_URL" -c 'select 1 as ok;'
```

### Obtener credenciales Supabase del target

**Project URL** (`SUPABASE_URL`):

```text
Supabase Dashboard → Project Settings → API → Project URL
```

**Service role key** (`SUPABASE_SERVICE_ROLE_KEY`):

```text
Supabase Dashboard → Project Settings → API → service_role
```

(Copiar al gestor de secretos; no pegar en tickets.)

**Publishable / anon key** (validación login §18):

```text
Supabase Dashboard → Project Settings → API → anon / publishable key
```

### Confirmación final (sin imprimir valores)

```bash
test -n "$RESTORE_TARGET_DB_URL" && echo "DB target configured"
test -n "$SUPABASE_URL" && echo "Supabase target configured"
test -n "$SUPABASE_SERVICE_ROLE_KEY" && echo "Storage target credentials configured"
export CONFIRM_RESTORE=RESTORE
export RESTORE_ISOLATED=yes
echo "Restore guards configured"
```

### Checklist antes de restore

```text
[ ] Proyecto confirmado como aislado (no producción)
[ ] auth.users = 0, auth.identities = 0
[ ] RESTORE_TARGET_DB_URL copiada del Dashboard (Session Pooler)
[ ] SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del mismo proyecto
[ ] BACKUP_AGE_IDENTITY_FILE configurada
[ ] local-verify.sh → local verify PASS
[ ] CONFIRM_RESTORE=RESTORE y RESTORE_ISOLATED=yes
```

Referencia complementaria del drill histórico: [`backup-disaster-recovery-operations.md`](backup-disaster-recovery-operations.md#restore-drill--complete-procedure).

---

## 18. Validación funcional después del restore

### SQL

```bash
psql "$RESTORE_TARGET_DB_URL" -c 'select count(*) from auth.users;'
psql "$RESTORE_TARGET_DB_URL" -c 'select count(*) from auth.identities;'
psql "$RESTORE_TARGET_DB_URL" -c 'select count(*) from public.users;'
```

Comparar `auth.users` / `auth.identities` con el manifest (§12).

### Login (WSL)

Usar usuario de **prueba del drill** — nunca credenciales de producción en documentación.

```bash
export DRILL_SUPABASE_URL="$SUPABASE_URL"
export DRILL_SUPABASE_PUBLISHABLE_KEY='<anon-key-del-target>'
export TEST_EMAIL='<usuario-prueba@example.com>'
export TEST_PASSWORD='<placeholder>'
```

```bash
RESP="$(curl -sS \
  -X POST \
  "${DRILL_SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${DRILL_SUPABASE_PUBLISHABLE_KEY}" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\"}")"

export ACCESS_TOKEN="$(printf '%s' "$RESP" | jq -r '.access_token // empty')"
[[ -n "$ACCESS_TOKEN" && "$ACCESS_TOKEN" != "null" ]] || echo 'login failed'
```

**No** imprimir `$ACCESS_TOKEN` en logs compartidos.

### RLS vía API

```bash
curl -sS \
  -H "apikey: ${DRILL_SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "${DRILL_SUPABASE_URL}/rest/v1/trips?select=id&limit=1"
```

Repetir sobre `reservations` y lecturas representativas según rol.

### Storage

Confirmar al menos un objeto real accesible (p. ej. logo en `agency-assets`) vía app o Storage API.

---

## 19. ¿Cuándo está validado un restore?

Un restore **técnicamente terminado** (script sin error) **no** equivale a un restore **funcional validado**. Checklist para restore drill:

```text
[ ] Database restore PASS (psql aplicó roles/schema/data o SKIP_ROLES documentado)
[ ] Storage restore PASS (si RESTORE_STORAGE=1)
[ ] auth.users restaurados (conteo > 0, coherente con manifest)
[ ] auth.identities restaurados
[ ] public.users restaurados
[ ] login con contraseña restaurada funciona
[ ] JWT nuevo emitido y usable
[ ] RLS funciona (lecturas autorizadas / denegadas según rol)
[ ] reservations accesibles vía API
[ ] trips accesibles vía API
[ ] al menos un Storage object accesible
```

Registrar evidencia **sin secretos** (backup_id, timestamp, conteos, resultado PASS/FAIL).

---

## 20. Seguridad

### Confidencialidad vs permisos de filesystem

`age` proporciona la **confidencialidad criptográfica** del backup. Los permisos del filesystem (Linux en WSL, NTFS en `/mnt/c/...`) son una **capa adicional** — no sustituyen el cifrado.

- En WSL, `local.sh` intenta `chmod 700` en el directorio y `600` en los archivos.
- Permisos **NTFS** y comportamiento de `/mnt/c/` pueden diferir de un filesystem Linux nativo.
- No exagerar la seguridad del filesystem: quien tenga acceso al disco **y** la private key puede descifrar.

### NEVER

- Commitear private keys `age`
- Guardar private keys dentro de `<LOCAL_BACKUP_DIR>` o junto a ciphertexts
- Usar identity inline como método normal (historial de shell / entorno del proceso)
- Imprimir access tokens, service role keys ni connection strings
- Compartir el directorio de backups por red no confiable
- Dejar `database.tar.gz`, `data.sql` u otros plaintext fuera de `/tmp` controlado por los scripts

---

## 21. Troubleshooting

| Error / situación | Causa probable | Acción |
|-------------------|----------------|--------|
| `required command not found: aws` | AWS CLI no instalado | `sudo apt update && sudo apt install -y awscli` |
| `missing required environment variable: R2_*` | Credenciales R2 no exportadas | Exportar las tres variables R2 antes de `local.sh` |
| `no age identity available for decrypt` | Identity no configurada | `export BACKUP_AGE_IDENTITY_FILE='/ruta/verify-age-key.txt'` |
| `SHA-256 mismatch` | Corrupción o descarga incompleta | Eliminar carpeta del backup; repetir `local.sh` |
| `manifest backup_id does not match` | `BACKUP_ID` incorrecto | Verificar ID en manifest R2 |
| `not an age ciphertext` | Archivo dañado | Eliminar copia; repetir `local.sh` |
| `destination already exists` | Intento previo en el mismo path | Si `local-verify.sh` pasa → copia ya válida; si no → `rm -rf` carpeta y repetir |
| Descarga interrumpida | Red / R2 | **No** reutilizar carpeta parcial; eliminar si existe; repetir `local.sh` |
| `local verify` falla tras descarga OK | Identity, checksum o manifest | Revisar identity; eliminar copia; volver a copiar |
| Verify OK pero restore falla | Target DB, Storage o credenciales | Separar: ¿falló psql, roles, o PUT Storage? |
| `refusing to restore: set CONFIRM_RESTORE=RESTORE` | Guard | `export CONFIRM_RESTORE=RESTORE` |
| `refusing to restore: set RESTORE_ISOLATED=yes` | Guard | `export RESTORE_ISOLATED=yes` |
| `RESTORE_DRY_RUN=1 — skipping psql apply` | Dry-run normal | No es error |
| Storage restore falla | URL/key del target | Revisar `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` del **aislado** |
| R2 no responde | Outage | Usar copia local ya verificada; `local-verify.sh` / `local-restore.sh` sin R2 |

---

## 22. Documentación complementaria

Este tutorial cubre:

```text
R2 → local copy → offline verify → local restore
```

Referencia externa (no obligatoria para el flujo local):

| Tema | Documento |
|------|-----------|
| Backup automático, cron, workflow, secrets iniciales | [`backup-disaster-recovery-operations.md`](backup-disaster-recovery-operations.md) |
| Cutover, escenarios de pérdida, RTO/RPO | [`backup-disaster-recovery-runbook.md`](backup-disaster-recovery-runbook.md) |
| Reconstrucción Render / GitHub / servicios | [`RECOVERY-CHECKLIST.md`](RECOVERY-CHECKLIST.md) |

### Comandos de referencia (copia + verify)

```bash
export LOCAL_BACKUP_DIR="/mnt/c/Users/<usuario>/nomadas-backups"
export BACKUP_ID='20260818T045852Z-32101100102'
export BACKUP_AGE_IDENTITY_FILE='/ruta/verify-age-key.txt'
export R2_ACCOUNT_ID='...'
export R2_ACCESS_KEY_ID='...'
export R2_SECRET_ACCESS_KEY='...'

bash scripts/backup/local.sh "$BACKUP_ID" "$LOCAL_BACKUP_DIR"

unset R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
bash scripts/backup/local-verify.sh "$BACKUP_ID" "$LOCAL_BACKUP_DIR"
```

Tests automatizados del repo (sin red de producción):

```bash
bash scripts/backup/test-local.sh
```
