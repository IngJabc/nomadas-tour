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

require_env BACKUP_ID
restore_require_guards
require_cmd tar gzip age jq
if [[ "${BACKUP_R2_FIXTURE_DIR:-}" == "" ]]; then
  require_cmd aws
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
restore_apply_database "${WORK}/db"

if [[ "${RESTORE_STORAGE:-0}" == "1" ]]; then
  log "downloading storage ciphertext"
  r2_cp_down "$ST_KEY" "${WORK}/storage.tar.gz.age"
  age_decrypt "${WORK}/storage.tar.gz.age" "${WORK}/storage.tar.gz"
  mkdir -p "${WORK}/st"
  tar -xzf "${WORK}/storage.tar.gz" -C "${WORK}/st"
  restore_apply_storage "${WORK}/st"
fi

restore_log_finished
