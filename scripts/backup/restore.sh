#!/usr/bin/env bash
# Manual restore from an R2 backup into an EXPLICIT isolated target.
# Never defaults to production.
# Auth user data and identities are restored from data.sql.
# Users must re-login after restore. Old JWTs, sessions, and refresh tokens
# are not considered reusable. External OAuth/SSO/SMTP/platform configuration
# requires manual reconfiguration.
#
# session_replication_role: not set here. supabase db dump --data-only already
# emits SET session_replication_role = replica inside data.sql. The extra
# --command used in the manual drill is redundant for those dumps. Auth rows
# appear because data.sql contains COPY "auth"."users" / COPY "auth"."identities".
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_LOG_PREFIX="backup-restore"

usage() {
  cat <<'EOF'
Usage:
  CONFIRM_RESTORE=RESTORE \
  RESTORE_ISOLATED=yes \
  RESTORE_TARGET_DB_URL=postgres://... \
  BACKUP_ID=<id> \
  BACKUP_AGE_SECRET_KEY='AGE-SECRET-KEY-1...' \
  scripts/backup/restore.sh

Optional:
  RESTORE_STORAGE=1
  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (target project, for Storage PUT)
  SKIP_ROLES=1   (if roles restore is not permitted on the target)

Refuses to run unless CONFIRM_RESTORE=RESTORE and RESTORE_ISOLATED=yes.
Set RESTORE_ALLOW_PRODUCTION=I_UNDERSTAND only if you intentionally target prod
(not used in the quarterly isolated drill).
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_env BACKUP_ID RESTORE_TARGET_DB_URL

if [[ "${CONFIRM_RESTORE:-}" != "RESTORE" ]]; then
  die "refusing to restore: set CONFIRM_RESTORE=RESTORE"
fi
if [[ "${RESTORE_ISOLATED:-}" != "yes" ]]; then
  die "refusing to restore: set RESTORE_ISOLATED=yes (isolated target only)"
fi

require_cmd tar gzip age aws psql jq

if [[ -n "${PRODUCTION_DB_URL_MARKER:-}" ]]; then
  case "${RESTORE_TARGET_DB_URL}" in
    *"${PRODUCTION_DB_URL_MARKER}"*)
      if [[ "${RESTORE_ALLOW_PRODUCTION:-}" != "I_UNDERSTAND" ]]; then
        die "target URL looks like production; aborting"
      fi
      ;;
  esac
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/nomadas-restore.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

DB_KEY="production/database/daily/${BACKUP_ID}/database.tar.gz.age"
ST_KEY="production/storage/daily/${BACKUP_ID}/storage.tar.gz.age"

log "downloading database ciphertext ${DB_KEY}"
r2_cp_down "$DB_KEY" "${WORK}/database.tar.gz.age"
age_decrypt "${WORK}/database.tar.gz.age" "${WORK}/database.tar.gz"
mkdir -p "${WORK}/db"
tar -xzf "${WORK}/database.tar.gz" -C "${WORK}/db"
assert_roles_sql "${WORK}/db/roles.sql"
assert_schema_sql "${WORK}/db/schema.sql"
assert_data_sql_backup_contract "${WORK}/db/data.sql"

PSQL=(psql --single-transaction --variable ON_ERROR_STOP=1 --dbname "${RESTORE_TARGET_DB_URL}")

if [[ "${SKIP_ROLES:-0}" != "1" ]]; then
  log "restoring roles.sql"
  "${PSQL[@]}" --file "${WORK}/db/roles.sql"
else
  log "SKIP_ROLES=1 — skipping roles.sql"
fi

log "restoring schema.sql"
"${PSQL[@]}" --file "${WORK}/db/schema.sql"
log "restoring data.sql"
"${PSQL[@]}" --file "${WORK}/db/data.sql"
log "database restore statements applied"

if [[ "${RESTORE_STORAGE:-0}" == "1" ]]; then
  require_env SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
  log "downloading storage ciphertext"
  r2_cp_down "$ST_KEY" "${WORK}/storage.tar.gz.age"
  age_decrypt "${WORK}/storage.tar.gz.age" "${WORK}/storage.tar.gz"
  mkdir -p "${WORK}/st"
  tar -xzf "${WORK}/storage.tar.gz" -C "${WORK}/st"
  require_cmd python3 curl
  python3 - "$WORK/st" <<'PY'
import os, sys, urllib.parse, subprocess
root = sys.argv[1]
url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
for dirpath, _, files in os.walk(root):
    for name in files:
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, root).replace("\\", "/")
        bucket, _, path = rel.partition("/")
        if not path:
            continue
        encoded = urllib.parse.quote(path, safe="/")
        dest = f"{url}/storage/v1/object/{bucket}/{encoded}"
        subprocess.check_call([
            "curl", "-fsS", "-X", "POST", dest,
            "-H", f"Authorization: Bearer {key}",
            "-H", f"apikey: {key}",
            "-H", "x-upsert: true",
            "-F", f"file=@{full}",
        ])
        print(f"restored {bucket}/{path}", file=sys.stderr)
PY
  log "storage objects uploaded to target project"
fi

log "restore finished. Auth user data and identities are restored from data.sql."
log "Users must re-login after restore. Old JWTs, sessions, and refresh tokens are not considered reusable."
log "External OAuth/SSO/SMTP/platform configuration requires manual reconfiguration."
log "Next: configure project, deploy API/worker, smoke tests (isolated). See docs/backup-disaster-recovery-runbook.md"
