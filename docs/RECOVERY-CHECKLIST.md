# Recovery checklist

Usar junto con [`backup-disaster-recovery-runbook.md`](backup-disaster-recovery-runbook.md) (emergencia), [`backup-disaster-recovery-operations.md`](backup-disaster-recovery-operations.md) (instalación y operación del backup automático) y [`backup-local-contingency.md`](backup-local-contingency.md) (copia local manual: descargar, verify offline, restore desde disco).
**No pegar valores secretos en este archivo ni en tickets públicos.**

RPO 24 h / RTO target 8 h / RTO estimado ~90 min (no es SLA).

---

## 1. Identidad del incidente

- [ ] Fecha/hora UTC del desastre
- [ ] Qué se perdió (proyecto Supabase / R2 / GitHub Actions / Render / credenciales)
- [ ] `backup_id` elegido (último verify PASS anterior al incidente)
- [ ] Operador y testigo

---

## 2. Secretos y nombres (valores: fuera de git)

### GitHub Actions (backup)

- [ ] `SUPABASE_DB_URL`
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `BACKUP_AGE_RECIPIENT`
- [ ] `BACKUP_AGE_VERIFY_RECIPIENT`
- [ ] `BACKUP_AGE_VERIFY_IDENTITY`
- [ ] `R2_ACCOUNT_ID`
- [ ] `R2_ACCESS_KEY_ID`
- [ ] `R2_SECRET_ACCESS_KEY`

### Restore offline

- [ ] `BACKUP_AGE_SECRET_KEY` (master; **solo offline**)
- [ ] `RESTORE_TARGET_DB_URL` (proyecto **aislado** o nuevo)
- [ ] `CONFIRM_RESTORE=RESTORE`
- [ ] `RESTORE_ISOLATED=yes`

### Custodia de claves `age` (obligatorio)

**Pública — puede estar online**

- [ ] `BACKUP_AGE_RECIPIENT` en GitHub Actions Secrets (cifra el backup)

**Privada master — debe permanecer offline**

- [ ] `BACKUP_AGE_SECRET_KEY` **no** está en GitHub, R2, el repo, Render, Supabase ni logs
- [ ] Copia 1: password manager
- [ ] Copia 2: segunda copia offline segura
- [ ] Opcional: tercera ubicación física segura

El par `BACKUP_AGE_VERIFY_*` solo sirve para verificar en CI; **no** sustituye la master offline. Sin la master no hay restore ante desastre.

### Copia local de contingencia

Tutorial paso a paso: [`backup-local-contingency.md`](backup-local-contingency.md).

- [ ] `LOCAL_DIR` elegido por el operador (p. ej. `/mnt/c/Users/<usuario>/nomadas-backups`)
- [ ] Copia descargada con `local.sh` → log **`local copy PASS`**
- [ ] `local-verify.sh` offline → log **`local verify PASS`**
- [ ] Cinco artefactos bajo `<LOCAL_DIR>/daily/<backup_id>/` (sin plaintext persistente)
- [ ] Private key `age` **no** está junto a esa carpeta

### R2

- [ ] Bucket `nomadas-backups` (privado)
- [ ] Prefijo `production/…` y, si aplica, `restore-drills/`

---

## 3. Servicios a reconstruir

| Servicio | Dónde | Notas |
|----------|--------|--------|
| Git | GitHub `nomadas-tour` | Código + `supabase/migrations` |
| Backup job | `.github/workflows/backup.yml` | No sustituye restore |
| Postgres + API | Proyecto Supabase **nuevo o aislado** | `data.sql` incluye Auth users/identities |
| Storage | Mismos buckets (descubiertos en el archive) | Bytes en `storage.tar.gz.age` |
| Auth | Filas restauradas + config de plataforma | Re-login; OAuth/SSO/SMTP/URLs manuales |
| API | Render, root `backend` | Ver `docs/backend-deploy.md` |
| Worker | Render worker | `npm run worker`; flags de outbox |
| Frontend | Render/host del Next.js | Env públicas, no secrets de backup |
| DNS | Proveedor DNS | Apuntar a Render / URLs nuevas |

---

## 4. Orden de recuperación

- [ ] Crear proyecto Supabase aislado/nuevo (manual)
- [ ] Elegir fuente: R2 (`restore.sh`) **o** copia local verificada — ver [`backup-local-contingency.md`](backup-local-contingency.md) §16 (`local-verify.sh` → `local-restore.sh`)
- [ ] Restore database including Auth users/identities
- [ ] Verify Auth users restored
- [ ] Verify Auth identities restored
- [ ] Storage desde `storage.tar.gz.age` (`RESTORE_STORAGE=1` o upload preservando paths)
- [ ] Reconfigure OAuth/SSO if applicable
- [ ] Reconfigure SMTP / Site URL / Redirect URLs
- [ ] Copiar env de app a Render (DB URL, anon, service role **del proyecto nuevo**)
- [ ] Build/deploy API + worker + frontend
- [ ] Validate password login
- [ ] Validate JWT/RLS
- [ ] Users re-login
- [ ] Re-register WebAuthn/Passkeys if used
- [ ] Smoke tests (abajo)
- [ ] Decidir cutover DNS
- [ ] Registrar evidencia del drill o incidente

---

## 5. Smoke tests (entorno aislado)

### Database

- [ ] Conexión `psql`
- [ ] Schemas esperados (`public`, …)
- [ ] Tablas críticas (`trips`, `reservations`, `seats`, `agencies`, `audit_log`, …)
- [ ] Funciones / RPCs
- [ ] Triggers
- [ ] RLS habilitado en tablas tenant
- [ ] Conteos de filas no vacíos vs. lo esperado del backup
- [ ] Versión/migración (`supabase/migrations` vs. lo aplicado)

### Application

- [ ] API `GET /health`
- [ ] Worker `GET /healthz`
- [ ] Login
- [ ] JWT aceptado / RLS (`public.users`, reservations, trips)
- [ ] Lectura de viajes
- [ ] Lectura de reservas
- [ ] Crear **una** reserva de prueba **solo en aislado**
- [ ] Audit trail lectura

### Storage

- [ ] Al menos un objeto real (p. ej. logo en `agency-assets`) accesible

---

## 6. GitHub / R2 / Render — recreación

- [ ] Secrets de Actions cargados de nuevo si se rotaron
- [ ] Workflow `backup` con `permissions: contents: read`
- [ ] Primer `workflow_dispatch` PASS después de recuperar
- [ ] Render: Root Directory `backend`, `npm install && npm run build`, `npm start`
- [ ] Worker: mismas env de producto que antes (**no** secrets de backup)

---

## 7. Cierre

- [ ] Auth users/identities restaurados desde `data.sql`; usuarios re-login; JWTs viejos no reutilizados
- [ ] OAuth/SSO/SMTP/Site URL/Redirect URLs reconfigurados si aplican
- [ ] Nadie restauró producción sin `RESTORE_ISOLATED` / confirmación
- [ ] Notas en `restore-drills/` (R2) o ticket interno **sin secretos**
